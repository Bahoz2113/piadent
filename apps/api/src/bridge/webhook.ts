/**
 * Webhook alımı (AT-13). Sıra: hedef bağlantı (dar SECURITY DEFINER) → HMAC imza + zaman penceresi (replay) → olay kimliğiyle
 * tekilleştirme (aynı olay ikinci kez etki doğurmaz) → durum önceliği (ters sırada gelen eski olay terminal durumu bozmaz) → etki.
 * Etki ve olay kaydı aynı transaction'dadır. Geçersiz istek içerik saklanmadan reddedilir.
 */
import { createHash } from "node:crypto";
import { decryptSecret, verifyWebhook } from "@viadent/db";
import type { Db } from "../infra/db.service.js";
import type { RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";
import { cashMovement, lockAccount, refundPayment } from "../finance/ledger.js";

export interface IngestResult { http: number; status: "processed" | "duplicate" | "ignored_stale" | "ignored_unknown" | "error" | "rejected"; detail?: string }
interface Evt { id: string; type: string; created?: number; data: Record<string, string> }
type C = import("pg").PoolClient;

function systemCtx(tenantId: string, userId: string, timezone: string, correlationId: string): RequestContext {
  return { tenantId, userId, timezone, correlationId, membershipId: null as unknown as string, sessionId: "", userName: "Sağlayıcı bildirimi", tenantName: "",
    role: "finance", permissions: new Set() };
}

export async function ingestWebhook(db: Db, connectionId: string, rawBody: string, signature: string | undefined, correlationId: string,
  nowSec = Math.floor(Date.now() / 1000)): Promise<IngestResult> {
  if (!/^[0-9a-f-]{36}$/.test(connectionId)) return { http: 404, status: "rejected", detail: "unknown_target" };
  const target = await db.userTx(null, async (c) => (await c.query("select * from app.webhook_target($1)", [connectionId])).rows[0]);
  if (!target || target.status !== "active" || !target.webhook_secret_enc) return { http: 404, status: "rejected", detail: "unknown_target" };
  const tenantCtx = { tenantId: target.tenant_id as string, userId: null };
  const v = verifyWebhook(decryptSecret(target.webhook_secret_enc), rawBody, signature, nowSec);
  let evt: Evt | null = null;
  if (v.ok) { try { evt = JSON.parse(rawBody); } catch { evt = null; } }
  const bad = !v.ok ? v.reason : !evt || typeof evt.id !== "string" || typeof evt.type !== "string" || typeof evt.data !== "object" ? "malformed" : null;
  if (bad) {
    await db.tx(tenantCtx, (c) => c.query("insert into webhook_rejections(tenant_id, connection_id, reason) values ($1,$2,$3)", [target.tenant_id, connectionId, bad]));
    return { http: bad === "malformed" ? 400 : 401, status: "rejected", detail: bad };
  }
  const e = evt!;
  return db.tx(tenantCtx, async (c) => {
    const ins = await c.query(
      `insert into webhook_events(tenant_id, connection_id, provider_event_id, event_type, occurred_at, payload_sha256, payload, status)
       values ($1,$2,$3,$4,$5,$6,$7,'processed') on conflict (tenant_id, connection_id, provider_event_id) do nothing returning id`,
      [target.tenant_id, connectionId, e.id, e.type, e.created ? new Date(e.created * 1000) : null, createHash("sha256").update(rawBody).digest("hex"), rawBody]);
    if (!ins.rowCount) return { http: 200, status: "duplicate" as const, detail: "Aynı olay daha önce işlendi" };
    const tz = (await c.query("select timezone from tenants where id = $1", [target.tenant_id])).rows[0].timezone as string;
    const r = await apply(c, target.tenant_id, connectionId, e, tz, correlationId);
    await c.query("update webhook_events set status = $2, job_id = $3, detail = $4 where id = $1", [ins.rows[0].id, r.status, r.jobId ?? null, r.detail ?? null]);
    return { http: 200, status: r.status, detail: r.detail };
  });
}

async function findJob(c: C, connectionId: string, operation: string, d: Record<string, string>) {
  // Webhook, gönderim sonucu kaydedilmeden önce gelebilir: sağlayıcı referansı yoksa idempotency anahtarıyla eşlenir.
  return (await c.query(
    `select * from integration_jobs where connection_id = $1 and operation = $2 and (provider_ref = $3 or idempotency_key = $4) for update`,
    [connectionId, operation, d.provider_ref ?? "", d.request_key ?? ""])).rows[0];
}
async function closeOutcome(c: C, jobId: string, outcome: "succeeded" | "failed") {
  await c.query("update integration_jobs set outcome_status = $2, completed_at = now(), updated_at = now() where id = $1", [jobId, outcome]);
}

async function apply(c: C, tenantId: string, connectionId: string, e: Evt, tz: string, correlationId: string):
  Promise<{ status: "processed" | "ignored_stale" | "ignored_unknown" | "error"; jobId?: string; detail?: string }> {
  const d = e.data;
  if (e.type === "message.delivered" || e.type === "message.failed") {
    const job = await findJob(c, connectionId, "sms.send", d);
    if (!job) return { status: "ignored_unknown", detail: "Eşleşen mesaj işi yok" };
    const m = (await c.query("select status from messages where id = $1 for update", [job.source_id])).rows[0];
    if (!m || ["delivered", "failed", "cancelled"].includes(m.status)) return { status: "ignored_stale", jobId: job.id, detail: `Mesaj zaten ${m?.status}` };
    const st = e.type === "message.delivered" ? "delivered" : "failed";
    await c.query("update messages set status = $2, status_reason = $3, status_at = now() where id = $1", [job.source_id, st, st === "failed" ? d.reason ?? "Sağlayıcı teslim edemedi" : null]);
    await c.query("insert into delivery_events(tenant_id, message_id, status, source, detail) values ($1,$2,$3,'provider',$4)",
      [tenantId, job.source_id, st, `Sağlayıcı bildirimi ${e.id}`]);
    await closeOutcome(c, job.id, st === "delivered" ? "succeeded" : "failed");
    return { status: "processed", jobId: job.id };
  }

  if (e.type === "payment.succeeded" || e.type === "payment.failed") {
    const job = await findJob(c, connectionId, "payment.create_link", d);
    if (!job) return { status: "ignored_unknown", detail: "Eşleşen ödeme isteği yok" };
    const req = (await c.query("select * from online_payment_requests where id = $1 for update", [job.source_id])).rows[0];
    if (req.status === "paid") return { status: "ignored_stale", jobId: job.id, detail: "İstek zaten ödendi; ikinci ödeme kaydı oluşturulmadı" };
    if (e.type === "payment.failed") {
      await c.query("update online_payment_requests set status = 'failed', failure_reason = $2 where id = $1", [req.id, d.reason ?? "Sağlayıcı ödemeyi reddetti"]);
      await closeOutcome(c, job.id, "failed");
      return { status: "processed", jobId: job.id };
    }
    if (d.amount !== req.amount) {
      await deadLike(c, tenantId, job.id, `Ödeme tutarı uyuşmuyor (istek ${req.amount}, bildirim ${d.amount}); kayıt oluşturulmadı.`);
      return { status: "error", jobId: job.id, detail: "amount_mismatch" };
    }
    if (!d.payment_id) return { status: "error", jobId: job.id, detail: "payment_id yok" };
    await lockAccount(c, req.patient_id);
    if ((await c.query("select 1 from payments where provider_ref = $1", [d.payment_id])).rowCount) {
      return { status: "ignored_stale", jobId: job.id, detail: "Bu sağlayıcı ödemesi zaten kayıtlı" };
    }
    const acct = (await c.query("select id from cash_accounts where kind = 'provider' and active order by created_at limit 1")).rows[0];
    if (!acct) { await deadLike(c, tenantId, job.id, "Sağlayıcı tahsilat hesabı yok"); return { status: "error", jobId: job.id, detail: "no_provider_account" }; }
    const at = e.created ? new Date(e.created * 1000) : new Date();
    const ctx = systemCtx(tenantId, req.created_by, tz, correlationId);
    const p = await c.query(
      `insert into payments(tenant_id, patient_id, amount, method, cash_account_id, paid_at, note, received_by, source, provider_ref)
       values ($1,$2,$3,'online',$4,$5,$6,$7,'provider',$8) returning id`,
      [tenantId, req.patient_id, req.amount, acct.id, at, `Online ödeme (sağlayıcı bildirimi ${e.id})`, req.created_by, d.payment_id]);
    await cashMovement(c, ctx, { accountId: acct.id, amount: req.amount, source: "payment", sourceId: p.rows[0].id, at });
    await c.query("update online_payment_requests set status = 'paid', payment_id = $2, paid_at = $3 where id = $1", [req.id, p.rows[0].id, at]);
    await closeOutcome(c, job.id, "succeeded");
    await audit(c, ctx, { action: "payment.create", entityType: "payment", entityId: p.rows[0].id, patientId: req.patient_id,
      changes: { amount: { from: null, to: req.amount }, method: { from: null, to: "online" }, source: { from: null, to: "provider_webhook" } } });
    await enqueue(c, tenantId, "via_net.changed", { patientId: req.patient_id });
    return { status: "processed", jobId: job.id };
  }

  if (e.type === "refund.succeeded" || e.type === "refund.failed") {
    const job = await findJob(c, connectionId, "payment.refund", d);
    if (!job) return { status: "ignored_unknown", detail: "Eşleşen iade işi yok" };
    if (job.outcome_status === "succeeded" || job.outcome_status === "failed") return { status: "ignored_stale", jobId: job.id, detail: `İade işi zaten ${job.outcome_status}` };
    if (e.type === "refund.failed") { await closeOutcome(c, job.id, "failed"); return { status: "processed", jobId: job.id }; }
    const pl = job.payload as { paymentId: string; amount: string; reason: string };
    const pay = (await c.query("select patient_id, cash_account_id from payments where id = $1", [pl.paymentId])).rows[0];
    await lockAccount(c, pay.patient_id);
    try {
      await c.query("savepoint refund_try");
      await refundPayment(c, systemCtx(tenantId, job.requested_by, tz, correlationId), pl.paymentId,
        { amount: pl.amount, method: "online", cashAccountId: pay.cash_account_id, reason: pl.reason, providerRef: d.refund_id ?? null, source: "provider_webhook" });
      await c.query("release savepoint refund_try");
    } catch (err) {
      await c.query("rollback to savepoint refund_try");
      await deadLike(c, tenantId, job.id, `Sağlayıcı iadeyi bildirdi ama defter kaydı yapılamadı: ${(err as Error).message.slice(0, 160)}`);
      return { status: "error", jobId: job.id, detail: "ledger_refund_failed" };
    }
    await closeOutcome(c, job.id, "succeeded");
    await enqueue(c, tenantId, "via_net.changed", { patientId: pay.patient_id });
    return { status: "processed", jobId: job.id };
  }
  return { status: "ignored_unknown", detail: `Desteklenmeyen olay türü: ${e.type}` };
}

/** İnsan incelemesi gereken uyuşmazlık: yöneticiye görev (tutar uyuşmazlığı, defter hatası). */
async function deadLike(c: C, tenantId: string, jobId: string, reason: string) {
  await c.query(
    `insert into tasks(tenant_id, kind, source_type, source_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     values ($1,'integration_dead','integration_job',$2::uuid,'integration_review:' || $2::text,'Sağlayıcı bildirimi incelenmeli',$3,
             'PİA Köprü ekranında işi ve sağlayıcı bildirimini karşılaştırın; gerekirse finans kaydını elle düzeltin.','clinic_admin', now())
     on conflict (tenant_id, dedupe_key) where status in ('open','in_progress','blocked') do nothing`, [tenantId, jobId, reason.slice(0, 400)]);
}
