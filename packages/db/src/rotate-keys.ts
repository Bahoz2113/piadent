/**
 * Sır anahtarı döndürme (ADR-052). Adımlar:
 *  1. Yeni anahtar üret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
 *  2. Ortamda VIADENT_SECRET_KEY = yeni, VIADENT_SECRET_KEYS_OLD = eski (virgülle) → API/worker yeniden başlat (ikisini de okur)
 *  3. `pnpm db:rotate-keys` (önizleme) → `pnpm db:rotate-keys --apply` (tüm sırları yeni anahtarla yeniden yazar)
 *  4. Tekrar önizleme 0 gösterince eski anahtarı VIADENT_SECRET_KEYS_OLD'dan çıkar → yeniden başlat.
 * Kapsam: entegrasyon webhook sırları (klinik başına, RLS bağlamında) ve kullanıcı MFA sırları. Sır değerleri hiçbir yere yazılmaz.
 * Sahip rolüyle (MIGRATION_DATABASE_URL) çalışır; FORCE RLS nedeniyle her klinik kendi bağlamında işlenir.
 */
import pg from "pg";
import { loadEnv, requireEnv } from "./env.js";
import { currentKeyId, decryptSecret, encryptSecret, needsRotation } from "./bridge.js";

export interface RotationReport { keyId: string; apply: boolean; integrationSecrets: number; mfaSecrets: number; mfaPending: number; failed: number; tenants: number }

export async function rotateSecrets(url: string, apply: boolean): Promise<RotationReport> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const rep: RotationReport = { keyId: currentKeyId(), apply, integrationSecrets: 0, mfaSecrets: 0, mfaPending: 0, failed: 0, tenants: 0 };
  const rewrite = (blob: string | null) => {
    if (!blob || !needsRotation(blob)) return null;
    try { return encryptSecret(decryptSecret(blob)); } catch { rep.failed++; return null; }
  };
  try {
    const tenants = (await c.query("select id from tenants order by id")).rows.map((r) => r.id as string);
    rep.tenants = tenants.length;
    for (const t of tenants) {
      await c.query("begin");
      await c.query("select set_config('app.tenant_id', $1, true)", [t]);
      const rows = (await c.query("select id, webhook_secret_enc from integration_connections where webhook_secret_enc is not null for update")).rows;
      let n = 0;
      for (const r of rows) {
        const nb = rewrite(r.webhook_secret_enc);
        if (!nb) continue;
        n++;
        if (apply) await c.query("update integration_connections set webhook_secret_enc = $2 where id = $1", [r.id, nb]);
      }
      rep.integrationSecrets += n;
      if (apply && n) {
        await c.query(`insert into audit_events(tenant_id, action, entity_type, changes) values ($1, 'system.secret_key_rotated', 'tenant', $2)`,
          [t, JSON.stringify({ keyId: { from: null, to: rep.keyId }, integrationSecrets: { from: null, to: n } })]);
      }
      await c.query(apply ? "commit" : "rollback");
    }
    await c.query("begin");
    const users = (await c.query("select id, mfa_secret_enc, mfa_pending_enc from users where mfa_secret_enc is not null or mfa_pending_enc is not null for update")).rows;
    for (const u of users) {
      const s1 = rewrite(u.mfa_secret_enc), s2 = rewrite(u.mfa_pending_enc);
      if (s1) rep.mfaSecrets++;
      if (s2) rep.mfaPending++;
      if (apply && (s1 || s2)) {
        await c.query("update users set mfa_secret_enc = coalesce($2, mfa_secret_enc), mfa_pending_enc = coalesce($3, mfa_pending_enc) where id = $1", [u.id, s1, s2]);
      }
    }
    await c.query(apply ? "commit" : "rollback");
    return rep;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally { await c.end(); }
}

if (/[\\/]rotate-keys\.(ts|js)$/.test(process.argv[1] ?? "")) {
  loadEnv();
  const apply = process.argv.includes("--apply");
  rotateSecrets(requireEnv("MIGRATION_DATABASE_URL"), apply)
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      if (!apply) console.log("Önizleme: hiçbir şey yazılmadı. Uygulamak için --apply.");
      if (r.failed) { console.error(`${r.failed} sır çözülemedi: eski anahtar VIADENT_SECRET_KEYS_OLD'da mı?`); process.exitCode = 2; }
    })
    .catch((e) => { console.error("Döndürme başarısız:", (e as Error).message); process.exit(1); });
}
