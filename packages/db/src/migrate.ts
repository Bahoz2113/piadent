/** Sıralı SQL migration çalıştırıcısı. Her dosya tek transaction'da uygulanır; checksum saklanır. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnv, requireEnv } from "./env.js";

// Paketlenmiş CLI'de (dist/migrate.js) de ../migrations; konteynerde MIGRATIONS_DIR ile ezilebilir.
const dir = process.env.MIGRATIONS_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function migrate(connectionString: string, log = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    const done = new Map(
      (await client.query("select name, checksum from schema_migrations")).rows.map((r) => [r.name, r.checksum]),
    );
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = readFileSync(join(dir, file), "utf8");
      const sum = createHash("sha256").update(sql).digest("hex");
      if (done.has(file)) {
        if (done.get(file) !== sum) throw new Error(`Uygulanmış migration değişmiş: ${file}. Yeni migration ekleyin.`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations(name, checksum) values ($1, $2)", [file, sum]);
        await client.query("commit");
        applied.push(file);
        log(`uygulandı: ${file}`);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`${file}: ${(e as Error).message}`);
      }
    }
    if (!applied.length) log("Bekleyen migration yok.");
  } finally {
    await client.end();
  }
  return applied;
}

// Yalnız bu dosya doğrudan çalıştırılınca (tsx src/migrate.ts veya paketlenmiş dist/migrate.js). import.meta.url
// karşılaştırması paketlenmiş API'de API'nin kendisine eşit olur ve açılışta migration çalıştırırdı (Görev 8).
if (/[\\/]migrate\.(ts|js)$/.test(process.argv[1] ?? "")) {
  loadEnv();
  migrate(requireEnv("MIGRATION_DATABASE_URL")).catch((e) => {
    console.error("Migration başarısız:", e.message);
    process.exit(1);
  });
}
