/**
 * YALNIZ YEREL PERFORMANS ÖLÇÜMÜ: ayrı bir veritabanında (varsayılan viadent_perf) tamamen sentetik büyük veri.
 *  - Normal sentetik seed (≥2 klinik, kullanıcılar) + büyük klinikte (demo-yesil) 100.000 hasta, 25 ek hekim, 1.000.000 randevu.
 *  - Randevular 2021-06 → 2026-12 arası, hekim başına çakışmasız 30 dk slot (09:00–19:00, İstanbul); geçmiştekiler
 *    tamamlandı/gelmedi/iptal, gelecektekiler planlı/onaylı. Diğer klinik küçük kalır (çapraz klinik etkisi ölçülür).
 * Kullanım: PERF_DB=viadent_perf pnpm --filter @viadent/db exec tsx src/perf-data.ts
 */
import pg from "pg";
import { normalizeSearch } from "@viadent/contracts";
import { loadEnv, requireEnv } from "./env.js";
import { migrate } from "./migrate.js";
import { seed } from "./seed.js";
import { applyDbTuning } from "./db-tuning.js";

loadEnv();
if (process.env.NODE_ENV === "production") throw new Error("perf-data üretimde kullanılamaz");
const PERF_DB = process.env.PERF_DB ?? "viadent_perf";
if (!/^[a-z0-9_]+_perf$/.test(PERF_DB)) throw new Error("PERF_DB adı *_perf ile bitmeli (yanlışlıkla gerçek veritabanına yazmamak için)");
const PATIENTS = Number(process.env.PERF_PATIENTS ?? 100_000);
const APPOINTMENTS = Number(process.env.PERF_APPOINTMENTS ?? 1_000_000);
const PRACS = 25;
// md5 tabanlı deterministik kimlik, RFC 4122 v4 biçiminde (sürüm 4, varyant 8): API uuid doğrulamasından geçer.
const V4 = (expr: string) => `(substr(md5(${expr}),1,12)||'4'||substr(md5(${expr}),14,3)||'8'||substr(md5(${expr}),18))::uuid`;

const owner = new URL(requireEnv("MIGRATION_DATABASE_URL")); owner.pathname = `/${PERF_DB}`;
const admin = new pg.Client({ connectionString: requireEnv("ADMIN_DATABASE_URL") });
await admin.connect();
await admin.query(`drop database if exists ${PERF_DB} with (force)`);
await admin.query(`create database ${PERF_DB} owner viadent_owner`);
await admin.end();
await applyDbTuning(requireEnv("ADMIN_DATABASE_URL"), PERF_DB);
const t0 = Date.now();
await migrate(owner.toString());
await seed(owner.toString(), { password: process.env.VIADENT_DEMO_PASSWORD || undefined });

const FIRST = ["Ayşe", "Fatma", "Emine", "Hatice", "Zeynep", "Elif", "Meryem", "Şerife", "Zehra", "Sultan", "Hanife", "Merve", "Özlem", "Büşra", "Esra", "İrem", "Gül", "Derya",
  "Mehmet", "Mustafa", "Ahmet", "Ali", "Hüseyin", "Hasan", "İbrahim", "İsmail", "Osman", "Yusuf", "Murat", "Ömer", "Ramazan", "Halil", "Süleyman", "Abdullah", "Mahmut", "Recep",
  "Emre", "Burak", "Can", "Çağrı", "Deniz", "Ece", "Görkem", "Kaan", "Selin", "Tuğba", "Ufuk", "Yağmur"];
const LAST = ["Yılmaz", "Kaya", "Demir", "Çelik", "Şahin", "Yıldız", "Yıldırım", "Öztürk", "Aydın", "Özdemir", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara", "Koç", "Kurt",
  "Özkan", "Şimşek", "Polat", "Özcan", "Korkmaz", "Çakır", "Erdoğan", "Yavuz", "Can", "Acar", "Şen", "Aktaş", "Güler", "Yalçın", "Güneş", "Bozkurt", "Bulut", "Keskin"];
const firsts = FIRST, lasts = LAST;
const searchFL = firsts.flatMap((f) => lasts.map((l) => normalizeSearch(`${f} ${l}`)));

const c = new pg.Client({ connectionString: owner.toString() });
await c.connect();
const ten = (await c.query("select id from tenants where slug = 'demo-yesil'")).rows[0].id as string;
await c.query("select set_config('app.tenant_id', $1, false)", [ten]);
const branch = (await c.query("select id from branches order by created_at limit 1")).rows[0].id;
const creator = (await c.query("select u.id from users u join memberships m on m.user_id = u.id where m.role = 'clinic_admin' limit 1")).rows[0].id;
const startNo = Number((await c.query("select coalesce(max(file_no), 0) as n from patients")).rows[0].n);

console.log(`hastalar (${PATIENTS})…`);
await c.query(
  `insert into patients(id, tenant_id, file_no, first_name, last_name, search_text, birth_date, gender, phone_e164, phone_digits, city, created_by, created_at)
   select ${V4("'perf-p' || g")}, $1, $2 + g,
          ($3::text[])[1 + (g % array_length($3::text[], 1))], ($4::text[])[1 + ((g / array_length($3::text[], 1)) % array_length($4::text[], 1))],
          ($5::text[])[1 + ((g % array_length($3::text[], 1)) * array_length($4::text[], 1)) + ((g / array_length($3::text[], 1)) % array_length($4::text[], 1))],
          date '1940-01-01' + (g * 7919 % 29000), case when g % 2 = 0 then 'female' else 'male' end,
          '+90555' || lpad((g % 10000000)::text, 7, '0'), '90555' || lpad((g % 10000000)::text, 7, '0'),
          (array['İstanbul','Ankara','İzmir','Bursa','Antalya'])[1 + g % 5], $6, now() - (g % 2000) * interval '1 day'
     from generate_series(1, $7::int) g`,
  [ten, startNo, firsts, lasts, searchFL, creator, PATIENTS]);
await c.query("insert into tenant_counters(tenant_id, name, value) values ($1,'patient_file_no',$2) on conflict (tenant_id, name) do update set value = excluded.value", [ten, startNo + PATIENTS]);

console.log(`${PRACS} ek hekim…`);
await c.query(`insert into practitioners(id, tenant_id, branch_id, display_name, title)
               select ${V4("'perf-h' || g")}, $1, $2, 'Perf Hekim ' || g, 'Dt.' from generate_series(1, $3::int) g`, [ten, branch, PRACS]);
await c.query(`insert into work_schedules(tenant_id, practitioner_id, weekday, start_min, end_min)
               select $1, ${V4("'perf-h' || g")}, w, 540, 1140 from generate_series(1, $2::int) g, generate_series(1, 6) w`, [ten, PRACS]);

console.log(`randevular (${APPOINTMENTS})…`);
const perPrac = Math.ceil(APPOINTMENTS / PRACS);
const chunk = 100_000;
for (let off = 0; off < APPOINTMENTS; off += chunk) {
  await c.query(
    `with s as (
       select g, (g / $3::int) as p, (g % $3::int) as k from generate_series($4::int, least($5::int, $4::int + $6::int) - 1) g
     ), t as (
       select g, p, ((date '2021-06-01' + (k / 20)::int) + time '09:00' + ((k % 20) * interval '30 minutes')) at time zone 'Europe/Istanbul' as st from s
     )
     insert into appointments(tenant_id, branch_id, patient_id, practitioner_id, starts_at, ends_at, status, cancel_reason, reason, created_by, created_at)
     select $1, $2, ${V4("'perf-p' || (1 + (g::bigint * 48271 % $7::int))")}, ${V4("'perf-h' || (1 + p)")}, st, st + interval '30 minutes',
            case when st > now() then (case when g % 3 = 0 then 'confirmed' else 'planned' end)
                 when g % 13 = 0 then 'cancelled' when g % 15 = 0 then 'no_show' else 'completed' end,
            case when st <= now() and g % 13 = 0 then 'Hasta erteledi (sentetik)' end,
            'Kontrol', $8, st - interval '7 days'
       from t`,
    [ten, branch, perPrac, off, APPOINTMENTS, chunk, PATIENTS, creator]);
  process.stdout.write(`  ${Math.min(off + chunk, APPOINTMENTS)}\n`);
}
await c.query("analyze");
const n = (await c.query("select (select count(*) from patients)::int as p, (select count(*) from appointments)::int as a")).rows[0];
await c.end();
console.log(JSON.stringify({ db: PERF_DB, tenant: "demo-yesil", patients: n.p, appointments: n.a, seconds: Math.round((Date.now() - t0) / 1000) }));
