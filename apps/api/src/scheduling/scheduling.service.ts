import { Inject, Injectable } from "@nestjs/common";
import {
  APPOINTMENT_TRANSITIONS, dayRangeUtc, localDate, zonedToUtc,
  type AppointmentCreate, type AppointmentStatus,
} from "@viadent/contracts";
import { Db } from "../infra/db.service.js";
import { AppError, Errors } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";

const APPT_COLS = `a.id, a.patient_id, a.practitioner_id, a.chair_id, a.starts_at, a.ends_at, a.status, a.contact_outcome,
  a.reason, a.note, a.cancel_reason, a.checked_in_at, a.completed_at, a.version`;

function presentAppointment(r: Record<string, any>) {
  return {
    id: r.id,
    patientId: r.patient_id,
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
  };
}

@Injectable()
export class SchedulingService {
  constructor(@Inject(Db) private readonly db: Db) {}

  resources(ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const p = await c.query("select id, display_name, title, active from practitioners where active order by display_name");
      const ch = await c.query("select id, name, active from chairs where active order by name");
      return {
        practitioners: p.rows.map((r) => ({ id: r.id, name: r.display_name, title: r.title })),
        chairs: ch.rows.map((r) => ({ id: r.id, name: r.name })),
      };
    });
  }

  day(ctx: RequestContext, date?: string) {
    const d = date ?? localDate(new Date(), ctx.timezone);
    const { from, to } = dayRangeUtc(d, ctx.timezone);
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select ${APPT_COLS}, p.first_name || ' ' || p.last_name as patient_name, p.file_no,
                pr.display_name as practitioner_name, ch.name as chair_name
           from appointments a
           join patients p on p.id = a.patient_id
           join practitioners pr on pr.id = a.practitioner_id
           left join chairs ch on ch.id = a.chair_id
          where a.starts_at >= $1 and a.starts_at < $2
          order by a.starts_at, pr.display_name`,
        [from, to],
      );
      return { date: d, timezone: ctx.timezone, items: r.rows.map(presentAppointment) };
    });
  }

  forPatient(ctx: RequestContext, patientId: string) {
    return this.db.tx(ctx, async (c) => {
      const p = await c.query("select 1 from patients where id = $1", [patientId]);
      if (!p.rowCount) return null;
      const r = await c.query(
        `select ${APPT_COLS}, pr.display_name as practitioner_name, ch.name as chair_name
           from appointments a join practitioners pr on pr.id = a.practitioner_id left join chairs ch on ch.id = a.chair_id
          where a.patient_id = $1 order by a.starts_at desc limit 100`,
        [patientId],
      );
      return r.rows.map(presentAppointment);
    });
  }

  async create(ctx: RequestContext, input: AppointmentCreate) {
    const startsAt = zonedToUtc(input.date, input.startTime, ctx.timezone);
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
    return this.db.tx(ctx, async (c) => {
      const patient = await c.query("select id from patients where id = $1 and status = 'active'", [input.patientId]);
      if (!patient.rowCount) throw Errors.validation({ patientId: "Hasta bulunamadı." });
      const prac = await c.query("select id, branch_id from practitioners where id = $1 and active", [input.practitionerId]);
      if (!prac.rowCount) throw Errors.validation({ practitionerId: "Hekim bulunamadı." });
      if (input.chairId) {
        const chair = await c.query("select 1 from chairs where id = $1 and active", [input.chairId]);
        if (!chair.rowCount) throw Errors.validation({ chairId: "Koltuk bulunamadı." });
      }
      // Çakışma DB exclusion constraint ile engellenir; eşzamanlı iki istekte yalnız biri başarılı olur (AT-03).
      const r = await c.query(
        `insert into appointments(tenant_id, branch_id, patient_id, practitioner_id, chair_id, starts_at, ends_at, reason, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         returning id, patient_id, practitioner_id, chair_id, starts_at, ends_at, status, contact_outcome, reason, note,
                   cancel_reason, checked_in_at, completed_at, version`,
        [ctx.tenantId, prac.rows[0].branch_id, input.patientId, input.practitionerId, input.chairId ?? null, startsAt, endsAt,
         input.reason ?? null, input.note ?? null, ctx.userId],
      );
      const a = r.rows[0];
      await audit(c, ctx, {
        action: "appointment.create", entityType: "appointment", entityId: a.id, patientId: a.patient_id,
        changes: { starts_at: { from: null, to: a.starts_at }, practitioner_id: { from: null, to: a.practitioner_id }, chair_id: { from: null, to: a.chair_id } },
      });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "appointment.create" });
      return presentAppointment(a);
    });
  }

  async changeStatus(ctx: RequestContext, id: string, version: number, status: AppointmentStatus, cancelReason?: string) {
    return this.db.tx(ctx, async (c) => {
      const cur = await c.query(`select ${APPT_COLS} from appointments a where a.id = $1 for update`, [id]);
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
          where id = $1
          returning id, patient_id, practitioner_id, chair_id, starts_at, ends_at, status, contact_outcome, reason, note,
                    cancel_reason, checked_in_at, completed_at, version`,
        [id, status, cancelReason ?? null, ctx.userId],
      );
      await audit(c, ctx, {
        action: "appointment.status", entityType: "appointment", entityId: id, patientId: a.patient_id,
        changes: { status: { from: a.status, to: status }, ...(cancelReason ? { cancel_reason: { from: null, to: cancelReason } } : {}) },
      });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "appointment.status" });
      return presentAppointment(r.rows[0]);
    });
  }

  async changeContact(ctx: RequestContext, id: string, version: number, outcome: string) {
    return this.db.tx(ctx, async (c) => {
      const cur = await c.query("select id, patient_id, contact_outcome, version from appointments where id = $1 for update", [id]);
      const a = cur.rows[0];
      if (!a) throw Errors.notFound("Randevu");
      if (a.version !== version) throw Errors.versionConflict();
      const r = await c.query(
        `update appointments set contact_outcome = $2, updated_at = now(), updated_by = $3, version = version + 1 where id = $1
         returning id, patient_id, practitioner_id, chair_id, starts_at, ends_at, status, contact_outcome, reason, note,
                   cancel_reason, checked_in_at, completed_at, version`,
        [id, outcome, ctx.userId],
      );
      await audit(c, ctx, {
        action: "appointment.contact", entityType: "appointment", entityId: id, patientId: a.patient_id,
        changes: { contact_outcome: { from: a.contact_outcome, to: outcome } },
      });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "appointment.contact" });
      return presentAppointment(r.rows[0]);
    });
  }
}
