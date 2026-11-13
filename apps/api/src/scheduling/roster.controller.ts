/**
 * ADR-110 (ürün sahibi 12.11.2026): Hekimler → aylık çalışma listesi.
 * Okuma: randevu okuyabilen herkes (kim hangi gün çalışıyor). Yazma: schedule.manage (yönetici).
 * Kayıt, o gün için haftalık çalışma şablonunun yerine geçer (uygun saatler + çalışma saati dışı uyarısı).
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Query } from "@nestjs/common";
import type pg from "pg";
import { CLOSURE_KIND_LABELS, ROSTER_MONTH, WorkRosterClear, WorkRosterSave, addDays, dayRangeUtc, fromMin, localDate, toMin, type ClosureKind } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";

type C = pg.PoolClient;
const monthDays = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
};
const isoDow = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };

@Controller()
export class RosterController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("work-roster")
  @Require("appointment.read")
  month(@Ctx() ctx: RequestContext, @Query("month") month?: string) {
    const today = localDate(new Date(), ctx.timezone);
    const m = month ?? today.slice(0, 7);
    if (!ROSTER_MONTH.test(m)) throw Errors.validation({ month: "Ay YYYY-AA biçiminde olmalı." });
    const days = monthDays(m);
    const from = dayRangeUtc(days[0]!, ctx.timezone).from, to = dayRangeUtc(days.at(-1)!, ctx.timezone).to;
    return this.db.tx(ctx, async (c) => {
      const pr = (await c.query(
        `select p.id, p.display_name as name, p.title, p.active from practitioners p
          where p.active or exists (select 1 from work_rosters r where r.practitioner_id = p.id and r.work_date between $1 and $2)
          order by p.active desc, p.display_name`, [days[0], days.at(-1)])).rows;
      const weekly = (await c.query("select practitioner_id, weekday, start_min, end_min from work_schedules order by weekday, start_min")).rows;
      const entries = (await c.query(
        `select r.practitioner_id, r.work_date::text as d, r.kind, r.start_min, r.end_min, r.chair_id, ch.name as chair_name, r.note, r.updated_at, u.full_name as updated_by
           from work_rosters r left join chairs ch on ch.id = r.chair_id join users u on u.id = r.updated_by
          where r.work_date between $1 and $2`, [days[0], days.at(-1)])).rows;
      const closures = (await c.query(
        `select scope, practitioner_id, kind, reason, starts_at, ends_at from closures
          where cancelled_at is null and scope in ('clinic','practitioner') and starts_at < $2 and ends_at > $1`, [from, to])).rows;
      const appts = (await c.query(
        `select practitioner_id, (starts_at at time zone $3)::date::text as d, count(*)::int as n from appointments
          where starts_at >= $1 and starts_at < $2 and status not in ('cancelled','no_show') group by 1, 2`, [from, to, ctx.timezone])).rows;
      const chairs = (await c.query("select id, name from chairs where active order by name")).rows;
      const marks: { practitionerId: string | null; date: string; kind: ClosureKind; label: string; reason: string }[] = [];
      for (const cl of closures) {
        for (const d of days) {
          const r = dayRangeUtc(d, ctx.timezone);
          if (new Date(cl.starts_at) < r.to && new Date(cl.ends_at) > r.from) {
            marks.push({ practitionerId: cl.scope === "clinic" ? null : cl.practitioner_id, date: d, kind: cl.kind, label: CLOSURE_KIND_LABELS[cl.kind as ClosureKind], reason: cl.reason });
          }
        }
      }
      const practitioners = pr.map((p) => {
        const wk = weekly.filter((w) => w.practitioner_id === p.id).map((w) => ({ weekday: w.weekday as number, start: fromMin(w.start_min), end: fromMin(w.end_min) }));
        let minutes = 0, workDays = 0;
        for (const d of days) {
          const e = entries.find((x) => x.practitioner_id === p.id && x.d === d);
          const closed = marks.some((x) => x.date === d && (x.practitionerId === null || x.practitionerId === p.id));
          if (closed) continue;
          const mins = e ? (e.kind === "work" ? e.end_min - e.start_min : 0)
            : weekly.filter((w) => w.practitioner_id === p.id && w.weekday === isoDow(d)).reduce((s, w) => s + (w.end_min - w.start_min), 0);
          if (mins > 0) { minutes += mins; workDays++; }
        }
        return { id: p.id as string, name: p.name as string, title: p.title as string | null, active: p.active as boolean, weekly: wk, plannedMinutes: minutes, plannedDays: workDays };
      });
      return {
        month: m, today, days: days.map((d) => ({ date: d, weekday: isoDow(d) })), practitioners, chairs,
        entries: entries.map((e) => ({ practitionerId: e.practitioner_id as string, date: e.d as string, kind: e.kind as "work" | "off",
          start: e.start_min == null ? null : fromMin(e.start_min), end: e.end_min == null ? null : fromMin(e.end_min),
          chairId: (e.chair_id ?? null) as string | null, chairName: (e.chair_name ?? null) as string | null, note: (e.note ?? null) as string | null,
          updatedAt: e.updated_at, updatedBy: e.updated_by as string })),
        marks,
        appointments: appts.map((a) => ({ practitionerId: a.practitioner_id as string, date: a.d as string, count: a.n as number })),
      };
    });
  }

  @Post("work-roster")
  @HttpCode(200)
  @Require("schedule.manage")
  save(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(WorkRosterSave, body);
    const today = localDate(new Date(), ctx.timezone);
    const keys = new Set<string>();
    for (const [n, cell] of i.cells.entries()) {
      if (cell.date < addDays(today, -62) || cell.date > addDays(today, 400)) throw Errors.validation({ [`cells.${n}.date`]: "Tarih bugünden en çok 62 gün önce, 400 gün sonra olabilir." });
      const k = `${cell.practitionerId}|${cell.date}`;
      if (keys.has(k)) throw Errors.validation({ cells: "Aynı hekim ve gün iki kez gönderildi." });
      keys.add(k);
    }
    return this.db.tx(ctx, async (c) => {
      const pids = [...new Set(i.cells.map((x) => x.practitionerId))];
      const pr = await c.query("select id, active from practitioners where id = any($1::uuid[])", [pids]);
      if (pr.rowCount !== pids.length) throw Errors.validation({ practitionerId: "Hekim bulunamadı." });
      if (pr.rows.some((p) => !p.active)) throw Errors.validation({ practitionerId: "Pasif hekime çalışma planı yazılamaz." });
      const chairIds = [...new Set(i.cells.map((x) => x.chairId).filter(Boolean))] as string[];
      if (chairIds.length) {
        const ch = await c.query("select id from chairs where id = any($1::uuid[]) and active", [chairIds]);
        if (ch.rowCount !== chairIds.length) throw Errors.validation({ chairId: "Ünite bulunamadı veya pasif." });
      }
      // Planın dışında kalacak randevular: bilinerek onaylanmadıkça kaydetme (randevular silinmez, yalnız uyarılır).
      const outside: { practitionerId: string; date: string; count: number }[] = [];
      for (const cell of i.cells) {
        const { from, to } = dayRangeUtc(cell.date, ctx.timezone);
        const r = await c.query(
          `select ((extract(hour from starts_at at time zone $4) * 60 + extract(minute from starts_at at time zone $4))::int) as s,
                  (extract(epoch from ends_at - starts_at) / 60)::int as len
             from appointments where practitioner_id = $1 and starts_at >= $2 and starts_at < $3 and status not in ('cancelled','no_show')`,
          [cell.practitionerId, from, to, ctx.timezone]);
        const s0 = cell.kind === "work" ? toMin(cell.start!) : 0, e0 = cell.kind === "work" ? toMin(cell.end!) : 0;
        const n = r.rows.filter((a) => cell.kind === "off" || a.s < s0 || a.s + a.len > e0).length;
        if (n) outside.push({ practitionerId: cell.practitionerId, date: cell.date, count: n });
      }
      if (outside.length && !i.acknowledgeAppointments) {
        const total = outside.reduce((s, x) => s + x.count, 0);
        throw new AppError(409, "ROSTER_APPOINTMENTS_OUTSIDE",
          `${total} randevu yeni planın dışında kalıyor (${outside.map((x) => x.date.split("-").reverse().join(".")).join(", ")}). Randevular silinmez; yine de kaydetmek için onaylayın.`,
          undefined, { outside });
      }
      let saved = 0;
      for (const cell of i.cells) {
        const before = (await c.query("select id, kind, start_min, end_min, chair_id, note from work_rosters where practitioner_id = $1 and work_date = $2", [cell.practitionerId, cell.date])).rows[0];
        const sm = cell.kind === "work" ? toMin(cell.start!) : null, em = cell.kind === "work" ? toMin(cell.end!) : null;
        const r = await c.query(
          `insert into work_rosters(tenant_id, practitioner_id, work_date, kind, start_min, end_min, chair_id, note, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           on conflict (tenant_id, practitioner_id, work_date) do update set kind = excluded.kind, start_min = excluded.start_min, end_min = excluded.end_min,
             chair_id = excluded.chair_id, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()
           returning id`,
          [ctx.tenantId, cell.practitionerId, cell.date, cell.kind, sm, em, cell.chairId ?? null, cell.note ?? null, ctx.userId]);
        const fmt = (k: string | null, s: number | null, e: number | null) => (k === "work" ? `${fromMin(s!)}–${fromMin(e!)}` : k === "off" ? "Çalışmıyor" : "Haftalık şablon");
        const changed = !before || before.kind !== cell.kind || before.start_min !== sm || before.end_min !== em || (before.chair_id ?? null) !== (cell.chairId ?? null) || (before.note ?? null) !== (cell.note ?? null);
        if (!changed) continue;
        saved++;
        const ack = outside.find((x) => x.practitionerId === cell.practitionerId && x.date === cell.date);
        await audit(c, ctx, { action: "work_roster.save", entityType: "work_roster", entityId: r.rows[0].id,
          changes: { practitioner_id: { from: null, to: cell.practitionerId }, work_date: { from: null, to: cell.date },
            kind: { from: before ? fmt(before.kind, before.start_min, before.end_min) : "Haftalık şablon", to: fmt(cell.kind, sm, em) },
            ...((before?.chair_id ?? null) !== (cell.chairId ?? null) ? { chair_id: { from: before?.chair_id ?? null, to: cell.chairId ?? null } } : {}),
            ...(ack ? { outside_appointments: { from: null, to: ack.count } } : {}) } });
      }
      return { saved, unchanged: i.cells.length - saved, outside };
    });
  }

  @Post("work-roster/clear")
  @HttpCode(200)
  @Require("schedule.manage")
  clear(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(WorkRosterClear, body);
    return this.db.tx(ctx, async (c) => {
      let cleared = 0;
      for (const cell of i.cells) {
        const r = await c.query("delete from work_rosters where practitioner_id = $1 and work_date = $2 returning id, kind, start_min, end_min", [cell.practitionerId, cell.date]);
        if (!r.rowCount) continue;
        cleared++;
        const b = r.rows[0];
        await audit(c, ctx, { action: "work_roster.clear", entityType: "work_roster", entityId: b.id,
          changes: { practitioner_id: { from: cell.practitionerId, to: cell.practitionerId }, work_date: { from: cell.date, to: cell.date },
            kind: { from: b.kind === "work" ? `${fromMin(b.start_min)}–${fromMin(b.end_min)}` : "Çalışmıyor", to: "Haftalık şablon" } } });
      }
      return { cleared };
    });
  }
}
