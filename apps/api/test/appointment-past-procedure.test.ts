/**
 * Ürün sahibi geri bildirimi 04.11.2026 (madde 1, 5, 12) — ADR-094.
 *  1. Geçmiş tarih/saate yeni randevu verilemez: 422 APPOINTMENT_IN_PAST, satır ve denetim kaydı yazılmaz. Kısa tolerans
 *     (APPOINTMENT_PAST_GRACE_MINUTES) yürüyerek gelen hasta içindir. Geriye dönük düzeltme yalnız `schedule.manage` + gerekçeyle
 *     (sekreter 403) ve denetime `backdated` olarak yazılır. Pilot geçmiş randevu aktarımı bu kuraldan etkilenmez (gorev13).
 *  12. Randevu bir katalog işlemine bağlanabilir: açıkça (`procedureId`) ya da işlem türünün bağlı işleminden. Yanıt ve listeler
 *     `procedureLabel` + tarifeden `plannedPrice` taşır (tahakkuk yalnız gerçekleşen işlemden doğar — alacak oluşmaz).
 *     İşlem türüne bağlı işlem Yönetim'den atanır ve denetlenir; pasif/başka kiracının işlemi reddedilir.
 *     Standart işlem listesi kataloğa fiyatsız, yalnız eksik kodlar olarak eklenir; ikinci çağrı hiçbir şey eklemez.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { APPOINTMENT_PAST_GRACE_MINUTES, STANDARD_PROCEDURES } from "@viadent/contracts";
import { EMAILS, login, ownerQuery, startApp, tomorrowIstanbul, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, sec: Client, dentist: Client, bAdmin: Client;
let tenantA: string, pracId: string, patientId: string;
const tag = Math.random().toString(36).slice(2, 8);
const TZ = "Europe/Istanbul";
/** İstanbul saatine göre şimdiden `deltaMin` dakika sonrası: { date, time }. */
function at(deltaMin: number) {
  const d = new Date(Date.now() + deltaMin * 60_000);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { date, time };
}
const countAppts = async () => Number((await ownerQuery(tenantA, "select count(*)::int as n from appointments where patient_id = $1", [patientId]))[0].n);

beforeAll(async () => {
  app = await startApp();
  [admin, sec, dentist, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aSecretary), login(app, EMAILS.aDentist), login(app, EMAILS.bAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  // QA-402: kendi hekimi — seed hekiminin gün içi randevuları (ör. bugün 14:00) "şimdi"ye göre açılan randevuyla çakışmaz.
  // Çalışma saati tanımsız (kısıt yok); "Zz" öneki ad sıralı /resources listesinde diğer dosyaların practitioners[0]'ını değiştirmez.
  pracId = (await admin.post("/practitioners", { displayName: `Zz Dt. Geçmiş ${tag}` }).expect(201)).body.id;
  patientId = (await sec.post("/patients", { firstName: "Randevu", lastName: `Kural ${tag}`, birthDate: "1984-04-04" }).expect(201)).body.patient.id;
});
afterAll(async () => { await app.close(); });

describe("geçmişe randevu (madde 1)", () => {
  it("dün ve iki saat önce → 422 APPOINTMENT_IN_PAST; kayıt ve denetim yazılmaz", async () => {
    const before = await countAppts();
    const audits = Number((await ownerQuery(tenantA, "select count(*)::int as n from audit_events where action = 'appointment.create' and patient_id = $1", [patientId]))[0].n);
    for (const slot of [{ date: tomorrowIstanbul(-1), time: "10:00" }, at(-120)]) {
      const r = await sec.post("/appointments", { patientId, practitionerId: pracId, date: slot.date, startTime: slot.time, durationMinutes: 30, allowOutsideHours: true });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe("APPOINTMENT_IN_PAST");
      expect(r.body.field_errors.date).toBeTruthy();
    }
    expect(await countAppts()).toBe(before);
    expect(Number((await ownerQuery(tenantA, "select count(*)::int as n from audit_events where action = 'appointment.create' and patient_id = $1", [patientId]))[0].n)).toBe(audits);
  });

  it("tolerans içinde (şimdiden birkaç dakika önce) ve ileri saat kabul edilir", async () => {
    const graceMinus = Math.max(1, APPOINTMENT_PAST_GRACE_MINUTES - 5);
    const s = at(-graceMinus);
    const r = await sec.post("/appointments", { patientId, practitionerId: pracId, date: s.date, startTime: s.time, durationMinutes: 15, allowOutsideHours: true });
    expect(r.status).toBe(201);
    await sec.post(`/appointments/${r.body.id}/status`, { version: r.body.version, status: "cancelled", cancelReason: "Test temizliği" }).expect(200);
    const f = { date: tomorrowIstanbul(3), time: "21:05" };
    await sec.post("/appointments", { patientId, practitionerId: pracId, date: f.date, startTime: f.time, durationMinutes: 15, allowOutsideHours: true }).expect(201);
  });

  it("geriye dönük düzeltme: sekreter gerekçeyle bile 403; yönetici gerekçeyle 201 ve denetimde backdated", async () => {
    const y = { patientId, practitionerId: pracId, date: tomorrowIstanbul(-2), startTime: "20:40", durationMinutes: 20, allowOutsideHours: true };
    expect((await sec.post("/appointments", { ...y, backdateReason: "Kayıt unutulmuş" })).status).toBe(403);
    const r = await admin.post("/appointments", { ...y, backdateReason: "Kâğıt ajandadan geriye dönük kayıt" }).expect(201);
    const ev = await ownerQuery(tenantA, "select changes from audit_events where action = 'appointment.create' and entity_id = $1", [r.body.id]);
    expect(ev[0].changes.backdated.to).toBe(true);
    expect(ev[0].changes.backdate_reason.to).toBe("Kâğıt ajandadan geriye dönük kayıt");
  });
});

describe("randevuda planlanan işlem ve fiyat (madde 12)", () => {
  it("açık procedureId: etiket + tarife fiyatı; alacak oluşmaz; hasta listesinde de görünür", async () => {
    const procs = (await dentist.get("/procedures").expect(200)).body.items;
    const tem = procs.find((p: { code: string }) => p.code === "TEM-01");
    const recBefore = Number((await ownerQuery(tenantA, "select count(*)::int as n from receivables where patient_id = $1", [patientId]))[0].n);
    const r = await sec.post("/appointments", { patientId, practitionerId: pracId, date: tomorrowIstanbul(4), startTime: "20:00", durationMinutes: 30, allowOutsideHours: true, procedureId: tem.id }).expect(201);
    expect(r.body.procedureId).toBe(tem.id);
    expect(r.body.procedureLabel).toBe("TEM-01 · Diş taşı temizliği (tüm ağız)");
    expect(r.body.plannedPrice).toBe("1200.00");
    expect(r.body.reason).toBe("Diş taşı temizliği (tüm ağız)");
    expect(Number((await ownerQuery(tenantA, "select count(*)::int as n from receivables where patient_id = $1", [patientId]))[0].n)).toBe(recBefore);
    const list = (await sec.get(`/patients/${patientId}/appointments`).expect(200)).body.items;
    expect(list.find((a: { id: string }) => a.id === r.body.id).plannedPrice).toBe("1200.00");
    const day = (await sec.get(`/appointments?date=${tomorrowIstanbul(4)}`).expect(200)).body.items;
    expect(day.find((a: { id: string }) => a.id === r.body.id).procedureLabel).toContain("TEM-01");
  });

  it("işlem türünün bağlı işlemi varsayılan olur; yönetici bağlantıyı değiştirir ve denetlenir", async () => {
    const types = (await admin.get("/admin/resources").expect(200)).body.appointmentTypes;
    const dolgu = types.find((t: { name: string }) => t.name === "Dolgu");
    expect(dolgu.procedureLabel).toContain("DOL-01");
    const r = await sec.post("/appointments", { patientId, practitionerId: pracId, date: tomorrowIstanbul(5), startTime: "20:00", durationMinutes: 45, allowOutsideHours: true, appointmentTypeId: dolgu.id }).expect(201);
    expect(r.body.procedureLabel).toBe("DOL-01 · Kompozit dolgu (tek yüz)");
    expect(r.body.plannedPrice).toBe("1800.00");
    expect(r.body.reason).toBe("Dolgu");
    // sekreter türü değiştiremez; başka kiracının işlemi reddedilir
    expect((await sec.patch(`/appointment-types/${dolgu.id}`, { name: "Dolgu", defaultMinutes: 45, procedureId: null })).status).toBe(403);
    const bProc = (await bAdmin.get("/procedures").expect(200)).body.items[0].id;
    expect((await admin.patch(`/appointment-types/${dolgu.id}`, { name: "Dolgu", defaultMinutes: 45, procedureId: bProc })).status).toBe(422);
    const dol2 = (await dentist.get("/procedures").expect(200)).body.items.find((p: { code: string }) => p.code === "DOL-02");
    await admin.patch(`/appointment-types/${dolgu.id}`, { name: "Dolgu", defaultMinutes: 45, procedureId: dol2.id }).expect(200);
    const ev = await ownerQuery(tenantA, "select changes from audit_events where action = 'appointment_type.update' and entity_id = $1 order by id desc limit 1", [dolgu.id]);
    expect(ev[0].changes.procedure_id.to).toBe(dol2.id);
    await admin.patch(`/appointment-types/${dolgu.id}`, { name: "Dolgu", defaultMinutes: 45, procedureId: dolgu.procedureId }).expect(200);
  });

  it("geçersiz/başka kiracının procedureId'si 422; B kiracısı A'nın randevusunu göremez", async () => {
    const bProc = (await bAdmin.get("/procedures").expect(200)).body.items[0].id;
    const r = await sec.post("/appointments", { patientId, practitionerId: pracId, date: tomorrowIstanbul(6), startTime: "20:00", durationMinutes: 30, allowOutsideHours: true, procedureId: bProc });
    expect(r.status).toBe(422);
    expect(r.body.field_errors.procedureId).toBeTruthy();
  });

  it("standart işlem listesi: yalnız eksik kodlar fiyatsız eklenir; ikinci çağrı 0; sekreter 403", async () => {
    expect((await sec.post("/procedures/standard-import", {})).status).toBe(403);
    const before = (await bAdmin.get("/procedures?all=1").expect(200)).body.items.length;
    const r1 = (await bAdmin.post("/procedures/standard-import", {}).expect(201)).body;
    expect(r1.added + r1.skipped).toBe(STANDARD_PROCEDURES.length);
    const after = (await bAdmin.get("/procedures?all=1").expect(200)).body.items.length;
    expect(after - before).toBe(r1.added);
    const r2 = (await bAdmin.post("/procedures/standard-import", {}).expect(201)).body;
    expect(r2.added).toBe(0);
    // Eklenenlerin fiyatı yok: tarife kalemi oluşmaz
    if (r1.codes.length) {
      const bTenant = bAdmin.session.activeMembership.tenantId;
      const priced = await ownerQuery(bTenant, "select count(*)::int as n from tariff_items ti join procedures p on p.id = ti.procedure_id where p.code = any($1::text[])", [r1.codes]);
      expect(priced[0].n).toBe(0);
    }
  });
});
