/**
 * Laboratuvar iş emri (H12, R09; Plan Akış E). Aşamalar ayrı olaydır: gönderim, üretim, teslim (klinik teslim aldı),
 * hekim kabulü veya revizyon. Revizyon yeni aşama + (varsa) yeni maliyet kaydıdır; maliyet laboratuvar carisine borç yazar.
 * Laboratuvara giden bilgi en az veridir (iş föyü): hasta baş harfleri + iş emri no; kimlik, telefon, anamnez, tanı yok.
 */
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { LAB_TRANSITIONS, LabCostCreate, LabOrderCreate, LabOrderUpdate, LabTransition, ReverseInput, addMoney, localDate } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";
import { idempotent, requireKey } from "../finance/ledger.js";
import { activeSupplier, createBill, reverseEntry } from "./cari.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
type C = import("pg").PoolClient;

const OPEN = ["sent", "in_production", "revision"];

const trDate = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");

function initials(first: string, last: string) {
  return `${first.trim().charAt(0).toLocaleUpperCase("tr-TR")}. ${last.trim().charAt(0).toLocaleUpperCase("tr-TR")}.`;
}

@Controller()
export class LabController {
  constructor(@Inject(Db) private readonly db: Db) {}

  private mapOrder(o: Record<string, any>, today: string, withCost: boolean) {
    return {
      id: o.id, orderNo: o.order_no, patientId: o.patient_id, patient: o.patient, practitionerId: o.practitioner_id, practitioner: o.practitioner,
      supplierId: o.supplier_id, supplier: o.supplier, workType: o.work_type, teeth: o.teeth, shade: o.shade, instructions: o.instructions,
      targetDate: o.target_date, status: o.status, revisionCount: o.revision_count, sentAt: o.sent_at, receivedAt: o.received_at, acceptedAt: o.accepted_at,
      cancelReason: o.cancel_reason, appointmentId: o.appointment_id, appointmentAt: o.appointment_at, planItemId: o.plan_item_id, version: o.row_version,
      // ADR-108: hastadan alınan ölçü ve istenen malzeme
      impressionType: o.impression_type ?? null, impressionTakenOn: o.impression_taken_on ?? null, material: o.material ?? null,
      createdAt: o.created_at, overdue: OPEN.includes(o.status) && !!o.target_date && o.target_date < today,
      ...(withCost ? { cost: o.cost } : {}),
    };
  }

  private baseSelect = `
    select lo.*, lo.target_date::text as target_date, lo.impression_taken_on::text as impression_taken_on, p.first_name || ' ' || p.last_name as patient, pr.display_name as practitioner, s.name as supplier,
           a.starts_at as appointment_at, coalesce((select sum(amount) from lab_costs lc where lc.lab_order_id = lo.id), 0)::numeric(14,2)::text as cost
      from lab_orders lo join patients p on p.id = lo.patient_id join practitioners pr on pr.id = lo.practitioner_id join suppliers s on s.id = lo.supplier_id
      left join appointments a on a.id = lo.appointment_id`;

  @Get("lab-orders")
  @Require("lab.read")
  list(@Ctx() ctx: RequestContext, @Query("status") status?: string, @Query("supplierId") supplierId?: string) {
    const today = localDate(new Date(), ctx.timezone);
    const where = status === "open" ? "lo.status in ('draft','sent','in_production','revision','received')"
      : status === "overdue" ? "lo.status in ('sent','in_production','revision') and lo.target_date < $1::date"
      : status === "received" ? "lo.status = 'received'"
      : status === "closed" ? "lo.status in ('accepted','cancelled')" : "true";
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(`${this.baseSelect} where $1::date is not null and ${where} and ($2::uuid is null or lo.supplier_id = $2)
        order by case lo.status when 'received' then 0 when 'revision' then 1 when 'sent' then 2 when 'in_production' then 2 when 'draft' then 3 else 4 end,
                 lo.target_date nulls last, lo.order_no desc limit 300`, [today, supplierId && /^[0-9a-f-]{36}$/.test(supplierId) ? supplierId : null]);
      return { items: r.rows.map((o) => this.mapOrder(o, today, ctx.permissions.has("lab.cost"))) };
    });
  }

  @Get("patients/:patientId/lab-orders")
  @Require("lab.read")
  forPatient(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string) {
    const today = localDate(new Date(), ctx.timezone);
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const r = await c.query(`${this.baseSelect} where lo.patient_id = $1 order by lo.created_at desc`, [patientId]);
      return { items: r.rows.map((o) => this.mapOrder(o, today, ctx.permissions.has("lab.cost"))) };
    });
  }

  @Get("lab-orders/:id")
  @Require("lab.read")
  detail(@Ctx() ctx: RequestContext, @Param("id", id) oid: string) {
    const today = localDate(new Date(), ctx.timezone);
    const withCost = ctx.permissions.has("lab.cost");
    return this.db.tx(ctx, async (c) => {
      const o = (await c.query(`${this.baseSelect} where lo.id = $1`, [oid])).rows[0];
      if (!o) throw Errors.notFound("İş emri");
      const ev = await c.query(
        `select e.id, e.kind, e.from_status, e.to_status, e.note, e.at, u.full_name as by from lab_events e join users u on u.id = e.by_user
          where e.lab_order_id = $1 order by e.seq`, [oid]);
      const costs = withCost ? (await c.query(
        `select lc.id, lc.stage, lc.revision_no, lc.amount::text, lc.description, lc.reverses_id, lc.reason, lc.created_at, u.full_name as by,
                exists (select 1 from lab_costs z where z.reverses_id = lc.id) as reversed
           from lab_costs lc join users u on u.id = lc.created_by where lc.lab_order_id = $1 order by lc.created_at`, [oid])).rows : [];
      return {
        ...this.mapOrder(o, today, withCost),
        events: ev.rows.map((e) => ({ id: e.id, kind: e.kind, from: e.from_status, to: e.to_status, note: e.note, at: e.at, by: e.by })),
        ...(withCost ? { costs: costs.map((x) => ({ id: x.id, stage: x.stage, revisionNo: x.revision_no, amount: x.amount, description: x.description,
          reversal: !!x.reverses_id, reversed: x.reversed, reason: x.reason, at: x.created_at, by: x.by })) } : {}),
      };
    });
  }

  /** İş föyü: laboratuvara gidecek en az veri. */
  @Get("lab-orders/:id/work-sheet")
  @Require("lab.read")
  workSheet(@Ctx() ctx: RequestContext, @Param("id", id) oid: string) {
    return this.db.tx(ctx, async (c) => {
      const o = (await c.query(
        `select lo.order_no, lo.work_type, lo.teeth, lo.shade, lo.instructions, lo.target_date::text, lo.status, lo.revision_count,
                lo.impression_type, lo.impression_taken_on::text, lo.material,
                p.first_name, p.last_name, pr.display_name as practitioner, s.name as supplier, t.name as clinic
           from lab_orders lo join patients p on p.id = lo.patient_id join practitioners pr on pr.id = lo.practitioner_id
           join suppliers s on s.id = lo.supplier_id join tenants t on t.id = lo.tenant_id where lo.id = $1`, [oid])).rows[0];
      if (!o) throw Errors.notFound("İş emri");
      await audit(c, ctx, { action: "lab_order.work_sheet", entityType: "lab_order", entityId: oid });
      return { clinic: o.clinic, supplier: o.supplier, orderNo: o.order_no, patientRef: `${initials(o.first_name, o.last_name)} · İş emri ${o.order_no}`,
        practitioner: o.practitioner, workType: o.work_type, teeth: o.teeth, shade: o.shade, instructions: o.instructions, targetDate: o.target_date,
        impressionType: o.impression_type, impressionTakenOn: o.impression_taken_on, material: o.material,
        revision: o.revision_count, notice: "Bu föy yalnız iş için gerekli teknik bilgiyi içerir; hasta kimliği, iletişim ve sağlık bilgisi paylaşılmaz." };
    });
  }

  @Post("lab-orders")
  @Require("lab.write")
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(LabOrderCreate, body);
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [i.patientId])).rowCount) throw Errors.validation({ patientId: "Hasta bulunamadı." });
      await activeSupplier(c, i.supplierId, "lab");
      let practitionerId = i.practitionerId;
      if (!practitionerId) {
        practitionerId = (await c.query("select id from practitioners where membership_id = $1 and active", [ctx.membershipId])).rows[0]?.id;
        if (!practitionerId) throw Errors.validation({ practitionerId: "Hekim seçin." });
      } else if (!(await c.query("select 1 from practitioners where id = $1", [practitionerId])).rowCount) throw Errors.validation({ practitionerId: "Hekim bulunamadı." });
      if (i.planItemId) {
        const pi = await c.query(
          `select 1 from plan_items pi join plan_versions pv on pv.id = pi.plan_version_id join treatment_plans tp on tp.id = pv.plan_id where pi.id = $1 and tp.patient_id = $2`,
          [i.planItemId, i.patientId]);
        if (!pi.rowCount) throw Errors.validation({ planItemId: "Plan kalemi bu hastaya ait değil." });
      }
      if (i.appointmentId) await this.checkAppointment(c, i.appointmentId, i.patientId);
      this.checkImpressionDate(i.impressionTakenOn, ctx);
      const no = (await c.query(
        `insert into tenant_counters(tenant_id, name, value) values ($1,'lab_order_no',1)
         on conflict (tenant_id, name) do update set value = tenant_counters.value + 1 returning value`, [ctx.tenantId])).rows[0].value;
      const r = await c.query(
        `insert into lab_orders(tenant_id, order_no, patient_id, practitioner_id, supplier_id, plan_item_id, appointment_id, work_type, teeth, shade, instructions, target_date, created_by,
                                impression_type, impression_taken_on, material)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
        [ctx.tenantId, no, i.patientId, practitionerId, i.supplierId, i.planItemId ?? null, i.appointmentId ?? null, i.workType, i.teeth, i.shade ?? null,
         i.instructions ?? null, i.targetDate ?? null, ctx.userId, i.impressionType ?? null, i.impressionTakenOn ?? null, i.material ?? null]);
      await this.event(c, ctx, r.rows[0].id, "created", null, "draft", null);
      await audit(c, ctx, { action: "lab_order.create", entityType: "lab_order", entityId: r.rows[0].id, patientId: i.patientId,
        changes: { order_no: { from: null, to: no }, supplier_id: { from: null, to: i.supplierId }, work_type: { from: null, to: i.workType },
          ...(i.impressionType ? { impression_type: { from: null, to: i.impressionType } } : {}), ...(i.material ? { material: { from: null, to: i.material } } : {}) } });
      return { id: r.rows[0].id, orderNo: no };
    });
  }

  /** Ölçü tarihi ileri olamaz (klinik saat dilimi). */
  private checkImpressionDate(d: string | null | undefined, ctx: RequestContext) {
    if (d && d > localDate(new Date(), ctx.timezone)) throw Errors.validation({ impressionTakenOn: "Ölçü tarihi ileri bir tarih olamaz." });
  }

  private async checkAppointment(c: C, appointmentId: string, patientId: string) {
    const a = await c.query("select status from appointments where id = $1 and patient_id = $2", [appointmentId, patientId]);
    if (!a.rowCount) throw Errors.validation({ appointmentId: "Randevu bu hastaya ait değil." });
    if (["cancelled", "no_show"].includes(a.rows[0].status)) throw Errors.validation({ appointmentId: "İptal edilmiş/gelinmemiş randevuya bağlanamaz." });
  }

  private async event(c: C, ctx: RequestContext, orderId: string, kind: string, from: string | null, to: string | null, note: string | null) {
    await c.query("insert into lab_events(tenant_id, lab_order_id, kind, from_status, to_status, note, by_user) values ($1,$2,$3,$4,$5,$6,$7)",
      [ctx.tenantId, orderId, kind, from, to, note, ctx.userId]);
  }

  @Patch("lab-orders/:id")
  @Require("lab.write")
  update(@Ctx() ctx: RequestContext, @Param("id", id) oid: string, @Body() body: unknown) {
    const i = parse(LabOrderUpdate, body);
    return this.db.tx(ctx, async (c) => {
      const o = (await c.query("select *, target_date::text as target_date, impression_taken_on::text as impression_taken_on from lab_orders where id = $1 for update", [oid])).rows[0];
      if (!o) throw Errors.notFound("İş emri");
      if (o.row_version !== i.expectedVersion) throw Errors.versionConflict();
      if (["accepted", "cancelled"].includes(o.status)) throw new AppError(409, "LAB_CLOSED", "Kapanmış iş emri düzenlenemez.");
      if (i.supplierId && i.supplierId !== o.supplier_id) {
        if (o.status !== "draft") throw new AppError(409, "LAB_SUPPLIER_LOCKED", "Gönderilmiş iş emrinin laboratuvarı değiştirilemez; iptal edip yeni iş emri açın.");
        await activeSupplier(c, i.supplierId, "lab");
      }
      // Gönderilmiş işte teknik tanım (iş, diş, renk, talimat) değişmez: laboratuvar eski föyle çalışıyor olabilir → not veya revizyon.
      const techChange = (i.workType && i.workType !== o.work_type) || (i.teeth && JSON.stringify(i.teeth) !== JSON.stringify(o.teeth))
        || (i.shade !== undefined && (i.shade ?? null) !== o.shade) || (i.instructions !== undefined && (i.instructions ?? null) !== o.instructions)
        || (i.impressionType !== undefined && (i.impressionType ?? null) !== o.impression_type) || (i.impressionTakenOn !== undefined && (i.impressionTakenOn ?? null) !== o.impression_taken_on)
        || (i.material !== undefined && (i.material ?? null) !== o.material);
      if (techChange && o.status !== "draft") throw new AppError(409, "LAB_SPEC_LOCKED", "Laboratuvara gönderilmiş işin teknik tanımı değiştirilemez; not ekleyin veya teslimden sonra revizyon isteyin.");
      if (i.appointmentId) await this.checkAppointment(c, i.appointmentId, o.patient_id);
      this.checkImpressionDate(i.impressionTakenOn, ctx);
      const next = {
        supplier_id: i.supplierId ?? o.supplier_id, work_type: i.workType ?? o.work_type, teeth: i.teeth ?? o.teeth,
        shade: i.shade !== undefined ? i.shade ?? null : o.shade, instructions: i.instructions !== undefined ? i.instructions ?? null : o.instructions,
        target_date: i.targetDate ?? o.target_date, appointment_id: i.appointmentId !== undefined ? i.appointmentId : o.appointment_id,
        impression_type: i.impressionType !== undefined ? i.impressionType ?? null : o.impression_type,
        impression_taken_on: i.impressionTakenOn !== undefined ? i.impressionTakenOn ?? null : o.impression_taken_on,
        material: i.material !== undefined ? i.material ?? null : o.material,
      };
      if (next.impression_taken_on && !next.impression_type) throw Errors.validation({ impressionType: "Ölçü tarihi için ölçü türü seçin." });
      await c.query(
        `update lab_orders set supplier_id = $2, work_type = $3, teeth = $4, shade = $5, instructions = $6, target_date = $7, appointment_id = $8,
                impression_type = $9, impression_taken_on = $10, material = $11, row_version = row_version + 1 where id = $1`,
        [oid, next.supplier_id, next.work_type, next.teeth, next.shade, next.instructions, next.target_date, next.appointment_id,
         next.impression_type, next.impression_taken_on, next.material]);
      if (next.target_date !== o.target_date) await this.event(c, ctx, oid, "target_changed", null, null, `Hedef teslim: ${trDate(o.target_date)} → ${trDate(next.target_date)}`);
      else await this.event(c, ctx, oid, "updated", null, null, null);
      await audit(c, ctx, { action: "lab_order.update", entityType: "lab_order", entityId: oid, patientId: o.patient_id,
        changes: Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(o[k])).map(([k, v]) => [k, { from: o[k], to: v }])) });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "lab_order.update" });
      return { ok: true, version: o.row_version + 1 };
    });
  }

  @Post("lab-orders/:id/transition")
  @HttpCode(200)
  @Require("lab.write")
  transition(@Ctx() ctx: RequestContext, @Param("id", id) oid: string, @Body() body: unknown) {
    const i = parse(LabTransition, body);
    if ((i.action === "accept" || i.action === "revision") && !ctx.permissions.has("lab.decide")) throw Errors.forbidden();
    if ((i.action === "revision" || i.action === "cancel") && !i.note) throw Errors.validation({ note: i.action === "revision" ? "Revizyon gerekçesi gerekli." : "İptal gerekçesi gerekli." });
    const tr = LAB_TRANSITIONS[i.action];
    return this.db.tx(ctx, async (c) => {
      const o = (await c.query("select *, target_date::text as target_date from lab_orders where id = $1 for update", [oid])).rows[0];
      if (!o) throw Errors.notFound("İş emri");
      if (!tr.from.includes(o.status)) throw new AppError(409, "LAB_INVALID_TRANSITION", `İş emri “${o.status}” aşamasındayken bu işlem yapılamaz.`);
      const target = i.targetDate ?? o.target_date;
      if ((i.action === "send" || i.action === "revision") && !target) throw Errors.validation({ targetDate: "Hedef teslim tarihi gerekli." });
      if (i.action === "send") await activeSupplier(c, o.supplier_id, "lab");
      const set: string[] = ["status = $2", "row_version = row_version + 1", "target_date = $3"];
      if (i.action === "send") set.push("sent_at = now()");
      if (i.action === "receive") set.push("received_at = now()");
      if (i.action === "accept") set.push("accepted_at = now()");
      if (i.action === "revision") set.push("revision_count = revision_count + 1", "received_at = null");
      if (i.action === "cancel") set.push("cancel_reason = $4");
      await c.query(`update lab_orders set ${set.join(", ")} where id = $1`, i.action === "cancel" ? [oid, tr.to, target, i.note] : [oid, tr.to, target]);
      const kind = i.action === "send" ? "sent" : i.action === "receive" ? "received" : i.action === "accept" ? "accepted" : i.action === "revision" ? "revision_requested"
        : i.action === "cancel" ? "cancelled" : "in_production";
      if (target !== o.target_date && i.action !== "revision") await this.event(c, ctx, oid, "target_changed", null, null, `Hedef teslim: ${trDate(o.target_date)} → ${trDate(target)}`);
      await this.event(c, ctx, oid, kind, o.status, tr.to, i.note ?? null);
      if (target !== o.target_date && i.action === "revision") await this.event(c, ctx, oid, "target_changed", null, null, `Yeni hedef teslim (revizyon): ${trDate(target)}`);
      await audit(c, ctx, { action: `lab_order.${i.action}`, entityType: "lab_order", entityId: oid, patientId: o.patient_id,
        changes: { status: { from: o.status, to: tr.to }, ...(i.note ? { note: { from: null, to: i.note } } : {}) } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: `lab_order.${i.action}` });
      return { ok: true, status: tr.to };
    });
  }

  @Post("lab-orders/:id/notes")
  @Require("lab.write")
  note(@Ctx() ctx: RequestContext, @Param("id", id) oid: string, @Body() body: unknown) {
    const i = parse(ReverseInput, { reason: (body as { note?: string })?.note });
    return this.db.tx(ctx, async (c) => {
      const o = (await c.query("select patient_id from lab_orders where id = $1", [oid])).rows[0];
      if (!o) throw Errors.notFound("İş emri");
      await this.event(c, ctx, oid, "note", null, null, i.reason);
      await audit(c, ctx, { action: "lab_order.note", entityType: "lab_order", entityId: oid, patientId: o.patient_id });
      return { ok: true };
    });
  }

  /** Maliyet satırı → laboratuvar carisine borç (aynı transaction). Revizyon maliyeti ilgili revizyon numarasıyla kaydedilir. */
  @Post("lab-orders/:id/costs")
  @Require("lab.cost")
  addCost(@Ctx() ctx: RequestContext, @Param("id", id) oid: string, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response) {
    const i = parse(LabCostCreate, body);
    const k = requireKey(key);
    return this.db.tx(ctx, async (c) => {
      const out = await idempotent(c, ctx, "lab_cost.create", k, { oid, ...i }, async () => {
        const o = (await c.query("select id, order_no, status, revision_count, supplier_id, patient_id from lab_orders where id = $1 for update", [oid])).rows[0];
        if (!o) throw Errors.notFound("İş emri");
        if (o.status === "draft") throw new AppError(409, "LAB_NOT_SENT", "Taslak iş emrine maliyet girilmez; önce laboratuvara gönderin.");
        if (i.stage === "revision" && o.revision_count === 0) throw Errors.validation({ stage: "Bu iş emrinde revizyon yok." });
        const costId = (await c.query("select gen_random_uuid() as id")).rows[0].id as string;
        const billId = await createBill(c, ctx, { supplierId: o.supplier_id, amount: i.amount, description: `İş emri ${o.order_no} · ${i.description}`.slice(0, 200),
          source: "lab_cost", sourceId: costId, at: new Date() });
        await c.query(
          `insert into lab_costs(id, tenant_id, lab_order_id, stage, revision_no, amount, description, supplier_entry_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [costId, ctx.tenantId, oid, i.stage, i.stage === "revision" ? o.revision_count : 0, i.amount, i.description, billId, ctx.userId]);
        await this.event(c, ctx, oid, "cost_added", null, null, `${i.stage === "revision" ? `Revizyon ${o.revision_count}` : i.stage === "extra" ? "Ek" : "İlk iş"} maliyeti`);
        await audit(c, ctx, { action: "lab_cost.create", entityType: "lab_cost", entityId: costId, patientId: o.patient_id,
          changes: { amount: { from: null, to: i.amount }, stage: { from: null, to: i.stage } } });
        return { id: costId };
      });
      if (out.replayed) res.setHeader("Idempotent-Replayed", "true");
      return out.body;
    });
  }

  @Post("lab-costs/:id/reverse")
  @Require("lab.cost")
  reverseCost(@Ctx() ctx: RequestContext, @Param("id", id) cid: string, @Body() body: unknown) {
    const i = parse(ReverseInput, body);
    return this.db.tx(ctx, async (c) => {
      const x = (await c.query("select lc.*, lo.patient_id from lab_costs lc join lab_orders lo on lo.id = lc.lab_order_id where lc.id = $1", [cid])).rows[0];
      if (!x) throw Errors.notFound("Maliyet");
      if (x.reverses_id) throw new AppError(409, "REVERSAL_INVALID", "Ters kayıt yeniden ters çevrilemez.");
      if ((await c.query("select 1 from lab_costs where reverses_id = $1", [cid])).rowCount) throw new AppError(409, "ALREADY_REVERSED", "Bu maliyet zaten ters kayda alınmış.");
      const entryId = await reverseEntry(c, ctx, x.supplier_entry_id, i.reason, true);
      const r = await c.query(
        `insert into lab_costs(tenant_id, lab_order_id, stage, revision_no, amount, description, supplier_entry_id, reverses_id, reason, created_by)
         values ($1,$2,$3,$4,-$5::numeric,$6,$7,$8,$9,$10) returning id, amount::text`,
        [ctx.tenantId, x.lab_order_id, x.stage, x.revision_no, x.amount, `Ters kayıt: ${x.description}`.slice(0, 200), entryId, cid, i.reason, ctx.userId]);
      await this.event(c, ctx, x.lab_order_id, "cost_reversed", null, null, i.reason);
      await audit(c, ctx, { action: "lab_cost.reverse", entityType: "lab_cost", entityId: r.rows[0].id, patientId: x.patient_id,
        changes: { amount: { from: null, to: r.rows[0].amount }, reverses_id: { from: null, to: cid }, reason: { from: null, to: i.reason } } });
      return { id: r.rows[0].id };
    });
  }

  /** Laboratuvar tanımı formu ve listeler için özet sayaçlar. */
  @Get("lab-orders-summary")
  @Require("lab.read")
  summary(@Ctx() ctx: RequestContext) {
    const today = localDate(new Date(), ctx.timezone);
    return this.db.tx(ctx, async (c) => {
      const r = (await c.query(
        `select count(*) filter (where status in ('sent','in_production','revision'))::int as at_lab,
                count(*) filter (where status in ('sent','in_production','revision') and target_date < $1::date)::int as overdue,
                count(*) filter (where status = 'received')::int as awaiting_decision,
                count(*) filter (where status = 'draft')::int as drafts
           from lab_orders`, [today])).rows[0];
      const cost = ctx.permissions.has("lab.cost")
        ? (await c.query("select coalesce(sum(amount), 0)::numeric(14,2)::text as v from lab_costs where created_at >= (date_trunc('month', now() at time zone $1) at time zone $1)", [ctx.timezone])).rows[0].v : undefined;
      return { atLab: r.at_lab, overdue: r.overdue, awaitingDecision: r.awaiting_decision, drafts: r.drafts, ...(cost !== undefined ? { costThisMonth: addMoney("0", cost) } : {}) };
    });
  }
}
