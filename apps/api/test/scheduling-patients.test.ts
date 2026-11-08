/** AT-03 (eşzamanlı çift rezervasyon), AT-04 (doğum tarihi / ortak telefon), hasta ve randevu kuralları, PİA Akış. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import pg from "pg";
import { EMAILS, login, ownerQuery, startApp, tomorrowIstanbul, type Client } from "./helpers.js";
import { WORKER_URL } from "./env.js";
import { processOutbox, scanAllTenants } from "../../worker/src/jobs.js";
import { zonedToUtc } from "@viadent/contracts";

let app: INestApplication;
let sec: Client;
let res: { practitioners: { id: string }[]; chairs: { id: string }[] };
let patients: { id: string }[];

beforeAll(async () => {
  app = await startApp();
  sec = await login(app, EMAILS.aSecretary);
  res = (await sec.get("/resources").expect(200)).body;
  patients = (await sec.get("/patients?limit=50").expect(200)).body.items;
});
afterAll(async () => app.close());

const appt = (over: Record<string, unknown> = {}) => ({
  patientId: patients[0]!.id, practitionerId: res.practitioners[0]!.id, chairId: res.chairs[0]!.id,
  date: tomorrowIstanbul(5), startTime: "13:00", durationMinutes: 30, reason: "Kontrol", allowOutsideHours: true, ...over,
});

describe("AT-03 aynı hekim/koltuğa eşzamanlı randevu", () => {
  it("aynı anda gönderilen 6 istekten yalnız biri başarılı, diğerleri anlamlı çakışma", async () => {
    const reqs = await Promise.all(
      Array.from({ length: 6 }, (_, i) => sec.post("/appointments", appt({ patientId: patients[i + 1]!.id, chairId: res.chairs[i % 3]!.id }))),
    );
    const ok = reqs.filter((r) => r.status === 201);
    const conflict = reqs.filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(conflict).toHaveLength(5);
    for (const r of conflict) {
      expect(r.body.code).toBe("APPOINTMENT_CONFLICT");
      expect(r.body.message).toMatch(/dolu/);
    }
    const rows = await ownerQuery(sec.session.activeMembership.tenantId,
      "select count(*)::int as n from appointments where practitioner_id = $1 and starts_at = $2 and status <> 'cancelled'",
      [res.practitioners[0]!.id, ok[0]!.body.startsAt]);
    expect(rows[0].n).toBe(1);
  });

  it("farklı hekim aynı koltuğa aynı anda alınamaz (ünite çakışması)", async () => {
    await sec.post("/appointments", appt({ startTime: "15:00" })).expect(201);
    const r = await sec.post("/appointments", appt({ startTime: "15:10", practitionerId: res.practitioners[1]!.id, patientId: patients[2]!.id }));
    expect(r.status).toBe(409);
    expect(r.body.details.resource).toBe("ünite");
  });

  it("[başlangıç, bitiş) — bitişi aynı anda olan randevular çakışmaz", async () => {
    await sec.post("/appointments", appt({ startTime: "16:00", durationMinutes: 30 })).expect(201);
    await sec.post("/appointments", appt({ startTime: "16:30", durationMinutes: 30, patientId: patients[3]!.id })).expect(201);
  });

  it("iptal edilen randevu kapasiteyi bırakır; iptal nedeni zorunlu", async () => {
    const a = (await sec.post("/appointments", appt({ startTime: "17:00" })).expect(201)).body;
    expect((await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "cancelled" })).status).toBe(422);
    await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "cancelled", cancelReason: "Hasta erteledi" }).expect(200);
    await sec.post("/appointments", appt({ startTime: "17:00", patientId: patients[4]!.id })).expect(201);
  });

  it("geçersiz durum geçişi ve eski sürümle güncelleme reddedilir", async () => {
    const a = (await sec.post("/appointments", appt({ startTime: "18:00" })).expect(201)).body;
    const done = await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "completed" });
    expect(done.status).toBe(422);
    expect(done.body.code).toBe("INVALID_TRANSITION");
    const future = await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "no_show" });
    expect(future.status).toBe(422);
    await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "confirmed" }).expect(200);
    const stale = await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "cancelled", cancelReason: "x" });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("VERSION_CONFLICT");
  });

  it("iletişim sonucu randevu durumunu değiştirmez ('Bilgi verildi' ≠ geldi)", async () => {
    const a = (await sec.post("/appointments", appt({ startTime: "19:00" })).expect(201)).body;
    const r = (await sec.post(`/appointments/${a.id}/contact`, { version: a.version, contactOutcome: "informed" }).expect(200)).body;
    expect(r.contactOutcome).toBe("informed");
    expect(r.status).toBe("planned");
  });

  it("asistan randevu oluşturamaz (sunucu yetkisi)", async () => {
    const asst = await login(app, EMAILS.aAssistant);
    if (asst) expect((await asst.post("/appointments", appt({ startTime: "20:00" }))).status).toBe(403);
  });
});

describe("AT-04 doğum tarihi ve ortak aile telefonu", () => {
  it("gelecek doğum tarihi sunucuda reddedilir", async () => {
    const r = await sec.post("/patients", { firstName: "Gelecek", lastName: "Tarihli", birthDate: tomorrowIstanbul(1) });
    expect(r.status).toBe(422);
    expect(r.body.field_errors.birthDate).toMatch(/gelecekte/);
  });

  it("DB tetikleyicisi de gelecek doğum tarihini engeller (ikinci savunma)", async () => {
    await expect(ownerQuery(sec.session.activeMembership.tenantId,
      "update patients set birth_date = current_date + 30 where id = $1", [patients[0]!.id])).rejects.toThrow(/birth_date_in_future/);
  });

  it("bilinmeyen doğum tarihi uydurulmaz (boş kabul edilir)", async () => {
    const r = await sec.post("/patients", { firstName: "Tarihsiz", lastName: "Kayıt" }).expect(201);
    expect(r.body.patient.birthDate).toBeNull();
    expect(r.body.patient.age).toBeNull();
  });

  it("aynı telefonu kullanan aile bireyi kaydı engellenmez; bilgi uyarısı döner", async () => {
    const first = await sec.post("/patients", { firstName: "Leyla", lastName: "Aksoy", birthDate: "1985-04-12", phone: "0555 000 99 11" }).expect(201);
    const child = await sec.post("/patients", { firstName: "Ece", lastName: "Aksoy", birthDate: "2015-09-03", phone: "+90 555 000 9911" });
    expect(child.status).toBe(201);
    expect(child.body.warnings.map((w: { kind: string; id: string }) => [w.kind, w.id])).toContainEqual(["shared_phone", first.body.patient.id]);
    expect(child.body.patient.phone).toBe("+905550009911");
  });

  it("aynı ad + aynı doğum tarihi mükerrer aday döner; bilinçli onayla kaydedilir", async () => {
    const body = { firstName: "Hakan", lastName: "Yücel", birthDate: "1979-02-20" };
    await sec.post("/patients", body).expect(201);
    const dup = await sec.post("/patients", { ...body, firstName: "hakan", lastName: "YÜCEL" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("DUPLICATE_CANDIDATES");
    expect(dup.body.details.candidates[0].kind).toBe("same_person_likely");
    const ok = await sec.post("/patients", { ...body, acknowledgeDuplicates: true });
    expect(ok.status).toBe(201);
    expect(ok.body.patient.firstName).toBe("Hakan");
  });

  it("geçersiz TCKN biçimi reddedilir; aynı kimlik no ikinci kez kaydedilemez", async () => {
    const bad = await sec.post("/patients", { firstName: "Kimlik", lastName: "Hatalı", nationalIdType: "tckn", nationalId: "12345678901" });
    expect(bad.status).toBe(422);
    // Algoritmik olarak geçerli SENTETİK numara (10000000146).
    await sec.post("/patients", { firstName: "Kimlik", lastName: "Bir", nationalIdType: "tckn", nationalId: "10000000146" }).expect(201);
    const again = await sec.post("/patients", { firstName: "Başka", lastName: "Kişi", nationalIdType: "tckn", nationalId: "10000000146" });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("DUPLICATE_IDENTITY");
  });
});

describe("Hasta arama, güncelleme ve PİA İz", () => {
  it("Türkçe karakterden bağımsız arama ve dosya no / telefon ile bulma", async () => {
    await sec.post("/patients", { firstName: "Şükrü", lastName: "Işıklı", phone: "05550008877" }).expect(201);
    const byName = (await sec.get("/patients?q=sukru%20isikli").expect(200)).body.items;
    expect(byName[0].fullName).toBe("Şükrü Işıklı");
    const byPhone = (await sec.get("/patients?q=8877").expect(200)).body.items;
    expect(byPhone.some((p: { fullName: string }) => p.fullName === "Şükrü Işıklı")).toBe(true);
    const byFile = (await sec.get(`/patients?q=${byName[0].fileNo}`).expect(200)).body.items;
    expect(byFile[0].id).toBe(byName[0].id);
  });

  it("güncelleme sürüm kontrolü yapar; geçmişte yalnız değişen alanlar görünür", async () => {
    const p = (await sec.post("/patients", { firstName: "Derya", lastName: "Kaplan", city: "Batman" }).expect(201)).body.patient;
    const u = (await sec.patch(`/patients/${p.id}`, { version: p.version, city: "Diyarbakır", phone: "05550001234" }).expect(200)).body;
    expect(u.version).toBe(p.version + 1);
    const stale = await sec.patch(`/patients/${p.id}`, { version: p.version, city: "Mardin" });
    expect(stale.status).toBe(409);
    const hist = (await sec.get(`/patients/${p.id}/history`).expect(200)).body.items;
    const upd = hist.find((e: { action: string }) => e.action === "patient.update");
    expect(Object.keys(upd.changes).sort()).toEqual(["city", "phone_e164"]);
    expect(upd.changes.city).toEqual({ from: "Batman", to: "Diyarbakır" });
    // Telefon audit'e tam yazılmaz.
    expect(JSON.stringify(upd.changes.phone_e164)).not.toContain("5550001234");
    expect(upd.actorName).toBe("Nur Ekinci");
  });
});

describe("PİA Akış", () => {
  it("aynı olay için ikinci yenilemede görev tekrar oluşmaz", async () => {
    await sec.post("/via-akis/refresh").expect(200);
    const second = (await sec.post("/via-akis/refresh").expect(200)).body;
    expect(second.created).toBe(0);
  });

  it("geciken randevu 'Geldi' işaretlenince görev kaynaktan kapanır", async () => {
    // Test günün saatinden bağımsız olsun: tarama, klinik saatiyle bugün 23:30'daymış gibi çalıştırılır
    // (seed'deki 10:00/14:00/15:30 planlı randevular gecikmiş sayılır).
    const scanPool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
    try {
      await scanAllTenants(scanPool, zonedToUtc(tomorrowIstanbul(0), "23:30", "Europe/Istanbul"));
    } finally {
      await scanPool.end();
    }
    const tasks = (await sec.get("/tasks").expect(200)).body.items;
    const overdue = tasks.find((t: { kind: string }) => t.kind === "overdue_checkin");
    expect(overdue).toBeTruthy();
    expect(overdue.reason).toMatch(/geçti/);
    expect(overdue.nextStep).toBeTruthy();
    expect(overdue.assigneeRole).toBe("secretary");
    const day = (await sec.get("/appointments").expect(200)).body.items;
    const a = day.find((x: { id: string }) => x.id === overdue.sourceId);
    await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "checked_in" }).expect(200);

    // Outbox olayı kısıtlı worker rolüyle işlenir.
    const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
    try {
      expect(await processOutbox(pool)).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
    const open = (await sec.get("/tasks").expect(200)).body.items;
    expect(open.find((t: { id: string }) => t.id === overdue.id)).toBeUndefined();
    const closed = (await sec.get("/tasks?status=closed").expect(200)).body.items.find((t: { id: string }) => t.id === overdue.id);
    expect(closed.closedReason).toMatch(/checked_in/);
  });

  it("kullanıcı görevi tamamlayabilir; iptal gerekçe ister", async () => {
    const t = (await sec.get("/tasks").expect(200)).body.items[0];
    expect((await sec.post(`/tasks/${t.id}/status`, { status: "cancelled" })).status).toBe(422);
    await sec.post(`/tasks/${t.id}/status`, { status: "done", closedReason: "Hasta arandı" }).expect(200);
    expect((await sec.post(`/tasks/${t.id}/status`, { status: "in_progress" })).status).toBe(422);
  });
});
