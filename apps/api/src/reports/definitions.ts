/**
 * Rapor tanımları (V09). Kural: satırlar ve toplamlar AYRI sorgularla hesaplanır; testler satır toplamının
 * rapor toplamına ve kaynak kayıtlara eşit olduğunu doğrular (Plan §09 “filtre toplamlarını hareketlere bağla”).
 * Gün sınırı klinik saat dilimindedir (AT-19). Satır sınırı aşılırsa `truncated` döner; toplamlar her zaman tüm kümeden.
 */
import type pg from "pg";
import type { Drill, ReportColumn } from "@viadent/contracts";
import { AUDIT_ACTION_LABELS, addDays, auditActionLabel, auditEntityLabel, auditFieldLabel, localDate } from "@viadent/contracts";
import type { RequestContext } from "../infra/context.js";
import { CLINICAL_ENTITY_TYPES, notClinicalOutputDocSql, notHiddenFileEventSql, notHiddenTaskEventSql } from "../audit/audit.js";

export interface Params { [k: string]: string | undefined }
export interface Range { from: string; to: string; fromUtc: Date; toUtc: Date }
export interface RunArgs { c: pg.PoolClient; ctx: RequestContext; p: Params; r: Range; limit: number; ownPractitionerId: string | null }
export interface ReportResult {
  columns: ReportColumn[];
  rows: (Record<string, unknown> & { _drill?: Drill })[];
  totals: Record<string, string | number | null>;
  totalLabels: Record<string, [string, ReportColumn["type"]]>;
  notes?: string[];
  truncated?: boolean;
}
type Runner = (a: RunArgs) => Promise<ReportResult>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const uuidOrNull = (v?: string) => (v && UUID.test(v) ? v : null);
const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | null => (v && (allowed as readonly string[]).includes(v) ? (v as T) : null);
const col = (key: string, label: string, type: ReportColumn["type"] = "text"): ReportColumn => ({ key, label, type });
const rate = (num: number, den: number) => (den > 0 ? (Math.round((num / den) * 10000) / 100).toFixed(2) : null);
/** Hekim kendi kaydıyla sınırlıysa seçimi ezer (sunucu tarafı; istemci başka hekim seçemez). */
const prac = (a: RunArgs) => a.ownPractitionerId ?? uuidOrNull(a.p.practitionerId);
async function rows(a: RunArgs, sql: string, args: unknown[]) {
  const r = await a.c.query(`${sql} limit ${a.limit + 1}`, args);
  return { list: r.rows.slice(0, a.limit), truncated: r.rows.length > a.limit };
}
const one = async (a: RunArgs, sql: string, args: unknown[]) => (await a.c.query(sql, args)).rows[0];

// ------------------------------------------------------------------ finans
const MOVEMENT_LABEL = `case m.source
  when 'payment' then 'Tahsilat'
  when 'refund' then 'İade'
  when 'expense' then 'Gider · ' || (select e.category from expenses e where e.id = m.source_id)
  when 'supplier_payment' then 'Tedarikçi ödemesi · ' || (select s.name from supplier_entries se join suppliers s on s.id = se.supplier_id where se.id = m.source_id)
  when 'commission_payout' then 'Prim ödemesi · ' || (select pr.display_name from commission_payouts y join practitioners pr on pr.id = y.practitioner_id where y.id = m.source_id)
  when 'salary_payment' then 'Maaş ödemesi · ' || (select pr.display_name from salary_payments y join practitioners pr on pr.id = y.practitioner_id where y.id = m.source_id)
end`;
const CASH_SUMS = `
  coalesce(sum(m.amount) filter (where m.source = 'payment'), 0)::numeric(14,2)::numeric(14,2)::text as collections,
  (-coalesce(sum(m.amount) filter (where m.source = 'refund'), 0))::numeric(14,2)::numeric(14,2)::text as refunds,
  (-coalesce(sum(m.amount) filter (where m.source = 'expense'), 0))::numeric(14,2)::text as expenses,
  (-coalesce(sum(m.amount) filter (where m.source = 'supplier_payment'), 0))::numeric(14,2)::text as supplier_payments,
  (-coalesce(sum(m.amount) filter (where m.source = 'commission_payout'), 0))::numeric(14,2)::text as commission_payouts,
  (-coalesce(sum(m.amount) filter (where m.source = 'salary_payment'), 0))::numeric(14,2)::text as salary_payments,
  coalesce(sum(m.amount), 0)::numeric(14,2)::text as net_cash`;

const gelirGider: Runner = async (a) => {
  // Gruplama: gün, hafta (Pazartesi başlangıçlı; dönem = haftanın ilk günü) veya ay — hepsi klinik saat diliminde.
  const by = a.p.groupBy === "day" || a.p.groupBy === "week" ? a.p.groupBy : "month";
  const key = (col: string) => by === "day" ? `to_char(${col} at time zone $3, 'YYYY-MM-DD')`
    : by === "week" ? `date_trunc('week', ${col} at time zone $3)::date::text` : `to_char(${col} at time zone $3, 'YYYY-MM')`;
  const args = [a.r.fromUtc, a.r.toUtc, a.ctx.timezone];
  const cash = await a.c.query(
    `select ${key("m.occurred_at")} as period, ${CASH_SUMS}
       from cash_movements m where m.occurred_at >= $1 and m.occurred_at < $2 group by 1 order by 1`, args);
  const earned = await a.c.query(
    `select ${key("completed_at")} as period, coalesce(sum(amount), 0)::numeric(14,2)::text as v
       from performed_procedures where status = 'completed' and completed_at >= $1 and completed_at < $2 group by 1`, args);
  const periods = [...new Set([...cash.rows.map((x) => x.period), ...earned.rows.map((x) => x.period)])].sort();
  const em = new Map(earned.rows.map((x) => [x.period, x.v]));
  const zero = { collections: "0.00", refunds: "0.00", expenses: "0.00", supplier_payments: "0.00", commission_payouts: "0.00", salary_payments: "0.00", net_cash: "0.00" };
  const list = periods.map((p) => {
    const x = cash.rows.find((y) => y.period === p) ?? zero;
    const [pf, pt] = by === "day" ? [p, p] : by === "week" ? [p, addDays(p, 6)] : [`${p}-01`, lastDay(p)];
    return { period: by === "week" ? `${p.slice(8, 10)}.${p.slice(5, 7)}.${p.slice(0, 4)} haftası` : p, treatment: em.get(p) ?? "0.00", collections: x.collections, refunds: x.refunds, expenses: x.expenses, supplierPayments: x.supplier_payments,
      commissionPayouts: x.commission_payouts, salaryPayments: x.salary_payments, netCash: x.net_cash,
      _drill: { report: "nakit-hareketleri", params: { from: pf < a.r.from ? a.r.from : pf, to: pt > a.r.to ? a.r.to : pt } } };
  });
  const t = await one(a, `select ${CASH_SUMS}, (select coalesce(sum(amount), 0) from performed_procedures where status = 'completed' and completed_at >= $1 and completed_at < $2)::numeric(14,2)::text as treatment
    from cash_movements m where m.occurred_at >= $1 and m.occurred_at < $2`, [a.r.fromUtc, a.r.toUtc]);
  return {
    columns: [col("period", by === "day" ? "Gün" : by === "week" ? "Hafta (Pazartesi)" : "Ay"), col("treatment", "Tedavi tutarı (kazanılmış)", "money"), col("collections", "Tahsilat", "money"),
      col("refunds", "İade", "money"), col("expenses", "Gider", "money"), col("supplierPayments", "Tedarikçi ödemesi", "money"),
      col("commissionPayouts", "Prim ödemesi", "money"), col("salaryPayments", "Maaş ödemesi", "money"), col("netCash", "Net nakit akışı", "money")],
    rows: list,
    totals: { treatment: t.treatment, collections: t.collections, refunds: t.refunds, expenses: t.expenses, supplierPayments: t.supplier_payments,
      commissionPayouts: t.commission_payouts, salaryPayments: t.salary_payments, netCash: t.net_cash },
    totalLabels: { treatment: ["Tedavi tutarı", "money"], collections: ["Tahsilat", "money"], refunds: ["İade", "money"], expenses: ["Gider", "money"],
      supplierPayments: ["Tedarikçi ödemesi", "money"], commissionPayouts: ["Prim ödemesi", "money"], salaryPayments: ["Maaş ödemesi", "money"], netCash: ["Net nakit akışı", "money"] },
    notes: ["Net nakit akışı = tahsilat − iade − gider − tedarikçi ödemesi − prim ödemesi − maaş ödemesi (ters kayıtlar dahil). Kâr değildir.",
      "Tedavi tutarı kazanılmış işlem bedelidir (snapshot); nakit değildir ve net nakde katılmaz. Tutarlar KDV ayrımı yapılmadan kayıtlı tutardır."],
  };
};
function lastDay(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
}

const nakit: Runner = async (a) => {
  const src = pick(a.p.source, ["payment", "refund", "expense", "supplier_payment", "commission_payout", "salary_payment"] as const);
  const args = [a.r.fromUtc, a.r.toUtc, src];
  const { list, truncated } = await rows(a,
    `select m.id, m.occurred_at as at, m.source, ca.name as account, m.amount::text, ${MOVEMENT_LABEL} as label,
            case m.source when 'payment' then (select x.patient_id from payments x where x.id = m.source_id)
                          when 'refund' then (select x.patient_id from refunds f join payments x on x.id = f.payment_id where f.id = m.source_id) end as patient_id
       from cash_movements m join cash_accounts ca on ca.id = m.cash_account_id
      where m.occurred_at >= $1 and m.occurred_at < $2 and ($3::text is null or m.source = $3) order by m.occurred_at, m.created_at`, args);
  const t = await one(a, `select count(*)::int as n, ${CASH_SUMS} from cash_movements m where m.occurred_at >= $1 and m.occurred_at < $2 and ($3::text is null or m.source = $3)`, args);
  const SRC: Record<string, string> = { payment: "Tahsilat", refund: "İade", expense: "Gider", supplier_payment: "Tedarikçi ödemesi", commission_payout: "Prim ödemesi", salary_payment: "Maaş ödemesi" };
  return {
    columns: [col("at", "Zaman", "datetime"), col("sourceLabel", "Kaynak", "badge"), col("label", "Açıklama"), col("account", "Kasa / banka"), col("amount", "Tutar (±)", "money")],
    rows: list.map((m) => ({ at: m.at, source: m.source, sourceLabel: SRC[m.source], label: m.label, account: m.account, amount: m.amount,
      ...(m.patient_id ? { _drill: { patientId: m.patient_id, tab: "finans" } } : {}) })),
    totals: { count: t.n, collections: t.collections, refunds: t.refunds, expenses: t.expenses, supplierPayments: t.supplier_payments, commissionPayouts: t.commission_payouts, salaryPayments: t.salary_payments, netCash: t.net_cash },
    totalLabels: { count: ["Hareket", "int"], collections: ["Tahsilat", "money"], refunds: ["İade", "money"], expenses: ["Gider", "money"],
      supplierPayments: ["Tedarikçi ödemesi", "money"], commissionPayouts: ["Prim ödemesi", "money"], salaryPayments: ["Maaş ödemesi", "money"], netCash: ["Net", "money"] },
    truncated,
  };
};

/** Mali müşavir dönem dökümü (Faz 2.3): nakit hareketleri + belge no (makbuz) + karşı taraf; CSV ile birebir. */
const muhasebeDonem: Runner = async (a) => {
  const kind = pick(a.p.kind, ["payment", "refund", "expense", "supplier_payment", "commission_payout", "salary_payment"] as const);
  const args = [a.r.fromUtc, a.r.toUtc, kind];
  const { list, truncated } = await rows(a,
    `select m.id, m.occurred_at as at, m.source, ca.name as account, ca.kind as account_kind, m.amount::text,
            case m.source when 'payment' then (select rc.receipt_no from receipts rc where rc.kind = 'payment' and rc.payment_id = m.source_id)
                          when 'refund' then (select rc.receipt_no from receipts rc where rc.kind = 'refund' and rc.refund_id = m.source_id) end as doc_no,
            case m.source when 'payment' then (select p.first_name || ' ' || p.last_name from payments x join patients p on p.id = x.patient_id where x.id = m.source_id)
                          when 'refund' then (select p.first_name || ' ' || p.last_name from refunds f join payments x on x.id = f.payment_id join patients p on p.id = x.patient_id where f.id = m.source_id)
                          when 'expense' then (select e.category || coalesce(' · ' || e.description, '') from expenses e where e.id = m.source_id)
                          when 'supplier_payment' then (select s.name from supplier_entries se join suppliers s on s.id = se.supplier_id where se.id = m.source_id)
                          when 'commission_payout' then (select pr.display_name from commission_payouts y join practitioners pr on pr.id = y.practitioner_id where y.id = m.source_id)
                          when 'salary_payment' then (select pr.display_name from salary_payments y join practitioners pr on pr.id = y.practitioner_id where y.id = m.source_id) end as party,
            case m.source when 'payment' then (select x.method from payments x where x.id = m.source_id)
                          when 'refund' then (select f.method from refunds f where f.id = m.source_id) end as method,
            case m.source when 'payment' then (select x.patient_id from payments x where x.id = m.source_id)
                          when 'refund' then (select x.patient_id from refunds f join payments x on x.id = f.payment_id where f.id = m.source_id) end as patient_id
       from cash_movements m join cash_accounts ca on ca.id = m.cash_account_id
      where m.occurred_at >= $1 and m.occurred_at < $2 and ($3::text is null or m.source = $3) order by m.occurred_at, m.created_at`, args);
  const t = await one(a, `select count(*)::int as n, ${CASH_SUMS} from cash_movements m where m.occurred_at >= $1 and m.occurred_at < $2 and ($3::text is null or m.source = $3)`, args);
  const SRC: Record<string, string> = { payment: "Tahsilat", refund: "İade", expense: "Gider", supplier_payment: "Tedarikçi ödemesi", commission_payout: "Prim ödemesi", salary_payment: "Maaş ödemesi" };
  const METHOD: Record<string, string> = { cash: "Nakit", card_manual: "Kart (POS)", bank_transfer: "Havale/EFT", other: "Diğer", online: "Online" };
  return {
    columns: [col("at", "Tarih", "datetime"), col("docNo", "Belge no"), col("kindLabel", "Tür", "badge"), col("party", "Karşı taraf / açıklama"), col("method", "Yöntem"), col("account", "Kasa / banka"), col("amount", "Tutar (±)", "money")],
    rows: list.map((m) => ({ at: m.at, docNo: m.doc_no ?? "", kind: m.source, kindLabel: SRC[m.source], party: m.party ?? "", method: m.method ? METHOD[m.method] ?? m.method : "", account: m.account, amount: m.amount,
      ...(m.patient_id ? { _drill: { patientId: m.patient_id, tab: "finans" } } : {}) })),
    totals: { count: t.n, collections: t.collections, refunds: t.refunds, expenses: t.expenses, supplierPayments: t.supplier_payments, commissionPayouts: t.commission_payouts, salaryPayments: t.salary_payments, netCash: t.net_cash },
    totalLabels: { count: ["Hareket", "int"], collections: ["Tahsilat", "money"], refunds: ["İade", "money"], expenses: ["Gider", "money"],
      supplierPayments: ["Tedarikçi ödemesi", "money"], commissionPayouts: ["Prim ödemesi", "money"], salaryPayments: ["Maaş ödemesi", "money"], netCash: ["Net", "money"] },
    notes: ["Resmî muhasebe fişi / hesap planı değildir; mali müşavir kendi hesap planına aktarır.", "Fatura / e-Arşiv belgeleri bu dökümde değildir; e-belge sağlayıcısından alınır. Belge no sütunu PİA-DENT makbuz numarasıdır (TM tahsilat, IM iade)."],
    truncated,
  };
};

const aylikCiro: Runner = async (a) => {
  const args = [a.r.fromUtc, a.r.toUtc, a.ctx.timezone];
  const r = await a.c.query(
    `with t as (select to_char(completed_at at time zone $3, 'YYYY-MM') as period, sum(amount) as treatment, count(*) as n
                  from performed_procedures where status = 'completed' and completed_at >= $1 and completed_at < $2 group by 1),
          p as (select to_char(paid_at at time zone $3, 'YYYY-MM') as period, sum(amount) as collections from payments where paid_at >= $1 and paid_at < $2 group by 1),
          f as (select to_char(refunded_at at time zone $3, 'YYYY-MM') as period, sum(amount) as refunds from refunds where refunded_at >= $1 and refunded_at < $2 group by 1)
     select coalesce(t.period, p.period, f.period) as period, coalesce(t.treatment, 0)::numeric(14,2)::numeric(14,2)::text as treatment, coalesce(t.n, 0)::int as n,
            coalesce(p.collections, 0)::numeric(14,2)::numeric(14,2)::text as collections, coalesce(f.refunds, 0)::numeric(14,2)::numeric(14,2)::text as refunds,
            (coalesce(p.collections, 0) - coalesce(f.refunds, 0))::numeric(14,2)::text as net
       from t full join p on p.period = t.period full join f on f.period = coalesce(t.period, p.period) order by 1`, args);
  const t = await one(a,
    `select (select coalesce(sum(amount), 0) from performed_procedures where status = 'completed' and completed_at >= $1 and completed_at < $2)::numeric(14,2)::text as treatment,
            (select count(*) from performed_procedures where status = 'completed' and completed_at >= $1 and completed_at < $2)::int as n,
            (select coalesce(sum(amount), 0) from payments where paid_at >= $1 and paid_at < $2)::numeric(14,2)::text as collections,
            (select coalesce(sum(amount), 0) from refunds where refunded_at >= $1 and refunded_at < $2)::numeric(14,2)::text as refunds`, [a.r.fromUtc, a.r.toUtc]);
  return {
    columns: [col("period", "Ay"), col("treatmentCount", "İşlem", "int"), col("treatment", "Tedavi tutarı", "money"), col("collections", "Tahsilat", "money"),
      col("refunds", "İade", "money"), col("net", "Net tahsilat", "money")],
    rows: r.rows.map((x) => ({ period: x.period, treatmentCount: x.n, treatment: x.treatment, collections: x.collections, refunds: x.refunds, net: x.net,
      _drill: { report: "tedavi", params: { from: maxD(`${x.period}-01`, a.r.from), to: minD(lastDay(x.period), a.r.to), status: "completed" } } })),
    totals: { treatmentCount: t.n, treatment: t.treatment, collections: t.collections, refunds: t.refunds,
      net: (await one(a, "select ($1::numeric - $2::numeric)::numeric(14,2)::text as v", [t.collections, t.refunds])).v },
    totalLabels: { treatmentCount: ["İşlem", "int"], treatment: ["Tedavi tutarı", "money"], collections: ["Tahsilat", "money"], refunds: ["İade", "money"], net: ["Net tahsilat", "money"] },
    notes: ["Tedavi tutarı tamamlanan işlemlerin snapshot bedelidir; tahsilat değildir. Net tahsilat önceki dönem borcunu ve avansı içerebilir."],
  };
};
const maxD = (x: string, y: string) => (x > y ? x : y);
const minD = (x: string, y: string) => (x < y ? x : y);

const BORC_CTE = `
  with o as (select r.patient_id, r.due_date, r.amount - r.allocated_amount as open
               from receivables r where r.status = 'active' and r.amount > r.allocated_amount),
       d as (select patient_id, sum(open) as debt,
                    coalesce(sum(open) filter (where due_date > $1::date), 0) as not_due,
                    coalesce(sum(open) filter (where due_date <= $1::date and $1::date - due_date <= 30), 0) as d0_30,
                    coalesce(sum(open) filter (where $1::date - due_date between 31 and 60), 0) as d31_60,
                    coalesce(sum(open) filter (where $1::date - due_date between 61 and 90), 0) as d61_90,
                    coalesce(sum(open) filter (where $1::date - due_date > 90), 0) as d90p
               from o where open <> 0 group by patient_id),
       v as (select x.patient_id, sum(x.amount - x.allocated_amount - x.refunded_amount) as advance
               from payments x where x.amount > x.allocated_amount + x.refunded_amount group by x.patient_id),
       f as (select d.*, coalesce(v.advance, 0) as advance from d left join v on v.patient_id = d.patient_id
              where d.debt > 0 and ($2::numeric is null or d.debt >= $2::numeric)
                and ($3::text is null or (case $3 when 'notDue' then d.not_due when 'd0_30' then d.d0_30 when 'd31_60' then d.d31_60 when 'd61_90' then d.d61_90 else d.d90p end) > 0))`;
const borc: Runner = async (a) => {
  const today = localDate(new Date(), a.ctx.timezone);
  const min = a.p.minAmount && /^\d{1,12}([.,]\d{1,2})?$/.test(a.p.minAmount) ? a.p.minAmount.replace(",", ".") : null;
  const args = [today, min, pick(a.p.bucket, ["notDue", "d0_30", "d31_60", "d61_90", "d90p"] as const)];
  const { list, truncated } = await rows(a,
    `${BORC_CTE} select f.*, f.debt::text as debt_t, f.advance::text as adv_t, p.first_name || ' ' || p.last_name as patient, p.file_no
       from f join patients p on p.id = f.patient_id order by f.debt desc, p.file_no`, args);
  const t = await one(a, `${BORC_CTE} select count(*)::int as n, coalesce(sum(debt), 0)::numeric(14,2)::text as debt, coalesce(sum(advance), 0)::numeric(14,2)::text as advance,
      coalesce(sum(d90p), 0)::numeric(14,2)::text as d90p from f`, args);
  return {
    columns: [col("fileNo", "Dosya", "int"), col("patient", "Hasta"), col("debt", "Açık borç", "money"), col("notDue", "Vadesi gelmemiş", "money"),
      col("d0_30", "0–30", "money"), col("d31_60", "31–60", "money"), col("d61_90", "61–90", "money"), col("d90p", "90+", "money"), col("advance", "Avans (ayrı)", "money")],
    rows: list.map((x) => ({ fileNo: x.file_no, patient: x.patient, debt: x.debt_t, notDue: String(x.not_due), d0_30: String(x.d0_30), d31_60: String(x.d31_60),
      d61_90: String(x.d61_90), d90p: String(x.d90p), advance: x.adv_t, _drill: { patientId: x.patient_id, tab: "finans" } })),
    totals: { patients: t.n, debt: t.debt, d90p: t.d90p, advance: t.advance },
    totalLabels: { patients: ["Hasta", "int"], debt: ["Açık borç", "money"], d90p: ["90+ gün", "money"], advance: ["Bu hastaların avansı", "money"] },
    notes: ["Açık borç = etkin alacaklar − dağıtılan ödemeler. Avans borçtan düşülmez; ayrı gösterilir (dağıtım ayrı karar)."],
    truncated,
  };
};

const prim: Runner = async (a) => {
  const args = [a.r.fromUtc, a.r.toUtc, prac(a), pick(a.p.basis, ["collection", "treatment"] as const)];
  const where = `ac.created_at >= $1 and ac.created_at < $2 and ($3::uuid is null or ac.practitioner_id = $3) and ($4::text is null or ac.basis = $4)`;
  const { list, truncated } = await rows(a,
    `select ac.id, ac.created_at, ac.basis, ac.base_amount::text, ac.rate::text, ac.amount::text, ac.reverses_id, pr.display_name as practitioner,
            p.id as patient_id, p.first_name || ' ' || p.last_name as patient, coalesce(rv.description, pp.procedure_code || ' · ' || pp.procedure_name) as source
       from commission_accruals ac join practitioners pr on pr.id = ac.practitioner_id
       left join allocations al on al.id = ac.allocation_id left join receivables rv on rv.id = al.receivable_id
       left join performed_procedures pp on pp.id = ac.performed_procedure_id join patients p on p.id = coalesce(rv.patient_id, pp.patient_id)
      where ${where} order by ac.created_at`, args);
  const t = await one(a,
    `select coalesce(sum(ac.amount) filter (where ac.amount > 0), 0)::numeric(14,2)::text as accrued, coalesce(sum(ac.amount) filter (where ac.amount < 0), 0)::numeric(14,2)::text as reversed,
            coalesce(sum(ac.amount), 0)::numeric(14,2)::text as net, count(*)::int as n,
            (select coalesce(sum(y.amount), 0) from commission_payouts y where y.paid_at >= $1 and y.paid_at < $2 and ($3::uuid is null or y.practitioner_id = $3))::numeric(14,2)::text as paid,
            ((select coalesce(sum(x.amount), 0) from commission_accruals x where ($3::uuid is null or x.practitioner_id = $3))
              - (select coalesce(sum(y.amount), 0) from commission_payouts y where ($3::uuid is null or y.practitioner_id = $3)))::numeric(14,2)::text as payable
       from commission_accruals ac where ${where}`, args);
  return {
    columns: [col("at", "Zaman", "datetime"), col("practitioner", "Hekim"), col("basisLabel", "Temel", "badge"), col("patient", "Hasta"), col("source", "Kaynak"),
      col("base", "Taban", "money"), col("rate", "Oran %", "percent"), col("amount", "Prim", "money")],
    rows: list.map((x) => ({ at: x.created_at, practitioner: x.practitioner, basis: x.basis, basisLabel: x.basis === "treatment" ? "Tedavi" : "Tahsilat",
      patient: x.patient, source: `${x.source}${x.reverses_id ? " (ters kayıt)" : ""}`, base: x.base_amount, rate: x.rate, amount: x.amount,
      _drill: { patientId: x.patient_id, tab: "finans" } })),
    totals: { count: t.n, accrued: t.accrued, reversed: t.reversed, net: t.net, paid: t.paid, payable: t.payable },
    totalLabels: { count: ["Satır", "int"], accrued: ["Tahakkuk", "money"], reversed: ["Ters prim", "money"], net: ["Net tahakkuk", "money"],
      paid: ["Dönemde ödenen", "money"], payable: ["Ödenecek bakiye (tüm zamanlar)", "money"] },
    notes: ["Tedavi bazlı prim gerçekleşen işlem bedelinden, tahsilat bazlı prim dağıtılan tahsilattan doğar; bir hekim için bir günde tek kural etkindir.",
      "İade/iptal orijinal oranla ters prim doğurur. Prim ödemesi ayrı harekettir; bakiye = net tahakkuk − ödenen."],
    truncated,
  };
};

const onlineOdeme: Runner = async (a) => {
  const args = [a.r.fromUtc, a.r.toUtc, pick(a.p.status, ["created", "link_ready", "paid", "failed", "expired", "cancelled"] as const)];
  const where = "o.created_at >= $1 and o.created_at < $2 and ($3::text is null or o.status = $3)";
  const { list, truncated } = await rows(a,
    `select o.id, o.created_at, o.amount::text, o.status, o.paid_at, o.patient_id, p.first_name || ' ' || p.last_name as patient,
            (select cn.provider from integration_jobs j join integration_connections cn on cn.id = j.connection_id where j.source_type = 'online_payment' and j.source_id = o.id limit 1) as provider
       from online_payment_requests o join patients p on p.id = o.patient_id where ${where} order by o.created_at`, args);
  const t = await one(a, `select count(*)::int as n, coalesce(sum(o.amount), 0)::numeric(14,2)::text as requested, coalesce(sum(o.amount) filter (where o.status = 'paid'), 0)::numeric(14,2)::numeric(14,2)::text as paid,
      count(*) filter (where o.status = 'paid')::int as paid_n from online_payment_requests o where ${where}`, args);
  const ST: Record<string, string> = { created: "Hazırlanıyor", link_ready: "Bağlantı hazır", paid: "Ödendi", failed: "Başarısız", expired: "Süresi doldu", cancelled: "İptal" };
  return {
    columns: [col("at", "İstek", "datetime"), col("patient", "Hasta"), col("amount", "Tutar", "money"), col("statusLabel", "Durum", "badge"), col("paidAt", "Ödeme", "datetime"), col("provider", "Sağlayıcı")],
    rows: list.map((x) => ({ at: x.created_at, patient: x.patient, amount: x.amount, status: x.status, statusLabel: ST[x.status], paidAt: x.paid_at,
      provider: x.provider === "mock" ? "DENEME" : x.provider, _drill: { patientId: x.patient_id, tab: "finans" } })),
    totals: { count: t.n, requested: t.requested, paidCount: t.paid_n, paid: t.paid },
    totalLabels: { count: ["İstek", "int"], requested: ["İstenen", "money"], paidCount: ["Ödenen istek", "int"], paid: ["Ödenen (sağlayıcı bildirimi)", "money"] },
    notes: ["Yalnız Deneme sağlayıcı; gerçek para hareketi yok."],
    truncated,
  };
};

// ------------------------------------------------------------------ tedavi
const tedavi: Runner = async (a) => {
  const st = a.p.status === "" ? null : pick(a.p.status ?? "completed", ["completed", "cancelled", "corrected"] as const);
  const args = [a.r.fromUtc, a.r.toUtc, prac(a), uuidOrNull(a.p.procedureId), st];
  const where = `pp.completed_at >= $1 and pp.completed_at < $2 and ($3::uuid is null or pp.practitioner_id = $3) and ($4::uuid is null or pp.procedure_id = $4)
                 and ($5::text is null or pp.status = $5)`;
  const { list, truncated } = await rows(a,
    `select pp.id, pp.completed_at, pp.procedure_code, pp.procedure_name, pp.tooth, pp.quantity, pp.amount::text, pp.status, pp.status_reason,
            pr.display_name as practitioner, p.id as patient_id, p.first_name || ' ' || p.last_name as patient
       from performed_procedures pp join practitioners pr on pr.id = pp.practitioner_id join patients p on p.id = pp.patient_id
      where ${where} order by pp.completed_at`, args);
  const t = await one(a, `select count(*)::int as n, coalesce(sum(pp.quantity), 0)::int as qty, coalesce(sum(pp.amount), 0)::numeric(14,2)::text as amount,
      coalesce(sum(pp.amount) filter (where pp.status = 'completed'), 0)::numeric(14,2)::text as completed_amount from performed_procedures pp where ${where}`, args);
  const ST: Record<string, string> = { completed: "Tamamlandı", cancelled: "İptal", corrected: "Düzeltildi" };
  return {
    columns: [col("at", "Tarih", "datetime"), col("patient", "Hasta"), col("procedure", "İşlem"), col("tooth", "Diş"), col("practitioner", "Hekim"),
      col("quantity", "Adet", "int"), col("amount", "Bedel (snapshot)", "money"), col("statusLabel", "Durum", "badge")],
    rows: list.map((x) => ({ at: x.completed_at, patient: x.patient, procedure: `${x.procedure_code} · ${x.procedure_name}`, tooth: x.tooth ?? "", practitioner: x.practitioner,
      quantity: x.quantity, amount: x.amount, status: x.status, statusLabel: ST[x.status], _drill: { patientId: x.patient_id, tab: "tedavi" } })),
    totals: { count: t.n, quantity: t.qty, amount: t.amount, completedAmount: t.completed_amount },
    totalLabels: { count: ["Kayıt", "int"], quantity: ["Adet", "int"], amount: ["Listelenen tutar", "money"], completedAmount: ["Tamamlanan tutar", "money"] },
    notes: ["Bedel, işlem anındaki snapshot'tır; tarife sonradan değişse de değişmez. İptal/düzeltilen kayıtlar silinmez, ayrı durumla görünür."],
    truncated,
  };
};

const aylikIslem: Runner = async (a) => {
  const args = [a.r.fromUtc, a.r.toUtc, a.ctx.timezone, prac(a)];
  const where = "status = 'completed' and completed_at >= $1 and completed_at < $2 and ($4::uuid is null or practitioner_id = $4)";
  const r = await a.c.query(
    `select to_char(completed_at at time zone $3, 'YYYY-MM') as period, procedure_id, procedure_code, procedure_name, count(*)::int as n,
            sum(quantity)::int as qty, sum(amount)::text as amount
       from performed_procedures where ${where} group by 1, 2, 3, 4 order by 1, 3`, args);
  const t = await one(a, `select count(*)::int as n, coalesce(sum(quantity), 0)::int as qty, coalesce(sum(amount), 0)::numeric(14,2)::text as amount from performed_procedures
    where ${where} and $3::text is not null`, args);
  return {
    columns: [col("period", "Ay"), col("procedure", "İşlem"), col("count", "Kayıt", "int"), col("quantity", "Adet", "int"), col("amount", "Tutar", "money")],
    rows: r.rows.map((x) => ({ period: x.period, procedure: `${x.procedure_code} · ${x.procedure_name}`, count: x.n, quantity: x.qty, amount: x.amount,
      _drill: { report: "tedavi", params: { from: maxD(`${x.period}-01`, a.r.from), to: minD(lastDay(x.period), a.r.to), procedureId: x.procedure_id, status: "completed",
        ...(a.p.practitionerId ? { practitionerId: a.p.practitionerId } : {}) } } })),
    totals: { count: t.n, quantity: t.qty, amount: t.amount },
    totalLabels: { count: ["Kayıt", "int"], quantity: ["Adet", "int"], amount: ["Tutar", "money"] },
  };
};

const PLAN_CTE = `
  with v as (
    select pv.id, pv.plan_id, pv.version, pv.proposed_at, pv.status, pv.practitioner_id, tp.patient_id, tp.title,
           (select coalesce(sum(pi.line_total), 0) from plan_items pi where pi.plan_version_id = pv.id) as total,
           (select d.decision from plan_decisions d where d.plan_version_id = pv.id order by d.recorded_at desc limit 1) as decision,
           (select d.recorded_at from plan_decisions d where d.plan_version_id = pv.id and d.decision in ('accepted','rejected') order by d.recorded_at desc limit 1) as decided_at
      from plan_versions pv join treatment_plans tp on tp.id = pv.plan_id
     where pv.proposed_at >= $1 and pv.proposed_at < $2 and ($3::uuid is null or pv.practitioner_id = $3)),
  f as (select v.*, case when decision in ('accepted','rejected') then decision else 'pending' end as outcome from v)`;
const plan: Runner = async (a) => {
  const args = [a.r.fromUtc, a.r.toUtc, prac(a), pick(a.p.status, ["accepted", "rejected", "pending"] as const)];
  const { list, truncated } = await rows(a,
    `${PLAN_CTE} select f.*, f.total::text as total_t, pr.display_name as practitioner, p.first_name || ' ' || p.last_name as patient
       from f join practitioners pr on pr.id = f.practitioner_id join patients p on p.id = f.patient_id
      where ($4::text is null or f.outcome = $4) order by f.proposed_at`, args);
  const t = await one(a,
    `${PLAN_CTE} select count(*)::int as n, count(*) filter (where outcome = 'accepted')::int as acc, count(*) filter (where outcome = 'rejected')::int as rej,
        count(*) filter (where outcome = 'pending')::int as pend, count(distinct patient_id)::int as patients,
        coalesce(sum(total) filter (where outcome = 'accepted'), 0)::numeric(14,2)::text as accepted_total
       from f where ($4::text is null or f.outcome = $4)`, args);
  const OUT: Record<string, string> = { accepted: "Kabul", rejected: "Ret", pending: "Bekliyor / kararsız" };
  return {
    columns: [col("proposedAt", "Teklif", "datetime"), col("patient", "Hasta"), col("plan", "Plan"), col("practitioner", "Hekim"), col("total", "Teklif tutarı", "money"),
      col("outcomeLabel", "Karar", "badge"), col("decidedAt", "Karar zamanı", "datetime")],
    rows: list.map((x) => ({ proposedAt: x.proposed_at, patient: x.patient, plan: `${x.title} · sürüm ${x.version}`, practitioner: x.practitioner, total: x.total_t,
      outcome: x.outcome, outcomeLabel: OUT[x.outcome], decidedAt: x.decided_at, _drill: { patientId: x.patient_id, tab: "tedavi" } })),
    totals: { proposed: t.n, accepted: t.acc, rejected: t.rej, pending: t.pend, acceptanceRate: rate(t.acc, t.acc + t.rej), patients: t.patients, acceptedTotal: t.accepted_total },
    totalLabels: { proposed: ["Sunulan sürüm", "int"], accepted: ["Kabul", "int"], rejected: ["Ret", "int"], pending: ["Bekliyor / kararsız", "int"],
      acceptanceRate: ["Kabul oranı", "percent"], patients: ["Farklı hasta", "int"], acceptedTotal: ["Kabul edilen tutar", "money"] },
    notes: ["Kabul oranı = kabul / (kabul + ret); kararsız ve bekleyenler paydaya girmez (Plan §09). Aynı planın sürümleri ayrı satırdır; hasta sayısı tekildir."],
    truncated,
  };
};

const hekimHasta: Runner = async (a) => {
  const args = [a.r.fromUtc, a.r.toUtc, a.ownPractitionerId];
  // Tek geçişli toplama (Görev 13 ölçümü: hekim başına bağıntılı alt sorgular 1 yılda ~1–5 sn sürüyordu; tarih dizini üzerinden tek tarama ~100 ms).
  const r = await a.c.query(
    `with ap as (select x.practitioner_id, count(*)::int as visits, count(distinct x.patient_id)::int as patients
                   from appointments x where x.status = 'completed' and x.starts_at >= $1 and x.starts_at < $2 and ($3::uuid is null or x.practitioner_id = $3) group by x.practitioner_id),
          pp as (select practitioner_id, count(*)::int as procedures from performed_procedures
                   where status = 'completed' and completed_at >= $1 and completed_at < $2 and ($3::uuid is null or practitioner_id = $3) group by practitioner_id),
          np as (select primary_practitioner_id as practitioner_id, count(*)::int as new_patients from patients
                   where created_at >= $1 and created_at < $2 and primary_practitioner_id is not null and ($3::uuid is null or primary_practitioner_id = $3) group by primary_practitioner_id)
     select pr.id, pr.display_name, coalesce(ap.visits, 0) as visits, coalesce(ap.patients, 0) as patients, coalesce(pp.procedures, 0) as procedures, coalesce(np.new_patients, 0) as new_patients
       from practitioners pr left join ap on ap.practitioner_id = pr.id left join pp on pp.practitioner_id = pr.id left join np on np.practitioner_id = pr.id
      where ($3::uuid is null or pr.id = $3) order by pr.display_name`, args);
  const t = await one(a,
    `select (select count(*) from appointments x where x.status = 'completed' and x.starts_at >= $1 and x.starts_at < $2 and ($3::uuid is null or x.practitioner_id = $3))::int as visits,
            (select count(distinct x.patient_id) from appointments x where x.status = 'completed' and x.starts_at >= $1 and x.starts_at < $2 and ($3::uuid is null or x.practitioner_id = $3))::int as patients,
            (select count(*) from performed_procedures pp where pp.status = 'completed' and pp.completed_at >= $1 and pp.completed_at < $2 and ($3::uuid is null or pp.practitioner_id = $3))::int as procedures,
            (select count(*) from patients p where p.created_at >= $1 and p.created_at < $2 and ($3::uuid is null or p.primary_practitioner_id = $3))::int as new_patients`, args);
  return {
    columns: [col("practitioner", "Hekim"), col("visits", "Tamamlanan randevu", "int"), col("patients", "Görülen farklı hasta", "int"),
      col("procedures", "Gerçekleşen işlem", "int"), col("newPatients", "Yeni hasta (birincil hekim)", "int")],
    rows: r.rows.map((x) => ({ practitioner: x.display_name, visits: x.visits, patients: x.patients, procedures: x.procedures, newPatients: x.new_patients,
      _drill: { report: "tedavi", params: { from: a.r.from, to: a.r.to, practitionerId: x.id, status: "completed" } } })),
    totals: { visits: t.visits, patients: t.patients, procedures: t.procedures, newPatients: t.new_patients },
    totalLabels: { visits: ["Tamamlanan randevu", "int"], patients: ["Farklı hasta (tekil)", "int"], procedures: ["Gerçekleşen işlem", "int"], newPatients: ["Yeni hasta", "int"] },
    notes: ["“Farklı hasta” toplamı tekildir: birden çok hekime giden hasta bir kez sayılır (satır toplamından küçük olabilir).",
      "Yeni hasta = dönemde oluşturulan hasta kaydı; ziyaret eden hasta sayısı değildir."],
  };
};

// ------------------------------------------------------------------ operasyon
const randevu: Runner = async (a) => {
  const args = [a.r.fromUtc, a.r.toUtc, prac(a)];
  const where = "x.starts_at >= $1 and x.starts_at < $2 and ($3::uuid is null or x.practitioner_id = $3)";
  const AGG = `count(*)::int as total, count(*) filter (where x.status = 'completed')::int as completed, count(*) filter (where x.status = 'no_show')::int as no_show,
      count(*) filter (where x.status = 'cancelled')::int as cancelled, count(*) filter (where x.status in ('planned','confirmed','checked_in','in_progress'))::int as open`;
  const r = await a.c.query(`select pr.display_name, x.practitioner_id, ${AGG} from appointments x join practitioners pr on pr.id = x.practitioner_id
     where ${where} group by 1, 2 order by 1`, args);
  const t = await one(a, `select ${AGG} from appointments x where ${where}`, args);
  return {
    columns: [col("practitioner", "Hekim"), col("total", "Toplam", "int"), col("completed", "Tamamlandı", "int"), col("noShow", "Gelmedi", "int"),
      col("cancelled", "İptal", "int"), col("open", "Açık / gelecek", "int"), col("noShowRate", "Gelmeme oranı", "percent")],
    rows: r.rows.map((x) => ({ practitioner: x.display_name, total: x.total, completed: x.completed, noShow: x.no_show, cancelled: x.cancelled, open: x.open,
      noShowRate: rate(x.no_show, x.completed + x.no_show) })),
    totals: { total: t.total, completed: t.completed, noShow: t.no_show, cancelled: t.cancelled, open: t.open, noShowRate: rate(t.no_show, t.completed + t.no_show) },
    totalLabels: { total: ["Randevu", "int"], completed: ["Tamamlandı", "int"], noShow: ["Gelmedi", "int"], cancelled: ["İptal", "int"], open: ["Açık / gelecek", "int"],
      noShowRate: ["Gelmeme oranı", "percent"] },
    notes: ["Gelmeme oranı = gelmedi / (tamamlandı + gelmedi). İptal ve henüz gerçekleşmemiş randevular paydaya girmez (Plan §09).",
      "“Geldi” (geliş kaydı) ile “tamamlandı” aynı sayılmaz."],
  };
};

const kontrol: Runner = async (a) => {
  const args = [a.r.from, a.r.to, prac(a), pick(a.p.status, ["open", "scheduled", "done", "cancelled"] as const), localDate(new Date(), a.ctx.timezone)];
  const where = "f.due_date between $1::date and $2::date and ($3::uuid is null or f.practitioner_id = $3) and ($4::text is null or f.status = $4)";
  const { list, truncated } = await rows(a,
    `select f.id, f.due_date::text as due, f.reason, f.status, f.cancel_reason, f.patient_id, p.first_name || ' ' || p.last_name as patient, pr.display_name as practitioner,
            a.starts_at as appointment_at, (f.status = 'open' and f.due_date < $5::date) as overdue
       from follow_ups f join patients p on p.id = f.patient_id left join practitioners pr on pr.id = f.practitioner_id left join appointments a on a.id = f.appointment_id
      where ${where} order by f.due_date`, args);
  const t = await one(a, `select count(*)::int as n, count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'cancelled')::int as cancelled,
      count(*) filter (where status = 'scheduled')::int as scheduled, count(*) filter (where status = 'open')::int as open,
      count(*) filter (where status = 'open' and due_date < $5::date)::int as overdue from follow_ups f where ${where}`, args);
  const ST: Record<string, string> = { open: "Açık", scheduled: "Randevu verildi", done: "Yapıldı", cancelled: "İptal" };
  return {
    columns: [col("due", "Vade", "date"), col("patient", "Hasta"), col("reason", "Gerekçe"), col("practitioner", "Hekim"), col("statusLabel", "Durum", "badge"),
      col("appointmentAt", "Randevu", "datetime")],
    rows: list.map((x) => ({ due: x.due, patient: x.patient, reason: x.reason, practitioner: x.practitioner ?? "", status: x.status,
      statusLabel: x.overdue ? "Açık · gecikmiş" : ST[x.status], appointmentAt: x.appointment_at, _drill: { patientId: x.patient_id, tab: "iletisim" } })),
    totals: { count: t.n, open: t.open, overdue: t.overdue, scheduled: t.scheduled, done: t.done, cancelled: t.cancelled, completionRate: rate(t.done, t.n - t.cancelled) },
    totalLabels: { count: ["Kontrol", "int"], open: ["Açık", "int"], overdue: ["Gecikmiş", "int"], scheduled: ["Randevu verildi", "int"], done: ["Yapıldı", "int"],
      cancelled: ["İptal", "int"], completionRate: ["Takip tamamlama", "percent"] },
    notes: ["Takip tamamlama = yapıldı / (vadesi aralıkta olan − iptal). Otomatik mesaj teslimi tamamlanma sayılmaz."],
    truncated,
  };
};

const laboratuvar: Runner = async (a) => {
  const withCost = a.ctx.permissions.has("lab.cost");
  const today = localDate(new Date(), a.ctx.timezone);
  const st = a.p.status;
  const stWhere = st === "open" ? "lo.status in ('sent','in_production','revision')" : st === "overdue" ? "lo.status in ('sent','in_production','revision') and lo.target_date < $5::date"
    : st === "received" ? "lo.status = 'received'" : st === "accepted" ? "lo.status = 'accepted'" : st === "cancelled" ? "lo.status = 'cancelled'" : "true";
  const args = [a.r.fromUtc, a.r.toUtc, uuidOrNull(a.p.supplierId), prac(a), today];
  // Anlık durum süzgeçleri (açık / geciken / kabul bekleyen) tarih aralığından bağımsızdır; diğerleri açılış tarihine göre.
  const current = st === "open" || st === "overdue" || st === "received";
  const where = `${current ? "$1::timestamptz is not null and $2::timestamptz is not null" : "lo.created_at >= $1 and lo.created_at < $2"}
    and ($3::uuid is null or lo.supplier_id = $3) and ($4::uuid is null or lo.practitioner_id = $4) and ${stWhere}`;
  const { list, truncated } = await rows(a,
    `select lo.id, lo.order_no, lo.created_at, lo.work_type, lo.teeth, lo.status, lo.target_date::text as target, lo.revision_count, lo.patient_id,
            p.first_name || ' ' || p.last_name as patient, s.name as lab, pr.display_name as practitioner,
            (lo.status in ('sent','in_production','revision') and lo.target_date < $5::date) as overdue,
            coalesce((select sum(lc.amount) from lab_costs lc where lc.lab_order_id = lo.id), 0)::numeric(14,2)::numeric(14,2)::text as cost
       from lab_orders lo join patients p on p.id = lo.patient_id join suppliers s on s.id = lo.supplier_id join practitioners pr on pr.id = lo.practitioner_id
      where ${where} order by lo.order_no`, args);
  const t = await one(a, `select count(*)::int as n, count(*) filter (where lo.status in ('sent','in_production','revision') and lo.target_date < $5::date)::int as overdue,
      count(*) filter (where lo.status = 'accepted')::int as accepted, coalesce(sum(lo.revision_count), 0)::int as revisions,
      (select coalesce(sum(lc.amount), 0) from lab_costs lc join lab_orders lo on lo.id = lc.lab_order_id where ${where})::numeric(14,2)::text as cost
      from lab_orders lo where ${where}`, args);
  const ST: Record<string, string> = { draft: "Taslak", sent: "Gönderildi", in_production: "Üretimde", received: "Kabul bekliyor", revision: "Revizyonda", accepted: "Kabul edildi", cancelled: "İptal" };
  return {
    columns: [col("orderNo", "No", "int"), col("createdAt", "Açılış", "datetime"), col("patient", "Hasta"), col("lab", "Laboratuvar"), col("work", "İş"),
      col("statusLabel", "Aşama", "badge"), col("target", "Hedef teslim", "date"), col("revisions", "Revizyon", "int"), ...(withCost ? [col("cost", "Maliyet", "money")] : [])],
    rows: list.map((x) => ({ orderNo: x.order_no, createdAt: x.created_at, patient: x.patient, lab: x.lab, work: `${x.work_type}${x.teeth.length ? ` · ${x.teeth.join(", ")}` : ""}`,
      status: x.status, statusLabel: x.overdue ? `${ST[x.status]} · gecikmiş` : ST[x.status], target: x.target, revisions: x.revision_count, ...(withCost ? { cost: x.cost } : {}),
      _drill: { labOrderId: x.id, patientId: x.patient_id } })),
    totals: { count: t.n, overdue: t.overdue, accepted: t.accepted, revisions: t.revisions, ...(withCost ? { cost: t.cost } : {}) },
    totalLabels: { count: ["İş emri", "int"], overdue: ["Geciken", "int"], accepted: ["Kabul edilen", "int"], revisions: ["Revizyon", "int"],
      ...(withCost ? { cost: ["Maliyet (cari borç)", "money"] as [string, "money"] } : {}) },
    notes: ["“Açık”, “geciken” ve “kabul bekliyor” süzgeçleri anlık durumdur (tarih aralığından bağımsız); diğerleri iş emrinin açılış tarihine göredir.",
      "Teslim alındı ≠ kabul edildi; revizyon yeni aşama ve (varsa) yeni maliyettir."],
    truncated,
  };
};

const mesaj: Runner = async (a) => {
  const args = [a.r.fromUtc, a.r.toUtc, pick(a.p.status, ["queued", "submitted", "delivered", "failed", "unknown", "cancelled"] as const)];
  const where = "m.created_at >= $1 and m.created_at < $2 and ($3::text is null or m.status = $3)";
  const { list, truncated } = await rows(a,
    `select m.id, m.created_at, m.channel, m.purpose, m.recipient_masked, m.status, m.status_reason, m.patient_id, p.first_name || ' ' || p.last_name as patient
       from messages m join patients p on p.id = m.patient_id where ${where} order by m.created_at`, args);
  const t = await one(a, `select count(*)::int as n, count(*) filter (where status = 'delivered')::int as delivered, count(*) filter (where status = 'submitted')::int as submitted,
      count(*) filter (where status = 'failed')::int as failed, count(*) filter (where status = 'unknown')::int as unknown from messages m where ${where}`, args);
  const ST: Record<string, string> = { queued: "Kuyrukta", submitted: "İletildi (teslim bilinmiyor)", delivered: "Teslim edildi", failed: "Başarısız", unknown: "Bilinmiyor", cancelled: "İptal" };
  const PU: Record<string, string> = { appointment_reminder: "Randevu hatırlatma", treatment_followup: "Tedavi takibi", payment_reminder: "Ödeme hatırlatma", survey: "Anket", marketing: "Kampanya" };
  return {
    columns: [col("at", "Zaman", "datetime"), col("patient", "Hasta"), col("recipient", "Alıcı (maskeli)"), col("channel", "Kanal"), col("purpose", "Amaç"), col("statusLabel", "Durum", "badge")],
    rows: list.map((x) => ({ at: x.created_at, patient: x.patient, recipient: x.recipient_masked, channel: x.channel.toUpperCase(), purpose: PU[x.purpose] ?? x.purpose,
      status: x.status, statusLabel: ST[x.status], _drill: { patientId: x.patient_id, tab: "iletisim" } })),
    totals: { count: t.n, submitted: t.submitted, delivered: t.delivered, failed: t.failed, unknown: t.unknown },
    totalLabels: { count: ["Mesaj", "int"], submitted: ["İletildi", "int"], delivered: ["Teslim edildi", "int"], failed: ["Başarısız", "int"], unknown: ["Bilinmiyor", "int"] },
    notes: ["Sağlayıcı yalnız deneme. “İletildi” teslim değildir; teslim yalnız imzalı sağlayıcı bildirimiyle kaydedilir. Mesaj metni raporda gösterilmez."],
    truncated,
  };
};

// QA-105 / ADR-088: klinik çıktı belgeleri (ADR-085) yalnız `patient.health.read` ile listelenir; satırlar ve toplamlar aynı CTE'den.
const ONAM_CTE = `with d as (
  select pd.id, pd.issued_at, pd.title, pd.patient_id, dt.name as type_name,
         case when pd.status = 'revoked' then 'revoked' when cr.status in ('accepted','declined') then cr.status
              when cr.id is null then 'info' else 'pending' end as outcome
    from patient_documents pd join document_types dt on dt.id = pd.document_type_id left join consent_requests cr on cr.patient_document_id = pd.id
   where pd.issued_at >= $1 and pd.issued_at < $2 and ($4::boolean or dt.category <> 'clinical_output'))`;
const onam: Runner = async (a) => {
  const args = [a.r.fromUtc, a.r.toUtc, pick(a.p.status, ["pending", "accepted", "declined", "revoked"] as const), a.ctx.permissions.has("patient.health.read")];
  const { list, truncated } = await rows(a, `${ONAM_CTE} select d.*, p.first_name || ' ' || p.last_name as patient from d join patients p on p.id = d.patient_id
     where ($3::text is null or d.outcome = $3) order by d.issued_at`, args);
  const t = await one(a, `${ONAM_CTE} select count(*)::int as n, count(*) filter (where outcome = 'pending')::int as pending, count(*) filter (where outcome = 'accepted')::int as accepted,
     count(*) filter (where outcome = 'declined')::int as declined, count(*) filter (where outcome = 'revoked')::int as revoked from d where ($3::text is null or d.outcome = $3)`, args);
  const OUT: Record<string, string> = { info: "Bilgilendirme (karar gerekmez)", pending: "Karar bekliyor", accepted: "Kabul (yüz yüze)", declined: "Ret", revoked: "İptal" };
  return {
    columns: [col("at", "Üretim", "datetime"), col("patient", "Hasta"), col("type", "Belge türü"), col("title", "Başlık"), col("outcomeLabel", "Durum", "badge")],
    rows: list.map((x) => ({ at: x.issued_at, patient: x.patient, type: x.type_name, title: x.title, outcome: x.outcome, outcomeLabel: OUT[x.outcome],
      _drill: { patientId: x.patient_id, tab: "belgeler" } })),
    totals: { count: t.n, pending: t.pending, accepted: t.accepted, declined: t.declined, revoked: t.revoked },
    totalLabels: { count: ["Belge", "int"], pending: ["Karar bekliyor", "int"], accepted: ["Kabul", "int"], declined: ["Ret", "int"], revoked: ["İptal", "int"] },
    notes: ["Kabul kaydı elektronik imza değildir (ADR-033). Belge metni raporda gösterilmez."],
    truncated,
  };
};

// ------------------------------------------------------------------ stok ve cari
const stok: Runner = async (a) => {
  const today = localDate(new Date(), a.ctx.timezone);
  const soon = addDays(today, 60);
  const flag = pick(a.p.flag, ["low", "expiring"] as const);
  const base = `
    with b as (select i.id, i.code, i.name, i.unit, i.min_level, i.active, coalesce(sum(m.quantity), 0)::numeric(12,3) as bal
                 from stock_items i left join stock_movements m on m.item_id = i.id group by i.id),
         l as (select l.item_id, count(*) filter (where lb.bal > 0 and l.expiry_date is not null and l.expiry_date <= $2::date) as expiring,
                      count(*) filter (where lb.bal > 0 and l.expiry_date < $1::date) as expired,
                      min(l.expiry_date) filter (where lb.bal > 0) as next_expiry
                 from stock_lots l cross join lateral (select coalesce(sum(m.quantity), 0) as bal from stock_movements m where m.lot_id = l.id) lb group by l.item_id),
         f as (select b.*, coalesce(l.expiring, 0) as expiring, coalesce(l.expired, 0) as expired, l.next_expiry, (b.min_level > 0 and b.bal <= b.min_level) as low
                 from b left join l on l.item_id = b.id
                where ($3::text is null or ($3 = 'low' and b.min_level > 0 and b.bal <= b.min_level) or ($3 = 'expiring' and coalesce(l.expiring, 0) > 0)))`;
  const args = [today, soon, flag];
  const r = await a.c.query(`${base} select f.*, f.bal::text as bal_t, f.min_level::text as min_t, f.next_expiry::text as next_t from f order by f.name`, args);
  const t = await one(a, `${base} select count(*)::int as n, count(*) filter (where low)::int as low, coalesce(sum(expiring), 0)::int as expiring from f`, args);
  return {
    columns: [col("code", "Kod"), col("name", "Kalem"), col("balance", "Bakiye", "qty"), col("unit", "Birim"), col("minLevel", "En az", "qty"),
      col("nextExpiry", "En yakın SKT", "date"), col("flags", "Uyarı", "badge")],
    rows: r.rows.map((x) => ({ code: x.code, name: x.name, balance: x.bal_t, unit: x.unit, minLevel: x.min_t, nextExpiry: x.next_t,
      flags: [x.low ? "En az seviye" : "", Number(x.expired) > 0 ? `${x.expired} lot SKT geçmiş` : "", Number(x.expiring) > 0 ? `${x.expiring} lot SKT ≤ 60 gün` : "",
        !x.active ? "Pasif" : ""].filter(Boolean).join(" · ") })),
    totals: { items: t.n, low: t.low, expiringLots: t.expiring },
    totalLabels: { items: ["Kalem", "int"], low: ["En az seviye altı", "int"], expiringLots: ["SKT yaklaşan lot", "int"] },
    notes: ["Bakiye yalnız hareketlerden (giriş, kullanım, fire, sayım düzeltmesi, iade) hesaplanır; miktar elle ezilmez."],
  };
};

const cari: Runner = async (a) => {
  const args = [a.r.fromUtc, a.r.toUtc, uuidOrNull(a.p.supplierId)];
  const r = await a.c.query(
    `select s.id, s.name, s.kind,
            coalesce(sum(case when e.kind = 'bill' then e.amount else -e.amount end) filter (where e.occurred_at < $1), 0)::numeric(14,2)::text as opening,
            coalesce(sum(e.amount) filter (where e.kind = 'bill' and e.occurred_at >= $1 and e.occurred_at < $2), 0)::numeric(14,2)::text as billed,
            coalesce(sum(e.amount) filter (where e.kind = 'payment' and e.occurred_at >= $1 and e.occurred_at < $2), 0)::numeric(14,2)::numeric(14,2)::text as paid,
            coalesce(sum(case when e.kind = 'bill' then e.amount else -e.amount end) filter (where e.occurred_at < $2), 0)::numeric(14,2)::text as closing
       from suppliers s left join supplier_entries e on e.supplier_id = s.id where ($3::uuid is null or s.id = $3) group by s.id order by s.name`, args);
  const t = await one(a,
    `select coalesce(sum(case when e.kind = 'bill' then e.amount else -e.amount end) filter (where e.occurred_at < $1), 0)::numeric(14,2)::text as opening,
            coalesce(sum(e.amount) filter (where e.kind = 'bill' and e.occurred_at >= $1 and e.occurred_at < $2), 0)::numeric(14,2)::text as billed,
            coalesce(sum(e.amount) filter (where e.kind = 'payment' and e.occurred_at >= $1 and e.occurred_at < $2), 0)::numeric(14,2)::numeric(14,2)::text as paid,
            coalesce(sum(case when e.kind = 'bill' then e.amount else -e.amount end) filter (where e.occurred_at < $2), 0)::numeric(14,2)::text as closing
       from supplier_entries e where ($3::uuid is null or e.supplier_id = $3)`, args);
  const K: Record<string, string> = { lab: "Laboratuvar", medical: "Medikal firma", other: "Diğer" };
  return {
    columns: [col("name", "Tedarikçi"), col("kind", "Tür", "badge"), col("opening", "Açılış", "money"), col("billed", "Borç (fatura/maliyet)", "money"),
      col("paid", "Ödeme", "money"), col("closing", "Kapanış bakiyesi", "money")],
    rows: r.rows.map((x) => ({ name: x.name, kind: K[x.kind], opening: x.opening, billed: x.billed, paid: x.paid, closing: x.closing,
      _drill: { report: "cari", params: { from: a.r.from, to: a.r.to, supplierId: x.id } } })),
    totals: { opening: t.opening, billed: t.billed, paid: t.paid, closing: t.closing },
    totalLabels: { opening: ["Açılış", "money"], billed: ["Borç", "money"], paid: ["Ödeme", "money"], closing: ["Kapanış", "money"] },
    notes: ["Kapanış = açılış + borç − ödeme. Bakiye hareketlerden üretilir; düzeltme ters kayıtla yapılır. Pozitif bakiye kliniğin tedarikçiye borcudur."],
  };
};

// ------------------------------------------------------------------ denetim
const log: Runner = async (a) => {
  // 07.11.2026: ekranda yabancı terim yok — eylem, kayıt türü ve alan adları Türkçe etiketle; arama Türkçe etiket üzerinde.
  const prefix = a.p.action && /^[a-z_.]{2,60}$/.test(a.p.action) ? a.p.action : null;
  const q = (a.p.q ?? "").trim().toLocaleLowerCase("tr").slice(0, 60);
  const byLabel = q ? Object.entries(AUDIT_ACTION_LABELS).filter(([k, v]) => v.toLocaleLowerCase("tr").includes(q) || k.startsWith(q)).map(([k]) => k) : null;
  const et = a.p.entityType && /^[a-z_]{2,60}$/.test(a.p.entityType) ? a.p.entityType : null;
  // Klinik olaylar (anamnez/klinik not/bulgu-tanı) yalnız sağlık yetkisiyle listelenir (QA-001).
  const args = [a.r.fromUtc, a.r.toUtc, prefix, et, a.ctx.permissions.has("patient.health.read"), CLINICAL_ENTITY_TYPES, byLabel];
  // QA-102: klinik çıktı belgesi olayları da aynı kapıya tabidir; QA-108: gizli dosyanın (ADR-089) olayları da.
  const where = `e.created_at >= $1 and e.created_at < $2 and ($3::text is null or e.action like $3 || '%') and ($4::text is null or e.entity_type = $4) and ($7::text[] is null or e.action = any($7::text[])) and ($5::boolean or (e.entity_type <> all($6::text[]) and ${notClinicalOutputDocSql("e")} and ${notHiddenFileEventSql("e")} and ${notHiddenTaskEventSql("e")}))`;
  const { list, truncated } = await rows(a,
    `select e.id, e.created_at, e.action, e.entity_type, e.entity_id, e.patient_id, u.full_name as actor,
            (select array_agg(k order by k) from jsonb_object_keys(case when jsonb_typeof(e.changes) = 'object' then e.changes else '{}'::jsonb end) k) as fields,
            case when e.patient_id is null then null else upper(left(p.first_name, 1)) || '. ' || upper(left(p.last_name, 1)) || '. · ' || p.file_no end as patient_ref
       from audit_events e left join users u on u.id = e.actor_user_id left join patients p on p.id = e.patient_id
      where ${where} order by e.created_at desc, e.id desc`, args);
  const t = await one(a, `select count(*)::int as n, count(distinct e.actor_user_id)::int as actors from audit_events e where ${where}`, args);
  return {
    columns: [col("at", "Zaman", "datetime"), col("actor", "Kullanıcı"), col("action", "İşlem"), col("entity", "Kayıt"), col("patient", "Hasta (kısaltma · dosya)"), col("fields", "Değişen alanlar")],
    rows: list.map((x) => ({ at: x.created_at, actor: x.actor ?? "Sistem", action: auditActionLabel(x.action), actionCode: x.action, entityType: x.entity_type,
      entity: `${auditEntityLabel(x.entity_type)}${x.entity_id ? ` · ${String(x.entity_id).slice(0, 8)}` : ""}`,
      patient: x.patient_ref ?? "", fields: ((x.fields ?? []) as string[]).map(auditFieldLabel).join(", "), ...(x.patient_id ? { _drill: { patientId: x.patient_id, tab: "gecmis" } } : {}) })),
    totals: { count: t.n, actors: t.actors },
    totalLabels: { count: ["Kayıt", "int"], actors: ["Kullanıcı", "int"] },
    notes: ["Değer içerikleri (tutar, metin, kimlik) gösterilmez; yalnız değişen alanların adları. Hasta ayrıntısı için hasta kartı → Geçmiş."],
    truncated,
  };
};

// ------------------------------------------------------------------ analiz (metrik sözlüğü)
const isletme: Runner = async (a) => {
  const today = localDate(new Date(), a.ctx.timezone);
  const args = [a.r.fromUtc, a.r.toUtc];
  const m = await one(a,
    `select (select count(*) from patients where created_at >= $1 and created_at < $2)::int as new_patients,
            (select count(*) from appointments where status = 'completed' and starts_at >= $1 and starts_at < $2)::int as completed,
            (select count(*) from appointments where status = 'no_show' and starts_at >= $1 and starts_at < $2)::int as no_show,
            (select coalesce(sum(amount), 0) from performed_procedures where status = 'completed' and completed_at >= $1 and completed_at < $2)::numeric(14,2)::text as treatment,
            ((select coalesce(sum(amount), 0) from payments where paid_at >= $1 and paid_at < $2)
              - (select coalesce(sum(amount), 0) from refunds where refunded_at >= $1 and refunded_at < $2))::numeric(14,2)::text as net_collections,
            (select coalesce(sum(r.amount - r.allocated_amount), 0) from receivables r where r.status = 'active' and r.amount > r.allocated_amount)::numeric(14,2)::text as open_debt`, args);
  const pl = await one(a, `${PLAN_CTE} select count(*) filter (where outcome = 'accepted')::int as acc, count(*) filter (where outcome = 'rejected')::int as rej from f`,
    [a.r.fromUtc, a.r.toUtc, null]);
  const fu = await one(a, `select count(*)::int as n, count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'cancelled')::int as cancelled
      from follow_ups where due_date between $1::date and $2::date`, [a.r.from, a.r.to]);
  const lab = await one(a, "select count(*)::int as n from lab_orders where status in ('sent','in_production','revision') and target_date < $1::date", [today]);
  const rng = { from: a.r.from, to: a.r.to };
  const metrics: { key: string; label: string; value: string | number | null; type: ReportColumn["type"]; definition: string; drill?: { report: string; params: Record<string, string> } }[] = [
    { key: "newPatients", label: "Yeni hasta", value: m.new_patients, type: "int", definition: "Dönemde oluşturulan hasta kaydı; ziyaret eden hasta sayısı değildir.", drill: { report: "hekim-hasta", params: rng } },
    { key: "completedAppointments", label: "Gerçekleşen randevu", value: m.completed, type: "int", definition: "Durumu “tamamlandı” olan randevular (geliş ≠ tamamlandı).", drill: { report: "randevu", params: rng } },
    { key: "noShowRate", label: "Gelmeme oranı", value: rate(m.no_show, m.completed + m.no_show), type: "percent", definition: "Gelmedi / (tamamlandı + gelmedi); iptal ve gelecek randevu paydaya girmez.", drill: { report: "randevu", params: rng } },
    { key: "treatmentAmount", label: "Tedavi tutarı", value: m.treatment, type: "money", definition: "Tamamlanan işlemlerin snapshot bedeli; plan teklifi ve tahsilat değildir.", drill: { report: "tedavi", params: { ...rng, status: "completed" } } },
    { key: "netCollections", label: "Net tahsilat", value: m.net_collections, type: "money", definition: "Tahsilat − iade (işlem tarihi bazında); kâr değildir.", drill: { report: "aylik-ciro", params: rng } },
    { key: "openDebt", label: "Açık borç (bugün)", value: m.open_debt, type: "money", definition: "Etkin alacaklar − dağıtılan ödemeler; avans ayrı. Dönem filtresinden bağımsız anlık değer.", drill: { report: "borc-bakiye", params: {} } },
    { key: "planAcceptanceRate", label: "Plan kabul oranı", value: rate(pl.acc, pl.acc + pl.rej), type: "percent", definition: "Kabul / (kabul + ret) — dönemde sunulan teklif sürümleri; kararsızlar ayrı.", drill: { report: "plan", params: rng } },
    { key: "followUpCompletion", label: "Takip tamamlama", value: rate(fu.done, fu.n - fu.cancelled), type: "percent", definition: "Vadesi dönemde olan kontrollerden yapılanlar / (toplam − iptal).", drill: { report: "kontrol", params: rng } },
    { key: "labOverdue", label: "Geciken laboratuvar işi (bugün)", value: lab.n, type: "int", definition: "Hedef teslimi geçmiş, hâlâ laboratuvardaki iş emirleri.", drill: { report: "laboratuvar", params: { ...rng, status: "overdue" } } },
  ];
  return {
    columns: [col("label", "Metrik"), col("display", "Değer"), col("definition", "Tanım")],
    rows: metrics.map((x) => ({ key: x.key, label: x.label, value: x.value, valueType: x.type, display: x.value, definition: x.definition, ...(x.drill ? { _drill: x.drill } : {}) })),
    totals: {},
    totalLabels: {},
    notes: ["Koltuk doluluğu henüz ölçülmüyor: planlı kullanılabilir süre (çalışma saati − kapatma) ile kullanılan süre ayrımı sonraki sürümde (sözlükte tanımlı, uydurulmaz).",
      "Tutarlar KDV ayrımı yapılmadan kayıtlı tutardır; vergi gösterimi mali müşavir onayı bekliyor."],
  };
};

export const RUNNERS: Record<string, Runner> = {
  "gelir-gider": gelirGider, "nakit-hareketleri": nakit, "muhasebe-donem": muhasebeDonem, "aylik-ciro": aylikCiro, "borc-bakiye": borc, prim, "online-odeme": onlineOdeme,
  tedavi, "aylik-islem": aylikIslem, plan, "hekim-hasta": hekimHasta, randevu, kontrol, laboratuvar, mesaj, onam, stok, cari, log, isletme,
};
