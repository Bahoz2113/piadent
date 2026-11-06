import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  COMM_PURPOSE_LABELS, MESSAGE_RULE_KINDS, MESSAGE_RULE_LABELS, MESSAGE_SOURCE_LABELS, MESSAGE_STATUS_LABELS, MessageRuleUpsert, MessagingSchedule, MessagingSend,
  maskPhone, normalizeSearch, type CommPurpose, type MessageRuleKind,
} from "@viadent/contracts";
import { netgsmStatus, pickSmsConnection, queueSms } from "@viadent/db";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import { has, type RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";
import { idempotent, requireKey } from "../finance/ledger.js";

const sid = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound("Zamanlanmış mesaj") });
const DEFAULT_RULES: Record<MessageRuleKind, { hours: number; body: string }> = {
  before_appointment: { hours: 24, body: "Sayın {hasta}, {tarih} {saat} tarihinde {hekim} ile randevunuz vardır. {klinik}" },
  after_appointment: { hours: 2, body: "Sayın {hasta}, bugünkü tedaviniz için teşekkür ederiz. Sorunuz olursa bizi arayabilirsiniz. {klinik}" },
};

/**
 * Mesajlar sekmesi (07.11.2026, ADR-102): tüm hastalar, toplu bilgi mesajı, zamanlanmış mesaj, otomatik randevu mesajları, gönderim geçmişi.
 * Gerçek gönderim yalnız Netgsm hazırsa (ortamdaki kimlik bilgileri + canlı gönderim kapısı); değilse DENEME sağlayıcı ve ekranda açık uyarı.
 */
@Controller("messaging")
export class MessagingController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("status")
  @Require("message.send")
  status(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const net = netgsmStatus();
      const conns = (await c.query("select provider, status from integration_connections where kind = 'sms'")).rows;
      const cn = await pickSmsConnection(c);
      const netConn = conns.find((x) => x.provider === "netgsm");
      return {
        provider: cn?.provider ?? null, realSending: cn?.provider === "netgsm",
        netgsm: { connection: netConn ? netConn.status : null, configured: net.configured, gateOpen: net.gateOpen, sender: net.sender, missing: net.missing },
        label: cn?.provider === "netgsm" ? `Netgsm bağlı — gerçek SMS gönderilir (gönderen: ${net.sender})`
          : cn ? "DENEME — gerçek mesaj gönderilmez" : "SMS sağlayıcı bağlantısı yok — mesaj gönderilemez",
      };
    });
  }

  /** Tüm etkin hastalar: maskeli telefon, SMS izinleri, son mesaj. */
  @Get("patients")
  @Require("message.send")
  patients(@Ctx() ctx: RequestContext, @Query("q") q?: string) {
    const term = q?.trim() ? normalizeSearch(q.trim()) : null;
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select p.id, p.file_no, p.first_name || ' ' || p.last_name as full_name, p.phone_e164,
                (select cp.status from communication_preferences cp where cp.patient_id = p.id and cp.purpose = 'appointment_reminder' and cp.channel = 'sms' order by cp.recorded_at desc limit 1) as reminder,
                (select cp.status from communication_preferences cp where cp.patient_id = p.id and cp.purpose = 'treatment_followup' and cp.channel = 'sms' order by cp.recorded_at desc limit 1) as followup,
                (select cp.status from communication_preferences cp where cp.patient_id = p.id and cp.purpose = 'payment_reminder' and cp.channel = 'sms' order by cp.recorded_at desc limit 1) as payment,
                (select json_build_object('at', m.created_at, 'status', m.status) from messages m where m.patient_id = p.id order by m.created_at desc limit 1) as last,
                (select min(a.starts_at) from appointments a where a.patient_id = p.id and a.starts_at > now() and a.status in ('planned','confirmed')) as next_at
           from patients p where p.status = 'active' and ($1::text is null or p.search_text like '%' || $1 || '%' or p.file_no::text = $1)
          order by p.last_name, p.first_name limit 500`, [term]);
      return { items: r.rows.map((x) => ({ id: x.id, fileNo: x.file_no, fullName: x.full_name, phone: maskPhone(x.phone_e164), hasPhone: !!x.phone_e164,
        consent: { appointment_reminder: x.reminder === "granted", treatment_followup: x.followup === "granted", payment_reminder: x.payment === "granted" },
        lastMessage: x.last, nextAppointmentAt: x.next_at })) };
    });
  }

  /** Toplu/tekil bilgi mesajı: izni olmayan veya telefonu olmayan hasta atlanır ve nedeni döner (sessiz başarı yok). */
  @Post("send")
  @Require("message.send")
  send(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(MessagingSend, body);
    const k = requireKey(key);
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "messaging.send", k, i, async () => {
        const results: { patientId: string; ok: boolean; reason?: string }[] = [];
        for (const pid of [...new Set(i.patientIds)]) {
          if (!(await c.query("select 1 from patients where id = $1", [pid])).rowCount) { results.push({ patientId: pid, ok: false, reason: "Hasta bulunamadı" }); continue; }
          const q = await queueSms(c, ctx.tenantId, { patientId: pid, purpose: i.purpose, body: i.body, createdBy: ctx.userId, source: "manual" });
          if (q.ok) {
            await audit(c, ctx, { action: "message.queue", entityType: "message", entityId: q.messageId, patientId: pid,
              changes: { purpose: { from: null, to: i.purpose }, channel: { from: null, to: "sms" } } });
            results.push({ patientId: pid, ok: true });
          } else results.push({ patientId: pid, ok: false, reason: q.message });
        }
        await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "messaging.send" });
        return { queued: results.filter((x) => x.ok).length, skipped: results.filter((x) => !x.ok).length, results };
      });
      if (r.replayed) res.setHeader("Idempotent-Replayed", "true");
      return r.body;
    });
  }

  @Get("schedules")
  @Require("message.send")
  schedules(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select s.id, s.patient_id, p.first_name || ' ' || p.last_name as patient, s.purpose, s.body, s.send_at, s.status, s.status_reason, u.full_name as by, m.status as message_status
           from message_schedules s join patients p on p.id = s.patient_id join users u on u.id = s.created_by left join messages m on m.id = s.message_id
          where s.status = 'scheduled' or s.send_at > now() - interval '30 days' order by s.send_at desc limit 300`);
      return { items: r.rows.map((x) => ({ id: x.id, patientId: x.patient_id, patient: x.patient, purpose: x.purpose, purposeLabel: COMM_PURPOSE_LABELS[x.purpose as CommPurpose], body: x.body,
        sendAt: x.send_at, status: x.status, statusReason: x.status_reason, by: x.by, messageStatus: x.message_status ? MESSAGE_STATUS_LABELS[x.message_status] ?? x.message_status : null })) };
    });
  }

  /** "Alarm": ileri tarihli tek seferlik mesaj; gönderim anında izin yeniden kontrol edilir. */
  @Post("schedules")
  @Require("message.send")
  schedule(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(MessagingSchedule, body);
    const k = requireKey(key);
    const at = new Date(i.sendAt);
    if (at.getTime() < Date.now() + 60_000) throw Errors.validation({ sendAt: "Gönderim zamanı en az 1 dakika sonrası olmalı." });
    if (at.getTime() > Date.now() + 366 * 86_400_000) throw Errors.validation({ sendAt: "En çok 1 yıl sonrasına kurulabilir." });
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "messaging.schedule", k, i, async () => {
        const ids: string[] = [];
        for (const pid of [...new Set(i.patientIds)]) {
          if (!(await c.query("select 1 from patients where id = $1 and status = 'active'", [pid])).rowCount) throw Errors.validation({ patientIds: "Hasta bulunamadı." });
          const s = await c.query(
            `insert into message_schedules(tenant_id, patient_id, purpose, body, send_at, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
            [ctx.tenantId, pid, i.purpose, i.body, at, ctx.userId]);
          ids.push(s.rows[0].id);
          await audit(c, ctx, { action: "message.schedule", entityType: "message_schedule", entityId: s.rows[0].id, patientId: pid,
            changes: { purpose: { from: null, to: i.purpose }, send_at: { from: null, to: at.toISOString() } } });
        }
        return { created: ids.length, ids };
      });
      if (r.replayed) res.setHeader("Idempotent-Replayed", "true");
      return r.body;
    });
  }

  @Post("schedules/:id/cancel")
  @HttpCode(200)
  @Require("message.send")
  cancel(@Ctx() ctx: RequestContext, @Param("id", sid) id: string) {
    return this.db.tx(ctx, async (c) => {
      const s = (await c.query("select status, patient_id from message_schedules where id = $1 for update", [id])).rows[0];
      if (!s) throw Errors.notFound("Zamanlanmış mesaj");
      if (s.status !== "scheduled") throw new AppError(409, "NOT_SCHEDULED", "Bu mesaj artık zamanlanmış durumda değil (gönderildi, atlandı veya iptal).");
      await c.query("update message_schedules set status = 'cancelled', cancelled_by = $2, cancelled_at = now() where id = $1", [id, ctx.userId]);
      await audit(c, ctx, { action: "message.schedule_cancel", entityType: "message_schedule", entityId: id, patientId: s.patient_id, changes: { status: { from: "scheduled", to: "cancelled" } } });
      return { ok: true };
    });
  }

  @Get("rules")
  @Require("message.send")
  rules(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = (await c.query("select kind, hours, body, active, updated_at from message_rules")).rows;
      return { canEdit: has(ctx, "settings.manage"), items: MESSAGE_RULE_KINDS.map((k) => {
        const x = r.find((y) => y.kind === k);
        return { kind: k, label: MESSAGE_RULE_LABELS[k], hours: x?.hours ?? DEFAULT_RULES[k].hours, body: x?.body ?? DEFAULT_RULES[k].body, active: x?.active ?? false, saved: !!x, updatedAt: x?.updated_at ?? null };
      }), placeholders: ["{hasta}", "{tarih}", "{saat}", "{hekim}", "{klinik}"] };
    });
  }

  @Put("rules/:kind")
  @Require("settings.manage")
  saveRule(@Ctx() ctx: RequestContext, @Param("kind") kind: string, @Body() body: unknown) {
    if (!(MESSAGE_RULE_KINDS as readonly string[]).includes(kind)) throw Errors.notFound("Kural");
    const i = parse(MessageRuleUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const before = (await c.query("select hours, active from message_rules where kind = $1", [kind])).rows[0];
      await c.query(
        `insert into message_rules(tenant_id, kind, hours, body, active, created_by) values ($1,$2,$3,$4,$5,$6)
         on conflict (tenant_id, kind) do update set hours = excluded.hours, body = excluded.body, active = excluded.active, updated_at = now()`,
        [ctx.tenantId, kind, i.hours, i.body, i.active, ctx.userId]);
      await audit(c, ctx, { action: "message.rule_update", entityType: "message_rule",
        changes: { kind: { from: null, to: MESSAGE_RULE_LABELS[kind as MessageRuleKind] }, hours: { from: before?.hours ?? null, to: i.hours }, active: { from: before?.active ?? null, to: i.active } } });
      return { ok: true };
    });
  }

  /** Gönderim geçmişi (eski "SMS / mesaj sorgulama" kartının yerine). */
  @Get("messages")
  @Require("message.send")
  messages(@Ctx() ctx: RequestContext, @Query("days") days?: string) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 366);
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select m.id, m.patient_id, p.first_name || ' ' || p.last_name as patient, m.purpose, m.recipient_masked, m.body, m.provider, m.status, m.status_reason, m.source, m.created_at, u.full_name as by
           from messages m join patients p on p.id = m.patient_id join users u on u.id = m.created_by
          where m.created_at > now() - make_interval(days => $1) order by m.created_at desc limit 500`, [d]);
      return { items: r.rows.map((x) => ({ id: x.id, patientId: x.patient_id, patient: x.patient, purpose: COMM_PURPOSE_LABELS[x.purpose as CommPurpose] ?? x.purpose,
        recipient: x.recipient_masked, body: x.body, provider: x.provider === "netgsm" ? "Netgsm" : "Deneme (gerçek gönderim yok)", status: x.status,
        statusLabel: MESSAGE_STATUS_LABELS[x.status] ?? x.status, statusReason: x.status_reason, source: MESSAGE_SOURCE_LABELS[x.source] ?? x.source, createdAt: x.created_at, by: x.by })) };
    });
  }
}
