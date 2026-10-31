import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import type pg from "pg";
import {
  PlanCancelInput, PlanCreate, PlanDecisionInput, PlanItemInput, localDate, toMinor, validateLocation, type ToothScope,
} from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";
import { applicableTariff, locCols, lookupPrice, presentLoc } from "./pricing.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });

/**
 * Tedavi planı (Akış B). Plan bir kapsayıcıdır; içerik sürümlüdür:
 *  taslak → teklif sunuldu → kabul / ret (kararsız yanıt durumu değiştirmez) ; yeni teklif = yeni sürüm.
 * Kabul edilmiş sürümün kalemleri ve fiyat snapshot'ı değişmez (API + DB tetikleyicisi, AT-05).
 * Planlanan bedel gerçekleşen tedavi geliri değildir; gerçekleşen işlem ayrı kayıttır.
 */
@Controller()
export class PlansController {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** Klinik geneli plan takibi: yanıt bekleyen teklifler ve tamamlanmamış kabul edilmiş planlar. */
  @Get("plans")
  @Require("treatment.read")
  overview(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select pv.id as version_id, pv.version, pv.status, pv.proposed_at, pv.decided_at, tp.id as plan_id, tp.title, tp.patient_id,
                p.first_name || ' ' || p.last_name as patient_name, p.file_no, pr.display_name as practitioner_name,
                coalesce((select sum(line_total) from plan_items pi where pi.plan_version_id = pv.id), 0)::text as total,
                coalesce((select sum(pi.quantity) from plan_items pi where pi.plan_version_id = pv.id), 0)::int as item_qty,
                coalesce((select sum(pp.quantity) from performed_procedures pp join plan_items pi on pi.id = pp.plan_item_id
                           where pi.plan_version_id = pv.id and pp.status = 'completed'), 0)::int as done_qty,
                (select min(a.starts_at) from appointments a where a.patient_id = tp.patient_id and a.status in ('planned','confirmed') and a.starts_at > now()) as next_appointment_at
           from plan_versions pv join treatment_plans tp on tp.id = pv.plan_id join patients p on p.id = tp.patient_id
           join practitioners pr on pr.id = pv.practitioner_id
          where pv.status in ('proposed','accepted')
          order by pv.status desc, coalesce(pv.decided_at, pv.proposed_at) desc
          limit 300`,
      );
      return { items: r.rows.map((x) => ({ versionId: x.version_id, version: x.version, status: x.status, proposedAt: x.proposed_at, decidedAt: x.decided_at,
        planId: x.plan_id, title: x.title, patientId: x.patient_id, patientName: x.patient_name, fileNo: x.file_no, practitionerName: x.practitioner_name,
        total: x.total, itemQty: x.item_qty, doneQty: x.done_qty, nextAppointmentAt: x.next_appointment_at }))
        .filter((x) => x.status === "proposed" || x.doneQty < x.itemQty) };
    });
  }

  @Get("patients/:patientId/plans")
  @Require("treatment.read")
  list(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const plans = await c.query(
        `select tp.id, tp.title, tp.created_at, u.full_name as created_by from treatment_plans tp join users u on u.id = tp.created_by
          where tp.patient_id = $1 order by tp.created_at desc`,
        [patientId],
      );
      const out = [];
      for (const p of plans.rows) out.push({ id: p.id, title: p.title, createdAt: p.created_at, createdBy: p.created_by, versions: await this.versions(c, p.id) });
      return { items: out };
    });
  }

  private async versions(c: pg.PoolClient, planId: string) {
    const v = await c.query(
      `select pv.id, pv.version, pv.status, pv.note, pv.proposed_at, pv.decided_at, pv.status_reason, pv.created_at,
              pv.practitioner_id, pr.display_name as practitioner_name, tv.name as tariff_name,
              coalesce((select sum(line_total) from plan_items pi where pi.plan_version_id = pv.id), 0)::text as total,
              coalesce((select sum(discount) from plan_items pi where pi.plan_version_id = pv.id), 0)::text as discount_total
         from plan_versions pv join practitioners pr on pr.id = pv.practitioner_id left join tariff_versions tv on tv.id = pv.tariff_version_id
        where pv.plan_id = $1 order by pv.version desc`,
      [planId],
    );
    const result = [];
    for (const r of v.rows) {
      const items = await c.query(
        `select pi.*, pi.unit_price::text as unit_price_t, pi.discount::text as discount_t, pi.line_total::text as line_total_t,
                coalesce((select sum(pp.quantity) from performed_procedures pp where pp.plan_item_id = pi.id and pp.status = 'completed'), 0)::int as performed_qty
           from plan_items pi where pi.plan_version_id = $1 order by pi.session_no, pi.sort, pi.created_at`,
        [r.id],
      );
      const decisions = await c.query(
        `select d.decision, d.note, d.recorded_at, u.full_name from plan_decisions d join memberships m on m.id = d.recorded_by join users u on u.id = m.user_id
          where d.plan_version_id = $1 order by d.recorded_at`,
        [r.id],
      );
      result.push({
        id: r.id, version: r.version, status: r.status, note: r.note, proposedAt: r.proposed_at, decidedAt: r.decided_at, statusReason: r.status_reason,
        createdAt: r.created_at, practitionerId: r.practitioner_id, practitionerName: r.practitioner_name, tariffName: r.tariff_name,
        total: r.total, discountTotal: r.discount_total,
        items: items.rows.map((i) => ({
          id: i.id, procedureId: i.procedure_id, code: i.procedure_code, name: i.procedure_name, location: presentLoc(i), quantity: i.quantity,
          unitPrice: i.unit_price_t, priceSource: i.price_source, priceNote: i.price_note, discount: i.discount_t, discountReason: i.discount_reason,
          lineTotal: i.line_total_t, sessionNo: i.session_no, performedQty: i.performed_qty,
        })),
        decisions: decisions.rows.map((d) => ({ decision: d.decision, note: d.note, at: d.recorded_at, by: d.full_name })),
      });
    }
    return result;
  }

  @Post("patients/:patientId/plans")
  @Require("treatment.write")
  create(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string, @Body() body: unknown) {
    const i = parse(PlanCreate, body);
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1 and status = 'active'", [patientId])).rowCount) throw Errors.notFound("Hasta");
      if (!(await c.query("select 1 from practitioners where id = $1 and active", [i.practitionerId])).rowCount) throw Errors.validation({ practitionerId: "Hekim bulunamadı." });
      const plan = await c.query("insert into treatment_plans(tenant_id, patient_id, title, created_by) values ($1,$2,$3,$4) returning id", [ctx.tenantId, patientId, i.title, ctx.userId]);
      const tariff = await applicableTariff(c, i.practitionerId, localDate(new Date(), ctx.timezone));
      const v = await c.query(
        "insert into plan_versions(tenant_id, plan_id, version, tariff_version_id, practitioner_id, created_by) values ($1,$2,1,$3,$4,$5) returning id",
        [ctx.tenantId, plan.rows[0].id, tariff, i.practitionerId, ctx.userId],
      );
      await audit(c, ctx, { action: "plan.create", entityType: "treatment_plan", entityId: plan.rows[0].id, patientId, changes: { title: { from: null, to: i.title } } });
      return { planId: plan.rows[0].id, versionId: v.rows[0].id };
    });
  }

  /** Taslak sürümü kilitleyip döner; taslak değilse 409 (yeni sürüm gerekir). */
  private async draft(c: pg.PoolClient, versionId: string) {
    const v = await c.query(
      `select pv.id, pv.status, pv.practitioner_id, pv.plan_id, tp.patient_id from plan_versions pv join treatment_plans tp on tp.id = pv.plan_id
        where pv.id = $1 for update of pv`,
      [versionId],
    );
    if (!v.rowCount) throw Errors.notFound("Plan sürümü");
    if (v.rows[0].status !== "draft") {
      throw new AppError(409, "PLAN_VERSION_LOCKED", "Bu sürüm teklif edildiği için değiştirilemez. Değişiklik için yeni sürüm oluşturun.");
    }
    return v.rows[0] as { id: string; practitioner_id: string; plan_id: string; patient_id: string };
  }

  private async itemValues(c: pg.PoolClient, ctx: RequestContext, practitionerId: string, input: ReturnType<typeof PlanItemInput.parse>) {
    const p = await c.query("select id, code, name, tooth_scope from procedures where id = $1 and active", [input.procedureId]);
    if (!p.rowCount) throw Errors.validation({ procedureId: "İşlem bulunamadı veya pasif." });
    const locErr = validateLocation(p.rows[0].tooth_scope as ToothScope, input.location);
    if (locErr) throw Errors.validation({ location: locErr });
    let unitPrice: string;
    let source: "tariff" | "manual";
    if (input.manualPrice) {
      unitPrice = input.manualPrice;
      source = "manual";
    } else {
      const found = await lookupPrice(c, input.procedureId, practitionerId, localDate(new Date(), ctx.timezone));
      if (!found) throw new AppError(422, "NO_TARIFF_PRICE", "Bu işlem için yayınlanmış tarifede fiyat yok. Elle fiyat ve açıklama girin.", { manualPrice: "Fiyat gerekli" });
      unitPrice = found.price;
      source = "tariff";
    }
    const discount = input.discount ?? "0.00";
    if (toMinor(discount) > toMinor(unitPrice) * BigInt(input.quantity)) throw Errors.validation({ discount: "İndirim kalem tutarını aşamaz." });
    if (toMinor(discount) < 0n || toMinor(unitPrice) < 0n) throw Errors.validation({ discount: "Tutar negatif olamaz." });
    return { proc: p.rows[0], unitPrice, source, discount: toMinor(discount) === 0n ? "0.00" : discount, discountReason: toMinor(discount) === 0n ? null : input.discountReason ?? null };
  }

  @Post("plan-versions/:id/items")
  @Require("treatment.write")
  addItem(@Ctx() ctx: RequestContext, @Param("id", id) versionId: string, @Body() body: unknown) {
    const input = parse(PlanItemInput, body);
    return this.db.tx(ctx, async (c) => {
      const v = await this.draft(c, versionId);
      const val = await this.itemValues(c, ctx, v.practitioner_id, input);
      const l = locCols(input.location);
      const r = await c.query(
        `insert into plan_items(tenant_id, plan_version_id, procedure_id, procedure_code, procedure_name, location_kind, tooth, surfaces, quadrant, arch,
            quantity, unit_price, price_source, price_note, discount, discount_reason, session_no, sort)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 (select coalesce(max(sort), -1) + 1 from plan_items where plan_version_id = $2))
         returning id, line_total::text`,
        [ctx.tenantId, versionId, val.proc.id, val.proc.code, val.proc.name, l.location_kind, l.tooth, l.surfaces, l.quadrant, l.arch,
         input.quantity, val.unitPrice, val.source, val.source === "manual" ? input.priceNote : null, val.discount, val.discountReason, input.sessionNo],
      );
      await audit(c, ctx, { action: "plan.item_add", entityType: "plan_version", entityId: versionId, patientId: v.patient_id,
        changes: { procedure: { from: null, to: val.proc.code }, unit_price: { from: null, to: val.unitPrice }, ...(val.discountReason ? { discount: { from: null, to: val.discount } } : {}) } });
      return { id: r.rows[0].id, lineTotal: r.rows[0].line_total };
    });
  }

  @Patch("plan-items/:id")
  @Require("treatment.write")
  updateItem(@Ctx() ctx: RequestContext, @Param("id", id) itemId: string, @Body() body: unknown) {
    const input = parse(PlanItemInput, body);
    return this.db.tx(ctx, async (c) => {
      const it = await c.query("select plan_version_id, unit_price::text as unit_price, discount::text as discount from plan_items where id = $1", [itemId]);
      if (!it.rowCount) throw Errors.notFound("Plan kalemi");
      const v = await this.draft(c, it.rows[0].plan_version_id);
      const val = await this.itemValues(c, ctx, v.practitioner_id, input);
      const l = locCols(input.location);
      await c.query(
        `update plan_items set procedure_id=$2, procedure_code=$3, procedure_name=$4, location_kind=$5, tooth=$6, surfaces=$7, quadrant=$8, arch=$9,
            quantity=$10, unit_price=$11, price_source=$12, price_note=$13, discount=$14, discount_reason=$15, session_no=$16 where id = $1`,
        [itemId, val.proc.id, val.proc.code, val.proc.name, l.location_kind, l.tooth, l.surfaces, l.quadrant, l.arch, input.quantity, val.unitPrice,
         val.source, val.source === "manual" ? input.priceNote : null, val.discount, val.discountReason, input.sessionNo],
      );
      await audit(c, ctx, { action: "plan.item_update", entityType: "plan_version", entityId: v.id, patientId: v.patient_id,
        changes: { unit_price: { from: it.rows[0].unit_price, to: val.unitPrice }, discount: { from: it.rows[0].discount, to: val.discount } } });
      return { ok: true };
    });
  }

  @Delete("plan-items/:id")
  @Require("treatment.write")
  deleteItem(@Ctx() ctx: RequestContext, @Param("id", id) itemId: string) {
    return this.db.tx(ctx, async (c) => {
      const it = await c.query("select plan_version_id, procedure_code from plan_items where id = $1", [itemId]);
      if (!it.rowCount) throw Errors.notFound("Plan kalemi");
      const v = await this.draft(c, it.rows[0].plan_version_id);
      await c.query("delete from plan_items where id = $1", [itemId]);
      await audit(c, ctx, { action: "plan.item_remove", entityType: "plan_version", entityId: v.id, patientId: v.patient_id, changes: { procedure: { from: it.rows[0].procedure_code, to: null } } });
      return { ok: true };
    });
  }

  /** Taslağın fiyatlarını güncel tarifeden yeniler (yalnız tarife kaynaklı kalemler). */
  @Post("plan-versions/:id/reprice")
  @HttpCode(200)
  @Require("treatment.write")
  reprice(@Ctx() ctx: RequestContext, @Param("id", id) versionId: string) {
    return this.db.tx(ctx, async (c) => {
      const v = await this.draft(c, versionId);
      const items = await c.query("select id, procedure_id, quantity, discount::text as discount, unit_price::text as unit_price from plan_items where plan_version_id = $1 and price_source = 'tariff'", [versionId]);
      let changed = 0;
      const missing: string[] = [];
      for (const it of items.rows) {
        const p = await lookupPrice(c, it.procedure_id, v.practitioner_id, localDate(new Date(), ctx.timezone));
        if (!p) { missing.push(it.id); continue; }
        if (p.price === it.unit_price) continue;
        if (toMinor(it.discount) > toMinor(p.price) * BigInt(it.quantity)) { missing.push(it.id); continue; }
        await c.query("update plan_items set unit_price = $2 where id = $1", [it.id, p.price]);
        changed++;
      }
      const tariff = await applicableTariff(c, v.practitioner_id, localDate(new Date(), ctx.timezone));
      await c.query("update plan_versions set tariff_version_id = $2 where id = $1", [versionId, tariff]);
      await audit(c, ctx, { action: "plan.reprice", entityType: "plan_version", entityId: versionId, patientId: v.patient_id, changes: { changed: { from: null, to: changed } } });
      return { changed, skipped: missing.length };
    });
  }

  @Post("plan-versions/:id/propose")
  @HttpCode(200)
  @Require("treatment.write")
  propose(@Ctx() ctx: RequestContext, @Param("id", id) versionId: string) {
    return this.db.tx(ctx, async (c) => {
      const v = await this.draft(c, versionId);
      const n = await c.query("select count(*)::int as n from plan_items where plan_version_id = $1", [versionId]);
      if (n.rows[0].n === 0) throw new AppError(422, "PLAN_EMPTY", "Kalemsiz plan teklif edilemez.");
      // Kararı verilmemiş eski teklif yenisiyle değişir; kabul edilmiş sürüm, yeni sürüm kabul edilene kadar geçerli kalır.
      await c.query("update plan_versions set status = 'superseded', status_reason = 'Yeni teklif sunuldu' where plan_id = $1 and status = 'proposed'", [v.plan_id]);
      await c.query("update plan_versions set status = 'proposed', proposed_at = now(), proposed_by = $2 where id = $1", [versionId, ctx.userId]);
      await audit(c, ctx, { action: "plan.propose", entityType: "plan_version", entityId: versionId, patientId: v.patient_id, changes: { status: { from: "draft", to: "proposed" } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "plan.propose" });
      return { ok: true };
    });
  }

  @Post("plan-versions/:id/decision")
  @HttpCode(200)
  @Require("treatment.decision")
  decide(@Ctx() ctx: RequestContext, @Param("id", id) versionId: string, @Body() body: unknown) {
    const i = parse(PlanDecisionInput, body);
    return this.db.tx(ctx, async (c) => {
      const v = await c.query(
        "select pv.id, pv.status, pv.plan_id, tp.patient_id from plan_versions pv join treatment_plans tp on tp.id = pv.plan_id where pv.id = $1",
        [versionId],
      );
      if (!v.rowCount) throw Errors.notFound("Plan sürümü");
      // Aynı plana ait tüm sürümleri kilitle (eşzamanlı iki kabulde tek kabul).
      await c.query("select id from plan_versions where plan_id = $1 order by version for update", [v.rows[0].plan_id]);
      const cur = await c.query("select status from plan_versions where id = $1", [versionId]);
      if (cur.rows[0].status !== "proposed") throw new AppError(409, "PLAN_NOT_PROPOSED", "Yalnız sunulmuş ve yanıt bekleyen teklif için karar kaydedilir.");
      await c.query("insert into plan_decisions(tenant_id, plan_version_id, decision, note, recorded_by) values ($1,$2,$3,$4,$5)",
        [ctx.tenantId, versionId, i.decision, i.note ?? null, ctx.membershipId]);
      if (i.decision === "accepted") {
        await c.query("update plan_versions set status = 'superseded', status_reason = 'Yeni sürüm kabul edildi' where plan_id = $1 and status = 'accepted'", [v.rows[0].plan_id]);
        await c.query("update plan_versions set status = 'accepted', decided_at = now() where id = $1", [versionId]);
      } else if (i.decision === "rejected") {
        await c.query("update plan_versions set status = 'rejected', decided_at = now() where id = $1", [versionId]);
      }
      await audit(c, ctx, { action: "plan.decision", entityType: "plan_version", entityId: versionId, patientId: v.rows[0].patient_id, changes: { decision: { from: null, to: i.decision } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "plan.decision" });
      return { ok: true };
    });
  }

  /** Son (iptal edilmemiş) sürümün kopyasıyla yeni taslak sürüm; fiyat snapshot'ları aynen taşınır. */
  @Post("plans/:id/versions")
  @Require("treatment.write")
  newVersion(@Ctx() ctx: RequestContext, @Param("id", id) planId: string) {
    return this.db.tx(ctx, async (c) => {
      const plan = await c.query("select patient_id from treatment_plans where id = $1", [planId]);
      if (!plan.rowCount) throw Errors.notFound("Plan");
      await c.query("select id from plan_versions where plan_id = $1 for update", [planId]);
      if ((await c.query("select 1 from plan_versions where plan_id = $1 and status = 'draft'", [planId])).rowCount) {
        throw new AppError(409, "DRAFT_EXISTS", "Bu planın açık bir taslak sürümü zaten var.");
      }
      const src = await c.query("select id, version, tariff_version_id, practitioner_id, note from plan_versions where plan_id = $1 and status <> 'cancelled' order by version desc limit 1", [planId]);
      const max = await c.query("select max(version)::int as v from plan_versions where plan_id = $1", [planId]);
      const s = src.rows[0];
      const nv = await c.query(
        "insert into plan_versions(tenant_id, plan_id, version, tariff_version_id, practitioner_id, note, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [ctx.tenantId, planId, (max.rows[0].v ?? 0) + 1, s?.tariff_version_id ?? null, s?.practitioner_id, s?.note ?? null, ctx.userId],
      );
      if (s) {
        await c.query(
          `insert into plan_items(tenant_id, plan_version_id, procedure_id, procedure_code, procedure_name, location_kind, tooth, surfaces, quadrant, arch,
              quantity, unit_price, price_source, price_note, discount, discount_reason, session_no, sort)
           select tenant_id, $2, procedure_id, procedure_code, procedure_name, location_kind, tooth, surfaces, quadrant, arch,
                  quantity, unit_price, price_source, price_note, discount, discount_reason, session_no, sort
             from plan_items where plan_version_id = $1`,
          [s.id, nv.rows[0].id],
        );
      }
      await audit(c, ctx, { action: "plan.new_version", entityType: "treatment_plan", entityId: planId, patientId: plan.rows[0].patient_id,
        changes: { version: { from: s?.version ?? null, to: (max.rows[0].v ?? 0) + 1 } } });
      return { versionId: nv.rows[0].id };
    });
  }

  @Post("plan-versions/:id/cancel")
  @HttpCode(200)
  @Require("treatment.write")
  cancel(@Ctx() ctx: RequestContext, @Param("id", id) versionId: string, @Body() body: unknown) {
    const i = parse(PlanCancelInput, body);
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `update plan_versions pv set status = 'cancelled', status_reason = $2 from treatment_plans tp
          where pv.id = $1 and tp.id = pv.plan_id and pv.status in ('draft','proposed','accepted') returning tp.patient_id, pv.plan_id`,
        [versionId, i.reason],
      );
      if (!r.rowCount) throw new AppError(409, "PLAN_NOT_CANCELLABLE", "Bu sürüm iptal edilemez.");
      await audit(c, ctx, { action: "plan.cancel", entityType: "plan_version", entityId: versionId, patientId: r.rows[0].patient_id, changes: { reason: { from: null, to: i.reason } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "plan.cancel" });
      return { ok: true };
    });
  }
}
