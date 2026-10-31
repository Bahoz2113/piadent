/**
 * Görev 5: VİA Köprü — port/adapter sözleşmesi, MOCK sağlayıcı, iş kuyruğu (retry/backoff/dead-letter), zaman aşımı → durum
 * sorgusu (mutabakat), imzalı webhook (AT-13: tekrar, ters sıra, geçersiz imza, replay), AT-12 (teslim uydurulmaz),
 * online ödeme + sağlayıcı iadesi ve dört göz onay kapısı. Gerçek PostgreSQL, kısıtlı uygulama ve worker rolleri.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import pg from "pg";
import {
  MockProviderAdapter, ProviderError, decryptSecret, defaultRegistry, processIntegrationJobs, signWebhook, verifyWebhook, withContext,
} from "@viadent/db";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";
import { APP_URL, WORKER_URL } from "./env.js";

let app: INestApplication;
let admin: Client, fin: Client, sec: Client, dentist: Client, bAdmin: Client;
let tenantA: string;
let smsConn: string, payConn: string;
const key = () => `t-${randomUUID()}`;

async function worker(now = new Date()) {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
  try { let n = 0; for (let i = 0; i < 10; i++) { const k = await processIntegrationJobs(pool, defaultRegistry, now); n += k; if (!k) break; } return n; } finally { await pool.end(); }
}
async function setMock(conn: string, behavior: string, queryResult = "accepted") {
  await admin.patch(`/integrations/connections/${conn}`, { mockBehavior: behavior, mockQueryResult: queryResult }).expect(200);
}
async function newPatient(first: string) {
  const id = (await sec.post("/patients", { firstName: first, lastName: "Köprü", birthDate: "1975-07-07", phone: `+90555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}` }).expect(201)).body.patient.id as string;
  await sec.post(`/patients/${id}/communication-preferences`, { purpose: "appointment_reminder", channel: "sms", status: "granted", source: "in_person" }).expect(201);
  return id;
}
async function sendSms(pid: string) {
  const m = (await sec.post("/messages", { patientId: pid, purpose: "appointment_reminder", channel: "sms", body: "Sentetik hatırlatma" }).set("idempotency-key", key()).expect(201)).body;
  const job = (await ownerQuery(tenantA, "select integration_job_id as j from messages where id = $1", [m.id]))[0].j as string;
  return { messageId: m.id as string, jobId: job };
}
const msg = async (id: string) => (await ownerQuery(tenantA, "select status from messages where id = $1", [id]))[0].status as string;
const job = async (id: string) => (await ownerQuery(tenantA, "select * from integration_jobs where id = $1", [id]))[0];
const attempts = async (id: string) => (await ownerQuery(tenantA, "select kind, result from integration_attempts where job_id = $1 order by started_at, attempt", [id]))
  .map((a) => `${a.kind}:${a.result}`);
const simulate = (jobId: string, event: string, extra: Record<string, unknown> = {}) => admin.post("/integrations/mock/simulate", { jobId, event, ...extra }).expect(200).then((r) => r.body);
async function secretOf(conn: string) { return decryptSecret((await ownerQuery(tenantA, "select webhook_secret_enc as s from integration_connections where id = $1", [conn]))[0].s); }
const postWebhook = (conn: string, body: string, sig?: string) => {
  const r = request(app.getHttpServer()).post(`/api/v1/webhooks/${conn}`).set("content-type", "application/json");
  return (sig ? r.set("x-viadent-signature", sig) : r).send(body);
};

beforeAll(async () => {
  app = await startApp();
  [admin, fin, sec, dentist, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aFinance), login(app, EMAILS.aSecretary),
    login(app, EMAILS.aDentist), login(app, EMAILS.bAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  const ov = (await admin.get("/integrations/overview").expect(200)).body;
  smsConn = ov.connections.find((c: { kind: string; provider: string }) => c.kind === "sms" && c.provider === "mock").id;
  payConn = ov.connections.find((c: { kind: string; provider: string }) => c.kind === "payment" && c.provider === "mock").id;
});
afterAll(async () => app.close());

describe("sağlayıcı portu sözleşmesi ve imza", () => {
  it("MOCK adaptör: aynı anahtar aynı referans; sorgu aynı sonucu verir; davranışlar ayrışır", async () => {
    const a = new MockProviderAdapter();
    const r1 = await a.submit("sms.send", { to: "+90555" }, "k-12345678");
    const r2 = await a.submit("sms.send", { to: "+90555" }, "k-12345678");
    expect(r1).toEqual(r2);
    expect(r1.outcome).toBe("accepted");
    expect(await a.query("sms.send", "k-12345678")).toEqual(r1);
    const link = await a.submit("payment.create_link", {}, "k-abcdefgh");
    expect(link.outcome === "accepted" && link.data?.checkoutUrl).toMatch(/^https:\/\/odeme\.mock\.invalid\//); // .invalid: asla gerçek alan adı değil
    expect((await new MockProviderAdapter({ behavior: "reject" }).submit("sms.send", {}, "k-1")).outcome).toBe("rejected");
    await expect(new MockProviderAdapter({ behavior: "timeout" }).submit("sms.send", {}, "k-1")).rejects.toMatchObject({ kind: "timeout" });
    await expect(new MockProviderAdapter({ behavior: "unavailable" }).submit("sms.send", {}, "k-1")).rejects.toBeInstanceOf(ProviderError);
    expect(await new MockProviderAdapter({ queryResult: "not_found" }).query("sms.send", "k-1")).toEqual({ outcome: "not_found" });
  });

  it("kayıt: MOCK dışı sağlayıcıya adaptör yok; canlı mod dağıtım kapısı kapalıyken açılmaz", () => {
    const base = { id: "x", kind: "sms", status: "active", config: {} };
    expect(defaultRegistry({ ...base, provider: "netgsm", mode: "sandbox" })).toHaveProperty("unavailable");
    expect(defaultRegistry({ ...base, provider: "netgsm", mode: "live" })).toEqual({ unavailable: "Canlı dış gönderim kapısı kapalı" });
    expect(defaultRegistry({ ...base, provider: "mock", mode: "mock", status: "disabled" })).toHaveProperty("unavailable");
    expect(defaultRegistry({ ...base, provider: "mock", mode: "mock" })).toBeInstanceOf(MockProviderAdapter);
  });

  it("HMAC imza: doğru imza geçer; gövde değişirse veya zaman penceresi dışındaysa reddedilir", () => {
    const body = JSON.stringify({ id: "evt_1", type: "x", data: {} });
    const now = 1_800_000_000;
    expect(verifyWebhook("whsec_a", body, signWebhook("whsec_a", body, now), now)).toEqual({ ok: true, t: now });
    expect(verifyWebhook("whsec_a", body + " ", signWebhook("whsec_a", body, now), now)).toEqual({ ok: false, reason: "signature_invalid" });
    expect(verifyWebhook("whsec_b", body, signWebhook("whsec_a", body, now), now)).toEqual({ ok: false, reason: "signature_invalid" });
    expect(verifyWebhook("whsec_a", body, signWebhook("whsec_a", body, now - 301), now)).toEqual({ ok: false, reason: "timestamp_out_of_window" });
    expect(verifyWebhook("whsec_a", body, undefined, now)).toEqual({ ok: false, reason: "signature_invalid" });
  });
});

describe("genel bakış ve roller", () => {
  it("MOCK bağlantılar etkin, erişim bekleyenler engelli; dış gönderim kapısı kapalı; sır yanıtta yok", async () => {
    const ov = (await fin.get("/integrations/overview").expect(200)).body;
    expect(ov.externalSendGate).toBe("closed");
    const blocked = ov.connections.filter((c: { status: string }) => c.status === "blocked").map((c: { kind: string }) => c.kind).sort();
    expect(blocked).toEqual(["e_invoice", "health_registry", "whatsapp"]);
    expect(JSON.stringify(ov)).not.toMatch(/whsec_|v1\./);
    expect(ov.readiness.e_invoice.mock).toBe(false);
    expect((await sec.get("/integrations/overview")).status).toBe(403);
    expect((await fin.patch(`/integrations/connections/${smsConn}`, { mockBehavior: "reject" })).status).toBe(403);
    const wa = ov.connections.find((c: { kind: string }) => c.kind === "whatsapp");
    expect((await admin.patch(`/integrations/connections/${wa.id}`, { status: "active" })).body.code).toBe("CONNECTION_BLOCKED");
  });

  it("bağlantı yoksa veya engelliyse mesaj sessizce 'gönderildi' olmaz (409)", async () => {
    const pid = await newPatient("Ada");
    await sec.post(`/patients/${pid}/communication-preferences`, { purpose: "appointment_reminder", channel: "whatsapp", status: "granted", source: "in_person" }).expect(201);
    const wa = await sec.post("/messages", { patientId: pid, purpose: "appointment_reminder", channel: "whatsapp", body: "x deneme" }).set("idempotency-key", key());
    expect(wa.body.code).toBe("PROVIDER_NOT_CONFIGURED");
    await admin.patch(`/integrations/connections/${smsConn}`, { status: "disabled" }).expect(200);
    const off = await sec.post("/messages", { patientId: pid, purpose: "appointment_reminder", channel: "sms", body: "x deneme" }).set("idempotency-key", key());
    expect(off.body.code).toBe("PROVIDER_NOT_CONFIGURED");
    await admin.patch(`/integrations/connections/${smsConn}`, { status: "active" }).expect(200);
  });
});

describe("AT-12/13 SMS teslim bildirimi", () => {
  it("kabul → teslim webhook'u; aynı olay ikinci kez etki doğurmaz; geç gelen 'başarısız' teslimi bozmaz", async () => {
    const pid = await newPatient("Bora");
    const { messageId, jobId } = await sendSms(pid);
    await worker();
    expect(await msg(messageId)).toBe("submitted");
    expect(await job(jobId)).toMatchObject({ transport_status: "accepted", outcome_status: "pending" });
    const d = await simulate(jobId, "message.delivered", { eventId: "evt_dup_1" });
    expect(d).toMatchObject({ status: "processed", http: 200 });
    expect(await msg(messageId)).toBe("delivered");
    expect(await simulate(jobId, "message.delivered", { eventId: "evt_dup_1" })).toMatchObject({ status: "duplicate" });
    expect(await simulate(jobId, "message.failed")).toMatchObject({ status: "ignored_stale" });
    expect(await msg(messageId)).toBe("delivered");
    expect((await job(jobId)).outcome_status).toBe("succeeded");
    const ev = (await ownerQuery(tenantA, "select status from delivery_events where message_id = $1 order by at", [messageId])).map((e) => e.status);
    expect(ev).toEqual(["queued", "submitted", "delivered"]);
  });

  it("ters sıra: teslim bildirimi, worker gönderim sonucunu yazmadan gelir → eşleşir; sonraki 'kabul' durumu geri almaz", async () => {
    const pid = await newPatient("Cem");
    const { messageId, jobId } = await sendSms(pid);
    expect(await simulate(jobId, "message.delivered")).toMatchObject({ status: "processed" }); // provider_ref henüz yok; anahtarla eşleşti
    expect(await msg(messageId)).toBe("delivered");
    await worker();
    expect(await msg(messageId)).toBe("delivered");
    expect(await job(jobId)).toMatchObject({ transport_status: "accepted", outcome_status: "succeeded" });
  });

  it("gerçek HTTP uç noktası: imzasız/yanlış imza 401, eski zaman damgası 401 (replay), bozuk gövde 400, bilinmeyen hedef 404; tekrar 'duplicate'", async () => {
    const pid = await newPatient("Deniz");
    const { messageId, jobId } = await sendSms(pid);
    await worker();
    const ref = (await job(jobId)).provider_ref;
    const secret = await secretOf(smsConn);
    const body = JSON.stringify({ id: `evt_${randomUUID().slice(0, 8)}`, type: "message.delivered", created: Math.floor(Date.now() / 1000), data: { provider_ref: ref } });
    expect((await postWebhook(smsConn, body)).status).toBe(401);
    expect((await postWebhook(smsConn, body, signWebhook("whsec_yanlis", body))).status).toBe(401);
    expect((await postWebhook(smsConn, body, signWebhook(secret, body, Math.floor(Date.now() / 1000) - 600))).status).toBe(401);
    expect((await postWebhook(smsConn, "{bozuk", signWebhook(secret, "{bozuk"))).status).toBe(400);
    expect((await postWebhook(randomUUID(), body, signWebhook(secret, body))).status).toBe(404);
    expect(await msg(messageId)).toBe("submitted"); // reddedilen istekler etki doğurmadı
    const ok = await postWebhook(smsConn, body, signWebhook(secret, body));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ received: true, result: "processed" });
    const again = await postWebhook(smsConn, body, signWebhook(secret, body));
    expect(again.body.result).toBe("duplicate");
    expect(await msg(messageId)).toBe("delivered");
    const rej = (await admin.get("/integrations/webhooks").expect(200)).body.rejections;
    const count = (r: string) => rej.find((x: { reason: string }) => x.reason === r)?.n ?? 0;
    expect(count("signature_invalid")).toBeGreaterThanOrEqual(2);
    expect(count("timestamp_out_of_window")).toBeGreaterThanOrEqual(1);
    expect(count("malformed")).toBeGreaterThanOrEqual(1);
    // Sır yenilenince eski anahtarla imzalanan bildirim reddedilir
    await admin.post(`/integrations/connections/${smsConn}/rotate-secret`).expect(200);
    const body2 = JSON.stringify({ id: `evt_${randomUUID().slice(0, 8)}`, type: "message.failed", data: { provider_ref: ref } });
    expect((await postWebhook(smsConn, body2, signWebhook(secret, body2))).status).toBe(401);
    // B kliniğinin kullanıcısı A'nın bağlantısının sırrını bilmez; A'nın işine B üzerinden erişim yok
    expect((await bAdmin.get(`/integrations/jobs/${jobId}`)).status).toBe(404);
    expect((await bAdmin.post("/integrations/mock/simulate", { jobId, event: "message.delivered" })).status).toBe(404);
  });
});

describe("zaman aşımı, mutabakat, yeniden deneme ve dead-letter", () => {
  it("zaman aşımı = bilinmiyor; kör yeniden gönderim yok, durum sorgusuyla kabul bulunur (tek gönderim)", async () => {
    const pid = await newPatient("Ece");
    await setMock(smsConn, "timeout");
    const { messageId, jobId } = await sendSms(pid);
    await worker();
    expect(await job(jobId)).toMatchObject({ transport_status: "unknown", outcome_status: "pending" });
    expect(await msg(messageId)).toBe("queued"); // ne gönderildi ne başarısız
    await setMock(smsConn, "accept", "accepted");
    await worker(); // backoff dolmadan tekrar denenmez
    expect((await job(jobId)).transport_status).toBe("unknown");
    await worker(new Date(Date.now() + 60_000));
    expect(await attempts(jobId)).toEqual(["submit:timeout", "status_query:accepted"]);
    expect(await job(jobId)).toMatchObject({ transport_status: "accepted" });
    expect(await msg(messageId)).toBe("submitted");
  });

  it("durum sorgusu 'kayıt yok' derse aynı anahtarla yeniden gönderilir", async () => {
    const pid = await newPatient("Feray");
    await setMock(smsConn, "timeout", "not_found");
    const { jobId } = await sendSms(pid);
    await worker();
    await setMock(smsConn, "accept", "not_found");
    await worker(new Date(Date.now() + 60_000));
    await worker(new Date(Date.now() + 10 * 60_000));
    expect(await attempts(jobId)).toEqual(["submit:timeout", "status_query:not_found", "submit:accepted"]);
    await setMock(smsConn, "accept", "accepted");
  });

  it("geçici hata: artan bekleme ile yeniden denenir; sınırda dead-letter + görev; elle yeniden deneme başarılı olur", async () => {
    const pid = await newPatient("Gizem");
    await setMock(smsConn, "unavailable");
    const { messageId, jobId } = await sendSms(pid);
    let t = Date.now();
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      await worker(new Date(t));
      const j = await job(jobId);
      if (j.transport_status === "dead") break;
      gaps.push(new Date(j.next_attempt_at).getTime() - t);
      t = new Date(j.next_attempt_at).getTime() + 1000;
    }
    const j = await job(jobId);
    expect(j).toMatchObject({ transport_status: "dead", outcome_status: "failed", attempts: 6 });
    expect(gaps.every((g, i) => i === 0 || g > gaps[i - 1]!)).toBe(true); // üstel geri çekilme
    expect(await msg(messageId)).toBe("failed");
    const task = (await admin.get("/tasks").expect(200)).body.items.find((x: { kind: string; sourceId: string }) => x.kind === "integration_dead" && x.sourceId === jobId);
    expect(task).toBeTruthy();
    expect((await sec.post(`/integration-jobs/${jobId}/retry`)).status).toBe(403);
    await setMock(smsConn, "accept");
    await admin.post(`/integration-jobs/${jobId}/retry`).expect(200);
    await worker();
    expect((await job(jobId)).transport_status).toBe("accepted");
    expect((await admin.get("/tasks").expect(200)).body.items.some((x: { id: string }) => x.id === task.id)).toBe(false);
  });

  it("sağlayıcı reddi kalıcıdır: yeniden denenmez, mesaj başarısız", async () => {
    const pid = await newPatient("Hilal");
    await setMock(smsConn, "reject");
    const { messageId, jobId } = await sendSms(pid);
    await worker(); await worker(new Date(Date.now() + 3600_000));
    expect(await attempts(jobId)).toEqual(["submit:rejected"]);
    expect(await msg(messageId)).toBe("failed");
    await setMock(smsConn, "accept");
  });
});

describe("online ödeme ve sağlayıcı iadesi (dört göz)", () => {
  let pid: string, reqId: string, payJob: string, paymentId: string;
  it("ödeme bağlantısı MOCK; ödeme yalnız imzalı bildirimle kaydedilir; çift bildirim tek ödeme", async () => {
    pid = await newPatient("İpek");
    const k = key();
    const r = (await sec.post(`/patients/${pid}/online-payments`, { amount: "500.00" }).set("idempotency-key", k).expect(201)).body;
    await sec.post(`/patients/${pid}/online-payments`, { amount: "500.00" }).set("idempotency-key", k).expect(201);
    expect((await ownerQuery(tenantA, "select count(*)::int as n from online_payment_requests where patient_id = $1", [pid]))[0].n).toBe(1);
    reqId = r.id; payJob = r.jobId;
    expect(r.isMock).toBe(true);
    await worker();
    let list = (await sec.get(`/patients/${pid}/online-payments`).expect(200)).body.items;
    expect(list[0]).toMatchObject({ status: "link_ready", isMock: true });
    expect(list[0].checkoutUrl).toMatch(/mock\.invalid/);
    expect((await fin.get(`/patients/${pid}/account`).expect(200)).body.totals.paid).toBe("0.00"); // bağlantı ≠ tahsilat

    expect(await simulate(payJob, "payment.succeeded")).toMatchObject({ status: "processed" });
    expect(await simulate(payJob, "payment.succeeded")).toMatchObject({ status: "ignored_stale" }); // farklı olay kimliği, aynı istek
    expect(await simulate(payJob, "payment.failed")).toMatchObject({ status: "ignored_stale" });
    list = (await sec.get(`/patients/${pid}/online-payments`).expect(200)).body.items;
    expect(list[0].status).toBe("paid");
    const acc = (await fin.get(`/patients/${pid}/account`).expect(200)).body;
    expect(acc.totals).toMatchObject({ paid: "500.00", advance: "500.00", openDebt: "0.00" }); // borçla otomatik karışmaz
    expect(acc.payments).toHaveLength(1);
    expect(acc.payments[0].method).toBe("online");
    paymentId = acc.payments[0].id;
    const p = (await ownerQuery(tenantA, "select source, provider_ref from payments where id = $1", [paymentId]))[0];
    expect(p.source).toBe("provider");
    expect(p.provider_ref).toMatch(/^mockpay_/);
  });

  it("tutar uyuşmazlığı ödeme oluşturmaz, incelemeye düşer", async () => {
    const r = (await sec.post(`/patients/${pid}/online-payments`, { amount: "120.00" }).set("idempotency-key", key()).expect(201)).body;
    await worker();
    expect(await simulate(r.jobId, "payment.succeeded", { amount: "100.00" })).toMatchObject({ status: "error", detail: "amount_mismatch" });
    expect((await fin.get(`/patients/${pid}/account`).expect(200)).body.payments).toHaveLength(1);
    const t = (await admin.get("/tasks").expect(200)).body.items.find((x: { sourceId: string; kind: string }) => x.sourceId === r.jobId && x.kind === "integration_dead");
    expect(t.reason).toMatch(/tutarı uyuşmuyor/);
  });

  it("sağlayıcı iadesi onay kapısında bekler; isteyen onaylayamaz (API + DB); onay → kabul → defter yalnız bildirimle", async () => {
    const r = (await fin.post(`/payments/${paymentId}/provider-refunds`, { amount: "200.00", reason: "Sentetik iade" }).set("idempotency-key", key()).expect(201)).body;
    expect(r.status).toBe("held");
    expect((await job(r.jobId))).toMatchObject({ approval_status: "pending", transport_status: "held" });
    await worker();
    expect((await job(r.jobId)).transport_status).toBe("held"); // onaysız iş gönderilmez
    expect((await fin.post(`/integration-jobs/${r.jobId}/approve`)).body.code).toBe("SAME_USER_APPROVAL");
    expect((await sec.post(`/integration-jobs/${r.jobId}/approve`)).status).toBe(403);
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) =>
        c.query("update integration_jobs set approved_by = requested_by, approval_status = 'approved', transport_status = 'queued' where id = $1", [r.jobId]))).rejects.toThrow(/check constraint/);
    } finally { await pool.end(); }
    const over = await fin.post(`/payments/${paymentId}/provider-refunds`, { amount: "300.01", reason: "fazla" }).set("idempotency-key", key());
    expect(over.body.code).toBe("REFUND_EXCEEDS_PAYMENT"); // bekleyen 200 dahil
    await admin.post(`/integration-jobs/${r.jobId}/approve`).expect(200);
    await worker();
    expect(await job(r.jobId)).toMatchObject({ transport_status: "accepted", outcome_status: "pending" });
    expect((await fin.get(`/patients/${pid}/account`).expect(200)).body.totals.refunded).toBe("0.00"); // sağlayıcı kabulü ≠ iade tamamlandı
    expect(await simulate(r.jobId, "refund.succeeded")).toMatchObject({ status: "processed" });
    expect(await simulate(r.jobId, "refund.succeeded")).toMatchObject({ status: "ignored_stale" });
    const acc = (await fin.get(`/patients/${pid}/account`).expect(200)).body;
    expect(acc.totals).toMatchObject({ paid: "500.00", refunded: "200.00", advance: "300.00" });
    expect(acc.refunds).toHaveLength(1);
    expect(acc.refunds[0].method).toBe("online");
    expect((await job(r.jobId)).outcome_status).toBe("succeeded");
  });

  it("reddedilen iade gönderilmez; manuel ödeme sağlayıcıdan iade edilemez", async () => {
    const r = (await fin.post(`/payments/${paymentId}/provider-refunds`, { amount: "50.00", reason: "Sentetik" }).set("idempotency-key", key()).expect(201)).body;
    await admin.post(`/integration-jobs/${r.jobId}/reject`, { reason: "Hasta vazgeçti" }).expect(200);
    await worker();
    expect(await job(r.jobId)).toMatchObject({ approval_status: "rejected", transport_status: "cancelled" });
    expect(await attempts(r.jobId)).toEqual([]);
    const cash = (await fin.get("/cash-accounts").expect(200)).body.items.find((a: { kind: string }) => a.kind === "cash").id;
    const manual = (await fin.post("/payments", { patientId: pid, amount: "10.00", method: "cash", cashAccountId: cash }).set("idempotency-key", key()).expect(201)).body;
    expect((await fin.post(`/payments/${manual.id}/provider-refunds`, { amount: "5.00", reason: "x deneme" }).set("idempotency-key", key())).body.code).toBe("NOT_PROVIDER_PAYMENT");
  });

  it("B kliniği A'nın işini onaylayamaz, iptal edemez, online ödeme isteklerini göremez", async () => {
    const r = (await fin.post(`/payments/${paymentId}/provider-refunds`, { amount: "10.00", reason: "Sentetik" }).set("idempotency-key", key()).expect(201)).body;
    expect((await bAdmin.post(`/integration-jobs/${r.jobId}/approve`)).status).toBe(404);
    expect((await bAdmin.post(`/integration-jobs/${r.jobId}/cancel`, { reason: "deneme" })).status).toBe(404);
    expect((await bAdmin.get(`/patients/${pid}/online-payments`)).status).toBe(404);
    const bJobs = (await bAdmin.get("/integrations/jobs").expect(200)).body.items;
    expect(bJobs.some((j: { id: string }) => j.id === r.jobId)).toBe(false);
    await admin.post(`/integration-jobs/${r.jobId}/cancel`, { reason: "Test temizliği" }).expect(200);
    expect((await dentist.get("/integrations/jobs")).status).toBe(403);
  });
});
