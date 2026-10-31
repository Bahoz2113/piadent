import { loadEnv, requireEnv } from "@viadent/db";

loadEnv();
function withDb(url: string, db: string) {
  const u = new URL(url);
  u.pathname = "/" + db;
  return u.toString();
}
const base = new URL(requireEnv("DATABASE_URL")).pathname.slice(1);
export const TEST_DB = `${base}_test`;
export const APP_URL = withDb(requireEnv("DATABASE_URL"), TEST_DB);
export const OWNER_URL = withDb(requireEnv("MIGRATION_DATABASE_URL"), TEST_DB);
export const WORKER_URL = withDb(process.env.WORKER_DATABASE_URL ?? requireEnv("DATABASE_URL"), TEST_DB);
export const ADMIN_URL = requireEnv("ADMIN_DATABASE_URL");
/** Yalnız test veritabanı için sentetik parola; üretim veya demo ortamında kullanılmaz. */
export const TEST_PASSWORD = "synthetic-test-only-Pw1";
/** Yedek rolü (BYPASSRLS, yalnız okuma) test veritabanında. */
export const BACKUP_URL = process.env.BACKUP_DATABASE_URL ? withDb(process.env.BACKUP_DATABASE_URL, TEST_DB) : null;
