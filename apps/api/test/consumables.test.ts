/**
 * Faz 4.5 (ADR-087) — İşlem başına sarf reçetesi: katalog kalemine stok reçetesi; işlem tamamlanınca otomatik usage (performed_procedure_id),
 * lot takipli kalemde en yakın SKT'li lot; stok yetersizse işlem KAYDEDİLİR, sarf atlanır, asistana stock_shortage görevi düşer.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";

let app: INestApplication; let admin: Client; let dentist: Client; let sec: Client; let assistant: Client; let tenantA: string;
let pracId: string; let procId: string; let eldId: string; let kartusId: string; let patientId: string;
const key = () => `t-${randomUUID()}`;
const day = (offset: number) => { const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date()); const [y, m, d] = t.split("-").map(Number); return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10); };
async function visit(patient: string, time: string) {
  const a = (await sec.post("/appointments", { patientId: patient, practitionerId: pracId, date: day(40), startTime: time, durationMinutes: 30, allowOutsideHours: true }).expect(201)).body;
  await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "checked_in" }).expect(200);
  return a.id as string;
}

beforeAll(async () => {
  app = await startApp();
  [admin, dentist, sec, assistant] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aAssistant)]);
  tenantA = admin.session.activeMembership.tenantId;
  pracId = (await sec.get("/resources").expect(200)).body.practitioners[0].id;
  const procs = (await dentist.get("/procedures").expect(200)).body.items;
  procId = procs.find((p: { code: string }) => p.code === "DOL-01")?.id ?? procs[0].id;
  // Sentetik stok kalemleri: lot takipsiz (bol) ve lot takipli (az)
  eldId = (await admin.post("/stock/items", { code: `SARF-ELD-${Date.now()}`, name: "Sarf testi eldiven", unit: "adet", trackLots: false, minLevel: "0" }).expect(201)).body.id;
  kartusId = (await admin.post("/stock/items", { code: `SARF-KRT-${Date.now()}`, name: "Sarf testi kartuş", unit: "kartus", trackLots: true, minLevel: "0" }).expect(201)).body.id;
  await assistant.post("/stock/receipts", { itemId: eldId, quantity: "100" }).set("idempotency-key", key()).expect(201);
  await assistant.post("/stock/receipts", { itemId: kartusId, quantity: "3", lotNo: "LOT-A", expiryDate: day(400) }).set("idempotency-key", key()).expect(201);
  patientId = (await sec.post("/patients", { firstName: "Sarf", lastName: "Reçete", birthDate: "1985-03-03" }).expect(201)).body.patient.id;
});
afterAll(async () => { await admin.put(`/procedures/${procId}/consumables`, { items: [] }); await app.close(); });

describe("sarf reçetesi", () => {
  it("yönetici reçete tanımlar (2 kalem); tekrar eden kalem 422; hekim yazamaz ama okur", async () => {
    await dentist.put(`/procedures/${procId}/consumables`, { items: [] }).expect(403);
    await admin.put(`/procedures/${procId}/consumables`, { items: [{ stockItemId: eldId, quantity: 2 }, { stockItemId: eldId, quantity: 1 }] }).expect(422);
    await admin.put(`/procedures/${procId}/consumables`, { items: [{ stockItemId: eldId, quantity: 2 }, { stockItemId: kartusId, quantity: 2 }] }).expect(200);
    const r = (await dentist.get(`/procedures/${procId}/consumables`).expect(200)).body;
    expect(r.items.map((x: { name: string; quantity: string }) => [x.name, x.quantity]).sort()).toEqual([["Sarf testi eldiven", "2.000"], ["Sarf testi kartuş", "2.000"]]);
  });
  it("işlem tamamlanınca iki usage hareketi düşer (işleme bağlı, lot seçili); hasta stok kullanımı listesinde görünür", async () => {
    const v = await visit(patientId, "09:00");
    const r = (await dentist.post(`/patients/${patientId}/performed`, { appointmentId: v, procedureId: procId, location: { kind: "tooth", tooth: "16", surfaces: ["O"] } }).expect(201)).body;
    expect(r.consumables).toEqual({ used: 2, shortages: 0 });
    const mv = await ownerQuery(tenantA, "select item_id, lot_id, quantity::text, reason from stock_movements where performed_procedure_id = $1 order by quantity", [r.id]);
    expect(mv).toHaveLength(2);
    expect(mv.find((m: { item_id: string }) => m.item_id === kartusId)).toMatchObject({ quantity: "-2.000", reason: "Sarf reçetesi (otomatik)" });
    expect(mv.find((m: { item_id: string }) => m.item_id === kartusId).lot_id).not.toBeNull();
    const usage = (await assistant.get(`/patients/${patientId}/stock-usage`).expect(200)).body;
    expect(JSON.stringify(usage)).toContain("Sarf testi kartuş");
  });
  it("stok yetersiz: işlem yine kaydedilir, yalnız yetersiz kalem atlanır, asistana stock_shortage görevi düşer (tek görev)", async () => {
    const v = await visit(patientId, "10:00");
    const r = (await dentist.post(`/patients/${patientId}/performed`, { appointmentId: v, procedureId: procId, location: { kind: "tooth", tooth: "26", surfaces: ["O"] } }).expect(201)).body;
    expect(r.consumables).toEqual({ used: 1, shortages: 1 }); // kartuş 1 kaldı, 2 gerekiyordu
    const mv = await ownerQuery(tenantA, "select item_id from stock_movements where performed_procedure_id = $1", [r.id]);
    expect(mv.map((m: { item_id: string }) => m.item_id)).toEqual([eldId]);
    const tasks = (await assistant.get("/tasks").expect(200)).body.items.filter((t: { kind: string; sourceId: string }) => t.kind === "stock_shortage" && t.sourceId === r.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ mine: true, assigneeRole: "assistant" });
    expect(tasks[0].reason).toMatch(/Sarf testi kartuş: 2 kartus/);
  });
});
