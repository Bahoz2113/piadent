/**
 * Kullanım:
 *   pnpm db:backup                       → şifreli yedek (BACKUP_DATABASE_URL, STORAGE_DIR, BACKUP_DIR, BACKUP_ENCRYPTION_PASSPHRASE)
 *   pnpm db:restore-verify [yedek-dizini] [--keep] [--target ad] → izole DB'ye geri yükle, mutabakat yap, süreleri yaz;
 *        hedef --keep yoksa silinir (varsayılan: en yeni yedek)
 * Çıktı kişisel veri içermez (sayım/toplam/süre). Parola komut satırından alınmaz.
 */
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { loadEnv, requireEnv } from "./env.js";
import { repoRoot } from "./files.js";
import { pruneBackups, restoreAndVerify, runBackup } from "./backup.js";

loadEnv();
const abs = (p: string) => (isAbsolute(p) ? p : join(repoRoot(), p));
const outDir = abs(process.env.BACKUP_DIR || ".backups");
const storageDir = abs(process.env.STORAGE_DIR || ".storage");
const pass = requireEnv("BACKUP_ENCRYPTION_PASSPHRASE");
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n: string) => argv.includes(n);
const opt = (n: string) => { const i = argv.indexOf(n); return i > 0 ? argv[i + 1] : undefined; };
const arg = argv.slice(1).find((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--target");

if (cmd === "backup") {
  const r = await runBackup({ backupUrl: requireEnv("BACKUP_DATABASE_URL"), storageDir, outDir, passphrase: pass });
  const keep = Number(process.env.BACKUP_KEEP ?? 14);
  const pruned = pruneBackups(outDir, keep);
  console.log(JSON.stringify({ ok: true, dir: r.dir, ms: r.ms, parts: r.manifest.parts, files: r.manifest.files,
    patients: Object.fromEntries(Object.entries(r.manifest.tenants).map(([k, v]) => [k, v.patients])), pruned: pruned.length }, null, 2));
} else if (cmd === "restore-verify") {
  let dir = arg ? abs(arg) : null;
  if (!dir) {
    const all = existsSync(outDir) ? readdirSync(outDir).filter((d) => d.startsWith("viadent-")).sort() : [];
    if (!all.length) throw new Error(`Yedek bulunamadı: ${outDir}`);
    dir = join(outDir, all[all.length - 1]!);
  }
  // --keep: doğrulanan veritabanı silinmez (geri dönüşte yeni üretim DB'si olarak kullanılır); --target ad: hedef DB adı
  const r = await restoreAndVerify({ backupDir: dir, adminUrl: requireEnv("ADMIN_DATABASE_URL"), passphrase: pass, keep: flag("--keep"), target: opt("--target") });
  console.log(JSON.stringify({ ok: r.ok, target: r.target, kept: flag("--keep"), differences: r.differences, timingsMs: r.timingsMs, backupAgeMinutes: r.backupAgeMinutes, files: r.restored.files }, null, 2));
  if (!r.ok) process.exitCode = 2;
} else {
  console.error("Kullanım: backup | restore-verify [dizin]");
  process.exitCode = 1;
}
