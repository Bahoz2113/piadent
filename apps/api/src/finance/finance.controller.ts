import { Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  CashAccountUpsert, CommissionPayoutCreate, CommissionRuleCreate, ExpenseCreate, ReverseInput, addDays, addMoney, dayRangeUtc, fromMinor, localDate, toMinor,
} from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";
import { activeAccount, cashMovement, checkEventTime, idempotent, requireKey } from "./ledger.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Klinik günleriyle [from, to] (dahil) → UTC [başlangıç, bitiş). Gün sınırı klinik saat dilimindedir (AT-19). */
function range(ctx: RequestContext, from?: string, to?: string, maxDays = 92) {
  const today = localDate(new Date(), ctx.timezone);
  const f = from ?? today;
  const t = to ?? f;
  if (!DATE.test(f) || !DATE.test(t) || t < f) throw Errors.validation({ from: "Geçerli bir tarih aralığı seçin." });
  if (addDays(f, maxDays - 1) < t) throw Errors.validation({ to: `En fazla ${maxDays} gün seçilebilir.` });
  return { from: f, to: t, fromUtc: dayRangeUtc(f, ctx.timezone).from, toUtc: dayRangeUtc(t, ctx.timezone).to };
}
const sum = (xs: string[]) => addMoney("0", ...xs);

@Controller()
export class FinanceController {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ------------------------------------------------------------ kasa / banka hesapları
  @Get("cash-accounts")
  @Require("account.read")
  accounts(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query("select id, name, kind, currency, active from cash_accounts order by active desc, kind, name");
      return { items: r.rows };
    });
  }

  @Post("cash-accounts")
  @Require("finance.settings")
  createAccount(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(CashAccountUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const r = await c.query("insert into cash_accounts(tenant_id, name, kind) values ($1,$2,$3) returning id", [ctx.tenantId, i.name, i.kind]);
      await audit(c, ctx, { action: "cash_account.create", entityType: "cash_account", entityId: r.rows[0].id, changes: { name: { from: null, to: i.name }, kind: { from: null, to: i.kind } } });
      return { id: r.rows[0].id };
    });
  }

  @Patch("cash-accounts/:id")
  @Require("finance.settings")
  updateAccount(@Ctx() ctx: RequestContext, @Param("id", id) aid: string, @Body() body: unknown) {
    const i = parse(CashAccountUpsert, body);
    return this.db.tx(ctx, async (c) => {
      const old = (await c.query("select name, kind, active from cash_accounts where id = $1", [aid])).rows[0];
      if (!old) throw Errors.notFound("Kasa");
      if (old.kind !== i.kind && (await c.query("select 1 from cash_movements where cash_account_id = $1 limit 1", [aid])).rowCount) {
        throw new AppError(409, "IMMUTABLE_FIELD", "Hareketi olan hesabın türü değiştirilemez.");
      }
      await c.query("update cash_accounts set name = $2, kind = $3, active = $4 where id = $1", [aid, i.name, i.kind, i.active ?? old.active]);
      await audit(c, ctx, { action: "cash_account.update", entityType: "cash_account", entityId: aid,
        changes: { name: { from: old.name, to: i.name }, active: { from: old.active, to: i.active ?? old.active } } });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ gider
  @Get("expenses")
  @Require("finance.read")
  expenses(@Ctx() ctx: RequestContext, @Query("from") from?: string, @Query("to") to?: string) {
    const r0 = range(ctx, from, to);
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select e.id, e.category, e.description, e.amount::text, e.occurred_at, e.reverses_id, ca.name as account_name, u.full_name as by,
                exists (select 1 from expenses x where x.reverses_id = e.id) as reversed
           from expenses e join cash_accounts ca on ca.id = e.cash_account_id join users u on u.id = e.created_by
          where e.occurred_at >= $1 and e.occurred_at < $2 order by e.occurred_at desc`,
        [r0.fromUtc, r0.toUtc],
      );
      return { items: r.rows.map((e) => ({ id: e.id, category: e.category, description: e.description, amount: e.amount, occurredAt: e.occurred_at,
        reversesId: e.reverses_id, reversed: e.reversed, accountName: e.account_name, by: e.by })), total: sum(r.rows.map((e) => e.amount)) };
    });
  }

  @Post("expenses")
  @Require("expense.write")
  createExpense(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(ExpenseCreate, body);
    const k = requireKey(key);
    const at = checkEventTime(i.occurredAt, "occurredAt");
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "expense.create", k, i, async () => {
        await activeAccount(c, i.cashAccountId);
        const e = await c.query(
          "insert into expenses(tenant_id, category, description, amount, cash_account_id, occurred_at, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
          [ctx.tenantId, i.category, i.description, i.amount, i.cashAccountId, at, ctx.userId],
        );
        await cashMovement(c, ctx, { accountId: i.cashAccountId, amount: `-${i.amount}`, source: "expense", sourceId: e.rows[0].id, at });
        await audit(c, ctx, { action: "expense.create", entityType: "expense", entityId: e.rows[0].id, changes: { amount: { from: null, to: i.amount }, category: { from: null, to: i.category } } });
        return { id: e.rows[0].id as string };
      });
      if (r.replayed) res.setHeader("Idempotent-Replayed", "true");
      return r.body;
    });
  }

  /** Gider silinmez; aynı tutarda ters kayıt (negatif gider + kasaya giriş) oluşturulur. */
  @Post("expenses/:id/reverse")
  @Require("expense.write")
  reverseExpense(@Ctx() ctx: RequestContext, @Param("id", id) eid: string, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const k = requireKey(key);
    return this.db.tx(ctx, async (c) => {
      const r = await idempotent(c, ctx, "expense.reverse", k, { eid }, async () => {
        const e = (await c.query("select * from expenses where id = $1", [eid])).rows[0]; // çift ters kayıt: expenses_reverse_uq tekil indeksi
        if (!e) throw Errors.notFound("Gider");
        if (Number(e.amount) < 0) throw new AppError(409, "EXPENSE_IS_REVERSAL", "Ters kayıt yeniden ters çevrilemez.");
        if ((await c.query("select 1 from expenses where reverses_id = $1", [eid])).rowCount) throw new AppError(409, "EXPENSE_ALREADY_REVERSED", "Bu gider zaten ters kayda alınmış.");
        const at = new Date();
        const x = await c.query(
          `insert into expenses(tenant_id, category, description, amount, cash_account_id, occurred_at, reverses_id, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [ctx.tenantId, e.category, `Ters kayıt: ${e.description}`.slice(0, 200), `-${e.amount}`, e.cash_account_id, at, eid, ctx.userId],
        );
        await cashMovement(c, ctx, { accountId: e.cash_account_id, amount: e.amount, source: "expense", sourceId: x.rows[0].id, at });
        await audit(c, ctx, { action: "expense.reverse", entityType: "expense", entityId: x.rows[0].id, changes: { reverses_id: { from: null, to: eid } } });
        return { id: x.rows[0].id as string };
      });
      if (r.replayed) res.setHeader("Idempotent-Replayed", "true");
      return r.body;
    });
  }

  // ------------------------------------------------------------ özet: işlem ≠ tahsilat (AT-19, R11)
  @Get("finance/summary")
  @Require("finance.read")
  summary(@Ctx() ctx: RequestContext, @Query("from") from?: string, @Query("to") to?: string) {
    const r0 = range(ctx, from, to);
    const tz = ctx.timezone;
    const args = [r0.fromUtc, r0.toUtc, tz];
    return this.db.tx(ctx, async (c) => {
      const proc = await c.query(
        `select pp.id, pp.completed_at as at, (pp.completed_at at time zone $3)::date::text as day, pp.procedure_code || ' · ' || pp.procedure_name as label,
                p.id as patient_id, p.first_name || ' ' || p.last_name as patient, pr.display_name as practitioner, pp.amount::text, pp.status
           from performed_procedures pp join patients p on p.id = pp.patient_id join practitioners pr on pr.id = pp.practitioner_id
          where pp.completed_at >= $1 and pp.completed_at < $2 order by pp.completed_at`, args);
      const pay = await c.query(
        `select x.id, x.paid_at as at, (x.paid_at at time zone $3)::date::text as day, x.method, ca.name as account,
                p.id as patient_id, p.first_name || ' ' || p.last_name as patient, x.amount::text
           from payments x join patients p on p.id = x.patient_id join cash_accounts ca on ca.id = x.cash_account_id
          where x.paid_at >= $1 and x.paid_at < $2 order by x.paid_at`, args);
      const ref = await c.query(
        `select f.id, f.refunded_at as at, (f.refunded_at at time zone $3)::date::text as day, f.method, f.reason,
                p.id as patient_id, p.first_name || ' ' || p.last_name as patient, f.amount::text
           from refunds f join payments x on x.id = f.payment_id join patients p on p.id = x.patient_id
          where f.refunded_at >= $1 and f.refunded_at < $2 order by f.refunded_at`, args);
      const exp = await c.query(
        `select e.id, e.occurred_at as at, (e.occurred_at at time zone $3)::date::text as day, e.category, e.description, e.amount::text
           from expenses e where e.occurred_at >= $1 and e.occurred_at < $2 order by e.occurred_at`, args);

      const completed = proc.rows.filter((x) => x.status === "completed");
      const notCompleted = proc.rows.filter((x) => x.status !== "completed");
      const byMethod: Record<string, string> = {};
      for (const p of pay.rows) byMethod[p.method] = addMoney(byMethod[p.method] ?? "0", p.amount);
      const days: Record<string, { procedures: string; collections: string; refunds: string; expenses: string }> = {};
      const bump = (day: string, k: "procedures" | "collections" | "refunds" | "expenses", v: string) => {
        days[day] ??= { procedures: "0.00", collections: "0.00", refunds: "0.00", expenses: "0.00" };
        days[day][k] = addMoney(days[day][k], v);
      };
      completed.forEach((x) => bump(x.day, "procedures", x.amount));
      pay.rows.forEach((x) => bump(x.day, "collections", x.amount));
      ref.rows.forEach((x) => bump(x.day, "refunds", x.amount));
      exp.rows.forEach((x) => bump(x.day, "expenses", x.amount));
      const collections = sum(pay.rows.map((x) => x.amount));
      const refunds = sum(ref.rows.map((x) => x.amount));
      return {
        from: r0.from, to: r0.to, timezone: tz, currency: "TRY",
        metrics: {
          procedureAmount: sum(completed.map((x) => x.amount)), procedureCount: completed.length,
          procedureCancelledAmount: sum(notCompleted.map((x) => x.amount)), procedureCancelledCount: notCompleted.length,
          collections, collectionCount: pay.rows.length, refunds, refundCount: ref.rows.length,
          netCollections: fromMinor(toMinor(collections) - toMinor(refunds)),
          expenses: sum(exp.rows.map((x) => x.amount)),
          collectionsByMethod: byMethod,
        },
        days: Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
        rows: {
          procedures: proc.rows.map((x) => ({ id: x.id, at: x.at, label: x.label, patientId: x.patient_id, patient: x.patient, practitioner: x.practitioner, amount: x.amount, status: x.status })),
          collections: pay.rows.map((x) => ({ id: x.id, at: x.at, method: x.method, account: x.account, patientId: x.patient_id, patient: x.patient, amount: x.amount })),
          refunds: ref.rows.map((x) => ({ id: x.id, at: x.at, method: x.method, reason: x.reason, patientId: x.patient_id, patient: x.patient, amount: x.amount })),
          expenses: exp.rows.map((x) => ({ id: x.id, at: x.at, category: x.category, description: x.description, amount: x.amount })),
        },
      };
    });
  }

  // ------------------------------------------------------------ hasta bakiyeleri (R02): açık borç ve avans ayrı, vade yaşlandırması
  @Get("finance/balances")
  @Require("finance.read")
  balances(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const today = localDate(new Date(), ctx.timezone);
      const open = await c.query(
        `select r.patient_id, r.due_date, (r.amount - coalesce((select sum(a.amount) from allocations a where a.receivable_id = r.id), 0))::numeric(14,2)::text as open
           from receivables r where r.status = 'active'`);
      const adv = await c.query(
        `select x.patient_id, sum(x.amount - coalesce(f.s, 0) - coalesce(a.s, 0))::numeric(14,2)::text as advance
           from payments x
           left join lateral (select sum(amount) as s from refunds where payment_id = x.id) f on true
           left join lateral (select sum(amount) as s from allocations where payment_id = x.id) a on true
          group by x.patient_id`);
      const pts = await c.query("select id, first_name || ' ' || last_name as name, file_no from patients");
      const name = new Map(pts.rows.map((p) => [p.id, p]));
      type Row = { patientId: string; patient: string; fileNo: number; openDebt: string; advance: string; aging: Record<string, string> };
      const rows = new Map<string, Row>();
      const get = (pid: string) => {
        if (!rows.has(pid)) rows.set(pid, { patientId: pid, patient: name.get(pid)?.name ?? "?", fileNo: name.get(pid)?.file_no, openDebt: "0.00", advance: "0.00",
          aging: { notDue: "0.00", d0_30: "0.00", d31_60: "0.00", d61_90: "0.00", d90p: "0.00" } });
        return rows.get(pid)!;
      };
      for (const o of open.rows) {
        if (toMinor(o.open) === 0n) continue;
        const row = get(o.patient_id);
        row.openDebt = addMoney(row.openDebt, o.open);
        const late = Math.round((Date.parse(today) - Date.parse(o.due_date)) / 86_400_000);
        const b = late < 0 ? "notDue" : late <= 30 ? "d0_30" : late <= 60 ? "d31_60" : late <= 90 ? "d61_90" : "d90p";
        row.aging[b] = addMoney(row.aging[b]!, o.open);
      }
      for (const a of adv.rows) if (toMinor(a.advance) !== 0n) get(a.patient_id).advance = a.advance;
      const items = [...rows.values()].sort((a, b) => Number(toMinor(b.openDebt) - toMinor(a.openDebt)));
      return { items, totals: { openDebt: sum(items.map((i) => i.openDebt)), advance: sum(items.map((i) => i.advance)) } };
    });
  }

  // ------------------------------------------------------------ kasa hareketleri ve bakiyeler
  @Get("finance/cash")
  @Require("finance.read")
  cash(@Ctx() ctx: RequestContext, @Query("from") from?: string, @Query("to") to?: string) {
    const r0 = range(ctx, from, to);
    return this.db.tx(ctx, async (c) => {
      const accts = await c.query(
        `select ca.id, ca.name, ca.kind, ca.active,
                coalesce((select sum(m.amount) from cash_movements m where m.cash_account_id = ca.id and m.occurred_at < $1), 0)::numeric(14,2)::text as opening,
                coalesce((select sum(m.amount) from cash_movements m where m.cash_account_id = ca.id and m.occurred_at >= $1 and m.occurred_at < $2 and m.amount > 0), 0)::numeric(14,2)::text as inflow,
                coalesce((select sum(m.amount) from cash_movements m where m.cash_account_id = ca.id and m.occurred_at >= $1 and m.occurred_at < $2 and m.amount < 0), 0)::numeric(14,2)::text as outflow
           from cash_accounts ca order by ca.kind, ca.name`, [r0.fromUtc, r0.toUtc]);
      const mv = await c.query(
        `select m.id, m.cash_account_id, m.amount::text, m.source, m.source_id, m.occurred_at,
                case m.source
                  when 'payment' then (select 'Tahsilat · ' || p.first_name || ' ' || p.last_name from payments x join patients p on p.id = x.patient_id where x.id = m.source_id)
                  when 'refund' then (select 'İade · ' || p.first_name || ' ' || p.last_name from refunds f join payments x on x.id = f.payment_id join patients p on p.id = x.patient_id where f.id = m.source_id)
                  when 'supplier_payment' then (select 'Tedarikçi ödemesi · ' || s.name from supplier_entries se join suppliers s on s.id = se.supplier_id where se.id = m.source_id)
                  when 'commission_payout' then (select 'Prim ödemesi · ' || pr.display_name from commission_payouts y join practitioners pr on pr.id = y.practitioner_id where y.id = m.source_id)
                  else (select 'Gider · ' || e.category || ' · ' || e.description from expenses e where e.id = m.source_id) end as label
           from cash_movements m where m.occurred_at >= $1 and m.occurred_at < $2 order by m.occurred_at`, [r0.fromUtc, r0.toUtc]);
      return {
        from: r0.from, to: r0.to,
        accounts: accts.rows.map((a) => ({ id: a.id, name: a.name, kind: a.kind, active: a.active, opening: a.opening, inflow: a.inflow, outflow: a.outflow,
          closing: addMoney(a.opening, a.inflow, a.outflow) })),
        movements: mv.rows.map((m) => ({ id: m.id, accountId: m.cash_account_id, amount: m.amount, source: m.source, at: m.occurred_at, label: m.label })),
      };
    });
  }

  // ------------------------------------------------------------ prim kuralı sürümleri ve tahakkuk (AT-10)
  @Get("commission-rules")
  @Require("finance.read")
  rules(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select cr.id, cr.practitioner_id, pr.display_name, cr.basis, cr.rate::text, cr.valid_from, cr.note, cr.created_at, u.full_name as by
           from commission_rule_versions cr left join practitioners pr on pr.id = cr.practitioner_id join users u on u.id = cr.created_by
          order by cr.valid_from desc, cr.created_at desc`);
      return { items: r.rows.map((x) => ({ id: x.id, practitionerId: x.practitioner_id, practitionerName: x.display_name, basis: x.basis, rate: x.rate,
        validFrom: x.valid_from, note: x.note, createdAt: x.created_at, by: x.by })) };
    });
  }

  /** Yeni kural sürümü yalnız ileriye uygulanır: geçerlilik tarihi bugünden önce olamaz; mevcut tahakkuklar değişmez. */
  @Post("commission-rules")
  @Require("finance.settings")
  createRule(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(CommissionRuleCreate, body);
    const today = localDate(new Date(), ctx.timezone);
    if (i.validFrom < today) throw Errors.validation({ validFrom: "Prim kuralı geriye dönük başlatılamaz; bugün veya sonrası seçin." });
    return this.db.tx(ctx, async (c) => {
      if (i.practitionerId && !(await c.query("select 1 from practitioners where id = $1", [i.practitionerId])).rowCount) throw Errors.validation({ practitionerId: "Hekim bulunamadı." });
      const dup = await c.query("select 1 from commission_rule_versions where valid_from = $1 and practitioner_id is not distinct from $2", [i.validFrom, i.practitionerId ?? null]);
      if (dup.rowCount) throw new AppError(409, "RULE_EXISTS", "Bu hekim (veya tüm hekimler) için aynı tarihte başlayan bir kural zaten var; başka bir tarih seçin.");
      const r = await c.query(
        "insert into commission_rule_versions(tenant_id, practitioner_id, basis, rate, valid_from, note, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [ctx.tenantId, i.practitionerId ?? null, i.basis, i.rate, i.validFrom, i.note ?? null, ctx.userId],
      );
      await audit(c, ctx, { action: "commission_rule.create", entityType: "commission_rule_version", entityId: r.rows[0].id,
        changes: { basis: { from: null, to: i.basis }, rate: { from: null, to: i.rate }, valid_from: { from: null, to: i.validFrom }, practitioner_id: { from: null, to: i.practitionerId ?? null } } });
      return { id: r.rows[0].id };
    });
  }

  @Get("commissions")
  @Require("finance.read")
  commissions(@Ctx() ctx: RequestContext, @Query("from") from?: string, @Query("to") to?: string) {
    const r0 = range(ctx, from, to, 366);
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select ac.id, ac.practitioner_id, pr.display_name, ac.basis, ac.base_amount::text, ac.rate::text, ac.amount::text, ac.reverses_id, ac.created_at,
                p.id as patient_id, p.first_name || ' ' || p.last_name as patient, coalesce(rv.description, pp.procedure_code || ' · ' || pp.procedure_name) as description
           from commission_accruals ac join practitioners pr on pr.id = ac.practitioner_id
           left join allocations a on a.id = ac.allocation_id left join receivables rv on rv.id = a.receivable_id
           left join performed_procedures pp on pp.id = ac.performed_procedure_id
           join patients p on p.id = coalesce(rv.patient_id, pp.patient_id)
          where ac.created_at >= $1 and ac.created_at < $2 order by ac.created_at`, [r0.fromUtc, r0.toUtc]);
      // Ödenecek bakiye tüm zamanlar üzerinden: net tahakkuk − ödenen prim (dönem süzgecinden bağımsız).
      const bal = await c.query(
        `select pr.id, pr.display_name,
                coalesce((select sum(amount) from commission_accruals x where x.practitioner_id = pr.id), 0)::numeric(14,2)::text as accrued_all,
                coalesce((select sum(amount) from commission_payouts y where y.practitioner_id = pr.id), 0)::numeric(14,2)::text as paid_all,
                coalesce((select sum(amount) from commission_payouts y where y.practitioner_id = pr.id and y.paid_at >= $1 and y.paid_at < $2), 0)::numeric(14,2)::text as paid_period
           from practitioners pr`, [r0.fromUtc, r0.toUtc]);
      type G = { practitionerId: string; practitioner: string; accrued: string; reversed: string; net: string; paidPeriod: string; payable: string };
      const by = new Map<string, G>();
      const g0 = (id: string, name: string) => by.get(id) ?? { practitionerId: id, practitioner: name, accrued: "0.00", reversed: "0.00", net: "0.00", paidPeriod: "0.00", payable: "0.00" };
      for (const x of r.rows) {
        const g = g0(x.practitioner_id, x.display_name);
        if (x.reverses_id || toMinor(x.amount) < 0n) g.reversed = addMoney(g.reversed, x.amount); else g.accrued = addMoney(g.accrued, x.amount);
        g.net = addMoney(g.net, x.amount);
        by.set(x.practitioner_id, g);
      }
      for (const b of bal.rows) {
        const payable = fromMinor(toMinor(b.accrued_all) - toMinor(b.paid_all));
        if (toMinor(payable) === 0n && toMinor(b.paid_period) === 0n && !by.has(b.id)) continue;
        const g = g0(b.id, b.display_name);
        g.paidPeriod = b.paid_period; g.payable = payable;
        by.set(b.id, g);
      }
      const payouts = await c.query(
        `select y.id, y.practitioner_id, pr.display_name, y.amount::text, y.period_from::text, y.period_to::text, y.paid_at, y.note, y.reverses_id, y.reason,
                ca.name as account, u.full_name as by,
                exists (select 1 from commission_payouts z where z.reverses_id = y.id) as reversed
           from commission_payouts y join practitioners pr on pr.id = y.practitioner_id join cash_accounts ca on ca.id = y.cash_account_id
           join users u on u.id = y.created_by where y.paid_at >= $1 and y.paid_at < $2 order by y.paid_at`, [r0.fromUtc, r0.toUtc]);
      return { from: r0.from, to: r0.to, groups: [...by.values()],
        rows: r.rows.map((x) => ({ id: x.id, practitioner: x.display_name, basis: x.basis, patientId: x.patient_id, patient: x.patient, description: x.description,
          base: x.base_amount, rate: x.rate, amount: x.amount, reversal: !!x.reverses_id, at: x.created_at })),
        payouts: payouts.rows.map((y) => ({ id: y.id, practitionerId: y.practitioner_id, practitioner: y.display_name, amount: y.amount, periodFrom: y.period_from,
          periodTo: y.period_to, paidAt: y.paid_at, note: y.note, reversal: !!y.reverses_id, reason: y.reason, reversed: y.reversed, account: y.account, by: y.by })) };
    });
  }

  /** Prim ödemesi: kasadan çıkış; hekimin ödenmemiş net tahakkukunu aşamaz (DB tetikleyicisi + kilit). Kazanım ayrı harekettir. */
  @Post("commission-payouts")
  @Require("commission.payout")
  async payout(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(CommissionPayoutCreate, body);
    const k = requireKey(key);
    const at = checkEventTime(i.paidAt, "paidAt");
    return this.db.tx(ctx, async (c) => {
      const out = await idempotent(c, ctx, "commission_payout.create", k, i, async () => {
        if (!(await c.query("select 1 from practitioners where id = $1", [i.practitionerId])).rowCount) throw Errors.validation({ practitionerId: "Hekim bulunamadı." });
        await activeAccount(c, i.cashAccountId);
        const r = await c.query(
          `insert into commission_payouts(tenant_id, practitioner_id, amount, period_from, period_to, cash_account_id, paid_at, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
          [ctx.tenantId, i.practitionerId, i.amount, i.periodFrom ?? null, i.periodTo ?? null, i.cashAccountId, at, i.note ?? null, ctx.userId]);
        await cashMovement(c, ctx, { accountId: i.cashAccountId, amount: `-${i.amount}`, source: "commission_payout", sourceId: r.rows[0].id, at });
        await audit(c, ctx, { action: "commission_payout.create", entityType: "commission_payout", entityId: r.rows[0].id,
          changes: { amount: { from: null, to: i.amount }, practitioner_id: { from: null, to: i.practitionerId } } });
        return { id: r.rows[0].id as string };
      });
      if (out.replayed) res.setHeader("Idempotent-Replayed", "true");
      return out.body;
    });
  }

  @Post("commission-payouts/:id/reverse")
  @Require("commission.payout")
  reversePayout(@Ctx() ctx: RequestContext, @Param("id", id) pid: string, @Body() body: unknown) {
    const i = parse(ReverseInput, body);
    return this.db.tx(ctx, async (c) => {
      const p = (await c.query("select * from commission_payouts where id = $1", [pid])).rows[0];
      if (!p) throw Errors.notFound("Prim ödemesi");
      if (p.reverses_id) throw new AppError(409, "REVERSAL_INVALID", "Ters kayıt yeniden ters çevrilemez.");
      if ((await c.query("select 1 from commission_payouts where reverses_id = $1", [pid])).rowCount) throw new AppError(409, "ALREADY_REVERSED", "Bu ödeme zaten ters kayda alınmış.");
      const r = await c.query(
        `insert into commission_payouts(tenant_id, practitioner_id, amount, period_from, period_to, cash_account_id, paid_at, note, reverses_id, reason, created_by)
         values ($1,$2,-$3::numeric,$4,$5,$6,now(),$7,$8,$9,$10) returning id, amount::text`,
        [ctx.tenantId, p.practitioner_id, p.amount, p.period_from, p.period_to, p.cash_account_id, p.note, pid, i.reason, ctx.userId]);
      await cashMovement(c, ctx, { accountId: p.cash_account_id, amount: fromMinor(-toMinor(r.rows[0].amount)), source: "commission_payout", sourceId: r.rows[0].id, at: new Date() });
      await audit(c, ctx, { action: "commission_payout.reverse", entityType: "commission_payout", entityId: r.rows[0].id,
        changes: { amount: { from: null, to: r.rows[0].amount }, reverses_id: { from: null, to: pid }, reason: { from: null, to: i.reason } } });
      return { id: r.rows[0].id };
    });
  }
}
