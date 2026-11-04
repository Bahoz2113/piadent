/**
 * Hekimler modülü — ürün sahibi geri bildirimi 04.11.2026 madde 8 (ADR-096).
 * Liste (randevu okuyucuları): hekim, çalışma saatleri, bu ayın randevu sayaçları; finans yetkilisine ek olarak ücret modeli ve bakiyeler.
 * Ücret modeli (yalnız prim / sabit maaş / maaş + prim) sürümlüdür ve yalnız ileriye başlatılır (finance.settings).
 * Maaş ödemesi kasadan çıkıştır (commission.payout — prim ödemesiyle aynı yetki), ayın maaş hakedişini aşamaz (DB tetikleyicisi),
 * idempotent'tir ve ters kayıtla düzeltilir. Bordro/SGK/stopaj hesabı kapsam dışıdır.
 */
import { Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CompensationCreate, ReverseInput, SalaryPaymentCreate, fromMinor, localDate, toMinor } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import { has, type RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";
import { activeAccount, cashMovement, checkEventTime, idempotent, requireKey } from "../finance/ledger.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
const monthOf = (d: string) => d.slice(0, 7);
function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const k = (y * 12 + (m - 1)) - (n - 1 - i);
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
  });
}

@Controller()
export class PractitionersController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get("practitioners/overview")
  @Require("appointment.read")
  overview(@Ctx() ctx: RequestContext) {
    const today = localDate(new Date(), ctx.timezone);
    const month = monthOf(today);
    const finance = has(ctx, "finance.read");
    return this.db.tx(ctx, async (c) => {
      const p = await c.query(
        `select p.id, p.display_name, p.title, p.active, u.full_name as member_name
           from practitioners p left join memberships m on m.id = p.membership_id left join users u on u.id = m.user_id
          order by p.active desc, p.display_name`);
      const s = await c.query("select practitioner_id, weekday, start_min, end_min from work_schedules order by weekday, start_min");
      const a = await c.query(
        `select practitioner_id,
                count(*) filter (where status <> 'cancelled')::int as appointments,
                count(*) filter (where status = 'completed')::int as completed,
                count(*) filter (where status = 'no_show')::int as no_show
           from appointments where to_char(starts_at at time zone $1, 'YYYY-MM') = $2 group by practitioner_id`, [ctx.timezone, month]);
      const am = new Map(a.rows.map((r) => [r.practitioner_id, r]));
      const pay = new Map<string, { model: string | null; monthlySalary: string | null; commissionPayable: string; salaryDue: string; salaryPaid: string }>();
      if (finance) {
        const f = await c.query(
          `select pr.id,
                  (select v.pay_model from practitioner_compensation_versions v where v.practitioner_id = pr.id and v.valid_from <= $1 order by v.valid_from desc, v.created_at desc limit 1) as model,
                  (select v.monthly_salary::text from practitioner_compensation_versions v where v.practitioner_id = pr.id and v.valid_from <= $1 order by v.valid_from desc, v.created_at desc limit 1) as salary,
                  (coalesce((select sum(amount) from commission_accruals x where x.practitioner_id = pr.id), 0)
                   - coalesce((select sum(amount) from commission_payouts y where y.practitioner_id = pr.id), 0))::numeric(14,2)::text as payable,
                  app.salary_due(pr.id, $2::date)::numeric(14,2)::text as due,
                  coalesce((select sum(amount) from salary_payments z where z.practitioner_id = pr.id and z.period = $2::date), 0)::numeric(14,2)::text as paid
             from practitioners pr`, [today, `${month}-01`]);
        for (const r of f.rows) pay.set(r.id, { model: r.model, monthlySalary: r.salary, commissionPayable: r.payable, salaryDue: r.due, salaryPaid: r.paid });
      }
      return {
        month,
        items: p.rows.map((r) => {
          const blocks = s.rows.filter((x) => x.practitioner_id === r.id).map((x) => ({ weekday: x.weekday, start: x.start_min, end: x.end_min }));
          const m = am.get(r.id);
          return {
            id: r.id, name: r.display_name, title: r.title, active: r.active, memberName: r.member_name, schedule: blocks,
            weeklyMinutes: blocks.reduce((t, b) => t + (b.end - b.start), 0),
            month: { appointments: m?.appointments ?? 0, completed: m?.completed ?? 0, noShow: m?.no_show ?? 0 },
            pay: finance ? pay.get(r.id) ?? null : null,
          };
        }),
      };
    });
  }

  @Get("practitioners/:id/compensation")
  @Require("finance.read")
  compensation(@Ctx() ctx: RequestContext, @Param("id", id) pid: string) {
    const today = localDate(new Date(), ctx.timezone);
    const months = lastMonths(today, 12);
    return this.db.tx(ctx, async (c) => {
      const pr = (await c.query("select id, display_name from practitioners where id = $1", [pid])).rows[0];
      if (!pr) throw Errors.notFound("Hekim");
      const versions = (await c.query(
        `select v.id, v.pay_model, v.monthly_salary::text, v.valid_from::text, v.note, v.created_at, u.full_name as by
           from practitioner_compensation_versions v join users u on u.id = v.created_by where v.practitioner_id = $1
          order by v.valid_from desc, v.created_at desc`, [pid])).rows;
      const current = versions.find((v) => v.valid_from <= today) ?? null;
      const rules = (await c.query(
        `select cr.id, cr.practitioner_id, cr.basis, cr.rate::text, cr.valid_from::text, cr.note
           from commission_rule_versions cr where cr.practitioner_id = $1 or cr.practitioner_id is null
          order by cr.valid_from desc, cr.created_at desc`, [pid])).rows;
      const monthly = (await c.query(
        `with m as (select unnest($2::text[]) as mo)
         select m.mo,
                app.salary_due($1, (m.mo || '-01')::date)::numeric(14,2)::text as salary_due,
                coalesce((select sum(z.amount) from salary_payments z where z.practitioner_id = $1 and z.period = (m.mo || '-01')::date), 0)::numeric(14,2)::text as salary_paid,
                coalesce((select sum(x.amount) from commission_accruals x where x.practitioner_id = $1 and to_char(x.created_at at time zone $3, 'YYYY-MM') = m.mo), 0)::numeric(14,2)::text as commission_accrued,
                coalesce((select sum(y.amount) from commission_payouts y where y.practitioner_id = $1 and to_char(y.paid_at at time zone $3, 'YYYY-MM') = m.mo), 0)::numeric(14,2)::text as commission_paid
           from m order by m.mo`, [pid, months, ctx.timezone])).rows;
      const totals = (await c.query(
        `select coalesce((select sum(amount) from commission_accruals where practitioner_id = $1), 0)::numeric(14,2)::text as accrued,
                coalesce((select sum(amount) from commission_payouts where practitioner_id = $1), 0)::numeric(14,2)::text as paid,
                coalesce((select sum(app.salary_due($1, g::date) - coalesce((select sum(z.amount) from salary_payments z where z.practitioner_id = $1 and z.period = g::date), 0))
                            from generate_series(date_trunc('month', (select min(valid_from) from practitioner_compensation_versions where practitioner_id = $1 and pay_model <> 'commission')),
                                                 $2::date, interval '1 month') g), 0)::numeric(14,2)::text as salary_outstanding`,
        [pid, `${monthOf(today)}-01`])).rows[0];
      const salaryPayments = (await c.query(
        `select y.id, to_char(y.period, 'YYYY-MM') as period, y.amount::text, y.paid_at, y.note, y.reverses_id, y.reason, ca.name as account, u.full_name as by,
                exists (select 1 from salary_payments z where z.reverses_id = y.id) as reversed
           from salary_payments y join cash_accounts ca on ca.id = y.cash_account_id join users u on u.id = y.created_by
          where y.practitioner_id = $1 order by y.paid_at desc, y.created_at desc limit 100`, [pid])).rows;
      const payouts = (await c.query(
        `select y.id, y.amount::text, y.paid_at, y.note, y.reverses_id, ca.name as account
           from commission_payouts y join cash_accounts ca on ca.id = y.cash_account_id where y.practitioner_id = $1 order by y.paid_at desc limit 100`, [pid])).rows;
      return {
        practitioner: { id: pr.id, name: pr.display_name },
        current: current ? { payModel: current.pay_model, monthlySalary: current.monthly_salary, validFrom: current.valid_from } : null,
        versions: versions.map((v) => ({ id: v.id, payModel: v.pay_model, monthlySalary: v.monthly_salary, validFrom: v.valid_from, note: v.note, createdAt: v.created_at, by: v.by,
          state: v.valid_from > today ? "scheduled" : v === current ? "current" : "superseded" })),
        rules: rules.map((r) => ({ id: r.id, scope: r.practitioner_id ? "practitioner" : "clinic", basis: r.basis, rate: r.rate, validFrom: r.valid_from, note: r.note })),
        months: monthly.map((r) => ({ month: r.mo, salaryDue: r.salary_due, salaryPaid: r.salary_paid,
          salaryRemaining: fromMinor(toMinor(r.salary_due) - toMinor(r.salary_paid)), commissionAccrued: r.commission_accrued, commissionPaid: r.commission_paid })),
        totals: { commissionAccrued: totals.accrued, commissionPaid: totals.paid, commissionPayable: fromMinor(toMinor(totals.accrued) - toMinor(totals.paid)),
          salaryOutstanding: totals.salary_outstanding },
        salaryPayments: salaryPayments.map((y) => ({ id: y.id, period: y.period, amount: y.amount, paidAt: y.paid_at, note: y.note, reversal: !!y.reverses_id,
          reason: y.reason, reversed: y.reversed, account: y.account, by: y.by })),
        commissionPayouts: payouts.map((y) => ({ id: y.id, amount: y.amount, paidAt: y.paid_at, note: y.note, reversal: !!y.reverses_id, account: y.account })),
      };
    });
  }

  /** Yeni ücret modeli sürümü: geçerlilik bugünden önce olamaz; mevcut tahakkuk ve ödemeler değişmez. */
  @Post("practitioners/:id/compensation")
  @Require("finance.settings")
  createCompensation(@Ctx() ctx: RequestContext, @Param("id", id) pid: string, @Body() body: unknown) {
    const i = parse(CompensationCreate, body);
    const today = localDate(new Date(), ctx.timezone);
    if (i.validFrom < today) throw Errors.validation({ validFrom: "Ücret modeli geriye dönük başlatılamaz; bugün veya sonrası seçin." });
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from practitioners where id = $1", [pid])).rowCount) throw Errors.notFound("Hekim");
      if ((await c.query("select 1 from practitioner_compensation_versions where practitioner_id = $1 and valid_from = $2", [pid, i.validFrom])).rowCount)
        throw new AppError(409, "COMPENSATION_EXISTS", "Bu hekim için aynı tarihte başlayan bir ücret modeli zaten var; başka bir tarih seçin.");
      const r = await c.query(
        `insert into practitioner_compensation_versions(tenant_id, practitioner_id, pay_model, monthly_salary, valid_from, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [ctx.tenantId, pid, i.payModel, i.payModel === "commission" ? null : i.monthlySalary, i.validFrom, i.note ?? null, ctx.userId]);
      await audit(c, ctx, { action: "compensation.create", entityType: "practitioner_compensation", entityId: r.rows[0].id,
        changes: { pay_model: { from: null, to: i.payModel }, monthly_salary: { from: null, to: i.payModel === "commission" ? null : i.monthlySalary },
          valid_from: { from: null, to: i.validFrom }, practitioner_id: { from: null, to: pid } } });
      return { id: r.rows[0].id };
    });
  }

  @Post("salary-payments")
  @Require("commission.payout")
  async salaryPayment(@Ctx() ctx: RequestContext, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const i = parse(SalaryPaymentCreate, body);
    const k = requireKey(key);
    const at = checkEventTime(i.paidAt, "paidAt");
    if (i.period > monthOf(localDate(new Date(), ctx.timezone))) throw Errors.validation({ period: "Gelecek ayın maaşı ödenemez; bu ay veya önceki bir ay seçin." });
    return this.db.tx(ctx, async (c) => {
      const out = await idempotent(c, ctx, "salary_payment.create", k, i, async () => {
        if (!(await c.query("select 1 from practitioners where id = $1", [i.practitionerId])).rowCount) throw Errors.validation({ practitionerId: "Hekim bulunamadı." });
        await activeAccount(c, i.cashAccountId);
        const r = await c.query(
          `insert into salary_payments(tenant_id, practitioner_id, period, amount, cash_account_id, paid_at, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [ctx.tenantId, i.practitionerId, `${i.period}-01`, i.amount, i.cashAccountId, at, i.note ?? null, ctx.userId]);
        await cashMovement(c, ctx, { accountId: i.cashAccountId, amount: `-${i.amount}`, source: "salary_payment", sourceId: r.rows[0].id, at });
        await audit(c, ctx, { action: "salary_payment.create", entityType: "salary_payment", entityId: r.rows[0].id,
          changes: { amount: { from: null, to: i.amount }, period: { from: null, to: i.period }, practitioner_id: { from: null, to: i.practitionerId } } });
        return { id: r.rows[0].id as string };
      });
      if (out.replayed) res.setHeader("Idempotent-Replayed", "true");
      return out.body;
    });
  }

  @Post("salary-payments/:id/reverse")
  @Require("commission.payout")
  reverseSalary(@Ctx() ctx: RequestContext, @Param("id", id) sid: string, @Body() body: unknown) {
    const i = parse(ReverseInput, body);
    return this.db.tx(ctx, async (c) => {
      const p = (await c.query("select * from salary_payments where id = $1", [sid])).rows[0];
      if (!p) throw Errors.notFound("Maaş ödemesi");
      if (p.reverses_id) throw new AppError(409, "REVERSAL_INVALID", "Ters kayıt yeniden ters çevrilemez.");
      if ((await c.query("select 1 from salary_payments where reverses_id = $1", [sid])).rowCount) throw new AppError(409, "ALREADY_REVERSED", "Bu ödeme zaten ters kayda alınmış.");
      const r = await c.query(
        `insert into salary_payments(tenant_id, practitioner_id, period, amount, cash_account_id, paid_at, note, reverses_id, reason, created_by)
         values ($1,$2,$3,-$4::numeric,$5,now(),$6,$7,$8,$9) returning id, amount::text`,
        [ctx.tenantId, p.practitioner_id, p.period, p.amount, p.cash_account_id, p.note, sid, i.reason, ctx.userId]);
      await cashMovement(c, ctx, { accountId: p.cash_account_id, amount: fromMinor(-toMinor(r.rows[0].amount)), source: "salary_payment", sourceId: r.rows[0].id, at: new Date() });
      await audit(c, ctx, { action: "salary_payment.reverse", entityType: "salary_payment", entityId: r.rows[0].id,
        changes: { amount: { from: null, to: r.rows[0].amount }, reverses_id: { from: null, to: sid }, reason: { from: null, to: i.reason } } });
      return { id: r.rows[0].id };
    });
  }
}
