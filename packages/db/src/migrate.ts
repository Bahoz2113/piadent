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
        await precheck(client, file);
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

/**
 * Veri okuyan ön kontroller (ADR-077): migration'lar sahip rolüyle ve kiracı bağlamı OLMADAN koşar; FORCE RLS altında sahip de
 * kiracı satırlarını görmez. Bu yüzden SQL içindeki "satır var mı" kontrolleri (0013'teki gibi) sessizce 0 görür. Veri gerektiren
 * kontroller burada kiracı kiracı yapılır; yeni migration'lar veri yazarken app.for_each_tenant() kullanır (0020).
 */
async function precheck(client: pg.Client, file: string) {
  if (file === "0013_drop_plain_national_id.sql") {
    const col = await client.query("select 1 from information_schema.columns where table_name = 'patients' and column_name = 'national_id'");
    if (!col.rowCount) return;
    const tenants = (await client.query("select id from tenants")).rows as { id: string }[];
    let n = 0;
    for (const t of tenants) {
      await client.query("select set_config('app.tenant_id', $1, true)", [t.id]);
      n += (await client.query("select count(*)::int as n from patients where national_id is not null")).rows[0].n as number;
    }
    await client.query("select set_config('app.tenant_id', '', true)");
    if (n > 0) throw new Error(`patients.national_id sütununda ${n} düz metin kayıt var; önce \`pnpm db:encrypt-ids --apply\` çalıştırın`);
  }
}

