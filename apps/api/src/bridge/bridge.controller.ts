import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import {
  ConnectionUpdate, JobReject, MockConnectionCreate, MockSimulate, OnlinePaymentCreate, PROVIDER_READINESS, ProviderRefundCreate, fromMinor, toMinor,
} from "@viadent/contracts";
import { decryptSecret, encryptSecret, newWebhookSecret, signWebhook } from "@viadent/db";
import { Ctx, Public, Require, Webhook } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";
import { idempotent, lockAccount, requireKey } from "../finance/ledger.js";
import { ingestWebhook } from "./webhook.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
type C = import("pg").PoolClient;

/** Aktif bağlantıyı bulur; yoksa iş oluşturulmaz (sessiz başarı yok). */
export async function activeConnection(c: C, kind: string) {
  const r = (await c.query("select id, provider, mode from integration_connections where kind = $1 and status = 'active' order by created_at limit 1", [kind])).rows[0];
  if (!r) throw new AppError(409, "PROVIDER_NOT_CONFIGURED", "Bu işlem için etkin bir sağlayıcı bağlantısı yok (VİA Köprü).");
  return r as { id: string; provider: string; mode: string };
}
export async function createJob(c: C, ctx: RequestContext, j: { connectionId: string; operation: string; sourceType: string; sourceId: string;
  key: string; payload: Record<string, unknown>; requiresApproval: boolean }) {
  const r = await c.query(
    `insert into integration_jobs(tenant_id, connection_id, operation, source_type, source_id, idempotency_key, payload, approval_status, transport_status, requested_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [ctx.tenantId, j.connectionId, j.operation, j.sourceType, j.sourceId, j.key, JSON.stringify(j.payload), j.requiresApproval ? "pending" : "not_required",
     j.requiresApproval ? "held" : "queued", ctx.userId]);
  const jobId = r.rows[0].id as string;
  if (j.requiresApproval) {
    await c.query(
      `insert into tasks(tenant_id, kind, source_type, source_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
       values ($1,'integration_approval','integration_job',$2::uuid,'integration_approval:' || $2::text,'Dış işlem onay bekliyor',$3,
               'VİA Köprü ekranında işi inceleyin; isteyen kişiden farklı bir yetkili onaylamalı veya gerekçeyle reddetmeli.','clinic_admin', now())`,
      [ctx.tenantId, jobId, `${j.operation} işlemi onay kapısında bekliyor.`]);
  }
  await audit(c, ctx, { action: "integration_job.create", entityType: "integration_job", entityId: jobId,
    changes: { operation: { from: null, to: j.operation }, approval: { from: null, to: j.requiresApproval ? "pending" : "not_required" } } });
  return jobId;
}

/**
 * VİA Köprü (VD-012): dış işler tek merkezde — gönderildi / sağlayıcı kabul etti / nihai sonuç / yeniden deneme / onay.
 * Gerçek sağlayıcı yok; MOCK bağlantılar açıkça etiketlidir ve dışarı hiçbir şey göndermez.
 */
@Controller()
export class BridgeController {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ------------------------------------------------------------ webhook (oturumsuz, imzalı)
  @Post("webhooks/:connectionId")
  @Public()
  @Webhook()
  async webhook(@Param("connectionId") connectionId: string, @Req() req: Request & { rawBody?: Buffer }, @Res() res: Response) {
    const raw = req.rawBody?.toString("utf8") ?? "";
    const r = await ingestWebhook(this.db, connectionId, raw, req.get("x-viadent-signature"), req.correlationId ?? randomUUID());
    // Yanıt gövdesi hasta verisi veya iç ayrıntı içermez.
    res.status(r.http).json(r.http === 200 ? { received: true, result: r.status } : { code: r.http === 404 ? "NOT_FOUND" : "WEBHOOK_REJECTED", message: "İstek doğrulanamadı." });
  }

  // ------------------------------------------------------------ genel bakış ve bağlantılar
  @Get("integrations/overview")
  @Require("integration.read")
  overview(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const cons = await c.query(
        `select cn.id, cn.kind, cn.provider, cn.mode, cn.status, cn.blocked_reason, cn.config, cn.secret_rotated_at, cn.created_at,
                (cn.webhook_secret_enc is not null) as has_secret,
                (select count(*) from webhook_rejections w where w.connection_id = cn.id and w.received_at > now() - interval '7 days')::int as rejections_7d
           from integration_connections cn order by cn.kind`);
      const counts = await c.query(
        `select operation, transport_status, outcome_status, approval_status, count(*)::int as n from integration_jobs group by 1,2,3,4`);
      return {
        connections: cons.rows.map((x) => ({ id: x.id, kind: x.kind, provider: x.provider, mode: x.mode, status: x.status, blockedReason: x.blocked_reason,
          mockBehavior: x.config?.behavior ?? "accept", mockQueryResult: x.config?.queryResult ?? "accepted", hasSecret: x.has_secret, secretRotatedAt: x.secret_rotated_at,
          webhookPath: `/api/v1/webhooks/${x.id}`, rejections7d: x.rejections_7d })),
        readiness: PROVIDER_READINESS,
        externalSendGate: process.env.VIADENT_EXTERNAL_SEND_ENABLED === "true" ? "open" : "closed",
        counts: counts.rows,
      };
    });
  }

  @Post("integrations/connections/mock")
  @Require("integration.manage")
  createMock(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(MockConnectionCreate, body);
    return this.db.tx(ctx, async (c) => {
      if ((await c.query("select 1 from integration_connections where kind = $1 and provider = 'mock'", [i.kind])).rowCount) {
        throw new AppError(409, "CONNECTION_EXISTS", "Bu tür için MOCK bağlantı zaten var.");
      }
      const secret = newWebhookSecret();
      const r = await c.query(
        `insert into integration_connections(tenant_id, kind, provider, mode, status, webhook_secret_enc, secret_rotated_at) values ($1,$2,'mock','mock','active',$3, now()) returning id`,
        [ctx.tenantId, i.kind, encryptSecret(secret)]);
      if (i.kind === "payment" && !(await c.query("select 1 from cash_accounts where kind = 'provider'")).rowCount) {
        await c.query("insert into cash_accounts(tenant_id, name, kind) values ($1,'Online ödeme — MOCK sağlayıcı','provider')", [ctx.tenantId]);
      }
      await audit(c, ctx, { action: "integration_connection.create", entityType: "integration_connection", entityId: r.rows[0].id, changes: { kind: { from: null, to: i.kind }, provider: { from: null, to: "mock" } } });
      return { id: r.rows[0].id, webhookSecret: secret, note: "İmza anahtarı yalnız şimdi gösterilir; sağlayıcı paneline girin." };
    });
  }

  @Post("integrations/connections/:id/rotate-secret")
  @HttpCode(200)
  @Require("integration.manage")
  rotate(@Ctx() ctx: RequestContext, @Param("id", id) cid: string) {
    return this.db.tx(ctx, async (c) => {
      const secret = newWebhookSecret();
      const r = await c.query("update integration_connections set webhook_secret_enc = $2, secret_rotated_at = now() where id = $1 returning id", [cid, encryptSecret(secret)]);
      if (!r.rowCount) throw Errors.notFound("Bağlantı");
      await audit(c, ctx, { action: "integration_connection.rotate_secret", entityType: "integration_connection", entityId: cid, changes: { secret: { from: "***", to: "***" } } });
      return { webhookSecret: secret, note: "Eski anahtarla imzalanan bildirimler artık reddedilir." };
    });
  }

  @Patch("integrations/connections/:id")
  @Require("integration.manage")
  update(@Ctx() ctx: RequestContext, @Param("id", id) cid: string, @Body() body: unknown) {
    const i = parse(ConnectionUpdate, body);
    return this.db.tx(ctx, async (c) => {
      const cn = (await c.query("select provider, status, config from integration_connections where id = $1", [cid])).rows[0];
      if (!cn) throw Errors.notFound("Bağlantı");
      if ((i.mockBehavior || i.mockQueryResult) && cn.provider !== "mock") throw Errors.validation({ mockBehavior: "Yalnız MOCK bağlantıda ayarlanır." });
      if (cn.status === "blocked") throw new AppError(409, "CONNECTION_BLOCKED", "Erişim bekleyen bağlantı etkinleştirilemez.");
      const config = { ...(cn.config ?? {}), ...(i.mockBehavior ? { behavior: i.mockBehavior } : {}), ...(i.mockQueryResult ? { queryResult: i.mockQueryResult } : {}) };
      await c.query("update integration_connections set status = coalesce($2, status), config = $3 where id = $1", [cid, i.status ?? null, JSON.stringify(config)]);
      await audit(c, ctx, { action: "integration_connection.update", entityType: "integration_connection", entityId: cid,
        changes: { ...(i.status ? { status: { from: cn.status, to: i.status } } : {}), ...(i.mockBehavior || i.mockQueryResult ? { config: { from: cn.config, to: config } } : {}) } });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ işler
  @Get("integrations/jobs")
  @Require("integration.read")
  jobs(@Ctx() ctx: RequestContext, @Query("status") status?: string) {
    const filter = status === "attention" ? "j.transport_status in ('held','dead','unknown') or (j.transport_status = 'rejected')"
      : status === "open" ? "j.transport_status in ('held','queued','sending','unknown') or (j.transport_status = 'accepted' and j.outcome_status = 'pending')" : "true";
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select j.id, j.operation, j.source_type, j.source_id, j.approval_status, j.transport_status, j.outcome_status, j.attempts, j.max_attempts,
                j.next_attempt_at, j.last_error, j.provider_ref, j.created_at, j.updated_at, j.completed_at, j.payload,
                cn.provider, cn.mode, ur.full_name as requested_by, ua.full_name as approved_by, j.requested_by as requested_by_id
           from integration_jobs j join integration_connections cn on cn.id = j.connection_id join users ur on ur.id = j.requested_by
           left join users ua on ua.id = j.approved_by where ${filter} order by j.created_at desc limit 200`);
      return { items: r.rows.map((j) => ({ id: j.id, operation: j.operation, sourceType: j.source_type, sourceId: j.source_id, approvalStatus: j.approval_status,
        transportStatus: j.transport_status, outcomeStatus: j.outcome_status, attempts: j.attempts, maxAttempts: j.max_attempts, nextAttemptAt: j.next_attempt_at,
        lastError: j.last_error, providerRef: j.provider_ref, createdAt: j.created_at, updatedAt: j.updated_at, completedAt: j.completed_at,
        provider: j.provider, mode: j.mode, requestedBy: j.requested_by, approvedBy: j.approved_by, mine: j.requested_by_id === ctx.userId,
        summary: j.operation === "payment.refund" ? `${j.payload.amount} TRY iade` : j.operation === "payment.create_link" ? `${j.payload.amount} TRY ödeme bağlantısı` : "SMS" })) };
    });
  }

  @Get("integrations/jobs/:id")
  @Require("integration.read")
  job(@Ctx() ctx: RequestContext, @Param("id", id) jid: string) {
    return this.db.tx(ctx, async (c) => {
      const j = (await c.query("select id, operation, transport_status, outcome_status, approval_status, reject_reason from integration_jobs where id = $1", [jid])).rows[0];
      if (!j) throw Errors.notFound("İş");
      const a = await c.query("select attempt, kind, result, detail, started_at, finished_at from integration_attempts where job_id = $1 order by started_at, attempt", [jid]);
      const w = await c.query("select provider_event_id, event_type, occurred_at, received_at, status, detail from webhook_events where job_id = $1 order by received_at", [jid]);
      return { ...j, attempts: a.rows, webhooks: w.rows };
    });
  }

  @Post("integration-jobs/:id/approve")
  @HttpCode(200)
  @Require("integration.approve")
  approve(@Ctx() ctx: RequestContext, @Param("id", id) jid: string) {
    return this.db.tx(ctx, async (c) => {
      const j = (await c.query("select requested_by, approval_status from integration_jobs where id = $1 for update", [jid])).rows[0];
      if (!j) throw Errors.notFound("İş");
      if (j.approval_status !== "pending") throw new AppError(409, "NOT_PENDING_APPROVAL", "Bu iş onay beklemiyor.");
      if (j.requested_by === ctx.userId) throw new AppError(409, "SAME_USER_APPROVAL", "İşlemi isteyen kişi kendi isteğini onaylayamaz (dört göz kuralı).");
      await c.query("update integration_jobs set approval_status = 'approved', approved_by = $2, approved_at = now(), transport_status = 'queued', next_attempt_at = now(), updated_at = now() where id = $1",
        [jid, ctx.userId]);
      await this.closeApprovalTask(c, jid, "Onaylandı");
      await audit(c, ctx, { action: "integration_job.approve", entityType: "integration_job", entityId: jid, changes: { approval: { from: "pending", to: "approved" } } });
      return { ok: true };
    });
  }

  @Post("integration-jobs/:id/reject")
  @HttpCode(200)
  @Require("integration.approve")
  reject(@Ctx() ctx: RequestContext, @Param("id", id) jid: string, @Body() body: unknown) {
    const i = parse(JobReject, body);
    return this.db.tx(ctx, async (c) => {
      const j = (await c.query("select approval_status from integration_jobs where id = $1 for update", [jid])).rows[0];
      if (!j) throw Errors.notFound("İş");
      if (j.approval_status !== "pending") throw new AppError(409, "NOT_PENDING_APPROVAL", "Bu iş onay beklemiyor.");
      await c.query(`update integration_jobs set approval_status = 'rejected', reject_reason = $2, transport_status = 'cancelled', outcome_status = 'not_applicable',
                       completed_at = now(), updated_at = now() where id = $1`, [jid, i.reason]);
      await this.closeApprovalTask(c, jid, "Reddedildi");
      await audit(c, ctx, { action: "integration_job.reject", entityType: "integration_job", entityId: jid, changes: { approval: { from: "pending", to: "rejected" }, reason: { from: null, to: i.reason } } });
      return { ok: true };
    });
  }

  /** Dead-letter'daki işi yeniden kuyruğa alır (aynı idempotency anahtarıyla; sağlayıcı tarafında çift işlem oluşmaz). */
  @Post("integration-jobs/:id/retry")
  @HttpCode(200)
  @Require("integration.manage")
  retry(@Ctx() ctx: RequestContext, @Param("id", id) jid: string) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `update integration_jobs set transport_status = case when outcome_status = 'unknown' then 'unknown' else 'queued' end, outcome_status = case when outcome_status = 'unknown' then 'unknown' else 'pending' end,
                attempts = 0, next_attempt_at = now(), completed_at = null, updated_at = now() where id = $1 and transport_status = 'dead' returning id`, [jid]);
      if (!r.rowCount) {
        if (!(await c.query("select 1 from integration_jobs where id = $1", [jid])).rowCount) throw Errors.notFound("İş");
        throw new AppError(409, "NOT_DEAD", "Yalnız deneme sınırı dolmuş (dead) iş yeniden denenebilir.");
      }
      await c.query("update tasks set status = 'done', closed_at = now(), updated_at = now(), closed_reason = 'Yeniden denemeye alındı' where kind = 'integration_dead' and source_id = $1 and status in ('open','in_progress','blocked')", [jid]);
      await audit(c, ctx, { action: "integration_job.retry", entityType: "integration_job", entityId: jid, changes: { transport_status: { from: "dead", to: "queued" } } });
      return { ok: true };
    });
  }

  @Post("integration-jobs/:id/cancel")
  @HttpCode(200)
  @Require("integration.manage")
  cancel(@Ctx() ctx: RequestContext, @Param("id", id) jid: string, @Body() body: unknown) {
    const i = parse(JobReject, body);
    return this.db.tx(ctx, async (c) => {
      const j = (await c.query("select operation, source_id, transport_status, approval_status from integration_jobs where id = $1 for update", [jid])).rows[0];
      if (!j) throw Errors.notFound("İş");
      if (!["queued", "dead", "held"].includes(j.transport_status)) throw new AppError(409, "NOT_CANCELLABLE", "Sağlayıcıya ulaşmış veya sonucu belirsiz iş iptal edilemez; önce durumu netleşmeli.");
      await c.query(`update integration_jobs set transport_status = 'cancelled', outcome_status = 'not_applicable', approval_status = case when approval_status = 'pending' then 'rejected' else approval_status end,
                       reject_reason = coalesce(reject_reason, $2), last_error = $2, completed_at = now(), updated_at = now() where id = $1`, [jid, i.reason]);
      if (j.operation === "sms.send") {
        await c.query("update messages set status = 'cancelled', status_reason = $2, status_at = now() where id = $1 and status in ('queued','unknown')", [j.source_id, i.reason]);
      } else if (j.operation === "payment.create_link") {
        await c.query("update online_payment_requests set status = 'cancelled' where id = $1 and status in ('created','link_ready')", [j.source_id]);
      }
      await c.query("update tasks set status = 'done', closed_at = now(), updated_at = now(), closed_reason = 'İş iptal edildi' where source_id = $1 and kind in ('integration_dead','integration_approval') and status in ('open','in_progress','blocked')", [jid]);
      await audit(c, ctx, { action: "integration_job.cancel", entityType: "integration_job", entityId: jid, changes: { transport_status: { from: j.transport_status, to: "cancelled" }, reason: { from: null, to: i.reason } } });
      return { ok: true };
    });
  }

  private async closeApprovalTask(c: C, jid: string, reason: string) {
    await c.query("update tasks set status = 'done', closed_at = now(), updated_at = now(), closed_reason = $2 where kind = 'integration_approval' and source_id = $1 and status in ('open','in_progress','blocked')", [jid, reason]);
  }

  @Get("integrations/webhooks")
  @Require("integration.read")
  webhooks(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const e = await c.query(
        `select w.provider_event_id, w.event_type, w.occurred_at, w.received_at, w.status, w.detail, w.job_id, cn.kind
           from webhook_events w join integration_connections cn on cn.id = w.connection_id order by w.received_at desc limit 100`);
      const r = await c.query("select reason, count(*)::int as n, max(received_at) as last_at from webhook_rejections group by reason");
      return { events: e.rows.map((x) => ({ eventId: x.provider_event_id, type: x.event_type, occurredAt: x.occurred_at, receivedAt: x.received_at, status: x.status,
        detail: x.detail, jobId: x.job_id, kind: x.kind })), rejections: r.rows };
    });
  }

  /**
   * MOCK sağlayıcının bildirimini simüle eder: bağlantının imza anahtarıyla imzalanmış gövde, gerçek webhook ile AYNI doğrulama
   * ve işleme yolundan geçer. Yalnız MOCK bağlantılarda çalışır; demo/test içindir.
   */
  @Post("integrations/mock/simulate")
  @HttpCode(200)
  @Require("integration.manage")
  async simulate(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(MockSimulate, body);
    const j = await this.db.tx(ctx, async (c) => (await c.query(
      `select j.id, j.operation, j.provider_ref, j.idempotency_key, j.payload, j.connection_id, cn.provider, cn.webhook_secret_enc
         from integration_jobs j join integration_connections cn on cn.id = j.connection_id where j.id = $1`, [i.jobId])).rows[0]);
    if (!j) throw Errors.notFound("İş");
    if (j.provider !== "mock") throw new AppError(409, "NOT_MOCK", "Simülasyon yalnız MOCK sağlayıcıda kullanılabilir.");
    const fits: Record<string, string> = { "message.": "sms.send", "payment.": "payment.create_link", "refund.": "payment.refund" };
    if (fits[i.event.split(".")[0]! + "."] !== j.operation) throw Errors.validation({ event: "Bu olay türü bu işe uymuyor." });
    const data: Record<string, string> = { provider_ref: j.provider_ref ?? "", request_key: j.idempotency_key };
    if (i.event === "payment.succeeded") { data.payment_id = `mockpay_${randomUUID().slice(0, 12)}`; data.amount = i.amount ?? j.payload.amount; }
    if (i.event === "refund.succeeded") data.refund_id = `mockref_${randomUUID().slice(0, 12)}`;
    if (i.event.endsWith("failed")) data.reason = "MOCK: sağlayıcı başarısız bildirdi";
    const evt = { id: i.eventId ?? `evt_${randomUUID().replace(/-/g, "").slice(0, 20)}`, type: i.event,
      created: Math.floor((i.occurredAt ? new Date(i.occurredAt) : new Date()).getTime() / 1000), data };
    const raw = JSON.stringify(evt);
    const sig = signWebhook(decryptSecret(j.webhook_secret_enc), raw);
    const r = await ingestWebhook(this.db, j.connection_id, raw, sig, ctx.correlationId);
    return { eventId: evt.id, ...r };
  }

  // ------------------------------------------------------------ online ödeme (MOCK sağlayıcı)
  @Get("patients/:patientId/online-payments")
  @Require("account.read")
  onlinePayments(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const r = await c.query(
        `select o.id, o.amount::text, o.description, o.status, o.checkout_url, o.payment_id, o.failure_reason, o.created_at, o.expires_at, o.paid_at,
                j.id as job_id, j.transport_status, cn.provider, u.full_name as by
           from online_payment_requests o join users u on u.id = o.created_by
           left join integration_jobs j on j.source_type = 'online_payment' and j.source_id = o.id left join integration_connections cn on cn.id = j.connection_id
          where o.patient_id = $1 order by o.created_at desc`, [patientId]);
      return { items: r.rows.map((o) => ({ id: o.id, amount: o.amount, description: o.description, status: o.status, checkoutUrl: o.checkout_url, paymentId: o.payment_id,
        failureReason: o.failure_reason, createdAt: o.created_at, expiresAt: o.expires_at, paidAt: o.paid_at, jobId: o.job_id, transportStatus: o.transport_status,
        provider: o.provider, isMock: o.provider === "mock", by: o.by })) };
    });
  }

  @Post("patients/:patientId/online-payments")
  @Require("payment.write")
  createOnline(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string, @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(OnlinePaymentCreate, body);
    const k = requireKey(key);
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "online_payment.create", k, { patientId, ...i }, async () => {
        if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
        const cn = await activeConnection(c, "payment");
        const o = await c.query("insert into online_payment_requests(tenant_id, patient_id, amount, description, created_by) values ($1,$2,$3,$4,$5) returning id",
          [ctx.tenantId, patientId, i.amount, i.description, ctx.userId]);
        // Sağlayıcıya en az veri: tutar, para birimi, genel açıklama ve bizim referansımız. Hasta adı/tanı gönderilmez.
        const jobId = await createJob(c, ctx, { connectionId: cn.id, operation: "payment.create_link", sourceType: "online_payment", sourceId: o.rows[0].id,
          key: `opr_${o.rows[0].id}`, payload: { amount: i.amount, currency: "TRY", description: i.description, reference: o.rows[0].id }, requiresApproval: false });
        await audit(c, ctx, { action: "online_payment.create", entityType: "online_payment_request", entityId: o.rows[0].id, patientId, changes: { amount: { from: null, to: i.amount } } });
        return { id: o.rows[0].id as string, jobId, status: "created", isMock: cn.provider === "mock" };
      });
      if (r.replayed) res.setHeader("Idempotent-Replayed", "true");
      return r.body;
    });
  }

  @Post("online-payments/:id/cancel")
  @HttpCode(200)
  @Require("payment.write")
  cancelOnline(@Ctx() ctx: RequestContext, @Param("id", id) oid: string) {
    return this.db.tx(ctx, async (c) => {
      const o = (await c.query("select status, patient_id from online_payment_requests where id = $1 for update", [oid])).rows[0];
      if (!o) throw Errors.notFound("Ödeme isteği");
      if (!["created", "link_ready"].includes(o.status)) throw new AppError(409, "NOT_CANCELLABLE", "Bu istek iptal edilemez.");
      await c.query("update online_payment_requests set status = 'cancelled' where id = $1", [oid]);
      await c.query(`update integration_jobs set transport_status = 'cancelled', outcome_status = 'not_applicable', last_error = 'Kullanıcı iptal etti', completed_at = now()
                      where source_type = 'online_payment' and source_id = $1 and transport_status in ('queued','held')`, [oid]);
      await audit(c, ctx, { action: "online_payment.cancel", entityType: "online_payment_request", entityId: oid, patientId: o.patient_id, changes: { status: { from: o.status, to: "cancelled" } } });
      return { ok: true, note: "Bağlantı zaten paylaşıldıysa sağlayıcı tarafında da kapatılmalıdır; geç gelen ödeme bildirimi yine kaydedilir." };
    });
  }

  /** Sağlayıcı üzerinden iade: onay kapısında (dört göz) bekler; defter kaydı yalnız sağlayıcı iadeyi bildirince yapılır. */
  @Post("payments/:id/provider-refunds")
  @Require("payment.refund")
  providerRefund(@Ctx() ctx: RequestContext, @Param("id", id) paymentId: string, @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(ProviderRefundCreate, body);
    const k = requireKey(key);
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "provider_refund.create", k, { paymentId, ...i }, async () => {
        const p = (await c.query(
          `select p.patient_id, p.source, p.amount::text as amount, coalesce((select sum(f.amount) from refunds f where f.payment_id = p.id), 0)::text as refunded
             from payments p where p.id = $1`, [paymentId])).rows[0];
        if (!p) throw Errors.notFound("Ödeme");
        if (p.source !== "provider") throw new AppError(409, "NOT_PROVIDER_PAYMENT", "Yalnız sağlayıcı üzerinden alınmış ödeme sağlayıcıdan iade edilebilir; diğerleri için iade kaydı kullanın.");
        await lockAccount(c, p.patient_id);
        const pending = (await c.query(
          `select coalesce(sum((payload->>'amount')::numeric), 0)::text as s from integration_jobs
            where operation = 'payment.refund' and payload->>'paymentId' = $1 and outcome_status in ('pending','unknown') and transport_status not in ('cancelled','rejected')`, [paymentId])).rows[0].s;
        const left = toMinor(p.amount) - toMinor(p.refunded) - toMinor(pending);
        if (toMinor(i.amount) > left) throw new AppError(409, "REFUND_EXCEEDS_PAYMENT", `Bekleyen iadeler dahil en çok ${fromMinor(left)} TRY iade edilebilir.`);
        const cn = await activeConnection(c, "payment");
        const jobId = await createJob(c, ctx, { connectionId: cn.id, operation: "payment.refund", sourceType: "payment", sourceId: paymentId,
          key: `prf_${randomUUID()}`, payload: { paymentId, amount: i.amount, reason: i.reason }, requiresApproval: true });
        return { jobId, status: "held", note: "İade onay kapısında; farklı bir yetkili onaylayınca sağlayıcıya iletilir. Defter kaydı sağlayıcı iadeyi bildirince yapılır." };
      });
      if (r.replayed) res.setHeader("Idempotent-Replayed", "true");
      return r.body;
    });
  }
}
