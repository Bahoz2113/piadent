import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  CommPreferenceSet, FollowUpCancel, FollowUpCreate, MessageSend, ReadinessExceptionCreate, ReadinessRuleCreate, localDate, maskPhone,
} from "@viadent/contracts";
import { readinessFor } from "@viadent/db";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";
import { idempotent, requireKey } from "../finance/ledger.js";
import { activeConnection, createJob } from "../bridge/bridge.controller.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");
/** QA-110 (ADR-092): klinik çıktı belgesi işlem sonrası hekim çıktısıdır ve sağlık verisidir; ziyaret hazırlığı önkoşulu olamaz. */
const CLINICAL_OUTPUT_RULE = "Klinik çıktı belgeleri (epikriz, hasta bilgi föyü, reçete yazısı) hazırlık kuralına bağlanamaz; bunlar işlem sonrası hekim çıktısıdır ve sağlık verisidir.";

/**
 * İletişim tercihi (amaç × kanal, yalnız eklenen geçmiş), mesaj (gönderim ≠ teslim, AT-12), kontrol (Akış E) ve PİA Hazır.
 * Aydınlatma, iletişim izni ve tıbbi onam ayrı kavramlardır; tek “KVKK onaylı” kutusu yoktur (Plan Akış D).
 */
@Controller()
export class CareController {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ------------------------------------------------------------ iletişim
  @Get("patients/:patientId/communication")
  @Require("patient.read")
  communication(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const h = await c.query(
        `select cp.purpose, cp.channel, cp.status, cp.source, cp.note, cp.recorded_at, u.full_name as by
           from communication_preferences cp join users u on u.id = cp.recorded_by where cp.patient_id = $1 order by cp.recorded_at desc, cp.id`, [patientId]);
      const current: Record<string, { status: string; at: string; source: string }> = {};
      for (const r of h.rows) { const k = `${r.purpose}:${r.channel}`; if (!current[k]) current[k] = { status: r.status, at: r.recorded_at, source: r.source }; }
      const m = await c.query(
        `select m.id, m.purpose, m.channel, m.recipient_masked, m.body, m.provider, m.status, m.status_reason, m.created_at, m.submitted_at, m.status_at, u.full_name as by,
                (select json_agg(json_build_object('status', d.status, 'source', d.source, 'detail', d.detail, 'at', d.at) order by d.at) from delivery_events d where d.message_id = m.id) as events
           from messages m join users u on u.id = m.created_by where m.patient_id = $1 order by m.created_at desc limit 100`, [patientId]);
      return {
        current, history: h.rows.map((r) => ({ purpose: r.purpose, channel: r.channel, status: r.status, source: r.source, note: r.note, at: r.recorded_at, by: r.by })),
        messages: m.rows.map((x) => ({ id: x.id, purpose: x.purpose, channel: x.channel, recipient: x.recipient_masked, body: x.body, provider: x.provider, status: x.status,
          statusReason: x.status_reason, createdAt: x.created_at, submittedAt: x.submitted_at, statusAt: x.status_at, by: x.by, events: x.events ?? [] })),
        provider: { name: "mock", label: "MOCK — gerçek mesaj gönderilmez (sağlayıcı sözleşmesi yok, Görev 5)" },
      };
    });
  }

  @Post("patients/:patientId/communication-preferences")
  @Require("communication.write")
  setPreference(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string, @Body() body: unknown) {
    const i = parse(CommPreferenceSet, body);
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const r = await c.query(
        "insert into communication_preferences(tenant_id, patient_id, purpose, channel, status, source, note, recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
        [ctx.tenantId, patientId, i.purpose, i.channel, i.status, i.source, i.note ?? null, ctx.userId]);
      await audit(c, ctx, { action: "communication_preference.set", entityType: "communication_preference", entityId: r.rows[0].id, patientId,
        changes: { [`${i.purpose}:${i.channel}`]: { from: null, to: i.status }, source: { from: null, to: i.source } } });
      return { id: r.rows[0].id };
    });
  }

  /** Mesaj kuyruğa alınır; amaç+kanal izni yoksa reddedilir. Sağlayıcı MOCK: dışarı hiçbir şey gitmez (AT-12). */
  @Post("messages")
  @Require("message.send")
  send(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(MessageSend, body);
    const k = requireKey(key);
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "message.send", k, i, async () => {
        const p = (await c.query("select phone_e164, email from patients where id = $1", [i.patientId])).rows[0];
        if (!p) throw Errors.notFound("Hasta");
        const pref = (await c.query(
          "select status from communication_preferences where patient_id = $1 and purpose = $2 and channel = $3 order by recorded_at desc limit 1",
          [i.patientId, i.purpose, i.channel])).rows[0];
        if (pref?.status !== "granted") throw new AppError(422, "CONSENT_MISSING", "Bu amaç ve kanal için hastanın kayıtlı iletişim izni yok. Önce iletişim tercihini kaydedin.");
        const cn = await activeConnection(c, i.channel); // kanal başına sağlayıcı bağlantısı; yoksa 409 (sessiz başarı yok)
        const to = i.channel === "email" ? p.email : p.phone_e164;
        if (!to) throw new AppError(422, "RECIPIENT_MISSING", i.channel === "email" ? "Hastanın e-posta adresi yok." : "Hastanın telefonu yok.");
        const m = await c.query(
          `insert into messages(tenant_id, patient_id, purpose, channel, recipient_masked, body, provider, created_by)
           values ($1,$2,$3,$4,$5,$6,'mock',$7) returning id, status`,
          [ctx.tenantId, i.patientId, i.purpose, i.channel, i.channel === "email" ? maskEmail(to) : maskPhone(to), i.body, ctx.userId]);
        await c.query("insert into delivery_events(tenant_id, message_id, status, source, detail) values ($1,$2,'queued','system',$3)",
          [ctx.tenantId, m.rows[0].id, cn.provider === "mock" ? "Kuyruğa alındı (MOCK sağlayıcı)" : "Kuyruğa alındı"]);
        // Sağlayıcıya yalnız alıcı ve metin gider; anahtar mesaj kimliğidir (yeniden denemede sağlayıcı tarafında tekilleşir).
        const jobId = await createJob(c, ctx, { connectionId: cn.id, operation: "sms.send", sourceType: "message", sourceId: m.rows[0].id,
          key: `msg_${m.rows[0].id}`, payload: { channel: i.channel, body: i.body }, requiresApproval: false });
        await c.query("update messages set integration_job_id = $2 where id = $1", [m.rows[0].id, jobId]);
        await audit(c, ctx, { action: "message.queue", entityType: "message", entityId: m.rows[0].id, patientId: i.patientId,
          changes: { purpose: { from: null, to: i.purpose }, channel: { from: null, to: i.channel } } });
        return { id: m.rows[0].id as string, status: "queued", provider: "mock" };
      });
      if (r.replayed) res.setHeader("Idempotent-Replayed", "true");
      return r.body;
    });
  }

  // ------------------------------------------------------------ kontrol (follow-up)
  @Get("patients/:patientId/follow-ups")
  @Require("patient.read")
  followUps(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const r = await c.query(
        `select f.id, f.due_date, f.reason, f.status, f.cancel_reason, f.created_at, f.closed_at, pr.display_name as practitioner, u.full_name as by,
                a.starts_at as appointment_at, a.status as appointment_status
           from follow_ups f join users u on u.id = f.created_by left join practitioners pr on pr.id = f.practitioner_id left join appointments a on a.id = f.appointment_id
          where f.patient_id = $1 order by f.due_date desc`, [patientId]);
      return { items: r.rows.map((f) => ({ id: f.id, dueDate: f.due_date, reason: f.reason, status: f.status, cancelReason: f.cancel_reason, createdAt: f.created_at,
        closedAt: f.closed_at, practitioner: f.practitioner, by: f.by, appointmentAt: f.appointment_at, appointmentStatus: f.appointment_status })) };
    });
  }

  @Post("follow-ups")
  @Require("followup.write")
  createFollowUp(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(FollowUpCreate, body);
    if (i.dueDate <= localDate(new Date(), ctx.timezone)) throw Errors.validation({ dueDate: "Kontrol tarihi bugünden sonra olmalı." });
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [i.patientId])).rowCount) throw Errors.notFound("Hasta");
      const r = await c.query(
        "insert into follow_ups(tenant_id, patient_id, due_date, reason, practitioner_id, created_by) values ($1,$2,$3,$4,$5,$6) returning id",
        [ctx.tenantId, i.patientId, i.dueDate, i.reason, i.practitionerId ?? null, ctx.userId]);
      await audit(c, ctx, { action: "follow_up.create", entityType: "follow_up", entityId: r.rows[0].id, patientId: i.patientId, changes: { due_date: { from: null, to: i.dueDate } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "follow_up.create" });
      return { id: r.rows[0].id };
    });
  }

  @Post("follow-ups/:id/cancel")
  @HttpCode(200)
  @Require("followup.write")
  cancelFollowUp(@Ctx() ctx: RequestContext, @Param("id", id) fid: string, @Body() body: unknown) {
    const i = parse(FollowUpCancel, body);
    return this.db.tx(ctx, async (c) => {
      const f = (await c.query("select patient_id, status from follow_ups where id = $1", [fid])).rows[0];
      if (!f) throw Errors.notFound("Kontrol");
      if (!["open", "scheduled"].includes(f.status)) throw new AppError(409, "FOLLOW_UP_CLOSED", "Kontrol zaten kapanmış.");
      await c.query("update follow_ups set status = 'cancelled', cancel_reason = $2, appointment_id = null, closed_at = now() where id = $1", [fid, i.reason]);
      await audit(c, ctx, { action: "follow_up.cancel", entityType: "follow_up", entityId: fid, patientId: f.patient_id, changes: { reason: { from: null, to: i.reason } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "follow_up.cancel" });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ PİA Hazır
  @Get("appointments/:id/readiness")
  @Require("appointment.read")
  readiness(@Ctx() ctx: RequestContext, @Param("id", id) aid: string) {
    return this.db.tx(ctx, async (c) => {
      const items = await readinessFor(c, aid);
      if (!items) throw Errors.notFound("Randevu");
      return { items, ready: items.every((x) => x.status !== "missing"), note: "Hazırlık kontrolü idari bir hatırlatmadır; tıbbi uygunluk kararı hekimindir." };
    });
  }

  @Post("appointments/:id/readiness-exceptions")
  @Require("readiness.exception")
  exception(@Ctx() ctx: RequestContext, @Param("id", id) aid: string, @Body() body: unknown) {
    const i = parse(ReadinessExceptionCreate, body);
    return this.db.tx(ctx, async (c) => {
      const items = await readinessFor(c, aid);
      if (!items) throw Errors.notFound("Randevu");
      const it = items.find((x) => x.key === i.itemKey);
      if (!it || it.status !== "missing") throw new AppError(409, "NOT_MISSING", "Bu kalem eksik değil; istisna gerekmez.");
      await c.query("insert into readiness_exceptions(tenant_id, appointment_id, item_key, reason, created_by) values ($1,$2,$3,$4,$5)",
        [ctx.tenantId, aid, i.itemKey, i.reason, ctx.userId]);
      const pid = (await c.query("select patient_id from appointments where id = $1", [aid])).rows[0].patient_id;
      await audit(c, ctx, { action: "readiness.exception", entityType: "appointment", entityId: aid, patientId: pid, changes: { [i.itemKey]: { from: "missing", to: "excepted" }, reason: { from: null, to: i.reason } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "readiness.exception" });
      return { ok: true };
    });
  }

  @Get("readiness-rules")
  @Require("template.manage")
  rules(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select r.id, r.kind, r.max_age_days, r.active, p.code as procedure_code, p.name as procedure_name, dt.name as document_type
           from readiness_rules r left join procedures p on p.id = r.procedure_id left join document_types dt on dt.id = r.document_type_id order by r.created_at`);
      return { items: r.rows.map((x) => ({ id: x.id, kind: x.kind, maxAgeDays: x.max_age_days, active: x.active, procedure: x.procedure_code ? `${x.procedure_code} · ${x.procedure_name}` : null, documentType: x.document_type })) };
    });
  }

  @Post("readiness-rules")
  @Require("template.manage")
  createRule(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(ReadinessRuleCreate, body);
    return this.db.tx(ctx, async (c) => {
      if (i.kind === "document_for_procedure") {
        if (!(await c.query("select 1 from procedures where id = $1", [i.procedureId])).rowCount) throw Errors.validation({ procedureId: "İşlem bulunamadı." });
        const dt = (await c.query("select category from document_types where id = $1", [i.documentTypeId])).rows[0];
        if (!dt) throw Errors.validation({ documentTypeId: "Belge türü bulunamadı." });
        if (dt.category === "clinical_output") throw Errors.validation({ documentTypeId: CLINICAL_OUTPUT_RULE }); // QA-110, ADR-092
      }
      const r = await c.query(
        "insert into readiness_rules(tenant_id, kind, procedure_id, document_type_id, max_age_days, created_by) values ($1,$2,$3,$4,$5,$6) returning id",
        [ctx.tenantId, i.kind, i.kind === "document_for_procedure" ? i.procedureId : null, i.kind === "document_for_procedure" ? i.documentTypeId : null,
         i.kind === "anamnesis_reviewed" ? i.maxAgeDays : null, ctx.userId]);
      await audit(c, ctx, { action: "readiness_rule.create", entityType: "readiness_rule", entityId: r.rows[0].id, changes: { kind: { from: null, to: i.kind } } });
      return { id: r.rows[0].id };
    });
  }

  @Post("readiness-rules/:id/active")
  @HttpCode(200)
  @Require("template.manage")
  toggleRule(@Ctx() ctx: RequestContext, @Param("id", id) rid: string, @Body() body: { active?: unknown }) {
    if (typeof body?.active !== "boolean") throw Errors.validation({ active: "Etkin/pasif değeri gerekli." });
    return this.db.tx(ctx, async (c) => {
      if (body.active) {
        const k = (await c.query(
          "select dt.category from readiness_rules r left join document_types dt on dt.id = r.document_type_id where r.id = $1", [rid])).rows[0];
        if (k?.category === "clinical_output") throw Errors.validation({ active: CLINICAL_OUTPUT_RULE }); // QA-110: eski kural yeniden açılamaz
      }
      const r = await c.query("update readiness_rules set active = $2 where id = $1 returning id", [rid, body.active]);
      if (!r.rowCount) throw Errors.notFound("Kural");
      await audit(c, ctx, { action: "readiness_rule.update", entityType: "readiness_rule", entityId: rid, changes: { active: { from: !body.active, to: body.active } } });
      return { ok: true };
    });
  }
}
