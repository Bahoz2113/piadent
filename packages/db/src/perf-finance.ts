/**
 * Perf veritabanına finans/tedavi hacmi ekler (Görev 14, ADR-076): var olan sentetik perf DB'de (perf-data.ts sonrası)
 * tamamlanmış randevulara gerçekleşen işlem + alacak, çoğuna tam dağıtılmış ödeme + kasa hareketi yazar.
 * Yalnız *_perf veritabanına; defter kuralları (dağıtım tetikleyicisi) aynen çalışır — hayali tutarsız bakiye üretmez.
 * Kullanım: PERF_DB=viadent_perf PERF_PROCEDURES=300000 pnpm --filter @viadent/db exec tsx src/perf-finance.ts
 */
import pg from "pg";
import { loadEnv, requireEnv } from "./env.js";

loadEnv();
const PERF_DB = process.env.PERF_DB ?? "viadent_perf";
if (!/^[a-z0-9_]+_perf$/.test(PERF_DB)) throw new Error("PERF_DB adı *_perf ile bitmeli");
const N = Number(process.env.PERF_PROCEDURES ?? 300_000);
const PAY_RATIO = Number(process.env.PERF_PAY_RATIO ?? 0.8);
const V4 = (expr: string) => `(substr(md5(${expr}),1,12)||'4'||substr(md5(${expr}),14,3)||'8'||substr(md5(${expr}),18))::uuid`;

const owner = new URL(requireEnv("MIGRATION_DATABASE_URL")); owner.pathname = `/${PERF_DB}`;
const c = new pg.Client({ connectionString: owner.toString() });
await c.connect();
const t0 = Date.now();
const ten = (await c.query("select id from tenants where slug = 'demo-yesil'")).rows[0].id as string;
await c.query("select set_config('app.tenant_id', $1, false)", [ten]);
const existing = (await c.query("select count(*)::int as n from performed_procedures where external_ref like 'perf-%'")).rows[0].n as number;
if (existing > 0) { console.log(`zaten ${existing} perf işlem var; çıkılıyor`); await c.end(); process.exit(0); }
const creator = (await c.query("select u.id from users u join memberships m on m.user_id = u.id where m.role = 'clinic_admin' and m.tenant_id = $1 limit 1", [ten])).rows[0].id as string;
const member = (await c.query("select id from memberships where tenant_id = $1 and role = 'dentist' limit 1", [ten])).rows[0].id as string;
const cash = (await c.query("select id from cash_accounts where kind = 'cash' limit 1")).rows[0].id as string;
const procs = (await c.query("select id, code, name from procedures where active order by code")).rows as { id: string; code: string; name: string }[];
if (!procs.length) throw new Error("katalog boş");

console.log(`${N} gerçekleşen işlem + alacak…`);
// Tamamlanmış randevulardan N tanesi (eskiden yeniye), her biri bir işlem; bedel 600–7.500 ₺ katalog sırasına göre.
const amounts = ["600.00", "250.00", "1200.00", "1800.00", "2300.00", "3500.00", "1500.00", "7500.00"];
await c.query(
  `with a as (select id, tenant_id, branch_id, patient_id, practitioner_id, starts_at, row_number() over (order by starts_at) as rn
                from appointments where status = 'completed' and starts_at < now() order by starts_at limit $1)
   insert into performed_procedures(id, tenant_id, patient_id, appointment_id, procedure_id, procedure_code, procedure_name, location_kind, tooth, quantity, amount, price_basis,
                                    practitioner_id, completed_by, completed_at, external_ref)
   select ${V4("'perf-pp' || a.rn")}, a.tenant_id, a.patient_id, a.id, p.id, p.code, p.name, 'tooth', (11 + (a.rn % 8))::text, 1, (($3::text[])[1 + (a.rn % 8)])::numeric, 'tariff',
          a.practitioner_id, $2, a.starts_at + interval '25 minutes', 'perf-' || a.rn
     from a join lateral (select id, code, name from procedures where active order by code offset (a.rn % $4::int) limit 1) p on true`,
  [N, member, amounts, procs.length]);
await c.query(
  `insert into receivables(id, tenant_id, patient_id, source, performed_procedure_id, description, amount, practitioner_id, due_date, created_by, created_at)
   select ${V4("'perf-rc' || pp.external_ref")}, pp.tenant_id, pp.patient_id, 'performed_procedure', pp.id, pp.procedure_name, pp.amount, pp.practitioner_id,
          (pp.completed_at at time zone 'Europe/Istanbul')::date + 30, $1, pp.completed_at
     from performed_procedures pp where pp.external_ref like 'perf-%'`, [creator]);

const pays = Math.floor(N * PAY_RATIO);
console.log(`${pays} ödeme + kasa hareketi + dağıtım (tetikleyici satır başına çalışır)…`);
await c.query(
  `insert into payments(id, tenant_id, patient_id, amount, method, cash_account_id, paid_at, received_by, created_at)
   select ${V4("'perf-py' || r.id")}, r.tenant_id, r.patient_id, r.amount, (array['cash','card_manual','bank_transfer'])[1 + (abs(hashtext(r.id::text)) % 3)], $2,
          r.created_at + interval '40 minutes', $3, r.created_at + interval '40 minutes'
     from (select id, tenant_id, patient_id, amount, created_at, row_number() over (order by created_at) as rn from receivables where performed_procedure_id is not null
             and performed_procedure_id in (select id from performed_procedures where external_ref like 'perf-%')) r
    where r.rn <= $1`, [pays, cash, creator]);
await c.query(
  `insert into cash_movements(tenant_id, cash_account_id, amount, source, source_id, occurred_at)
   select p.tenant_id, p.cash_account_id, p.amount, 'payment', p.id, p.paid_at from payments p
    where not exists (select 1 from cash_movements m where m.source = 'payment' and m.source_id = p.id)`);
const chunk = 20_000;
for (let off = 0; off < pays; off += chunk) {
  await c.query(
    `insert into allocations(tenant_id, payment_id, receivable_id, amount, created_by, created_at)
     select p.tenant_id, p.id, r.id, p.amount, $3, p.paid_at
       from (select id, tenant_id, patient_id, amount, paid_at, row_number() over (order by paid_at) as rn from payments
              where id in (select ${V4("'perf-py' || id")} from receivables)) p
       join receivables r on ${V4("'perf-py' || r.id")} = p.id
      where p.rn > $1 and p.rn <= $2
        and not exists (select 1 from allocations a where a.payment_id = p.id)`, [off, off + chunk, creator]);
  process.stdout.write(`  ${Math.min(off + chunk, pays)}\n`);
}
await c.query("analyze");
const n = (await c.query(`select (select count(*) from performed_procedures)::int as pp, (select count(*) from receivables)::int as rc, (select count(*) from payments)::int as py,
                                 (select count(*) from allocations)::int as al, (select coalesce(sum(amount),0)::text from receivables where status = 'active') as debt,
                                 (select coalesce(sum(amount),0)::text from allocations) as paid`)).rows[0];
await c.end();
console.log(JSON.stringify({ db: PERF_DB, ...n, seconds: Math.round((Date.now() - t0) / 1000) }));
