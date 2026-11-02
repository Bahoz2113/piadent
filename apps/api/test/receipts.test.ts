/**
 * Faz 2.1 (ADR-081) — Makbuz: tahsilat (TM) ve iade (IM) makbuzları aynı transaction'da boşluksuz numaralanır;
 * yazdırma denetim kaydına işlenir; makbuz değiştirilemez; kiracı sınırı korunur.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";

let app: INestApplication; let fin: Client; let sec: Client; let bAdmin: Client; let assistant: Client;
let cashId: string; let pracId: string; let tenantA: string;
const key = () => `t-${randomUUID()}`;
const NO = /^(TM|IM)-\d{4}-\d{6}$/;

async function newPatient(name: string) {
  return (await sec.post("/patients", { firstName: name, lastName: "Makbuz", birthDate: "1990-01-01" }).expect(201)).body.patient.id as string;
}
async function pay(patientId: string, amount: string, allocations: { receivableId: string; amount: string }[] = []) {
  return (await fin.post("/payments", { patientId, amount, method: "cash", cashAccountId: cashId, allocations }).set("idempotency-key", key()).expect(201)).body;
}
const seq = (no: string) => Number(no.split("-")[2]);

beforeAll(async () => {
  app = await startApp();
  [fin, sec, bAdmin, assistant] = await Promise.all([login(app, EMAILS.aFinance), login(app, EMAILS.aSecretary), login(app, EMAILS.bAdmin), login(app, EMAILS.aAssistant)]);
  tenantA = fin.session.activeMembership.tenantId;
  cashId = (await fin.get("/cash-accounts").expect(200)).body.items.find((a: { kind: string }) => a.kind === "cash").id;
  pracId = (await sec.get("/resources").expect(200)).body.practitioners[0].id;
});
afterAll(async () => app.close());

describe("makbuz numarası", () => {
  it("tahsilatta TM makbuzu üretilir, ardışık tahsilatlar ardışık numara alır; hesap görünümünde görünür", async () => {
    const p = await newPatient("Ardışık");
    const a = await pay(p, "100.00");
    const b = await pay(p, "50.00");
    expect(a.receiptNo).toMatch(NO); expect(a.receiptNo.startsWith("TM-")).toBe(true);
    expect(seq(b.receiptNo)).toBe(seq(a.receiptNo) + 1);
    const acc = (await fin.get(`/patients/${p}/account`).expect(200)).body;
    expect(acc.payments.map((x: { receiptNo: string }) => x.receiptNo).sort()).toEqual([a.receiptNo, b.receiptNo].sort());
  });

  it("eşzamanlı 6 tahsilat: hepsi farklı, boşluksuz numara alır (sayaç satır kilidi)", async () => {
    const p = await newPatient("Eşzamanlı");
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => pay(p, `${10 + i}.00`)));
    const seqs = results.map((r) => seq(r.receiptNo)).sort((x, y) => x - y);
    expect(new Set(seqs).size).toBe(6);
    expect(seqs[5]! - seqs[0]!).toBe(5);
  });

  it("idempotent tekrar aynı makbuzu döndürür, yeni numara tüketmez", async () => {
    const p = await newPatient("İdempotent");
    const k = key();
    const body = { patientId: p, amount: "70.00", method: "cash", cashAccountId: cashId, allocations: [] };
    const r1 = (await fin.post("/payments", body).set("idempotency-key", k).expect(201)).body;
    const r2 = await fin.post("/payments", body).set("idempotency-key", k);
    expect(r2.headers["idempotent-replayed"]).toBe("true");
    expect(r2.body.receiptNo).toBe(r1.receiptNo);
    const next = await pay(p, "1.00");
    expect(seq(next.receiptNo)).toBe(seq(r1.receiptNo) + 1);
  });

  it("başarısız tahsilat (geçersiz dağıtım) numara tüketmez", async () => {
    const p = await newPatient("Başarısız");
    const before = await pay(p, "5.00");
    await fin.post("/payments", { patientId: p, amount: "5.00", method: "cash", cashAccountId: cashId, allocations: [{ receivableId: randomUUID(), amount: "5.00" }] })
      .set("idempotency-key", key()).expect(422);
    const after = await pay(p, "5.00");
    expect(seq(after.receiptNo)).toBe(seq(before.receiptNo) + 1);
  });

  it("iade IM serisinde ayrı numara alır; iade makbuzu tahsilat makbuzuna atıf yapar", async () => {
    const p = await newPatient("İade");
    const pay1 = await pay(p, "200.00");
    const ref = (await fin.post(`/payments/${pay1.id}/refunds`, { amount: "80.00", method: "cash", cashAccountId: cashId, reason: "Sentetik iade" }).set("idempotency-key", key()).expect(201)).body;
    expect(ref.receiptNo).toMatch(/^IM-/);
    const r = (await fin.get(`/receipts/${ref.receiptId}`).expect(200)).body;
    expect(r).toMatchObject({ kind: "refund", receiptNo: ref.receiptNo, amount: "80.00", payment: { receiptNo: pay1.receiptNo }, refund: { reason: "Sentetik iade" } });
    expect(r.notice).toMatch(/fatura/i);
  });

  it("tahsilat makbuzu dağıtım satırlarını içerir", async () => {
    const p = await newPatient("Dağıtım");
    const rec = (await fin.post("/receivables", { patientId: p, amount: "300.00", description: "Sentetik dolgu", practitionerId: pracId }).set("idempotency-key", key()).expect(201)).body.id;
    const pay1 = await pay(p, "300.00", [{ receivableId: rec, amount: "300.00" }]);
    const r = (await fin.get(`/receipts/${pay1.receiptId}`).expect(200)).body;
    expect(r.lines).toEqual([{ description: "Sentetik dolgu", amount: "300.00" }]);
    expect(r.patient.fileNo).toBeGreaterThan(0);
  });
});

describe("yazdırma, yetki, kiracı sınırı, değişmezlik", () => {
  it("yazdırma denetim kaydı bırakır (receipt.print, makbuz no ile)", async () => {
    const p = await newPatient("Yazdır");
    const pay1 = await pay(p, "40.00");
    const r = (await fin.post(`/receipts/${pay1.receiptId}/print`, {}).expect(200)).body;
    expect(r.receiptNo).toBe(pay1.receiptNo);
    const log = await ownerQuery(tenantA, "select action, changes from audit_events where entity_type = 'receipt' and entity_id = $1", [pay1.receiptId]);
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("receipt.print");
    expect(log[0].changes.receipt_no.to).toBe(pay1.receiptNo);
  });

  it("account.read yetkisi olmayan rol (asistan) makbuzu göremez; B kliniği 404 alır", async () => {
    const p = await newPatient("Yetki");
    const pay1 = await pay(p, "30.00");
    await assistant.get(`/receipts/${pay1.receiptId}`).expect(403);
    await bAdmin.get(`/receipts/${pay1.receiptId}`).expect(404);
    await bAdmin.post(`/receipts/${pay1.receiptId}/print`, {}).expect(404);
  });

  it("makbuz kaydı güncellenemez ve silinemez (tetikleyici), uygulama rolünde update yetkisi yok", async () => {
    const p = await newPatient("Değişmez");
    const pay1 = await pay(p, "20.00");
    await expect(ownerQuery(tenantA, "update receipts set amount = 1 where id = $1", [pay1.receiptId])).rejects.toThrow(/receipt_immutable/);
    await expect(ownerQuery(tenantA, "delete from receipts where id = $1", [pay1.receiptId])).rejects.toThrow(/receipt_immutable/);
    const grants = await ownerQuery(tenantA, "select privilege_type from information_schema.role_table_grants where grantee = 'viadent_app' and table_name = 'receipts'");
    expect(grants.map((g: { privilege_type: string }) => g.privilege_type).sort()).toEqual(["SELECT"]);
  });
});
