/**
 * Faz 2.2 (ADR-083) — Fatura taslağı: numara üretilmez; satır/KDV hesapları bigint; durum makinesi; sağlayıcı yokken gönderim 409;
 * yetki (yalnız finans yazar), kiracı sınırı, denetim kaydı.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { vatOf } from "@viadent/contracts";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";

let app: INestApplication; let fin: Client; let sec: Client; let bAdmin: Client; let admin: Client;
let tenantA: string; let pracId: string;
const key = () => `t-${randomUUID()}`;
async function newPatient(name: string) {
  return (await sec.post("/patients", { firstName: name, lastName: "Fatura", birthDate: "1988-08-08" }).expect(201)).body.patient.id as string;
}
const draft = (patientId: string, extra: Record<string, unknown> = {}) => ({
  patientId, docType: "e_arsiv", buyerType: "individual", buyerName: "Sentetik Alıcı",
  lines: [{ description: "Dolgu (sentetik)", quantity: 2, unitPrice: "1250.00", vatRate: 10 }, { description: "Muayene", quantity: 1, unitPrice: "333.33", vatRate: 10 }], ...extra,
});

beforeAll(async () => {
  app = await startApp();
  [fin, sec, bAdmin, admin] = await Promise.all([login(app, EMAILS.aFinance), login(app, EMAILS.aSecretary), login(app, EMAILS.bAdmin), login(app, EMAILS.aAdmin)]);
  tenantA = fin.session.activeMembership.tenantId;
  pracId = (await sec.get("/resources").expect(200)).body.practitioners[0].id;
});
afterAll(async () => app.close());

describe("KDV hesabı (bigint, yarım-yukarı)", () => {
  it("vatOf", () => {
    expect(vatOf("1000.00", 10)).toBe("100.00");
    expect(vatOf("333.33", 10)).toBe("33.33");   // 33.333 → 33.33
    expect(vatOf("0.05", 10)).toBe("0.01");       // 0.005 → 0.01 (yarım yukarı)
    expect(vatOf("100.00", 0)).toBe("0.00");
    expect(() => vatOf("1.00", 18.5)).toThrow();
  });
});

describe("taslak yaşam döngüsü", () => {
  let patientId: string; let invId: string;
  it("oluşturulur: numara YOK, toplamlar satırlardan; idempotent tekrar aynı kaydı döndürür", async () => {
    patientId = await newPatient("Taslak");
    const k = key();
    const r1 = (await fin.post("/invoices", draft(patientId)).set("idempotency-key", k).expect(201)).body;
    invId = r1.id;
    expect(r1).toMatchObject({ status: "draft", subtotal: "2833.33", vatTotal: "283.33", grandTotal: "3116.66" });
    const r2 = await fin.post("/invoices", draft(patientId)).set("idempotency-key", k).expect(201);
    expect(r2.headers["idempotent-replayed"]).toBe("true"); expect(r2.body.id).toBe(invId);
    const d = (await fin.get(`/invoices/${invId}`).expect(200)).body;
    expect(d.invoiceNo).toBeNull(); expect(d.issuedAt).toBeNull(); expect(d.providerConnected).toBe(false);
    expect(d.lines).toHaveLength(2); expect(d.lines[0]).toMatchObject({ lineNo: 1, lineTotal: "2500.00", vatAmount: "250.00" });
    expect(d.notice).toMatch(/TASLAK/);
    const list = (await fin.get(`/patients/${patientId}/invoices`).expect(200)).body;
    expect(list.items).toHaveLength(1); expect(list.items[0]).toMatchObject({ id: invId, lineCount: 2, grandTotal: "3116.66" });
  });
  it("satırlar değiştirilir (taslak), toplamlar yeniden hesaplanır, denetim kaydı düşer", async () => {
    const r = (await fin.put(`/invoices/${invId}/lines`, { lines: [{ description: "Kanal tedavisi (sentetik)", quantity: 1, unitPrice: "4000.00", vatRate: 10 }] }).expect(200)).body;
    expect(r).toMatchObject({ subtotal: "4000.00", vatTotal: "400.00", grandTotal: "4400.00" });
    const ev = await ownerQuery(tenantA, "select action, changes from audit_events where entity_type = 'invoice' and entity_id = $1 order by created_at", [invId]);
    expect(ev.map((e: { action: string }) => e.action)).toEqual(["invoice.create", "invoice.update_lines"]);
    expect(ev[1].changes.grand_total).toEqual({ from: "3116.66", to: "4400.00" });
  });
  it("gönder: sağlayıcı bağlı değil → 409 E_INVOICE_PROVIDER_UNAVAILABLE; durum taslak kalır; engel denetimde", async () => {
    const r = await fin.post(`/invoices/${invId}/submit`, {}).expect(409);
    expect(r.body.code).toBe("E_INVOICE_PROVIDER_UNAVAILABLE");
    expect((await fin.get(`/invoices/${invId}`).expect(200)).body.status).toBe("draft");
    const ev = await ownerQuery(tenantA, "select action from audit_events where entity_type = 'invoice' and entity_id = $1 and action = 'invoice.submit_blocked'", [invId]);
    expect(ev).toHaveLength(1);
  });
  it("iptal: gerekçe zorunlu; iptal sonrası satır değişikliği ve ikinci iptal reddedilir", async () => {
    await fin.post(`/invoices/${invId}/cancel`, { reason: "x" }).expect(422);
    await fin.post(`/invoices/${invId}/cancel`, { reason: "Sentetik iptal" }).expect(200);
    await fin.put(`/invoices/${invId}/lines`, { lines: [{ description: "Deneme", quantity: 1, unitPrice: "1.00", vatRate: 0 }] }).expect(409);
    expect((await fin.post(`/invoices/${invId}/cancel`, { reason: "Tekrar" }).expect(409)).body.code).toBe("INVOICE_ALREADY_CANCELLED");
  });
  it("numara uygulama katmanından yazılamaz (tetikleyici): iptal/taslak kayda invoice_no → invoice_no_only_from_provider", async () => {
    await expect(ownerQuery(tenantA, "update invoices set invoice_no = 'ABC2026000000001' where id = $1", [invId])).rejects.toThrow(/invoice_no_only_from_provider|invoice_invalid_transition|invoice_locked/);
  });
});

describe("doğrulama, alacak bağı, yetki, kiracı", () => {
  it("alıcı/belge türü tutarlılığı: şahsa e-Fatura 422; kuruma VKN zorunlu 422; kurum + e-Fatura + VKN 201", async () => {
    const p = await newPatient("Kural");
    await fin.post("/invoices", draft(p, { docType: "e_fatura" })).set("idempotency-key", key()).expect(422);
    await fin.post("/invoices", draft(p, { buyerType: "company", docType: "e_fatura" })).set("idempotency-key", key()).expect(422);
    await fin.post("/invoices", draft(p, { buyerType: "company", docType: "e_fatura", buyerTaxNo: "1234567890", buyerName: "Sentetik A.Ş." })).set("idempotency-key", key()).expect(201);
  });
  it("satır alacak bağı başka hastanın alacağına izin vermez", async () => {
    const p1 = await newPatient("Bir"); const p2 = await newPatient("İki");
    const rec = (await fin.post("/receivables", { patientId: p2, amount: "500.00", description: "Sentetik alacak", practitionerId: pracId }).set("idempotency-key", key()).expect(201)).body.id;
    await fin.post("/invoices", draft(p1, { lines: [{ description: "Bağlı", quantity: 1, unitPrice: "500.00", vatRate: 10, receivableId: rec }] })).set("idempotency-key", key()).expect(422);
    await fin.post("/invoices", draft(p2, { lines: [{ description: "Bağlı", quantity: 1, unitPrice: "500.00", vatRate: 10, receivableId: rec }] })).set("idempotency-key", key()).expect(201);
  });
  it("sekreter ve yönetici taslak oluşturamaz (invoice.write yok) ama görür; B kliniği görmez", async () => {
    const p = await newPatient("Yetki");
    const inv = (await fin.post("/invoices", draft(p)).set("idempotency-key", key()).expect(201)).body.id;
    await sec.post("/invoices", draft(p)).set("idempotency-key", key()).expect(403);
    await admin.post("/invoices", draft(p)).set("idempotency-key", key()).expect(403);
    await sec.get(`/invoices/${inv}`).expect(200);
    await admin.get(`/patients/${p}/invoices`).expect(200);
    await bAdmin.get(`/invoices/${inv}`).expect(404);
    await bAdmin.post(`/invoices/${inv}/cancel`, { reason: "Başka klinik" }).expect(403); // B yöneticisinin invoice.write yetkisi yok; yetki denetimi kayıttan önce
  });
});

describe("mali müşavir dönem dökümü (Faz 2.3)", () => {
  it("tahsilat ve iade satırları makbuz no ile gelir; CSV ekranla aynı satır sayısı ve toplam; sekreter göremez", async () => {
    const p = await newPatient("Dönem");
    const cashId = (await fin.get("/cash-accounts").expect(200)).body.items.find((a: { kind: string }) => a.kind === "cash").id;
    const pay = (await fin.post("/payments", { patientId: p, amount: "150.00", method: "cash", cashAccountId: cashId, allocations: [] }).set("idempotency-key", key()).expect(201)).body;
    const ref = (await fin.post(`/payments/${pay.id}/refunds`, { amount: "50.00", method: "cash", cashAccountId: cashId, reason: "Sentetik dönem iadesi" }).set("idempotency-key", key()).expect(201)).body;
    const today = new Date().toISOString().slice(0, 10);
    const rep = (await fin.get(`/reports/muhasebe-donem?from=${today}&to=${today}`).expect(200)).body;
    const mine = rep.rows.filter((r: { docNo: string }) => r.docNo === pay.receiptNo || r.docNo === ref.receiptNo);
    expect(mine).toHaveLength(2);
    expect(mine.find((r: { docNo: string }) => r.docNo === pay.receiptNo)).toMatchObject({ kindLabel: "Tahsilat", method: "Nakit", amount: "150.00", party: expect.stringContaining("Dönem Fatura") });
    expect(mine.find((r: { docNo: string }) => r.docNo === ref.receiptNo)).toMatchObject({ kindLabel: "İade", amount: "-50.00" });
    expect(rep.notes.join(" ")).toMatch(/Resmî muhasebe fişi/);
    const csv = await fin.get(`/reports/muhasebe-donem/export?from=${today}&to=${today}`).expect(200);
    const lines = csv.text.split("\n").filter((l: string) => l.startsWith("20") || /^"?\d{2}\.\d{2}\.\d{4}/.test(l));
    expect(lines.length).toBe(rep.rows.length);
    expect(csv.text).toContain(pay.receiptNo); expect(csv.text).toContain(ref.receiptNo);
    await sec.get(`/reports/muhasebe-donem?from=${today}&to=${today}`).expect(403);
  });
});
