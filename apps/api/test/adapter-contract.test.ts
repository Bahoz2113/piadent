/**
 * Faz 3 (ADR-086) — Sağlayıcı adaptör iskeleti: sözleşme testi (MOCK adaptör tüm vakaları geçer), canlı kapı (gerçek adaptör yok,
 * canlı mod env kapalıyken kullanılamaz), e-belge MOCK akışı uçtan uca: taslak → gönder → kuyruk → worker → "issued" (MOCK numara) →
 * iptal isteği → worker → cancelled. Sahte başarı yok: ret/zaman aşımı faturayı 'rejected' / bekliyor bırakır.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import pg from "pg";
import { MockProviderAdapter, OPERATIONS, adapterContractCases, defaultRegistry, processIntegrationJobs } from "@viadent/db";
import { EMAILS, login, startApp, type Client } from "./helpers.js";
import { WORKER_URL } from "./env.js";

let app: INestApplication; let admin: Client; let fin: Client; let sec: Client; let connId: string;
const key = () => `t-${randomUUID()}`;
async function worker() {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
  try { let n = 0; for (let i = 0; i < 10; i++) { const k = await processIntegrationJobs(pool, defaultRegistry, new Date()); n += k; if (!k) break; } return n; } finally { await pool.end(); }
}
const draft = (patientId: string) => ({ patientId, docType: "e_arsiv", buyerType: "individual", buyerName: "Sentetik Alıcı", lines: [{ description: "Muayene", quantity: 1, unitPrice: "500.00", vatRate: 10 }] });

beforeAll(async () => {
  app = await startApp();
  [admin, fin, sec] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aFinance), login(app, EMAILS.aSecretary)]);
});
afterAll(async () => { if (connId) await admin.patch(`/integrations/connections/${connId}`, { status: "disabled" }); await app.close(); });

describe("adaptör sözleşmesi — MOCK", () => {
  for (const c of adapterContractCases((o) => new MockProviderAdapter(o))) it(c.name, c.run);
  it("OPERATIONS kümesi: SMS, WhatsApp, ödeme (2), e-belge (2), sağlık kaydı; MOCK sağlık kaydını desteklemez (resmî sistem taklidi yok)", () => {
    expect(OPERATIONS).toHaveLength(7);
    const m = new MockProviderAdapter();
    expect(m.supports("health_registry.submit")).toBe(false);
    expect(m.supports("einvoice.submit")).toBe(true); expect(m.supports("whatsapp.send")).toBe(true);
  });
});

describe("canlı kapı", () => {
  it("gerçek sağlayıcı adaptörü yok: canlı mod env kapalıyken 'kapı kapalı'; bilinmeyen sağlayıcı 'doğrulanmış adaptör yok'; pasif bağlantı kullanılamaz", () => {
    const prev = process.env.VIADENT_EXTERNAL_SEND_ENABLED; delete process.env.VIADENT_EXTERNAL_SEND_ENABLED;
    try {
      expect(defaultRegistry({ id: "x", kind: "e_invoice", provider: "gib-entegrator", mode: "live", status: "active", config: {} })).toMatchObject({ unavailable: expect.stringMatching(/kapısı kapalı/) });
      process.env.VIADENT_EXTERNAL_SEND_ENABLED = "true";
      expect(defaultRegistry({ id: "x", kind: "e_invoice", provider: "gib-entegrator", mode: "live", status: "active", config: {} })).toMatchObject({ unavailable: expect.stringMatching(/doğrulanmış adaptör yok/) });
      expect(defaultRegistry({ id: "x", kind: "sms", provider: "mock", mode: "mock", status: "disabled", config: {} })).toMatchObject({ unavailable: expect.stringMatching(/etkin değil/) });
    } finally { if (prev === undefined) delete process.env.VIADENT_EXTERNAL_SEND_ENABLED; else process.env.VIADENT_EXTERNAL_SEND_ENABLED = prev; }
  });
});

describe("e-belge MOCK akışı uçtan uca", () => {
  let patientId: string; let invId: string;
  it("yönetici e_invoice MOCK bağlantısı açar; finans taslağı gönderir → pending_provider + kuyruk işi", async () => {
    const r = await admin.post("/integrations/connections/mock", { kind: "e_invoice" });
    expect([201, 409]).toContain(r.status);
    const ov = (await admin.get("/integrations/overview").expect(200)).body;
    const conn = ov.connections.find((x: { kind: string; provider: string }) => x.kind === "e_invoice" && x.provider === "mock");
    connId = conn.id;
    if (conn.status !== "active") await admin.patch(`/integrations/connections/${connId}`, { status: "active" }).expect(200);
    await admin.patch(`/integrations/connections/${connId}`, { mockBehavior: "accept" }).expect(200);
    patientId = (await sec.post("/patients", { firstName: "Mock", lastName: "Fatura", birthDate: "1980-01-01" }).expect(201)).body.patient.id;
    invId = (await fin.post("/invoices", draft(patientId)).set("idempotency-key", key()).expect(201)).body.id;
    const s = (await fin.post(`/invoices/${invId}/submit`, {}).expect(200)).body;
    expect(s).toMatchObject({ status: "pending_provider", mock: true });
    const d = (await fin.get(`/invoices/${invId}`).expect(200)).body;
    expect(d.status).toBe("pending_provider"); expect(d.invoiceNo).toBeNull(); expect(d.providerMock).toBe(true);
    await fin.post(`/invoices/${invId}/cancel`, { reason: "Beklerken iptal" }).expect(409); // sağlayıcı yanıtı beklenirken iptal yok
  });
  it("worker: MOCK kabul → issued; numara MOCK ile başlar; satırlar kilitli; ikinci gönderim 409", async () => {
    expect(await worker()).toBeGreaterThan(0);
    const d = (await fin.get(`/invoices/${invId}`).expect(200)).body;
    expect(d.status).toBe("issued");
    expect(d.invoiceNo).toMatch(/^MOCK\d{4}/); expect(d.issuedAt).not.toBeNull(); expect(d.providerRef).toMatch(/^mock_einvoice_submit_/);
    await fin.put(`/invoices/${invId}/lines`, { lines: [{ description: "Deneme satırı", quantity: 1, unitPrice: "1.00", vatRate: 0 }] }).expect(409);
    await fin.post(`/invoices/${invId}/submit`, {}).expect(409);
  });
  it("iptal: düzenlenmiş fatura için sağlayıcı iptal işi; worker sonrası cancelled", async () => {
    const r = (await fin.post(`/invoices/${invId}/cancel`, { reason: "Sentetik sağlayıcı iptali" }).expect(200)).body;
    expect(r).toMatchObject({ status: "issued", cancelRequested: true });
    await worker();
    const d = (await fin.get(`/invoices/${invId}`).expect(200)).body;
    expect(d.status).toBe("cancelled"); expect(d.cancelReason).toBe("Sentetik sağlayıcı iptali"); expect(d.invoiceNo).toMatch(/^MOCK/);
  });
  it("sahte başarı yok: MOCK ret → rejected + gerekçe; zaman aşımı → bekliyor kalır (numara yok)", async () => {
    await admin.patch(`/integrations/connections/${connId}`, { mockBehavior: "reject" }).expect(200);
    const rej = (await fin.post("/invoices", draft(patientId)).set("idempotency-key", key()).expect(201)).body.id;
    await fin.post(`/invoices/${rej}/submit`, {}).expect(200);
    await worker();
    const d1 = (await fin.get(`/invoices/${rej}`).expect(200)).body;
    expect(d1.status).toBe("rejected"); expect(d1.rejectedReason).toMatch(/MOCK/); expect(d1.invoiceNo).toBeNull();
    await admin.patch(`/integrations/connections/${connId}`, { mockBehavior: "timeout" }).expect(200);
    const to = (await fin.post("/invoices", draft(patientId)).set("idempotency-key", key()).expect(201)).body.id;
    await fin.post(`/invoices/${to}/submit`, {}).expect(200);
    await worker();
    const d2 = (await fin.get(`/invoices/${to}`).expect(200)).body;
    expect(d2.status).toBe("pending_provider"); expect(d2.invoiceNo).toBeNull();
    await admin.patch(`/integrations/connections/${connId}`, { mockBehavior: "accept" }).expect(200);
  });
});
