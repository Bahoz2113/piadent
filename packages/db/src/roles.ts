/**
 * Veritabanı rollerini ve veritabanını oluşturur (idempotent).
 *
 *  viadent_owner  : tablo sahibi, yalnız migration/seed. Uygulama bu rolle BAĞLANMAZ.
 *  viadent_app    : API rolü. NOSUPERUSER, NOBYPASSRLS, tablo sahibi değil.
 *  viadent_worker : arka plan işçisi. NOBYPASSRLS; yalnız outbox/tenant listesi için ek politika.
 *  viadent_backup : yalnız yedek (pg_dump) ve geri yükleme doğrulaması. BYPASSRLS + yalnız SELECT; uygulama bu rolle BAĞLANMAZ.
 *                   Parolası tanımlı değilse rol oluşturulmaz (yedek alınamaz; bkz. docs/ops/backup-restore.md).
 */
import pg from "pg";
import { applyDbTuning } from "./db-tuning.js";
import { loadEnv, requireEnv } from "./env.js";

loadEnv();

const admin = new pg.Client({ connectionString: requireEnv("ADMIN_DATABASE_URL") });
const appPw = requireEnv("VIADENT_APP_DB_PASSWORD");
const ownerPw = requireEnv("VIADENT_OWNER_DB_PASSWORD");
const workerPw = process.env.VIADENT_WORKER_DB_PASSWORD ?? appPw;
const dbName = new URL(requireEnv("DATABASE_URL")).pathname.slice(1) || "viadent";

function lit(s: string) {
  return "'" + s.replace(/'/g, "''") + "'";
}

async function ensureRole(name: string, password: string, extra: string) {
  const r = await admin.query("select 1 from pg_roles where rolname = $1", [name]);
  const verb = r.rowCount ? "alter" : "create";
  await admin.query(`${verb} role ${name} with login password ${lit(password)} ${extra}`);
}

async function main() {
  await admin.connect();
  await ensureRole("viadent_owner", ownerPw, "nosuperuser nocreaterole nocreatedb nobypassrls");
  await ensureRole("viadent_app", appPw, "nosuperuser nocreaterole nocreatedb nobypassrls noinherit");
  await ensureRole("viadent_worker", workerPw, "nosuperuser nocreaterole nocreatedb nobypassrls noinherit");
  const backupPw = process.env.VIADENT_BACKUP_DB_PASSWORD;
  if (backupPw) await ensureRole("viadent_backup", backupPw, "nosuperuser nocreaterole nocreatedb bypassrls noinherit");
  const db = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
  if (!db.rowCount) await admin.query(`create database ${dbName} owner viadent_owner`);
  for (const testDb of [`${dbName}_test`]) {
    const t = await admin.query("select 1 from pg_database where datname = $1", [testDb]);
    if (!t.rowCount) await admin.query(`create database ${testDb} owner viadent_owner`);
  }
  await admin.end();
  for (const d of [dbName, `${dbName}_test`]) await applyDbTuning(requireEnv("ADMIN_DATABASE_URL"), d);
  console.log(`Roller hazır; veritabanları: ${dbName}, ${dbName}_test`);
}

main().catch((e) => {
  console.error("Rol kurulumu başarısız:", e.message);
  process.exit(1);
});
