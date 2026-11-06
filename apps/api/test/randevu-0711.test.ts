/**
 * 07.11.2026 geri bildirimi — randevu sayfası arka ucu, izin/rapor/resmî tatil, sağlık özeti (ADR-099…101).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, dentist: Client, sec: Client, fin: Client, asst: Client;
let tenantA: string, pracId: string;
const key = () => `t-${randomUUID()}`;
const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};

beforeAll(async () => {
  app = await startApp();
  [admin, dentist, sec, fin, asst] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aFinance), login(app, EMAILS.aAssistant)]);
  tenantA = admin.session.activeMembership.tenantId;
  // Kendi hekimi: diğer testlerin randevularından etkilenmez; çalışma saati 09:00–12:00 (her gün).
  pracId = (await admin.post("/practitioners", { displayName: `Dt. Saat ${randomUUID().slice(0, 4)}` }).expect(201)).body.id;
  await admin.put(`/practitioners/${pracId}/schedule`, { blocks: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "12:00" })) }).expect(200);
});
afterAll(async () => app.close());

describe("uygun boş saatler", () => {
  it("çalışma bloğu içinde 15 dk adımla tüm boş başlangıçlar; dolu aralık ve süre sığmayanlar çıkar", async () => {
    const p = (await sec.post("/patients", { firstName: "Slot", lastName: "Hasta", acknowledgeDuplicates: true }).expect(201)).body.patient.id;
    const d = day(2);
    let r = (await sec.get(`/availability?practitionerId=${pracId}&date=${d}&minutes=30`).expect(200)).body;
    expect(r.workingHoursDefined).toBe(true);
    expect(r.slots[0]).toBe("09:00");
    expect(r.slots.at(-1)).toBe("11:30");
    expect(r.slots).toHaveLength(11);
    await sec.post("/appointments", { patientId: p, practitionerId: pracId, date: d, startTime: "10:00", durationMinutes: 30 }).expect(201);
    r = (await sec.get(`/availability?practitionerId=${pracId}&date=${d}&minutes=30`).expect(200)).body;
    expect(r.slots).not.toContain("09:45"); expect(r.slots).not.toContain("10:00"); expect(r.slots).not.toContain("10:15");
    expect(r.slots).toContain("09:30"); expect(r.slots).toContain("10:30");
    r = (await sec.get(`/availability?practitionerId=${pracId}&date=${d}&minutes=120`).expect(200)).body;
    expect(r.slots).toEqual([]); // 10:00 dolu: 2 saatlik boşluk yok
    await sec.get(`/availability?practitionerId=${randomUUID()}&date=${d}&minutes=30`).expect(422);
  });

  it("hekim izni günü kapatır; boş saat yok, randevu 422; resmî tatil yalnız klinik kapsamında", async () => {
    const d = day(3);
    await admin.post("/closures", { kind: "leave", scope: "practitioner", practitionerId: pracId, startDate: d, startTime: "00:00", endDate: d, endTime: "24:00", reason: "Yıllık izin (sentetik)" }).expect(201);
    const r = (await sec.get(`/availability?practitionerId=${pracId}&date=${d}&minutes=30`).expect(200)).body;
    expect(r.slots).toEqual([]);
    expect(r.closedAllDay).toMatchObject({ kind: "leave", reason: "Yıllık izin (sentetik)" });
    const p = (await sec.post("/patients", { firstName: "Izin", lastName: "Hasta", acknowledgeDuplicates: true }).expect(201)).body.patient.id;
    expect((await sec.post("/appointments", { patientId: p, practitionerId: pracId, date: d, startTime: "09:00", durationMinutes: 30 }).expect(422)).body.code).toBe("RESOURCE_CLOSED");
    await admin.post("/closures", { kind: "public_holiday", scope: "practitioner", practitionerId: pracId, startDate: d, startTime: "00:00", endDate: d, endTime: "24:00", reason: "x y" }).expect(422);
    await admin.post("/closures", { kind: "sick_leave", scope: "clinic", startDate: d, startTime: "00:00", endDate: d, endTime: "24:00", reason: "x y" }).expect(422);
    await sec.post("/closures", { kind: "leave", scope: "practitioner", practitionerId: pracId, startDate: d, startTime: "00:00", endDate: d, endTime: "24:00", reason: "x y" }).expect(403);
    const list = (await sec.get("/closures").expect(200)).body.items as { kind: string; kindLabel: string; practitionerId: string }[];
    expect(list.find((c) => c.practitionerId === pracId)).toMatchObject({ kind: "leave", kindLabel: "İzin" });
  });
});

describe("randevu ödemesi ve hasta hesabı", () => {
  it("kısmi ödeme randevuya bağlı gerçek tahsilat (avans); başka hastanın randevusu 422; işlem listesi fiyatlı", async () => {
    const p = (await sec.post("/patients", { firstName: "Odeme", lastName: "Randevu", acknowledgeDuplicates: true }).expect(201)).body.patient.id;
    const other = (await sec.post("/patients", { firstName: "Baska", lastName: "Hasta", acknowledgeDuplicates: true }).expect(201)).body.patient.id;
    const procs = (await sec.get("/procedures").expect(200)).body.items as { id: string; code: string; price: string | null; defaultMinutes: number }[];
    const dol = procs.find((x) => x.code === "DOL-01")!;
    expect(dol.price).toMatch(/^\d+\.\d{2}$/);
    const a = (await sec.post("/appointments", { patientId: p, practitionerId: pracId, procedureId: dol.id, date: day(4), startTime: "09:00", durationMinutes: dol.defaultMinutes }).expect(201)).body;
    const cash = (await sec.get("/cash-accounts").expect(200)).body.items.find((x: { kind: string }) => x.kind === "cash").id;
    await sec.post("/payments", { patientId: other, amount: "100.00", method: "cash", cashAccountId: cash, appointmentId: a.id, allocations: [] }).set("idempotency-key", key()).expect(422);
    const pay = (await sec.post("/payments", { patientId: p, amount: "500.00", method: "cash", cashAccountId: cash, appointmentId: a.id, allocations: [] }).set("idempotency-key", key()).expect(201)).body;
    expect((await ownerQuery(tenantA, "select appointment_id from payments where id = $1", [pay.id]))[0]!.appointment_id).toBe(a.id);
    const acc = (await sec.get(`/patients/${p}/account`).expect(200)).body.totals;
    expect(acc).toMatchObject({ paid: "500.00", advance: "500.00", openDebt: "0.00" });
  });
});

describe("sağlık özeti (anamnez yerine)", () => {
  it("hekim/asistan/yönetici yazar ve okur; sekreter/finans yalnız 'kayıt var' görür; içerik denetim kaydına yazılmaz", async () => {
    const p = (await sec.post("/patients", { firstName: "Saglik", lastName: "Ozet", acknowledgeDuplicates: true }).expect(201)).body.patient.id;
    expect((await sec.get(`/patients/${p}/health-notes`).expect(200)).body).toEqual({ exists: false, restricted: true });
    await sec.put(`/patients/${p}/health-notes`, { chronicConditions: "x" }).expect(403);
    await fin.put(`/patients/${p}/health-notes`, { chronicConditions: "x" }).expect(403);
    await dentist.put(`/patients/${p}/health-notes`, { chronicConditions: "Tip 2 diyabet GİZLİ-0711", regularMedications: "Varfarin" }).expect(200);
    await asst.put(`/patients/${p}/health-notes`, { allergies: "Penisilin" }).expect(200);
    const d = (await dentist.get(`/patients/${p}/health-notes`).expect(200)).body;
    expect(d).toMatchObject({ exists: true, restricted: false, chronicConditions: "Tip 2 diyabet GİZLİ-0711", regularMedications: "Varfarin", allergies: "Penisilin", canEdit: true });
    expect((await admin.get(`/patients/${p}/health-notes`).expect(200)).body.chronicConditions).toContain("diyabet");
    for (const c of [sec, fin]) {
      expect((await c.get(`/patients/${p}/health-notes`).expect(200)).body).toEqual({ exists: true, restricted: true });
      const hist = JSON.stringify((await c.get(`/patients/${p}/history`).expect(200)).body);
      expect(hist).not.toContain("health_notes.update");
    }
    const aud = await ownerQuery(tenantA, "select changes::text as c from audit_events where action = 'health_notes.update' and patient_id = $1", [p]);
    expect(aud.length).toBe(2);
    expect(aud.map((x) => x.c).join(" ")).not.toMatch(/diyabet|Varfarin|Penisilin/);
    expect((await ownerQuery(tenantA, "select count(*)::int as n from audit_events where action = 'patient.health_view' and patient_id = $1", [p]))[0]!.n).toBe(1); // yalnız yönetici okuması
    await dentist.put(`/patients/${p}/health-notes`, { allergies: "a".repeat(1001) }).expect(422);
  });

  it("anamnez hazırlık kuralı yeni kurulumda pasif (anamnez arayüzden kaldırıldı)", async () => {
    expect(await ownerQuery(tenantA, "select active from readiness_rules where kind = 'anamnesis_reviewed'")).toEqual([{ active: false }]);
  });
});
