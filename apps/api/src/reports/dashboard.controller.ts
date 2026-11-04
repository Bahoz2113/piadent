/**
 * Panel (ana gösterge) — ürün sahibi geri bildirimi 04.11.2026 (ADR-095). Tek uçta sade özet: bugünün sayaçları ve dört grafik.
 * Rol bazlı: para tutarları (günlük tahsilat, bekleyen tahsilat, aylık gelir) yalnız `finance.read`; tedavi dağılımı `treatment.read`
 * (kategori sayıları; hasta/diş/sağlık içeriği yok). Tanımlar raporlarla aynıdır: tahsilat = ödeme − iade (işlem tarihi), açık borç =
 * etkin alacak − dağıtılan; gelir kâr değildir. Tüm sorgular kiracı bağlamında (RLS), zaman klinik saat diliminde.
 */
import { Controller, Get, Inject } from "@nestjs/common";
import { addDays, dayRangeUtc, localDate } from "@viadent/contracts";
import { Db } from "../infra/db.service.js";
import { Ctx, Require } from "../auth/decorators.js";
import { has, type RequestContext } from "../infra/context.js";

@Controller("dashboard")
export class DashboardController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get()
  @Require("appointment.read")
  summary(@Ctx() ctx: RequestContext) {
    const tz = ctx.timezone;
    const today = localDate(new Date(), tz);
    const { from: todayFrom, to: todayTo } = dayRangeUtc(today, tz);
    const finance = has(ctx, "finance.read");
    const treatment = has(ctx, "treatment.read");
    return this.db.tx(ctx, async (c) => {
      const t = (await c.query(
        `select count(*) filter (where status <> 'cancelled')::int as appointments,
                count(*) filter (where status = 'checked_in')::int as waiting,
                count(*) filter (where status = 'in_progress')::int as in_treatment,
                count(*) filter (where status = 'completed')::int as completed,
                count(*) filter (where status = 'no_show')::int as no_show,
                count(*) filter (where status in ('planned','confirmed') and ends_at < now())::int as past_pending
           from appointments where starts_at >= $1 and starts_at < $2`, [todayFrom, todayTo])).rows[0];
      const prac = (await c.query("select count(*)::int as n from practitioners where active")).rows[0].n as number;

      // Randevu yoğunluğu: son 30 gün (bugün dahil), iptaller hariç, gün gün.
      const densityFrom = addDays(today, -29);
      const density = (await c.query(
        `select to_char((starts_at at time zone $3)::date, 'YYYY-MM-DD') as d, count(*)::int as n
           from appointments where status <> 'cancelled' and starts_at >= $1 and starts_at < $2 group by 1`,
        [dayRangeUtc(densityFrom, tz).from, todayTo, tz])).rows as { d: string; n: number }[];
      const dens = new Map(density.map((r) => [r.d, r.n]));
      const days = Array.from({ length: 30 }, (_, i) => addDays(densityFrom, i)).map((d) => ({ date: d, count: dens.get(d) ?? 0 }));

      // Son 12 ay (bu ay dahil): yeni hasta ve (yetkiliyse) net tahsilat.
      const [y, m] = today.split("-").map(Number) as [number, number];
      const months = Array.from({ length: 12 }, (_, i) => {
        const k = (y * 12 + (m - 1)) - (11 - i);
        return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
      });
      const monthsFrom = dayRangeUtc(`${months[0]}-01`, tz).from;
      const np = new Map(((await c.query(
        `select to_char(created_at at time zone $2, 'YYYY-MM') as mo, count(*)::int as n from patients where created_at >= $1 group by 1`,
        [monthsFrom, tz])).rows as { mo: string; n: number }[]).map((r) => [r.mo, r.n]));
      const newPatients = months.map((mo) => ({ month: mo, count: np.get(mo) ?? 0 }));

      let money: null | { todayCollections: string; openReceivables: string; monthlyIncome: { month: string; amount: string }[] } = null;
      if (finance) {
        const k = (await c.query(
          `select ((select coalesce(sum(amount), 0) from payments where paid_at >= $1 and paid_at < $2)
                 - (select coalesce(sum(amount), 0) from refunds where refunded_at >= $1 and refunded_at < $2))::numeric(14,2)::text as today_net,
                  (select coalesce(sum(r.amount - r.allocated_amount), 0) from receivables r where r.status = 'active' and r.amount > r.allocated_amount)::numeric(14,2)::text as open_debt`,
          [todayFrom, todayTo])).rows[0];
        const inc = new Map(((await c.query(
          `select mo, sum(v)::numeric(14,2)::text as amount from (
             select to_char(paid_at at time zone $2, 'YYYY-MM') as mo, amount as v from payments where paid_at >= $1
             union all
             select to_char(refunded_at at time zone $2, 'YYYY-MM') as mo, -amount as v from refunds where refunded_at >= $1) x group by mo`,
          [monthsFrom, tz])).rows as { mo: string; amount: string }[]).map((r) => [r.mo, r.amount]));
        money = { todayCollections: k.today_net, openReceivables: k.open_debt, monthlyIncome: months.map((mo) => ({ month: mo, amount: inc.get(mo) ?? "0.00" })) };
      }

      // Tedavi dağılımı: son 90 günde tamamlanan işlemler, katalog kategorisine göre (adet).
      let treatments: { category: string; count: number }[] | null = null;
      if (treatment) {
        treatments = (await c.query(
          `select coalesce(pc.category, 'Diğer') as category, sum(pp.quantity)::int as count
             from performed_procedures pp join procedures pc on pc.id = pp.procedure_id
            where pp.status = 'completed' and pp.completed_at >= $1 group by 1 order by 2 desc, 1`,
          [dayRangeUtc(addDays(today, -89), tz).from])).rows;
      }

      return {
        date: today, timezone: tz,
        today: { appointments: t.appointments, waiting: t.waiting, inTreatment: t.in_treatment, completed: t.completed, noShow: t.no_show, pastPending: t.past_pending, activePractitioners: prac },
        money,
        charts: { appointmentDensity: days, newPatients, treatments, treatmentsWindowDays: 90 },
      };
    });
  }
}
