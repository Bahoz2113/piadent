import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import {
  AppointmentTypeUpsert, CLOSURE_KIND_LABELS, ChairUpsert, ClosureCreate, PractitionerUpsert, WorkScheduleReplace, addDays, dayRangeUtc, zonedToUtc, type ClosureKind,
} from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
const toMin = (hhmm: string) => (hhmm === "24:00" ? 1440 : Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)));
const RangeQuery = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days: z.coerce.number().int().min(1).max(31).default(7) });
const LOCK = "select pg_advisory_xact_lock(hashtextextended('viadent:schedule:' || $1::text, 0))";

/** Hekim/koltuk/işlem türü/çalışma saati/kapatma yönetimi (T04, T05, T06, T14). */
@Controller()
export class ResourcesController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("admin/resources")
  @Require("schedule.manage")
  all(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const p = await c.query(
        `select p.id, p.display_name, p.title, p.active, p.membership_id, u.full_name as member_name
           from practitioners p left join memberships m on m.id = p.membership_id left join users u on u.id = m.user_id
          order by p.active desc, p.display_name`,
      );
      const s = await c.query("select practitioner_id, weekday, start_min, end_min from work_schedules order by weekday, start_min");
      const ch = await c.query("select id, name, active from chairs order by active desc, name");
      const ty = await c.query("select t.id, t.name, t.default_minutes, t.active, t.procedure_id, pc.code as procedure_code, pc.name as procedure_name from appointment_types t left join procedures pc on pc.id = t.procedure_id order by t.active desc, t.name");
      const dentists = await c.query(
        `select m.id, u.full_name from memberships m join users u on u.id = m.user_id
          where m.status = 'active' and m.role = 'dentist' order by u.full_name`,
      );
      return {
        practitioners: p.rows.map((r) => ({
          id: r.id, name: r.display_name, title: r.title, active: r.active, membershipId: r.membership_id, memberName: r.member_name,
          schedule: s.rows.filter((x) => x.practitioner_id === r.id).map((x) => ({ weekday: x.weekday, start: x.start_min, end: x.end_min })),
        })),
        chairs: ch.rows.map((r) => ({ id: r.id, name: r.name, active: r.active })),
        appointmentTypes: ty.rows.map((r) => ({ id: r.id, name: r.name, defaultMinutes: r.default_minutes, active: r.active, procedureId: r.procedure_id ?? null, procedureLabel: r.procedure_code ? `${r.procedure_code} · ${r.procedure_name}` : null })),
        dentistMemberships: dentists.rows.map((r) => ({ id: r.id, name: r.full_name })),
      };
    });
  }

  /** Ajandada gösterilecek çalışma blokları ve kapatmalar (okuma; tüm randevu okuyucuları). */
  @Get("agenda-context")
  @Require("appointment.read")
  context(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    const q = parse(RangeQuery, query);
    const from = dayRangeUtc(q.from, ctx.timezone).from;
    const to = dayRangeUtc(addDays(q.from, q.days - 1), ctx.timezone).to;
    return this.db.tx(ctx, async (c) => {
      const s = await c.query("select practitioner_id, weekday, start_min, end_min from work_schedules order by weekday, start_min");
      const cl = await c.query(
        `select id, scope, practitioner_id, chair_id, starts_at, ends_at, reason from closures
          where cancelled_at is null and tstzrange(starts_at, ends_at, '[)') && tstzrange($1, $2, '[)') order by starts_at`,
        [from, to],
      );
      return {
        schedules: s.rows.map((x) => ({ practitionerId: x.practitioner_id, weekday: x.weekday, start: x.start_min, end: x.end_min })),
        closures: cl.rows.map((x) => ({ id: x.id, scope: x.scope, practitionerId: x.practitioner_id, chairId: x.chair_id, startsAt: x.starts_at, endsAt: x.ends_at, reason: x.reason })),
      };
    });
  }

  // ------------------------------------------------------------ hekim
  @Post("practitioners")
  @Require("schedule.manage")
  createPractitioner(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const input = parse(PractitionerUpsert, body);
    return this.db.tx(ctx, async (c) => {
      if (input.membershipId) await this.assertDentist(c, input.membershipId);
      const branch = await c.query("select id from branches order by created_at limit 1");
      const r = await c.query(
        "insert into practitioners(tenant_id, branch_id, membership_id, display_name, title) values ($1,$2,$3,$4,$5) returning id",
        [ctx.tenantId, branch.rows[0].id, input.membershipId ?? null, input.displayName, input.title ?? null],
      );
      await audit(c, ctx, { action: "practitioner.create", entityType: "practitioner", entityId: r.rows[0].id, changes: { display_name: { from: null, to: input.displayName } } });
      return { id: r.rows[0].id };
    });
  }

  @Patch("practitioners/:id")
  @Require("schedule.manage")
  updatePractitioner(@Ctx() ctx: RequestContext, @Param("id", id) pid: string, @Body() body: unknown) {
    const input = parse(PractitionerUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const cur = await c.query("select display_name, title, active, membership_id from practitioners where id = $1 for update", [pid]);
      if (!cur.rowCount) throw Errors.notFound("Hekim");
      if (input.membershipId) await this.assertDentist(c, input.membershipId);
      const b = cur.rows[0];
      const next = { display_name: input.displayName, title: input.title ?? null, active: input.active ?? b.active, membership_id: input.membershipId ?? b.membership_id };
      await c.query("update practitioners set display_name=$2, title=$3, active=$4, membership_id=$5 where id = $1", [pid, next.display_name, next.title, next.active, next.membership_id]);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of Object.keys(next) as (keyof typeof next)[]) if (b[k] !== next[k]) changes[k] = { from: b[k], to: next[k] };
      await audit(c, ctx, { action: "practitioner.update", entityType: "practitioner", entityId: pid, changes });
      return { ok: true };
    });
  }

  @Put("practitioners/:id/schedule")
  @Require("schedule.manage")
  replaceSchedule(@Ctx() ctx: RequestContext, @Param("id", id) pid: string, @Body() body: unknown) {
    const input = parse(WorkScheduleReplace, body);
    return this.db.tx(ctx, async (c) => {
      await c.query(LOCK, [ctx.tenantId]);
      const p = await c.query("select 1 from practitioners where id = $1", [pid]);
      if (!p.rowCount) throw Errors.notFound("Hekim");
      const before = await c.query("select weekday, start_min, end_min from work_schedules where practitioner_id = $1 order by weekday, start_min", [pid]);
      await c.query("delete from work_schedules where practitioner_id = $1", [pid]);
      for (const bl of input.blocks) {
        await c.query("insert into work_schedules(tenant_id, practitioner_id, weekday, start_min, end_min) values ($1,$2,$3,$4,$5)",
          [ctx.tenantId, pid, bl.weekday, toMin(bl.start), toMin(bl.end)]);
      }
      await audit(c, ctx, { action: "schedule.replace", entityType: "practitioner", entityId: pid,
        changes: { blocks: { from: before.rows.length, to: input.blocks.length } } });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ koltuk
  @Post("chairs")
  @Require("schedule.manage")
  createChair(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const input = parse(ChairUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const branch = await c.query("select id from branches order by created_at limit 1");
      const r = await c.query("insert into chairs(tenant_id, branch_id, name) values ($1,$2,$3) returning id", [ctx.tenantId, branch.rows[0].id, input.name]);
      await audit(c, ctx, { action: "chair.create", entityType: "chair", entityId: r.rows[0].id, changes: { name: { from: null, to: input.name } } });
      return { id: r.rows[0].id };
    });
  }

  @Patch("chairs/:id")
  @Require("schedule.manage")
  updateChair(@Ctx() ctx: RequestContext, @Param("id", id) cid: string, @Body() body: unknown) {
    const input = parse(ChairUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const cur = await c.query("select name, active from chairs where id = $1 for update", [cid]);
      if (!cur.rowCount) throw Errors.notFound("Ünite");
      const active = input.active ?? cur.rows[0].active;
      await c.query("update chairs set name = $2, active = $3 where id = $1", [cid, input.name, active]);
      await audit(c, ctx, { action: "chair.update", entityType: "chair", entityId: cid,
        changes: { name: { from: cur.rows[0].name, to: input.name }, active: { from: cur.rows[0].active, to: active } } });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ işlem türü
  @Post("appointment-types")
  @Require("schedule.manage")
  createType(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const input = parse(AppointmentTypeUpsert, body);
    return this.db.tx(ctx, async (c) => {
      if (input.procedureId && !(await c.query("select 1 from procedures where id = $1 and active", [input.procedureId])).rowCount) throw Errors.validation({ procedureId: "İşlem bulunamadı veya pasif." });
      const r = await c.query("insert into appointment_types(tenant_id, name, default_minutes, procedure_id) values ($1,$2,$3,$4) returning id", [ctx.tenantId, input.name, input.defaultMinutes, input.procedureId ?? null]);
      await audit(c, ctx, { action: "appointment_type.create", entityType: "appointment_type", entityId: r.rows[0].id,
        changes: { name: { from: null, to: input.name }, default_minutes: { from: null, to: input.defaultMinutes }, ...(input.procedureId ? { procedure_id: { from: null, to: input.procedureId } } : {}) } });
      return { id: r.rows[0].id };
    });
  }

  @Patch("appointment-types/:id")
  @Require("schedule.manage")
  updateType(@Ctx() ctx: RequestContext, @Param("id", id) tid: string, @Body() body: unknown) {
    const input = parse(AppointmentTypeUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const cur = await c.query("select name, default_minutes, active, procedure_id from appointment_types where id = $1 for update", [tid]);
      if (!cur.rowCount) throw Errors.notFound("İşlem türü");
      const active = input.active ?? cur.rows[0].active;
      const procedureId = input.procedureId === undefined ? cur.rows[0].procedure_id : input.procedureId;
      if (procedureId && procedureId !== cur.rows[0].procedure_id && !(await c.query("select 1 from procedures where id = $1 and active", [procedureId])).rowCount) throw Errors.validation({ procedureId: "İşlem bulunamadı veya pasif." });
      await c.query("update appointment_types set name=$2, default_minutes=$3, active=$4, procedure_id=$5 where id = $1", [tid, input.name, input.defaultMinutes, active, procedureId ?? null]);
      await audit(c, ctx, { action: "appointment_type.update", entityType: "appointment_type", entityId: tid,
        changes: { name: { from: cur.rows[0].name, to: input.name }, default_minutes: { from: cur.rows[0].default_minutes, to: input.defaultMinutes }, active: { from: cur.rows[0].active, to: active }, ...(procedureId !== cur.rows[0].procedure_id ? { procedure_id: { from: cur.rows[0].procedure_id, to: procedureId ?? null } } : {}) } });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ kapatma
  @Get("closures")
  @Require("appointment.read")
  listClosures(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select cl.id, cl.kind, cl.scope, cl.practitioner_id, cl.chair_id, cl.starts_at, cl.ends_at, cl.reason, p.display_name, ch.name as chair_name, u.full_name as creator
           from closures cl left join practitioners p on p.id = cl.practitioner_id left join chairs ch on ch.id = cl.chair_id join users u on u.id = cl.created_by
          where cl.cancelled_at is null and cl.ends_at > now() - interval '1 day' order by cl.starts_at`,
      );
      return { items: r.rows.map((x) => ({ id: x.id, kind: x.kind, kindLabel: CLOSURE_KIND_LABELS[x.kind as ClosureKind], scope: x.scope, practitionerId: x.practitioner_id, chairId: x.chair_id,
        targetName: x.scope === "clinic" ? "Tüm klinik" : x.display_name ?? x.chair_name, startsAt: x.starts_at, endsAt: x.ends_at, reason: x.reason, createdBy: x.creator })) };
    });
  }

  /** Kapatma, mevcut randevuları silmez/taşımaz; çakışanlar döner ve PİA Akış'a takip görevi düşer. */
  @Post("closures")
  @Require("schedule.manage")
  createClosure(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const input = parse(ClosureCreate, body);
    const startsAt = zonedToUtc(input.startDate, input.startTime === "24:00" ? "00:00" : input.startTime, ctx.timezone);
    const endsAt = input.endTime === "24:00"
      ? zonedToUtc(addDays(input.endDate, 1), "00:00", ctx.timezone)
      : zonedToUtc(input.endDate, input.endTime, ctx.timezone);
    if (endsAt <= startsAt) throw Errors.validation({ endTime: "Bitiş başlangıçtan sonra olmalı." });
    if (endsAt.getTime() - startsAt.getTime() > 366 * 86400_000) throw Errors.validation({ endDate: "En fazla 1 yıllık kapatma girilebilir." });
    return this.db.tx(ctx, async (c) => {
      await c.query(LOCK, [ctx.tenantId]);
      if (input.practitionerId && !(await c.query("select 1 from practitioners where id = $1", [input.practitionerId])).rowCount) throw Errors.validation({ practitionerId: "Hekim bulunamadı." });
      if (input.chairId && !(await c.query("select 1 from chairs where id = $1", [input.chairId])).rowCount) throw Errors.validation({ chairId: "Ünite bulunamadı." });
      const r = await c.query(
        `insert into closures(tenant_id, scope, practitioner_id, chair_id, starts_at, ends_at, reason, created_by, kind)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [ctx.tenantId, input.scope, input.scope === "practitioner" ? input.practitionerId : null, input.scope === "chair" ? input.chairId : null,
         startsAt, endsAt, input.reason, ctx.userId, input.kind],
      );
      const affected = await c.query(
        `select a.id, a.starts_at, p.first_name || ' ' || p.last_name as patient_name
           from appointments a join patients p on p.id = a.patient_id
          where a.status in ('planned','confirmed') and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange($1, $2, '[)')
            and ($3 = 'clinic' or a.practitioner_id = $4 or a.chair_id = $5)
          order by a.starts_at`,
        [startsAt, endsAt, input.scope, input.practitionerId ?? null, input.chairId ?? null],
      );
      await audit(c, ctx, { action: "closure.create", entityType: "closure", entityId: r.rows[0].id,
        changes: { kind: { from: null, to: CLOSURE_KIND_LABELS[input.kind] }, scope: { from: null, to: input.scope }, reason: { from: null, to: input.reason }, affected: { from: null, to: affected.rowCount } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "closure.create" });
      return { id: r.rows[0].id, affected: affected.rows.map((a) => ({ id: a.id, startsAt: a.starts_at, patientName: a.patient_name })) };
    });
  }

  @Post("closures/:id/cancel")
  @HttpCode(200)
  @Require("schedule.manage")
  cancelClosure(@Ctx() ctx: RequestContext, @Param("id", id) cid: string) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query("update closures set cancelled_at = now(), cancelled_by = $2 where id = $1 and cancelled_at is null returning id", [cid, ctx.userId]);
      if (!r.rowCount) throw Errors.notFound("Kapatma");
      await audit(c, ctx, { action: "closure.cancel", entityType: "closure", entityId: cid });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "closure.cancel" });
      return { ok: true };
    });
  }

  private async assertDentist(c: import("pg").PoolClient, membershipId: string) {
    const m = await c.query("select 1 from memberships where id = $1 and status = 'active' and role = 'dentist'", [membershipId]);
    if (!m.rowCount) throw new AppError(422, "VALIDATION_FAILED", "Bağlanacak kullanıcı bu klinikte etkin hekim olmalı.", { membershipId: "Etkin hekim üyeliği seçin." });
  }
}
