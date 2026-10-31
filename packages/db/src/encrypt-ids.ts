/**
 * Geçiş komutu (ADR-059): düz metin `patients.national_id` → `national_id_enc` + `national_id_hmac`; düz metin boşaltılır.
 * Kullanım: pnpm db:encrypt-ids (önizleme) | pnpm db:encrypt-ids --apply. Sahip rolüyle, klinik başına RLS bağlamında; idempotent.
 * Düz metin sütunu, tüm ortamlar geçince ayrı migration'la kaldırılır.
 */
import pg from "pg";
import { loadEnv, requireEnv } from "./env.js";
import { encryptField, indexHash } from "./field-crypto.js";

export async function encryptNationalIds(url: string, apply: boolean): Promise<{ apply: boolean; tenants: number; rows: number }> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const rep = { apply, tenants: 0, rows: 0 };
  try {
    const tenants = (await c.query("select id from tenants order by id")).rows.map((r) => r.id as string);
    rep.tenants = tenants.length;
    for (const t of tenants) {
      await c.query("begin");
      await c.query("select set_config('app.tenant_id', $1, true)", [t]);
      const rows = (await c.query("select id, national_id from patients where national_id is not null for update")).rows;
      rep.rows += rows.length;
      if (apply) {
        for (const r of rows) {
          await c.query("update patients set national_id_enc = $2, national_id_hmac = $3, national_id = null where id = $1",
            [r.id, encryptField(r.national_id), indexHash(t, r.national_id)]);
        }
        if (rows.length) await c.query("insert into audit_events(tenant_id, action, entity_type, changes) values ($1,'system.national_id_encrypted','tenant',$2)",
          [t, JSON.stringify({ rows: { from: null, to: rows.length } })]);
      }
      await c.query(apply ? "commit" : "rollback");
    }
    return rep;
  } catch (e) { await c.query("rollback").catch(() => undefined); throw e; } finally { await c.end(); }
}

if (/[\\/]encrypt-ids\.(ts|js)$/.test(process.argv[1] ?? "")) {
  loadEnv();
  const apply = process.argv.includes("--apply");
  encryptNationalIds(requireEnv("MIGRATION_DATABASE_URL"), apply)
    .then((r) => { console.log(JSON.stringify(r)); if (!apply) console.log("Önizleme: hiçbir şey yazılmadı. Uygulamak için --apply."); })
    .catch((e) => { console.error("Geçiş başarısız:", (e as Error).message); process.exit(1); });
}
