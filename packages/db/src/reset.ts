/** YALNIZ YEREL: veritabanını silip yeniden kurar (roller korunur). Üretimde çalıştırmayın. */
import pg from "pg";
import { loadEnv, requireEnv } from "./env.js";
import { migrate } from "./migrate.js";
import { applyDbTuning } from "./db-tuning.js";

loadEnv();
const url = new URL(requireEnv("MIGRATION_DATABASE_URL"));
const name = url.pathname.slice(1);
if (process.env.NODE_ENV === "production") throw new Error("reset üretimde kullanılamaz");
const admin = new pg.Client({ connectionString: requireEnv("ADMIN_DATABASE_URL") });
await admin.connect();
await admin.query(`drop database if exists ${name} with (force)`);
await admin.query(`create database ${name} owner viadent_owner`);
await admin.end();
await applyDbTuning(requireEnv("ADMIN_DATABASE_URL"), name); // katalog ayarı yeni DB'de yeniden (ADR-047)
await migrate(url.toString());
console.log(`${name} sıfırlandı. Sentetik veri için: pnpm db:seed`);
