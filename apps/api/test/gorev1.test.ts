/**
 * Görev 1: çalışma saatleri (T05), kapatma (T06), işlem türü (T04), hekim/koltuk yönetimi (T14),
 * yakın/veli (H03), sürümlü anamnez (H07), davet ve rol değişikliği (T20), haftalık okuma.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import pg from "pg";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";
import { TEST_PASSWORD, WORKER_URL, APP_URL } from "./env.js";
import { processOutbox } from "../../worker/src/jobs.js";

let app: INestApplication;
let admin: Client;
let sec: Client;
let dentist: Client;
let res: { practitioners: { id: string; name: string }[]; chairs: { id: string }[]; appointmentTypes: { id: string; name: string; defaultMinutes: number }[] };
let patients: { id: string; fullName: string }[];
let tenantA: string;

/** İstanbul saatine göre bugünden en az `min` gün sonraki, ISO haftagünü `dow` olan tarih. */
function nextWeekday(dow: number, min = 10): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  for (let i = min; i < min + 8; i++) {
    const dt = new Date(Date.UTC(y!, m! - 1, d! + i));
    if (((dt.getUTCDay() + 6) % 7) + 1 === dow) return dt.toISOString().slice(0, 10);
  }
  throw new Error("unreachable");
}

async function runWorker() {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
  try { await processOutbox(pool); } finally { await pool.end(); }
}

beforeAll(async () => {
  app = await startApp();
  admin = await login(app, EMAILS.aAdmin);
  sec = await login(app, EMAILS.aSecretary);
  dentist = await login(app, EMAILS.aDentist);
  res = (await sec.get("/resources").expect(200)).body;
  patients = (await sec.get("/patients?limit=50").expect(200)).body.items;
  tenantA = sec.session.activeMembership.tenantId;
});
afterAll(async () => app.close());

const appt = (over: Record<string, unknown>) => ({
  patientId: patients[10]!.id, practitionerId: res.practitioners[0]!.id, chairId: res.chairs[0]!.id, durationMinutes: 30, ...over,
});

describe("T05 çalışma saatleri", () => {
  it("çalışma saati dışı randevu uyarıyla reddedilir; bilinçli onayla kaydedilir ve iz bırakır", async () => {
    const tue = nextWeekday(2, 20);
    const r = await sec.post("/appointments", appt({ date: tue, startTime: "07:30" }));
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("OUTSIDE_WORKING_HOURS");
    expect(r.body.details.blocks).toEqual([{ start: 540, end: 1080 }]);
    const ok = await sec.post("/appointments", appt({ date: tue, startTime: "07:30", allowOutsideHours: true })).expect(201);
    const a = await ownerQuery(tenantA, "select changes from audit_events where entity_id = $1 and action = 'appointment.create'", [ok.body.id]);
    expect(a[0].changes.outside_working_hours).toEqual({ from: null, to: true });
  });

  it("bloğa tam sığmayan (taşan) randevu ve Pazar günü çalışma saati dışıdır", async () => {
    const tue = nextWeekday(2, 20);
    expect((await sec.post("/appointments", appt({ date: tue, startTime: "17:45", durationMinutes: 30 }))).body.code).toBe("OUTSIDE_WORKING_HOURS");
    const sun = nextWeekday(7, 20);
    const r = await sec.post("/appointments", appt({ date: sun, startTime: "10:00" }));
    expect(r.body.code).toBe("OUTSIDE_WORKING_HOURS");
    expect(r.body.details.blocks).toEqual([]);
    await sec.post("/appointments", appt({ date: tue, startTime: "17:30", durationMinutes: 30 })).expect(201);
  });

  it("yönetici çalışma saatini değiştirir; çakışan bloklar reddedilir; sekreter değiştiremez", async () => {
    const pid = res.practitioners[1]!.id;
    const bad = await admin.patch(`/practitioners/${pid}`, { displayName: "x" }); // ad < 2 → doğrulama
    expect(bad.status).toBe(422);
    const overlap = await request(app.getHttpServer()).put(`/api/v1/practitioners/${pid}/schedule`).set("cookie", admin.cookie)
      .set("x-viadent-request", "1").set("x-viadent-context", admin.context)
      .send({ blocks: [{ weekday: 1, start: "09:00", end: "13:00" }, { weekday: 1, start: "12:00", end: "18:00" }] });
    expect(overlap.status).toBe(422);
    expect(overlap.body.message).toMatch(/çakışıyor/);
    const put = (who: Client, body: object) => request(app.getHttpServer()).put(`/api/v1/practitioners/${pid}/schedule`).set("cookie", who.cookie)
      .set("x-viadent-request", "1").set("x-viadent-context", who.context).send(body);
    expect((await put(sec, { blocks: [] })).status).toBe(403);
    await put(admin, { blocks: [{ weekday: 7, start: "10:00", end: "14:00" }] }).expect(200);
    const sun = nextWeekday(7, 20);
    await sec.post("/appointments", appt({ practitionerId: pid, chairId: res.chairs[1]!.id, date: sun, startTime: "10:30" })).expect(201);
  });

  it("çalışma saati tanımsız yeni hekimde kısıt uygulanmaz", async () => {
    const p = await admin.post("/practitioners", { displayName: "Dt. Sentetik Yeni" }).expect(201);
    await sec.post("/appointments", appt({ practitionerId: p.body.id, chairId: undefined, date: nextWeekday(7, 30), startTime: "06:00" })).expect(201);
    // Pasif hekime yeni randevu verilemez.
    await admin.patch(`/practitioners/${p.body.id}`, { displayName: "Dt. Sentetik Yeni", active: false }).expect(200);
    const r = await sec.post("/appointments", appt({ practitionerId: p.body.id, chairId: undefined, date: nextWeekday(7, 30), startTime: "09:00" }));
    expect(r.status).toBe(422);
    expect(r.body.field_errors.practitionerId).toMatch(/pasif/);
  });
});

describe("T04 işlem türü", () => {
  it("tür seçilince neden alanı türün adıyla dolar; pasif tür kullanılamaz", async () => {
    const type = res.appointmentTypes.find((t) => t.name === "Dolgu")!;
    expect(type.defaultMinutes).toBe(45);
    const a = await sec.post("/appointments", appt({ date: nextWeekday(3, 20), startTime: "10:00", appointmentTypeId: type.id, durationMinutes: type.defaultMinutes })).expect(201);
    expect(a.body.reason).toBe("Dolgu");
    expect(a.body.appointmentTypeId).toBe(type.id);
    const t2 = await admin.post("/appointment-types", { name: "Sentetik Pasif", defaultMinutes: 15 }).expect(201);
    await admin.patch(`/appointment-types/${t2.body.id}`, { name: "Sentetik Pasif", defaultMinutes: 15, active: false }).expect(200);
    const r = await sec.post("/appointments", appt({ date: nextWeekday(3, 20), startTime: "12:00", appointmentTypeId: t2.body.id }));
    expect(r.status).toBe(422);
  });
});

describe("T06 kapatma", () => {
  it("kapatma mevcut randevuyu silmez; çakışanı döner ve VİA Akış görevi oluşturur", async () => {
    const thu = nextWeekday(4, 20);
    const a = await sec.post("/appointments", appt({ date: thu, startTime: "12:30", patientId: patients[11]!.id })).expect(201);
    const cl = await admin.post("/closures", { scope: "practitioner", practitionerId: res.practitioners[0]!.id, startDate: thu, startTime: "12:00", endDate: thu, endTime: "14:00", reason: "Kongre (sentetik)" }).expect(201);
    expect(cl.body.affected.map((x: { id: string }) => x.id)).toContain(a.body.id);
    expect(await ownerQuery(tenantA, "select status from appointments where id = $1", [a.body.id])).toEqual([{ status: "planned" }]);
    await runWorker();
    const tasks = (await sec.get("/tasks").expect(200)).body.items;
    const t = tasks.find((x: { kind: string; sourceId: string }) => x.kind === "closure_conflict" && x.sourceId === a.body.id);
    expect(t.reason).toMatch(/Kongre/);

    // Kapalı aralığa yeni randevu: onay bayrağı da aşamaz.
    const blocked = await sec.post("/appointments", appt({ date: thu, startTime: "13:00", allowOutsideHours: true, patientId: patients[12]!.id, chairId: res.chairs[2]!.id }));
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe("RESOURCE_CLOSED");
    // Başka hekim etkilenmez.
    // (2. hekimin saatleri önceki testte yalnız Pazar yapıldı; burada yalnız kapatmanın onu etkilemediği sınanır.)
    await sec.post("/appointments", appt({ date: thu, startTime: "13:00", practitionerId: res.practitioners[1]!.id, chairId: res.chairs[2]!.id, patientId: patients[12]!.id, allowOutsideHours: true })).expect(201);

    // Kapatma iptal edilince randevu verilebilir ve görev kendiliğinden kapanır.
    expect((await sec.post(`/closures/${cl.body.id}/cancel`)).status).toBe(403);
    await admin.post(`/closures/${cl.body.id}/cancel`).expect(200);
    await runWorker();
    const open = (await sec.get("/tasks").expect(200)).body.items;
    expect(open.find((x: { id: string }) => x.id === t.id)).toBeUndefined();
    await sec.post("/appointments", appt({ date: thu, startTime: "13:00", patientId: patients[13]!.id, chairId: res.chairs[1]!.id })).expect(201);
  });

  it("klinik kapsamlı kapatma tüm hekimleri engeller; sekreter kapatma oluşturamaz", async () => {
    const fri = nextWeekday(5, 20);
    expect((await sec.post("/closures", { scope: "clinic", startDate: fri, startTime: "00:00", endDate: fri, endTime: "24:00", reason: "Tatil" })).status).toBe(403);
    await admin.post("/closures", { scope: "clinic", startDate: fri, startTime: "00:00", endDate: fri, endTime: "24:00", reason: "Resmî tatil (sentetik)" }).expect(201);
    for (const p of res.practitioners) {
      const r = await sec.post("/appointments", appt({ date: fri, startTime: "10:00", practitionerId: p.id, chairId: undefined }));
      expect(r.body.code).toBe("RESOURCE_CLOSED");
    }
    const ctx = (await sec.get(`/agenda-context?from=${fri}&days=1`).expect(200)).body;
    expect(ctx.closures.some((c: { scope: string }) => c.scope === "clinic")).toBe(true);
  });

  it("eşzamanlı kapatma ve randevu: randevu ya reddedilir ya da çakışan listesinde görünür", async () => {
    const wed = nextWeekday(3, 40);
    for (let i = 0; i < 4; i++) {
      const t = `${10 + i}:00`;
      const [a, cl] = await Promise.all([
        sec.post("/appointments", appt({ date: wed, startTime: t, patientId: patients[14 + i]!.id })),
        admin.post("/closures", { scope: "practitioner", practitionerId: res.practitioners[0]!.id, startDate: wed, startTime: t, endDate: wed, endTime: `${10 + i}:30`, reason: `Eşzamanlılık ${i}` }),
      ]);
      expect(cl.status).toBe(201);
      if (a.status === 201) expect(cl.body.affected.map((x: { id: string }) => x.id)).toContain(a.body.id);
      else expect(a.body.code).toBe("RESOURCE_CLOSED");
    }
  });
});

describe("Haftalık ajanda okuma", () => {
  it("from + days aralığı birden çok günü döner; 14 günden fazlası reddedilir", async () => {
    const mon = nextWeekday(1, 20);
    const r = (await sec.get(`/appointments?from=${mon}&days=7`).expect(200)).body;
    expect(r.days).toBe(7);
    const days = new Set(r.items.map((a: { startsAt: string }) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(a.startsAt))));
    expect(days.size).toBeGreaterThan(1);
    expect((await sec.get(`/appointments?from=${mon}&days=30`)).status).toBe(422);
  });
});

describe("H03 yakın / veli", () => {
  it("reşit olmayan hasta işaretlenir; yasal temsil dayanak ister; ilişki iki yönden görünür", async () => {
    const mother = (await sec.post("/patients", { firstName: "Sentetik", lastName: "Anneoğlu", birthDate: "1988-03-03", phone: "05550004455" }).expect(201)).body.patient;
    const child = (await sec.post("/patients", { firstName: "Minik", lastName: "Anneoğlu", birthDate: "2016-06-06", phone: "05550004455" }).expect(201)).body.patient;
    let detail = (await sec.get(`/patients/${child.id}`).expect(200)).body;
    expect(detail.isMinor).toBe(true);
    expect(detail.legalRepresentativeCount).toBe(0);

    const noEvidence = await sec.post(`/patients/${child.id}/relations`, { relatedPatientId: mother.id, relation: "mother", isLegalRepresentative: true });
    expect(noEvidence.status).toBe(422);
    expect(noEvidence.body.field_errors.representationEvidence).toBeTruthy();
    const rel = await sec.post(`/patients/${child.id}/relations`, {
      relatedPatientId: mother.id, relation: "mother", isLegalRepresentative: true, representationEvidence: "Nüfus kayıt örneği görüldü (sentetik)", canReceiveInfo: true,
    }).expect(201);
    expect((await sec.post(`/patients/${child.id}/relations`, { relatedPatientId: mother.id, relation: "mother" })).status).toBe(409);

    detail = (await sec.get(`/patients/${child.id}`).expect(200)).body;
    expect(detail.legalRepresentativeCount).toBe(1);
    const fromChild = (await sec.get(`/patients/${child.id}/relations`).expect(200)).body.items[0];
    expect(fromChild).toMatchObject({ direction: "direct", personName: "Sentetik Anneoğlu", isLegalRepresentative: true, representationVerifiedBy: "Nur Ekinci" });
    const fromMother = (await sec.get(`/patients/${mother.id}/relations`).expect(200)).body.items[0];
    expect(fromMother).toMatchObject({ direction: "inverse", personName: "Minik Anneoğlu" });

    expect((await sec.post(`/patients/${child.id}/relations/${rel.body.id}/end`, {})).status).toBe(422);
    await sec.post(`/patients/${child.id}/relations/${rel.body.id}/end`, { reason: "Test: kayıt düzeltildi" }).expect(200);
    expect((await sec.get(`/patients/${child.id}`).expect(200)).body.legalRepresentativeCount).toBe(0);
  });

  it("kayıtlı olmayan yakın kişi eklenebilir; başka kliniğin hastası yakın yapılamaz", async () => {
    const p = patients[15]!.id;
    await sec.post(`/patients/${p}/relations`, { contactName: "Sentetik Komşu", contactPhone: "0555 000 1212", relation: "other" }).expect(201);
    const b = await login(app, EMAILS.bAdmin);
    const bPatient = (await b.get("/patients").expect(200)).body.items[0].id;
    const r = await sec.post(`/patients/${p}/relations`, { relatedPatientId: bPatient, relation: "sibling" });
    expect(r.status).toBe(422);
  });
});

describe("H07 sürümlü anamnez", () => {
  it("sekreter ve yönetici anamnezi okuyamaz; hasta özetinde klinik alan dönmez", async () => {
    const p = (patients as { id: string; fileNo?: number }[]).find((x) => x.fileNo === 1)!.id; // seed: alerji işaretli demo anamnez
    expect((await sec.get(`/patients/${p}/anamnesis`)).status).toBe(403);
    expect((await admin.get(`/patients/${p}/anamnesis`)).status).toBe(403);
    expect((await sec.get(`/patients/${p}`).expect(200)).body.clinical).toBeNull();
    const d = (await dentist.get(`/patients/${p}`).expect(200)).body.clinical;
    expect(d.criticalFlags).toEqual(["allergy"]);
  });

  it("asistan kaydı onay bekler, klinik görev yalnız sağlık yetkili rollere görünür; hekim onayıyla kapanır", async () => {
    const assistant = await login(app, EMAILS.aAssistant);
    const p = patients[20]!.id;
    const saved = await assistant.post(`/patients/${p}/anamnesis`, {
      basedOnVersion: 0, answers: { anticoagulant: { value: "yes", detail: "Sentetik ilaç" }, diabetes: { value: "no" } },
    }).expect(201);
    expect(saved.body).toEqual({ version: 1, criticalFlags: ["anticoagulant"], reviewed: false });
    await runWorker();
    const dTask = (await dentist.get(`/tasks?patientId=${p}`).expect(200)).body.items.find((t: { kind: string }) => t.kind === "anamnesis_review");
    expect(dTask.sensitivity).toBe("clinical");
    expect((await sec.get(`/tasks?patientId=${p}`).expect(200)).body.items.some((t: { kind: string }) => t.kind === "anamnesis_review")).toBe(false);
    expect((await assistant.post(`/patients/${p}/anamnesis/1/review`)).status).toBe(403);
    await dentist.post(`/patients/${p}/anamnesis/1/review`).expect(200);
    expect((await dentist.post(`/patients/${p}/anamnesis/1/review`)).status).toBe(409);
    await runWorker();
    expect((await dentist.get(`/tasks?patientId=${p}`).expect(200)).body.items.some((t: { id: string }) => t.id === dTask.id)).toBe(false);
  });

  it("her kayıt yeni sürüm; eski sürüm korunur; eski temelle kayıt çakışır; hekim kaydı otomatik onaylı", async () => {
    const p = patients[21]!.id;
    await dentist.post(`/patients/${p}/anamnesis`, { basedOnVersion: 0, answers: { allergy: { value: "no" } } }).expect(201);
    const v2 = await dentist.post(`/patients/${p}/anamnesis`, { basedOnVersion: 1, answers: { allergy: { value: "yes", detail: "Lateks (sentetik)" } } }).expect(201);
    expect(v2.body).toEqual({ version: 2, criticalFlags: ["allergy"], reviewed: true });
    const stale = await dentist.post(`/patients/${p}/anamnesis`, { basedOnVersion: 1, answers: {} });
    expect(stale.status).toBe(409);
    const v1 = (await dentist.get(`/patients/${p}/anamnesis/1`).expect(200)).body;
    expect(v1.answers.allergy.value).toBe("no");
    const cur = (await dentist.get(`/patients/${p}/anamnesis`).expect(200)).body;
    expect(cur.current.version).toBe(2);
    expect(cur.history).toHaveLength(2);
    expect(cur.questionnaire.demo).toBe(true);
    // İstemci kritik işaret enjekte edemez; tanımsız soru reddedilir.
    expect((await dentist.post(`/patients/${p}/anamnesis`, { basedOnVersion: 2, answers: { made_up: { value: "yes" } } })).status).toBe(422);
    // Audit yanıt içeriği taşımaz; sekreter geçmişte anamnez olayı görmez.
    const hist = (await dentist.get(`/patients/${p}/history`).expect(200)).body.items;
    expect(JSON.stringify(hist)).not.toContain("Lateks");
    expect((await sec.get(`/patients/${p}/history`).expect(200)).body.items.some((e: { entityType: string }) => e.entityType === "anamnesis")).toBe(false);
  });

  it("anamnez sürümleri uygulama rolüyle güncellenemez", async () => {
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      const c = await pool.connect();
      await c.query("begin");
      await c.query("select set_config('app.tenant_id', $1, true)", [tenantA]);
      await expect(c.query("update anamnesis_versions set critical_flags = '{}'")).rejects.toThrow(/permission denied/);
      await c.query("rollback");
      c.release();
    } finally {
      await pool.end();
    }
  });
});

describe("T20 davet ve rol değişikliği", () => {
  it("davet tek kullanımlık bağlantı üretir; yeni kullanıcı kabul edince doğru rolle giriş yapar", async () => {
    expect((await sec.post("/team/invitations", { email: "yeni.hekim@demo-yesil.test", fullName: "Dt. Yeni Sentetik", role: "dentist" })).status).toBe(403);
    const inv = await admin.post("/team/invitations", { email: "Yeni.Hekim@demo-yesil.test", fullName: "Dt. Yeni Sentetik", role: "dentist" }).expect(201);
    expect(inv.body.delivery).toBe("manual");
    const token = inv.body.acceptPath.split("/").pop();
    expect((await admin.post("/team/invitations", { email: "yeni.hekim@demo-yesil.test", fullName: "X Y", role: "dentist" })).status).toBe(409);
    const server = app.getHttpServer();
    const info = (await request(server).get(`/api/v1/invitations/${token}`).expect(200)).body;
    expect(info).toMatchObject({ email: "yeni.hekim@demo-yesil.test", role: "dentist", userExists: false });
    expect((await request(server).post(`/api/v1/invitations/${token}/accept`).set("x-viadent-request", "1").send({ password: "kisa" })).status).toBe(422);
    const acc = await request(server).post(`/api/v1/invitations/${token}/accept`).set("x-viadent-request", "1").send({ password: "Sentetik-Parola-123" }).expect(200);
    const cookie = (acc.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    const s = (await request(server).get("/api/v1/session").set("cookie", cookie).expect(200)).body;
    expect(s.activeMembership).toMatchObject({ role: "dentist", tenantId: tenantA });
    // Token yeniden kullanılamaz; token DB'de düz saklanmaz.
    expect((await request(server).post(`/api/v1/invitations/${token}/accept`).set("x-viadent-request", "1").send({ password: "Sentetik-Parola-123" })).status).toBe(404);
    const raw = await ownerQuery(tenantA, "select encode(token_hash, 'hex') as h from invitations");
    expect(raw.some((r) => r.h.includes(Buffer.from(token).toString("hex")))).toBe(false);
    // Yeni hekim aynı parolayla normal giriş yapabilir.
    await login(app, "yeni.hekim@demo-yesil.test", "Sentetik-Parola-123");
  });

  it("süresi dolan veya iptal edilen davet kullanılamaz; geçersiz biçimli token sorgulanmaz", async () => {
    const server = app.getHttpServer();
    const a = await admin.post("/team/invitations", { email: "sure@demo-yesil.test", fullName: "Süre Dolan", role: "assistant" }).expect(201);
    await ownerQuery(tenantA, "update invitations set expires_at = now() - interval '1 minute' where id = $1", [a.body.id]);
    expect((await request(server).get(`/api/v1/invitations/${a.body.acceptPath.split("/").pop()}`)).status).toBe(404);
    const b = await admin.post("/team/invitations", { email: "iptal@demo-yesil.test", fullName: "İptal Edilen", role: "assistant" }).expect(201);
    await admin.post(`/team/invitations/${b.body.id}/revoke`).expect(200);
    expect((await request(server).get(`/api/v1/invitations/${b.body.acceptPath.split("/").pop()}`)).status).toBe(404);
    expect((await request(server).get("/api/v1/invitations/kisa")).status).toBe(404);
  });

  it("başka klinikteki mevcut kullanıcı kendi parolasıyla daveti kabul eder; yanlış parola reddedilir", async () => {
    const server = app.getHttpServer();
    const inv = await admin.post("/team/invitations", { email: EMAILS.bDentist, fullName: "Dt. Lale Önal", role: "dentist" }).expect(201);
    const token = inv.body.acceptPath.split("/").pop();
    expect((await request(server).get(`/api/v1/invitations/${token}`).expect(200)).body.userExists).toBe(true);
    expect((await request(server).post(`/api/v1/invitations/${token}/accept`).set("x-viadent-request", "1").send({ password: "Yanlis-Parola-999" })).status).toBe(401);
    await request(server).post(`/api/v1/invitations/${token}/accept`).set("x-viadent-request", "1").send({ password: TEST_PASSWORD }).expect(200);
    const c = await login(app, EMAILS.bDentist);
    expect(c.session.memberships).toHaveLength(2);
  });

  it("rol değişikliği bir sonraki istekte etkili; kendi rolünü değiştiremez", async () => {
    const fin = await login(app, EMAILS.aFinance);
    expect((await fin.post("/patients", { firstName: "Rol", lastName: "Testi" })).status).toBe(403);
    const team = (await admin.get("/team").expect(200)).body.items;
    const target = team.find((m: { email: string }) => m.email === EMAILS.aFinance);
    expect((await admin.post(`/team/${admin.context}/role`, { role: "dentist" })).status).toBe(422);
    await admin.post(`/team/${target.id}/role`, { role: "secretary" }).expect(200);
    await fin.post("/patients", { firstName: "Rol", lastName: "Testi" }).expect(201);
    const audit = await ownerQuery(tenantA, "select changes from audit_events where entity_id = $1 and action = 'membership.role'", [target.id]);
    expect(audit[0].changes.role).toEqual({ from: "finance", to: "secretary" });
    // Paylaşılan test veritabanı: diğer dosyalar finans rolüne güvenir, eski hâline döndür.
    await admin.post(`/team/${target.id}/role`, { role: "finance" }).expect(200);
  });
});
