import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  ClinicalStatusChange, DiagnosisCreate, FindingCreate, PerformCancelInput, PerformInput,
  validSurfaces, validateLocation, ALL_TEETH, type ToothScope,
} from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";
import { locCols, lookupPrice, presentLoc } from "./pricing.js";
import { cancelReceivable, createReceivable, lockAccount } from "../finance/ledger.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
const VISIT_STATUSES = ["checked_in", "in_progress", "completed"];

/**
 * Klinik harita: odontogram bulguları (mevcut durum), tanılar, plan kalemleri ve gerçekleşen işlemler
 * AYRI veridir ve tek görünümde birleştirilir (H04, H05). Silme yok; yanlış kayıt gerekçeyle işaretlenir.
 */
@Controller()
export class ChartController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("patients/:patientId/chart")
  @Require("patient.health.read")
  chart(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const f = await c.query(
        `select f.id, f.tooth, f.surfaces, f.finding_type, f.note, f.status, f.created_at, u.full_name as by
           from odontogram_findings f join memberships m on m.id = f.recorded_by join users u on u.id = m.user_id
          where f.patient_id = $1 and f.status <> 'entered_in_error' order by f.created_at desc`,
        [patientId],
      );
      const d = await c.query(
        `select d.*, u.full_name as by from diagnoses d join memberships m on m.id = d.recorded_by join users u on u.id = m.user_id
          where d.patient_id = $1 and d.status <> 'entered_in_error' order by d.created_at desc`,
        [patientId],
      );
      // Plan katmanı: her planın kabul edilmiş ve (varsa) yanıt bekleyen sürümü.
      const pi = await c.query(
        `select pi.id, pi.procedure_code, pi.procedure_name, pi.location_kind, pi.tooth, pi.surfaces, pi.quadrant, pi.arch, pi.quantity, pv.status as version_status,
                coalesce((select sum(pp.quantity) from performed_procedures pp where pp.plan_item_id = pi.id and pp.status = 'completed'), 0)::int as performed_qty
           from plan_items pi join plan_versions pv on pv.id = pi.plan_version_id join treatment_plans tp on tp.id = pv.plan_id
          where tp.patient_id = $1 and pv.status in ('accepted','proposed')`,
        [patientId],
      );
      const pp = await c.query(
        `select pp.id, pp.procedure_code, pp.procedure_name, pp.location_kind, pp.tooth, pp.surfaces, pp.quadrant, pp.arch, pp.quantity,
                pp.amount::text as amount, pp.price_basis, pp.status, pp.status_reason, pp.completed_at, pp.plan_item_id, pp.corrects_id, pp.note,
                pr.display_name as practitioner, a.starts_at as visit_at
           from performed_procedures pp join practitioners pr on pr.id = pp.practitioner_id join appointments a on a.id = pp.appointment_id
          where pp.patient_id = $1 order by pp.completed_at desc`,
        [patientId],
      );
      return {
        findings: f.rows.map((x) => ({ id: x.id, tooth: x.tooth, surfaces: x.surfaces, type: x.finding_type, note: x.note, status: x.status, at: x.created_at, by: x.by })),
        diagnoses: d.rows.map((x) => ({ id: x.id, location: presentLoc(x), code: x.code, description: x.description, status: x.status, statusReason: x.status_reason, at: x.created_at, by: x.by })),
        planned: pi.rows.map((x) => ({ id: x.id, code: x.procedure_code, name: x.procedure_name, location: presentLoc(x), quantity: x.quantity, performedQty: x.performed_qty, versionStatus: x.version_status })),
        performed: pp.rows.map((x) => ({ id: x.id, code: x.procedure_code, name: x.procedure_name, location: presentLoc(x), quantity: x.quantity, amount: x.amount,
          priceBasis: x.price_basis, status: x.status, statusReason: x.status_reason, at: x.completed_at, planItemId: x.plan_item_id, correctsId: x.corrects_id,
          note: x.note, practitioner: x.practitioner, visitAt: x.visit_at })),
      };
    });
  }

  @Post("patients/:patientId/findings")
  @Require("patient.health.read", "diagnosis.write")
  addFinding(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string, @Body() body: unknown) {
    const i = parse(FindingCreate, body);
    if (!ALL_TEETH.has(i.tooth)) throw Errors.validation({ tooth: "Geçersiz diş numarası (FDI)." });
    const bad = i.surfaces.filter((s) => !validSurfaces(i.tooth).includes(s));
    if (bad.length) throw Errors.validation({ surfaces: `${i.tooth} numaralı dişte geçersiz yüzey: ${bad.join(", ")}.` });
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1 and status = 'active'", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const r = await c.query(
        "insert into odontogram_findings(tenant_id, patient_id, tooth, surfaces, finding_type, note, recorded_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [ctx.tenantId, patientId, i.tooth, i.surfaces, i.findingType, i.note ?? null, ctx.membershipId],
      );
      await audit(c, ctx, { action: "finding.create", entityType: "clinical_chart", entityId: r.rows[0].id, patientId, changes: { tooth: { from: null, to: i.tooth } } });
      return { id: r.rows[0].id };
    });
  }

  @Post("findings/:id/status")
  @HttpCode(200)
  @Require("patient.health.read", "diagnosis.write")
  findingStatus(@Ctx() ctx: RequestContext, @Param("id", id) fid: string, @Body() body: unknown) {
    const i = parse(ClinicalStatusChange, body);
    if (i.status === "resolved") throw Errors.validation({ status: "Bulgu için 'geçmiş' veya 'hatalı kayıt' seçin." });
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        "update odontogram_findings set status = $2, status_reason = $3, updated_at = now() where id = $1 and status = 'current' returning patient_id",
        [fid, i.status, i.reason],
      );
      if (!r.rowCount) throw Errors.notFound("Bulgu");
      await audit(c, ctx, { action: "finding.status", entityType: "clinical_chart", entityId: fid, patientId: r.rows[0].patient_id, changes: { status: { from: "current", to: i.status } } });
      return { ok: true };
    });
  }

  @Post("patients/:patientId/diagnoses")
  @Require("patient.health.read", "diagnosis.write")
  addDiagnosis(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string, @Body() body: unknown) {
    const i = parse(DiagnosisCreate, body);
    const scope: ToothScope = i.location.kind === "tooth" ? (i.location.surfaces?.length ? "surface" : "tooth") : i.location.kind;
    const err = validateLocation(scope, i.location);
    if (err) throw Errors.validation({ location: err });
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1 and status = 'active'", [patientId])).rowCount) throw Errors.notFound("Hasta");
      if (i.appointmentId && !(await c.query("select 1 from appointments where id = $1 and patient_id = $2", [i.appointmentId, patientId])).rowCount) {
        throw Errors.validation({ appointmentId: "Ziyaret bu hastaya ait değil." });
      }
      const l = locCols(i.location);
      const r = await c.query(
        `insert into diagnoses(tenant_id, patient_id, location_kind, tooth, surfaces, quadrant, arch, code, description, appointment_id, recorded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [ctx.tenantId, patientId, l.location_kind, l.tooth, l.surfaces, l.quadrant, l.arch, i.code ?? null, i.description, i.appointmentId ?? null, ctx.membershipId],
      );
      // Tanı metni audit'e yazılmaz.
      await audit(c, ctx, { action: "diagnosis.create", entityType: "clinical_chart", entityId: r.rows[0].id, patientId });
      return { id: r.rows[0].id };
    });
  }

  @Post("diagnoses/:id/status")
  @HttpCode(200)
  @Require("patient.health.read", "diagnosis.write")
  diagnosisStatus(@Ctx() ctx: RequestContext, @Param("id", id) did: string, @Body() body: unknown) {
    const i = parse(ClinicalStatusChange, body);
    if (i.status === "historic") throw Errors.validation({ status: "Tanı için 'çözüldü' veya 'hatalı kayıt' seçin." });
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        "update diagnoses set status = $2, status_reason = $3, updated_at = now() where id = $1 and status = 'active' returning patient_id",
        [did, i.status, i.reason],
      );
      if (!r.rowCount) throw Errors.notFound("Tanı");
      await audit(c, ctx, { action: "diagnosis.status", entityType: "clinical_chart", entityId: did, patientId: r.rows[0].patient_id, changes: { status: { from: "active", to: i.status } } });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ gerçekleşen işlem (VD-008)
  /** Hastanın gerçekleşmiş (geldi/tedavide/tamamlandı) ziyaretleri — işlem kaydında seçilir. */
  @Get("patients/:patientId/visits")
  @Require("treatment.read")
  visits(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select a.id, a.starts_at, a.status, pr.display_name from appointments a join practitioners pr on pr.id = a.practitioner_id
          where a.patient_id = $1 and a.status = any($2::text[]) order by a.starts_at desc limit 30`,
        [patientId, VISIT_STATUSES],
      );
      return { items: r.rows.map((a) => ({ id: a.id, startsAt: a.starts_at, status: a.status, practitionerName: a.display_name })) };
    });
  }

  @Post("patients/:patientId/performed")
  @Require("procedure.complete")
  perform(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string, @Body() body: unknown) {
    const i = parse(PerformInput, body);
    return this.db.tx(ctx, async (c) => this.record(c, ctx, patientId, i, null));
  }

  private async record(c: import("pg").PoolClient, ctx: RequestContext, patientId: string, i: ReturnType<typeof PerformInput.parse>, correctsId: string | null) {
    const visit = await c.query("select id, practitioner_id, status, (starts_at at time zone $3)::date::text as day from appointments where id = $1 and patient_id = $2",
      [i.appointmentId, patientId, ctx.timezone]);
    if (!visit.rowCount) throw Errors.validation({ appointmentId: "Ziyaret bu hastaya ait değil." });
    if (!VISIT_STATUSES.includes(visit.rows[0].status)) {
      throw new AppError(422, "VISIT_REQUIRED", "Gerçekleşen işlem yalnız geliş kaydı yapılmış ziyarete bağlanır.", { appointmentId: "Hasta bu ziyarette gelmiş görünmüyor." });
    }
    const practitionerId: string = visit.rows[0].practitioner_id;
    let proc: { id: string; code: string; name: string };
    let loc: Record<string, unknown>;
    let amount: string;
    let basis: "plan" | "tariff";
    if (i.planItemId) {
      const it = await c.query(
        `select pi.*, pi.line_total::text as line_total_t, pv.status as version_status, tp.patient_id
           from plan_items pi join plan_versions pv on pv.id = pi.plan_version_id join treatment_plans tp on tp.id = pv.plan_id
          where pi.id = $1 for update of pi`,
        [i.planItemId],
      );
      const item = it.rows[0];
      if (!item || item.patient_id !== patientId) throw Errors.validation({ planItemId: "Plan kalemi bu hastaya ait değil." });
      if (item.version_status !== "accepted") throw new AppError(422, "PLAN_NOT_ACCEPTED", "Yalnız kabul edilmiş plan sürümünün kalemi gerçekleştirilebilir.");
      const done = await c.query(
        "select coalesce(sum(quantity),0)::int as q, coalesce(sum(amount),0)::text as a from performed_procedures where plan_item_id = $1 and status = 'completed'",
        [i.planItemId],
      );
      const remaining = item.quantity - done.rows[0].q;
      if (i.quantity > remaining) throw new AppError(422, "EXCEEDS_PLAN", `Bu kalemde kalan adet ${remaining}.`, { quantity: `En çok ${remaining}` });
      // Bedel snapshot'ı plan kaleminden; son adet kuruş farkını kapatır (toplam = kalem tutarı).
      const amt = await c.query(
        "select case when $1::int = $2::int then ($3::numeric - $4::numeric) else round($3::numeric * $1 / $5, 2) end::text as v",
        [i.quantity, remaining, item.line_total_t, done.rows[0].a, item.quantity],
      );
      amount = amt.rows[0].v;
      basis = "plan";
      proc = { id: item.procedure_id, code: item.procedure_code, name: item.procedure_name };
      loc = { location_kind: item.location_kind, tooth: item.tooth, surfaces: item.surfaces, quadrant: item.quadrant, arch: item.arch };
    } else {
      const p = await c.query("select id, code, name, tooth_scope from procedures where id = $1 and active", [i.procedureId]);
      if (!p.rowCount) throw Errors.validation({ procedureId: "İşlem bulunamadı." });
      const err = validateLocation(p.rows[0].tooth_scope as ToothScope, i.location!);
      if (err) throw Errors.validation({ location: err });
      const price = await lookupPrice(c, p.rows[0].id, practitionerId, visit.rows[0].day);
      if (!price) throw new AppError(422, "NO_TARIFF_PRICE", "Plansız işlem için yayınlanmış tarifede fiyat yok. Önce plana ekleyin veya tarifeyi güncelleyin.");
      amount = (await c.query("select ($1::numeric * $2)::text as v", [price.price, i.quantity])).rows[0].v;
      basis = "tariff";
      proc = p.rows[0];
      loc = locCols(i.location!);
    }
    const r = await c.query(
      `insert into performed_procedures(tenant_id, patient_id, appointment_id, plan_item_id, procedure_id, procedure_code, procedure_name,
          location_kind, tooth, surfaces, quadrant, arch, quantity, amount, price_basis, practitioner_id, note, completed_by, corrects_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id, amount::text`,
      [ctx.tenantId, patientId, i.appointmentId, i.planItemId ?? null, proc.id, proc.code, proc.name, loc.location_kind, loc.tooth, loc.surfaces ?? [],
       loc.quadrant, loc.arch, i.quantity, amount, basis, practitionerId, i.note ?? null, ctx.membershipId, correctsId],
    );
    await audit(c, ctx, { action: correctsId ? "procedure.correct" : "procedure.complete", entityType: "performed_procedure", entityId: r.rows[0].id, patientId,
      changes: { procedure: { from: null, to: proc.code }, amount: { from: null, to: r.rows[0].amount }, ...(correctsId ? { corrects_id: { from: null, to: correctsId } } : {}) } });
    // Gerçekleşen işlem = hasta hesabında alacak (VİA Net). Aynı transaction; planlanan bedel alacak değildir.
    let receivableId: string | null = null;
    if (Number(r.rows[0].amount) > 0) {
      await lockAccount(c, patientId);
      receivableId = await createReceivable(c, ctx, { patientId, source: "performed_procedure", performedProcedureId: r.rows[0].id,
        description: `${proc.code} · ${proc.name}${loc.tooth ? ` · diş ${loc.tooth}` : ""}`, amount: r.rows[0].amount, practitionerId, dueDate: visit.rows[0].day });
    }
    await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "procedure.complete" });
    await enqueue(c, ctx.tenantId, "via_net.changed", { patientId });
    return { id: r.rows[0].id, amount: r.rows[0].amount, priceBasis: basis, receivableId };
  }

  @Post("performed/:id/cancel")
  @HttpCode(200)
  @Require("procedure.complete")
  cancelPerformed(@Ctx() ctx: RequestContext, @Param("id", id) pid: string, @Body() body: unknown) {
    const i = parse(PerformCancelInput, body);
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from performed_procedures where id = $1", [pid])).rowCount) throw Errors.notFound("İşlem kaydı");
      const r = await c.query("update performed_procedures set status = 'cancelled', status_reason = $2 where id = $1 and status = 'completed' returning patient_id", [pid, i.reason]);
      if (!r.rowCount) throw new AppError(409, "NOT_COMPLETED", "Yalnız tamamlanmış kayıt iptal edilebilir.");
      await this.cancelLinkedReceivable(c, ctx, pid, r.rows[0].patient_id, `işlem iptali: ${i.reason}`);
      await audit(c, ctx, { action: "procedure.cancel", entityType: "performed_procedure", entityId: pid, patientId: r.rows[0].patient_id, changes: { status: { from: "completed", to: "cancelled" }, reason: { from: null, to: i.reason } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "procedure.cancel" });
      return { ok: true };
    });
  }

  /** İşlem iptal/düzeltmesinde bağlı alacak da iptal edilir; dağıtılmış tahsilat ters kayıtla avansa döner (para kaybolmaz). */
  private async cancelLinkedReceivable(c: import("pg").PoolClient, ctx: RequestContext, performedId: string, patientId: string, reason: string) {
    const rec = await c.query("select id from receivables where performed_procedure_id = $1 and status = 'active'", [performedId]);
    if (!rec.rowCount) return;
    await lockAccount(c, patientId);
    await cancelReceivable(c, ctx, rec.rows[0].id, reason);
    await enqueue(c, ctx.tenantId, "via_net.changed", { patientId });
  }

  /** Düzeltme: önceki kayıt 'corrected' olur (silinmez), yeni kayıt ona bağlanır; tek transaction. */
  @Post("performed/:id/correct")
  @HttpCode(200)
  @Require("procedure.complete")
  correct(@Ctx() ctx: RequestContext, @Param("id", id) pid: string, @Body() body: unknown) {
    const raw = (body ?? {}) as Record<string, unknown>;
    const reason = parse(PerformCancelInput, { reason: raw.reason }).reason;
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from performed_procedures where id = $1", [pid])).rowCount) throw Errors.notFound("İşlem kaydı");
      const old = await c.query("select * from performed_procedures where id = $1 and status = 'completed' for update", [pid]);
      if (!old.rowCount) throw new AppError(409, "NOT_COMPLETED", "Yalnız tamamlanmış kayıt düzeltilebilir.");
      const o = old.rows[0];
      await c.query("update performed_procedures set status = 'corrected', status_reason = $2 where id = $1", [pid, reason]);
      await this.cancelLinkedReceivable(c, ctx, pid, o.patient_id, `işlem düzeltmesi: ${reason}`);
      const input = parse(PerformInput, {
        appointmentId: raw.appointmentId ?? o.appointment_id,
        planItemId: o.plan_item_id ?? undefined,
        procedureId: o.plan_item_id ? undefined : raw.procedureId ?? o.procedure_id,
        location: o.plan_item_id ? undefined : raw.location ?? presentLoc(o),
        quantity: raw.quantity ?? o.quantity,
        note: raw.note ?? undefined,
      });
      return this.record(c, ctx, o.patient_id, input, pid);
    });
  }
}
