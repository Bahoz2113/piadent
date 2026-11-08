import { Inject, Injectable } from "@nestjs/common";
import {
  addDays, APPOINTMENT_PAST_GRACE_MINUTES, APPOINTMENT_TRANSITIONS, dayRangeUtc, localDate, zonedToUtc,
  type AppointmentCreate, type AppointmentStatus,
} from "@viadent/contracts";
import { Db } from "../infra/db.service.js";
import { AppError, Errors } from "../infra/errors.js";
import { has, type RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";

const APPT_COLS = `a.id, a.appointment_type_id, a.patient_id, a.practitioner_id, a.chair_id, a.starts_at, a.ends_at, a.status, a.contact_outcome,
  a.reason, a.note, a.cancel_reason, a.checked_in_at, a.completed_at, a.version, a.procedure_id,
  apx.procs as planned_procedures, apx.planned_total as planned_price`;
/**
 * Planlanan işlemler (ADR-107: birden fazla, sıralı) ve randevu günündeki tarife fiyatları (lookupPrice ile aynı öncelik: hekime özel > klinik;
 * en yeni geçerli sürüm). Toplam yalnız her işlemin fiyatı varsa döner (eksik fiyatla yanlış toplam gösterilmez). Liste tablosu yoksa
 * (eski kayıt) `appointments.procedure_id` tek işlem olarak okunur.
 */
const procJoin = (tzParam: string) => `left join lateral (
  select json_agg(json_build_object('id', x.pid, 'code', pc.code, 'name', pc.name, 'price', pp.price) order by x.pos) as procs,
         case when bool_and(pp.price is not null) then sum(pp.price::numeric)::text end as planned_total
    from (select ap.procedure_id as pid, ap.position as pos from appointment_procedures ap where ap.appointment_id = a.id
          union all
          select a.procedure_id, 1 where a.procedure_id is not null and not exists (select 1 from appointment_procedures ap2 where ap2.appointment_id = a.id)) x
    join procedures pc on pc.id = x.pid
    left join lateral (
      select ti.price::text as price from tariff_items ti join tariff_versions tv on tv.id = ti.tariff_version_id
       where ti.procedure_id = x.pid and tv.status = 'published' and tv.valid_from <= (a.starts_at at time zone ${tzParam})::date
         and (tv.practitioner_id = a.practitioner_id or tv.practitioner_id is null)
       order by (tv.practitioner_id is not null) desc, tv.valid_from desc, tv.published_at desc limit 1) pp on true
  ) apx on true`;

type PlannedProc = { id: string; code: string; name: string; price: string | null };

function presentAppointment(r: Record<string, any>) {
  return {
    id: r.id,
    patientId: r.patient_id,
    appointmentTypeId: r.appointment_type_id ?? null,
    patientName: r.patient_name ? `${r.patient_name}` : undefined,
    patientFileNo: r.file_no ?? undefined,
    practitionerId: r.practitioner_id,
    practitionerName: r.practitioner_name ?? undefined,
    chairId: r.chair_id,
    chairName: r.chair_name ?? null,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    status: r.status as AppointmentStatus,
    contactOutcome: r.contact_outcome,
    reason: r.reason,
    note: r.note,
    cancelReason: r.cancel_reason,
    checkedInAt: r.checked_in_at,
    completedAt: r.completed_at,
    version: r.version,
    /** İlk planlanan işlem (geriye uyumluluk). */
    procedureId: r.procedure_id ?? null,
    /** ADR-107: planlanan işlemler sırasıyla; her birinin tarife fiyatı (yoksa null). Boş liste = işlem henüz belirlenmedi (hekim muayenede). */
    procedures: ((r.planned_procedures ?? []) as PlannedProc[]).map((p) => ({ id: p.id, code: p.code, name: p.name, label: `${p.code} · ${p.name}`, price: p.price ?? null })),
    procedureLabel: (r.planned_procedures as PlannedProc[] | null)?.length ? (r.planned_procedures as PlannedProc[]).map((p) => `${p.code} · ${p.name}`).join(", ") : null,
    /** Tarifeden bilgi amaçlı toplam fiyat (TL, metin); işlemlerden birinin fiyatı yoksa ya da işlem yoksa null. */
    plannedPrice: r.planned_price ?? null,
  };
}

@Injectable()
export class SchedulingService {
  constructor(@Inject(Db) private readonly db: Db) {}

  resources(ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const p = await c.query("select id, display_name, title, active from practitioners where active order by display_name");
      const ch = await c.query("select id, name, active from chairs where active order by name");
      const ty = await c.query("select id, name, default_minutes, procedure_id from appointment_types where active order by name");
      const pr = await c.query("select id, code, name, category, default_minutes from procedures where active order by category nulls last, name");
      return {
        practitioners: p.rows.map((r) => ({ id: r.id, name: r.display_name, title: r.title })),
        chairs: ch.rows.map((r) => ({ id: r.id, name: r.name })),
        appointmentTypes: ty.rows.map((r) => ({ id: r.id, name: r.name, defaultMinutes: r.default_minutes, procedureId: r.procedure_id ?? null })),
        procedures: pr.rows.map((r) => ({ id: r.id, code: r.code, name: r.name, category: r.category, defaultMinutes: r.default_minutes })),
      };
    });
  }

  day(ctx: RequestContext, date?: string, days = 1) {
    const d = date ?? localDate(new Date(), ctx.timezone);
    const { from } = dayRangeUtc(d, ctx.timezone);
    const { to } = dayRangeUtc(addDays(d, days - 1), ctx.timezone);
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select ${APPT_COLS}, p.first_name || ' ' || p.last_name as patient_name, p.file_no,
                pr.display_name as practitioner_name, ch.name as chair_name
           from appointments a
           join patients p on p.id = a.patient_id
           join practitioners pr on pr.id = a.practitioner_id
           left join chairs ch on ch.id = a.chair_id
           ${procJoin("$3")}
          where a.starts_at >= $1 and a.starts_at < $2
          order by a.starts_at, pr.display_name`,
        [from, to, ctx.timezone],
      );
      return { date: d, days, timezone: ctx.timezone, items: r.rows.map(presentAppointment) };
    });
  }

  forPatient(ctx: RequestContext, patientId: string) {
    return this.db.tx(ctx, async (c) => {
      const p = await c.query("select 1 from patients where id = $1", [patientId]);
      if (!p.rowCount) return null;
      const r = await c.query(
        `select ${APPT_COLS}, pr.display_name as practitioner_name, ch.name as chair_name
           from appointments a join practitioners pr on pr.id = a.practitioner_id left join chairs ch on ch.id = a.chair_id
           ${procJoin("$2")}
          where a.patient_id = $1 order by a.starts_at desc limit 100`,
        [patientId, ctx.timezone],
      );
      return r.rows.map(presentAppointment);
    });
  }

  async create(ctx: RequestContext, input: AppointmentCreate) {
    const startsAt = zonedToUtc(input.date, input.startTime, ctx.timezone);
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
    // Geçmişe randevu verilemez (madde 1, ADR-094). Geriye dönük düzeltme yalnız takvim yöneticisine, gerekçeyle ve denetimli.
    const past = startsAt.getTime() < Date.now() - APPOINTMENT_PAST_GRACE_MINUTES * 60_000;
    if (past && !input.backdateReason) {
      throw new AppError(422, "APPOINTMENT_IN_PAST", "Geçmiş bir tarih veya saate randevu oluşturulamaz. Lütfen ileri bir saat seçin.", { date: "Geçmiş tarih/saat seçilemez." });
    }
    if (past && !has(ctx, "schedule.manage")) throw Errors.forbidden();
    return this.db.tx(ctx, async (c) => {
      // Takvim yazımları tenant başına sıralanır: kapatma ile randevu aynı anda oluşturulsa da tutarlı kalır.
      await c.query("select pg_advisory_xact_lock(hashtextextended('viadent:schedule:' || $1::text, 0))", [ctx.tenantId]);
      const patient = await c.query("select id from patients where id = $1 and status = 'active'", [input.patientId]);
      if (!patient.rowCount) throw Errors.validation({ patientId: "Hasta bulunamadı." });
      const prac = await c.query("select id, branch_id from practitioners where id = $1 and active", [input.practitionerId]);
      if (!prac.rowCount) throw Errors.validation({ practitionerId: "Hekim bulunamadı veya pasif." });
      if (input.chairId) {
        const chair = await c.query("select 1 from chairs where id = $1 and active", [input.chairId]);
        if (!chair.rowCount) throw Errors.validation({ chairId: "Ünite bulunamadı veya pasif." });
      }
      let reason = input.reason ?? null;
      // ADR-107: işlemler isteğe bağlı ve birden fazla olabilir; `procedureIds` verilmişse `procedureId` yok sayılır.
      let procedureIds: string[] = input.procedureIds ?? (input.procedureId ? [input.procedureId] : []);
      if (input.appointmentTypeId) {
        const ty = await c.query("select name, procedure_id from appointment_types where id = $1 and active", [input.appointmentTypeId]);
        if (!ty.rowCount) throw Errors.validation({ appointmentTypeId: "İşlem türü bulunamadı." });
        reason = reason ?? ty.rows[0].name;
        if (!procedureIds.length && ty.rows[0].procedure_id) procedureIds = [ty.rows[0].procedure_id];
      }
      if (procedureIds.length) {
        const pr = await c.query("select id, name from procedures where id = any($1::uuid[]) and active", [procedureIds]);
        if (pr.rowCount !== procedureIds.length) throw Errors.validation({ [input.procedureIds ? "procedureIds" : "procedureId"]: "İşlem bulunamadı veya pasif." });
        const names = new Map(pr.rows.map((x) => [x.id as string, x.name as string]));
        if (!reason) {
          const joined = procedureIds.map((id) => names.get(id)!).join(", ");
          reason = joined.length <= 120 ? joined : `${joined.slice(0, 117)}…`;
        }
      }
      const procedureId = procedureIds[0] ?? null;
      // Kapatma: aşılamaz (T06).
      const closed = await c.query(
        `select reason, scope from closures
          where cancelled_at is null and tstzrange(starts_at, ends_at, '[)') && tstzrange($1, $2, '[)')
            and (scope = 'clinic' or practitioner_id = $3 or ($4::uuid is not null and chair_id = $4::uuid))
          limit 1`,
        [startsAt, endsAt, input.practitionerId, input.chairId ?? null],
      );
      if (closed.rowCount) {
        const label = { clinic: "Klinik", practitioner: "Hekim", chair: "Ünite" }[closed.rows[0].scope as "clinic"];
        throw new AppError(422, "RESOURCE_CLOSED", `${label} bu aralıkta kapalı: ${closed.rows[0].reason}`, undefined, { scope: closed.rows[0].scope });
      }
      // Çalışma saati: tanımlıysa dışı uyarıdır; bilinçli onayla kaydedilebilir ve iz bırakır (T05).
      const outside = await this.outsideHours(c, ctx.timezone, input.practitionerId, startsAt, endsAt);
      if (outside && !input.allowOutsideHours) {
        throw new AppError(422, "OUTSIDE_WORKING_HOURS", "Seçilen saat hekimin çalışma saatleri dışında.", undefined, { blocks: outside.blocks });
      }
      const r = await c.query(
        `insert into appointments(tenant_id, branch_id, patient_id, practitioner_id, chair_id, appointment_type_id, starts_at, ends_at, reason, note, created_by, procedure_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         returning id`,
        [ctx.tenantId, prac.rows[0].branch_id, input.patientId, input.practitionerId, input.chairId ?? null, input.appointmentTypeId ?? null,
         startsAt, endsAt, reason, input.note ?? null, ctx.userId, procedureId],
      );
      for (const [i, pid] of procedureIds.entries()) {
        await c.query("insert into appointment_procedures(tenant_id, appointment_id, procedure_id, position) values ($1,$2,$3,$4)", [ctx.tenantId, r.rows[0].id, pid, i + 1]);
      }
      const a = await this.loadOne(c, ctx, r.rows[0].id);
      await audit(c, ctx, {
        action: "appointment.create", entityType: "appointment", entityId: a.id, patientId: a.patient_id,
        changes: {
          starts_at: { from: null, to: a.starts_at }, practitioner_id: { from: null, to: a.practitioner_id }, chair_id: { from: null, to: a.chair_id },
          ...(outside ? { outside_working_hours: { from: null, to: true } } : {}),
          ...(procedureId ? { procedure_id: { from: null, to: procedureId } } : {}),
          ...(procedureIds.length > 1 ? { procedure_ids: { from: null, to: procedureIds } } : {}),
          ...(past ? { backdated: { from: null, to: true }, backdate_reason: { from: null, to: input.backdateReason } } : {}),
        },
      });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "appointment.create" });
      return presentAppointment(a);
    });
  }

  /**
   * 07.11.2026: hekim + gün + süre için uygun boş başlangıç saatleri (15 dk adım). Çalışma saati tanımsızsa 09:00–19:00 gösterilir
   * (kayıt yine sunucuda kontrol edilir). Kapatma/izin/resmî tatil, hekimin ve (verildiyse) koltuğun randevuları ile geçmiş saatler çıkarılır.
   */
  async availability(ctx: RequestContext, practitionerId: string, date: string, minutes: number, chairId: string | null) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from practitioners where id = $1 and active", [practitionerId])).rowCount) throw Errors.validation({ practitionerId: "Hekim bulunamadı veya pasif." });
      const wd = (await c.query("select extract(isodow from $1::date)::int as wd", [date])).rows[0].wd as number;
      const defined = !!(await c.query("select 1 from work_schedules where practitioner_id = $1 limit 1", [practitionerId])).rowCount;
      const blocks = defined
        ? (await c.query("select start_min, end_min from work_schedules where practitioner_id = $1 and weekday = $2 order by start_min", [practitionerId, wd])).rows.map((b) => ({ start: b.start_min as number, end: b.end_min as number }))
        : [{ start: 9 * 60, end: 19 * 60 }];
      const { from, to } = dayRangeUtc(date, ctx.timezone);
      const busy = await c.query(
        `select starts_at, ends_at from appointments where starts_at < $2 and ends_at > $1 and status not in ('cancelled', 'no_show')
            and (practitioner_id = $3 or ($4::uuid is not null and chair_id = $4::uuid))
         union all
         select starts_at, ends_at from closures where cancelled_at is null and starts_at < $2 and ends_at > $1
            and (scope = 'clinic' or practitioner_id = $3 or ($4::uuid is not null and chair_id = $4::uuid))`,
        [from, to, practitionerId, chairId]);
      const closures = await c.query(
        `select reason, kind from closures where cancelled_at is null and starts_at <= $1 and ends_at >= $2 and (scope = 'clinic' or practitioner_id = $3) limit 1`,
        [from, to, practitionerId]);
      const ranges = busy.rows.map((b) => [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()] as const);
      const earliest = Date.now() + 5 * 60_000;
      const slots: string[] = [];
      for (const b of blocks) {
        for (let m = Math.ceil(b.start / 15) * 15; m + minutes <= b.end; m += 15) {
          const hh = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          const s = zonedToUtc(date, hh, ctx.timezone).getTime();
          const e = s + minutes * 60_000;
          if (s < earliest) continue;
          if (ranges.some(([bs, be]) => bs < e && be > s)) continue;
          slots.push(hh);
        }
      }
      return { date, minutes, workingHoursDefined: defined, blocks, slots, closedAllDay: closures.rows[0] ? { reason: closures.rows[0].reason, kind: closures.rows[0].kind } : null };
    });
  }

  private async loadOne(c: import("pg").PoolClient, ctx: RequestContext, id: string) {
    const r = await c.query(`select ${APPT_COLS} from appointments a ${procJoin("$2")} where a.id = $1`, [id, ctx.timezone]);
    return r.rows[0];
  }

  /** Hekimin çalışma saati tanımı varsa ve aralık hiçbir bloğa tam sığmıyorsa o günün bloklarını döner. */
  private async outsideHours(c: import("pg").PoolClient, tz: string, practitionerId: string, start: Date, end: Date) {
    const any = await c.query("select 1 from work_schedules where practitioner_id = $1 limit 1", [practitionerId]);
    if (!any.rowCount) return null; // tanımsız: kısıt yok (yönetim ekranında uyarı gösterilir)
    const r = await c.query(
      `select extract(isodow from $2::timestamptz at time zone $1)::int as wd,
              (extract(hour from $2::timestamptz at time zone $1) * 60 + extract(minute from $2::timestamptz at time zone $1))::int as s,
              (($3::timestamptz at time zone $1)::date - ($2::timestamptz at time zone $1)::date) as span_days,
              (extract(hour from $3::timestamptz at time zone $1) * 60 + extract(minute from $3::timestamptz at time zone $1))::int as e`,
      [tz, start, end],
    );
    const { wd, s, e, span_days } = r.rows[0];
    const endMin = span_days === 1 && e === 0 ? 1440 : span_days > 0 ? 99999 : e;
    const blocks = await c.query("select start_min, end_min from work_schedules where practitioner_id = $1 and weekday = $2 order by start_min", [practitionerId, wd]);
    const fits = blocks.rows.some((b) => b.start_min <= s && b.end_min >= endMin);
    return fits ? null : { blocks: blocks.rows.map((b) => ({ start: b.start_min, end: b.end_min })) };
  }

  async changeStatus(ctx: RequestContext, id: string, version: number, status: AppointmentStatus, cancelReason?: string) {
    return this.db.tx(ctx, async (c) => {
      const cur = await c.query("select id, patient_id, status, starts_at, version from appointments a where a.id = $1 for update", [id]);
      const a = cur.rows[0];
      if (!a) throw Errors.notFound("Randevu");
      if (a.version !== version) throw Errors.versionConflict();
      const allowed = APPOINTMENT_TRANSITIONS[a.status as AppointmentStatus];
      if (!allowed.includes(status)) {
        throw new AppError(422, "INVALID_TRANSITION", "Bu randevu durumu bu şekilde değiştirilemez.", undefined, { from: a.status, to: status, allowed });
      }
      if (status === "no_show" && new Date(a.starts_at) > new Date()) {
        throw new AppError(422, "INVALID_TRANSITION", "Henüz saati gelmemiş randevu 'Gelmedi' olarak işaretlenemez.");
      }
      const r = await c.query(
        `update appointments set status = $2::text,
            cancel_reason = case when $2::text = 'cancelled' then $3 else cancel_reason end,
            checked_in_at = case when $2::text = 'checked_in' then now() else checked_in_at end,
            completed_at = case when $2::text = 'completed' then now() else completed_at end,
            updated_at = now(), updated_by = $4, version = version + 1
          where id = $1`,
        [id, status, cancelReason ?? null, ctx.userId],
      );
      await audit(c, ctx, {
        action: "appointment.status", entityType: "appointment", entityId: id, patientId: a.patient_id,
        changes: { status: { from: a.status, to: status }, ...(cancelReason ? { cancel_reason: { from: null, to: cancelReason } } : {}) },
      });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "appointment.status" });
      return presentAppointment(await this.loadOne(c, ctx, id));
    });
  }

  async changeContact(ctx: RequestContext, id: string, version: number, outcome: string) {
    return this.db.tx(ctx, async (c) => {
      const cur = await c.query("select id, patient_id, contact_outcome, version from appointments where id = $1 for update", [id]);
      const a = cur.rows[0];
      if (!a) throw Errors.notFound("Randevu");
      if (a.version !== version) throw Errors.versionConflict();
      const r = await c.query(
        `update appointments set contact_outcome = $2, updated_at = now(), updated_by = $3, version = version + 1 where id = $1`,
        [id, outcome, ctx.userId],
      );
      await audit(c, ctx, {
        action: "appointment.contact", entityType: "appointment", entityId: id, patientId: a.patient_id,
        changes: { contact_outcome: { from: a.contact_outcome, to: outcome } },
      });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "appointment.contact" });
      return presentAppointment(await this.loadOne(c, ctx, id));
    });
  }
}
