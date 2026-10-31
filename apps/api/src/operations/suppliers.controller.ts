import { Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { ReverseInput, SupplierBillCreate, SupplierPaymentCreate, SupplierUpsert, addDays, addMoney, dayRangeUtc, fromMinor, localDate, toMinor } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit, diff } from "../audit/audit.js";
import { activeAccount, checkEventTime, idempotent, requireKey } from "../finance/ledger.js";
import { activeSupplier, createBill, createSupplierPayment, reverseEntry } from "./cari.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

@Controller()
export class SuppliersController {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** Laboratuvar/tedarikçi listesi. İletişim ayrıntısı yalnız tanım yetkisiyle döner. */
  @Get("suppliers")
  @Require("lab.read")
  list(@Ctx() ctx: RequestContext, @Query("kind") kind?: string) {
    const full = ctx.permissions.has("supplier.manage");
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select id, kind, name, contact_name, phone, email, tax_no, note, active, created_at from suppliers
          where ($1::text is null or kind = $1) order by active desc, name`, [kind && ["lab", "medical", "other"].includes(kind) ? kind : null]);
      return { items: r.rows.map((s) => ({ id: s.id, kind: s.kind, name: s.name, active: s.active,
        ...(full ? { contactName: s.contact_name, phone: s.phone, email: s.email, taxNo: s.tax_no, note: s.note } : {}) })) };
    });
  }

  @Post("suppliers")
  @Require("supplier.manage")
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(SupplierUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `insert into suppliers(tenant_id, kind, name, contact_name, phone, email, tax_no, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [ctx.tenantId, i.kind, i.name, i.contactName ?? null, i.phone ?? null, i.email ?? null, i.taxNo ?? null, i.note ?? null, ctx.userId]);
      await audit(c, ctx, { action: "supplier.create", entityType: "supplier", entityId: r.rows[0].id, changes: { kind: { from: null, to: i.kind }, name: { from: null, to: i.name } } });
      return { id: r.rows[0].id };
    });
  }

  @Patch("suppliers/:id")
  @Require("supplier.manage")
  update(@Ctx() ctx: RequestContext, @Param("id", id) sid: string, @Body() body: unknown) {
    const i = parse(SupplierUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const old = (await c.query("select kind, name, contact_name, phone, email, tax_no, note, active from suppliers where id = $1", [sid])).rows[0];
      if (!old) throw Errors.notFound("Tedarikçi");
      if (old.kind !== i.kind && (await c.query("select 1 from lab_orders where supplier_id = $1 limit 1", [sid])).rowCount) {
        throw new AppError(409, "IMMUTABLE_FIELD", "İş emri bağlı laboratuvarın türü değiştirilemez.");
      }
      const next = { kind: i.kind, name: i.name, contact_name: i.contactName ?? null, phone: i.phone ?? null, email: i.email ?? null, tax_no: i.taxNo ?? null,
        note: i.note ?? null, active: i.active ?? old.active };
      await c.query(`update suppliers set kind = $2, name = $3, contact_name = $4, phone = $5, email = $6, tax_no = $7, note = $8, active = $9 where id = $1`,
        [sid, next.kind, next.name, next.contact_name, next.phone, next.email, next.tax_no, next.note, next.active]);
      await audit(c, ctx, { action: "supplier.update", entityType: "supplier", entityId: sid,
        changes: diff(old, next, ["kind", "name", "contact_name", "phone", "email", "tax_no", "note", "active"]) });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ cari
  @Get("supplier-balances")
  @Require("finance.read")
  balances(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select s.id, s.kind, s.name, s.active,
                coalesce(sum(e.amount) filter (where e.kind = 'bill'), 0)::numeric(14,2)::text as billed,
                coalesce(sum(e.amount) filter (where e.kind = 'payment'), 0)::numeric(14,2)::text as paid,
                (coalesce(sum(e.amount) filter (where e.kind = 'bill'), 0) - coalesce(sum(e.amount) filter (where e.kind = 'payment'), 0))::numeric(14,2)::text as balance
           from suppliers s left join supplier_entries e on e.supplier_id = s.id group by s.id order by s.name`);
      const items = r.rows.map((x) => ({ id: x.id, kind: x.kind, name: x.name, active: x.active, billed: x.billed, paid: x.paid, balance: x.balance }));
      return { items, totals: { billed: addMoney("0", ...items.map((x) => x.billed)), paid: addMoney("0", ...items.map((x) => x.paid)), balance: addMoney("0", ...items.map((x) => x.balance)) } };
    });
  }

  @Get("suppliers/:id/ledger")
  @Require("finance.read")
  ledger(@Ctx() ctx: RequestContext, @Param("id", id) sid: string, @Query("from") from?: string, @Query("to") to?: string) {
    const today = localDate(new Date(), ctx.timezone);
    const f = from && DATE.test(from) ? from : addDays(today, -89);
    const t = to && DATE.test(to) ? to : today;
    if (t < f) throw Errors.validation({ from: "Geçerli bir tarih aralığı seçin." });
    const fromUtc = dayRangeUtc(f, ctx.timezone).from, toUtc = dayRangeUtc(t, ctx.timezone).to;
    return this.db.tx(ctx, async (c) => {
      const s = (await c.query("select id, kind, name from suppliers where id = $1", [sid])).rows[0];
      if (!s) throw Errors.notFound("Tedarikçi");
      const open = (await c.query(
        `select coalesce(sum(case when kind = 'bill' then amount else -amount end), 0)::numeric(14,2)::text as v from supplier_entries where supplier_id = $1 and occurred_at < $2`, [sid, fromUtc])).rows[0].v;
      const rows = await c.query(
        `select e.id, e.kind, e.amount::text, e.description, e.document_no, e.source, e.source_id, e.occurred_at, e.reverses_id, e.reason, ca.name as account, u.full_name as by,
                exists (select 1 from supplier_entries z where z.reverses_id = e.id) as reversed,
                (select lo.order_no from lab_costs lc join lab_orders lo on lo.id = lc.lab_order_id where e.source = 'lab_cost' and lc.id = e.source_id) as lab_order_no,
                (select lc.lab_order_id from lab_costs lc where e.source = 'lab_cost' and lc.id = e.source_id) as lab_order_id
           from supplier_entries e left join cash_accounts ca on ca.id = e.cash_account_id join users u on u.id = e.created_by
          where e.supplier_id = $1 and e.occurred_at >= $2 and e.occurred_at < $3 order by e.occurred_at, e.created_at`, [sid, fromUtc, toUtc]);
      let bal = toMinor(open);
      const entries = rows.rows.map((e) => {
        bal += e.kind === "bill" ? toMinor(e.amount) : -toMinor(e.amount);
        return { id: e.id, kind: e.kind, amount: e.amount, description: e.description, documentNo: e.document_no, source: e.source, at: e.occurred_at,
          reversal: !!e.reverses_id, reversed: e.reversed, reason: e.reason, account: e.account, by: e.by, labOrderNo: e.lab_order_no, labOrderId: e.lab_order_id,
          balanceAfter: fromMinor(bal) };
      });
      const billed = addMoney("0", ...entries.filter((e) => e.kind === "bill").map((e) => e.amount));
      const paid = addMoney("0", ...entries.filter((e) => e.kind === "payment").map((e) => e.amount));
      return { supplier: s, from: f, to: t, opening: open, billed, paid, closing: fromMinor(bal), entries };
    });
  }

  @Post("supplier-bills")
  @Require("supplier.ledger")
  bill(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(SupplierBillCreate, body);
    const k = requireKey(key);
    const at = checkEventTime(i.occurredAt, "occurredAt");
    return this.db.tx(ctx, async (c) => {
      const out = await idempotent(c, ctx, "supplier_bill.create", k, i, async () => {
        await activeSupplier(c, i.supplierId);
        return { id: await createBill(c, ctx, { supplierId: i.supplierId, amount: i.amount, description: i.description, documentNo: i.documentNo, source: "manual", at }) };
      });
      if (out.replayed) res.setHeader("Idempotent-Replayed", "true");
      return out.body;
    });
  }

  @Post("supplier-payments")
  @Require("supplier.ledger")
  pay(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(SupplierPaymentCreate, body);
    const k = requireKey(key);
    const at = checkEventTime(i.occurredAt, "occurredAt");
    return this.db.tx(ctx, async (c) => {
      const out = await idempotent(c, ctx, "supplier_payment.create", k, i, async () => {
        await activeSupplier(c, i.supplierId);
        await activeAccount(c, i.cashAccountId);
        return { id: await createSupplierPayment(c, ctx, { supplierId: i.supplierId, amount: i.amount, cashAccountId: i.cashAccountId, description: i.description,
          documentNo: i.documentNo, at }) };
      });
      if (out.replayed) res.setHeader("Idempotent-Replayed", "true");
      return out.body;
    });
  }

  @Post("supplier-entries/:id/reverse")
  @Require("supplier.ledger")
  reverse(@Ctx() ctx: RequestContext, @Param("id", id) eid: string, @Body() body: unknown) {
    const i = parse(ReverseInput, body);
    return this.db.tx(ctx, async (c) => ({ id: await reverseEntry(c, ctx, eid, i.reason) }));
  }
}
