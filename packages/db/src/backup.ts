/**
 * Şifreli yedek ve izole geri yükleme doğrulaması (AT-17, Plan §08: “yedek almak yeterli sayılmaz”).
 *
 *  yedek    : pg_dump (özel biçim, viadent_backup rolü: BYPASSRLS + yalnız okuma) + özel dosya deposu (tar)
 *             → her parça AES-256-GCM ile şifrelenir (scrypt anahtar türetme, rastgele tuz/IV, kimlik doğrulama etiketi)
 *             → manifest: tablo sayımları, kiracı bazında hasta/finans toplamları, dosya özetleri, şifreli parçaların SHA-256'sı.
 *  Yetkiler (GRANT) dökümle taşınır; roller küme düzeyindedir, hedef sunucuda önce `pnpm db:roles` çalışmalıdır.
 *  doğrulama: ayrı (izole) veritabanı oluşturulur → çözülür → pg_restore → depo ayrı dizine açılır → manifest yeniden hesaplanır
 *             → yedekteki manifestle karşılaştırılır; süreler (RTO bileşenleri) ve yedek yaşı (RPO) ölçülür; hedef DB silinir.
 * Parola/anahtar yedekle aynı yerde tutulmaz; manifest kişisel veri içermez (yalnız sayım/toplam/özet).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, createReadStream, createWriteStream, existsSync, openSync, readSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { applyDbTuning } from "./db-tuning.js";

const MAGIC = Buffer.from("VDBK1");

function keyFrom(pass: string, salt: Buffer) {
  if (!pass || pass.length < 16) throw new Error("BACKUP_ENCRYPTION_PASSPHRASE en az 16 karakter olmalı");
  return scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** Biçim: "VDBK1" | tuz(16) | iv(12) | şifreli veri | etiket(16). */
export async function encryptFile(src: string, dst: string, pass: string) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(pass, salt), iv);
  const out = createWriteStream(dst);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(createReadStream(src), cipher, out, { end: false });
  await new Promise<void>((res, rej) => out.end(cipher.getAuthTag(), (e?: Error | null) => (e ? rej(e) : res())));
}

export async function decryptFile(src: string, dst: string, pass: string) {
  const size = statSync(src).size;
  if (size < 33 + 16) throw new Error("Yedek dosyası çok kısa");
  const fd = openSync(src, "r");
  const head = Buffer.alloc(33), tag = Buffer.alloc(16);
  try { readSync(fd, head, 0, 33, 0); readSync(fd, tag, 0, 16, size - 16); } finally { closeSync(fd); }
  if (!head.subarray(0, 5).equals(MAGIC)) throw new Error("Yedek dosyası tanınmadı (VDBK1 değil)");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(pass, head.subarray(5, 21)), head.subarray(21, 33));
  decipher.setAuthTag(tag);
  // etiket uyuşmazsa (değiştirilmiş dosya / yanlış parola) final aşamasında hata fırlatır
  await pipeline(createReadStream(src, { start: 33, end: size - 17 }), decipher, createWriteStream(dst));
}

const fileSha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

export interface Manifest {
  format: "viadent-backup"; version: 1; createdAt: string; database: string; serverVersion: string;
  migrations: string[];
  tables: Record<string, number>;
  tenants: Record<string, { patients: number; activePatients: number; receivables: string; payments: string; refunds: string; allocations: string;
    cashNet: string; supplierBills: string; supplierPayments: string; commissionNet: string; stockMovements: number }>;
  files: { referenced: number; present: number; missing: number; digest: string };
  parts?: Record<string, { sha256: string; bytes: number }>;
}

/** Sayım ve toplamlar. RLS'i aşan bir rolle (yedek rolü veya yönetici) bağlanılmalıdır. */
export async function computeManifest(url: string, storageDir: string | null): Promise<Manifest> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await manifestWith(c, storageDir); } finally { await c.end(); }
}

/** Verilen bağlantının gördüğü anlık görüntüden manifest (yedekte pg_dump ile aynı snapshot). */
export async function manifestWith(c: pg.Client, storageDir: string | null): Promise<Manifest> {
  {
    const db = (await c.query("select current_database() as d, current_setting('server_version') as v")).rows[0];
    const tabs = (await c.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).rows;
    const tables: Record<string, number> = {};
    for (const t of tabs) tables[t.table_name] = Number((await c.query(`select count(*) from "${t.table_name}"`)).rows[0].count);
    const migrations = (await c.query("select name from schema_migrations order by name")).rows.map((r) => r.name);
    const ten = await c.query(
      `select t.slug,
              (select count(*) from patients p where p.tenant_id = t.id)::int as patients,
              (select count(*) from patients p where p.tenant_id = t.id and p.status = 'active')::int as active_patients,
              (select coalesce(sum(amount), 0) from receivables r where r.tenant_id = t.id and r.status = 'active')::numeric(14,2)::text as receivables,
              (select coalesce(sum(amount), 0) from payments x where x.tenant_id = t.id)::numeric(14,2)::text as payments,
              (select coalesce(sum(amount), 0) from refunds f where f.tenant_id = t.id)::numeric(14,2)::text as refunds,
              (select coalesce(sum(amount), 0) from allocations a where a.tenant_id = t.id)::numeric(14,2)::text as allocations,
              (select coalesce(sum(amount), 0) from cash_movements m where m.tenant_id = t.id)::numeric(14,2)::text as cash_net,
              (select coalesce(sum(amount), 0) from supplier_entries e where e.tenant_id = t.id and e.kind = 'bill')::numeric(14,2)::text as supplier_bills,
              (select coalesce(sum(amount), 0) from supplier_entries e where e.tenant_id = t.id and e.kind = 'payment')::numeric(14,2)::text as supplier_payments,
              (select coalesce(sum(amount), 0) from commission_accruals ca where ca.tenant_id = t.id)::numeric(14,2)::text as commission_net,
              (select count(*) from stock_movements sm where sm.tenant_id = t.id)::int as stock_movements
         from tenants t order by t.slug`);
    const tenants: Manifest["tenants"] = {};
    for (const r of ten.rows) tenants[r.slug] = { patients: r.patients, activePatients: r.active_patients, receivables: r.receivables, payments: r.payments,
      refunds: r.refunds, allocations: r.allocations, cashNet: r.cash_net, supplierBills: r.supplier_bills, supplierPayments: r.supplier_payments,
      commissionNet: r.commission_net, stockMovements: r.stock_movements };
    const files = (await c.query("select object_key, sha256 from file_assets where status in ('available','quarantined') and object_key is not null order by object_key")).rows;
    let present = 0;
    const h = createHash("sha256");
    for (const f of files) {
      const p = storageDir ? join(storageDir, f.object_key) : null;
      const ok = !!p && existsSync(p) && fileSha(p) === f.sha256;
      if (ok) present++;
      h.update(`${f.object_key}:${f.sha256}:${ok ? 1 : 0}\n`);
    }
    return { format: "viadent-backup", version: 1, createdAt: new Date().toISOString(), database: db.d, serverVersion: db.v, migrations, tables, tenants,
      files: { referenced: files.length, present, missing: files.length - present, digest: h.digest("hex") } };
  }
}

/** Yedek al: DB dökümü + depo arşivi, şifreli; manifest yanında. Dönüş: yedek dizini. */
export async function runBackup(o: { backupUrl: string; storageDir: string; outDir: string; passphrase: string }): Promise<{ dir: string; manifest: Manifest; ms: number }> {
  const t0 = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dbName = new URL(o.backupUrl).pathname.slice(1);
  const dir = resolve(o.outDir, `viadent-${dbName}-${stamp}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const work = mkdtempSync(join(tmpdir(), "vdbk-"));
  try {
    // Manifest ve döküm AYNI anlık görüntüden: snapshot dışa aktarılır, pg_dump --snapshot ile aynı veriyi okur
    // (eşzamanlı yazımlar yanlış “uyuşmazlık” üretmez).
    const snap = new pg.Client({ connectionString: o.backupUrl });
    await snap.connect();
    let manifest: Manifest;
    try {
      await snap.query("begin isolation level repeatable read read only");
      const id = (await snap.query("select pg_export_snapshot() as s")).rows[0].s as string;
      execFileSync("pg_dump", ["--format=custom", `--snapshot=${id}`, `--file=${join(work, "db.dump")}`, `--dbname=${o.backupUrl}`], { stdio: "pipe" });
      manifest = await manifestWith(snap, existsSync(o.storageDir) ? o.storageDir : null);
      await snap.query("commit");
    } finally { await snap.end(); }
    const storageTar = join(work, "storage.tar");
    if (existsSync(o.storageDir)) execFileSync("tar", ["-cf", storageTar, "-C", o.storageDir, "."], { stdio: "pipe" });
    else execFileSync("tar", ["-cf", storageTar, "-T", "/dev/null"], { stdio: "pipe" });
    const parts: Manifest["parts"] = {};
    for (const [name, src] of [["db.dump", join(work, "db.dump")], ["storage.tar", storageTar]] as const) {
      const dst = join(dir, `${name}.enc`);
      await encryptFile(src, dst, o.passphrase);
      parts[name] = { sha256: fileSha(dst), bytes: statSync(dst).size };
    }
    manifest.parts = parts;
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    return { dir, manifest, ms: Date.now() - t0 };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

export interface RestoreReport {
  backupDir: string; target: string; ok: boolean; differences: string[];
  timingsMs: { decrypt: number; restore: number; verify: number; total: number };
  backupAgeMinutes: number; restored: Pick<Manifest, "tables" | "tenants" | "files">;
}

/** İzole veritabanına geri yükle ve mutabakat yap. adminUrl: sunucu yönetici bağlantısı (veritabanı oluşturma/silme). */
export async function restoreAndVerify(o: { backupDir: string; adminUrl: string; passphrase: string; target?: string; keep?: boolean; owner?: string }): Promise<RestoreReport> {
  const t0 = Date.now();
  const manifest = JSON.parse(readFileSync(join(o.backupDir, "manifest.json"), "utf8")) as Manifest;
  const differences: string[] = [];
  for (const [name, p] of Object.entries(manifest.parts ?? {})) {
    const f = join(o.backupDir, `${name}.enc`);
    if (!existsSync(f)) { differences.push(`${name}: parça yok`); continue; }
    if (fileSha(f) !== p.sha256) differences.push(`${name}: şifreli parça özeti uyuşmuyor (dosya değişmiş)`);
  }
  if (differences.length) throw new Error(`Yedek bütünlüğü bozuk: ${differences.join("; ")}`);
  const work = mkdtempSync(join(tmpdir(), "vdrs-"));
  const target = o.target ?? `viadent_restore_${Date.now()}`;
  if (!/^[a-z0-9_]{3,60}$/.test(target)) throw new Error("hedef veritabanı adı geçersiz");
  const admin = new pg.Client({ connectionString: o.adminUrl });
  await admin.connect();
  try {
    await decryptFile(join(o.backupDir, "db.dump.enc"), join(work, "db.dump"), o.passphrase);
    await decryptFile(join(o.backupDir, "storage.tar.enc"), join(work, "storage.tar"), o.passphrase);
    const t1 = Date.now();
    await admin.query(`drop database if exists ${target} with (force)`);
    await admin.query(`create database ${target} owner ${o.owner ?? "viadent_owner"}`);
    const targetUrl = new URL(o.adminUrl); targetUrl.pathname = `/${target}`;
    execFileSync("pg_restore", ["--exit-on-error", `--dbname=${targetUrl.toString()}`, join(work, "db.dump")], { stdio: "pipe" });
    await applyDbTuning(o.adminUrl, target); // katalog ayarı dökümle taşınmaz (ADR-047)
    const storage = join(work, "storage");
    mkdirSync(storage);
    execFileSync("tar", ["-xf", join(work, "storage.tar"), "-C", storage], { stdio: "pipe" });
    const t2 = Date.now();
    const restored = await computeManifest(targetUrl.toString(), storage);
    {
      const pc = new pg.Client({ connectionString: targetUrl.toString() });
      await pc.connect();
      try {
        const g = (await pc.query(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
                                    where s.nspname = 'public' and c.relkind = 'r' and c.relname <> 'schema_migrations'
                                      and not has_table_privilege('viadent_app', c.oid, 'select')`)).rows[0].n;
        if (g > 0) differences.push(`uygulama rolü ${g} tabloda okuma yetkisi almamış (GRANT taşınmadı)`);
        const nf = (await pc.query(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
                                     where s.nspname = 'public' and c.relkind = 'r' and c.relname <> 'schema_migrations' and exists
                                     (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'tenant_id')
                                     and not (c.relrowsecurity and c.relforcerowsecurity)`)).rows[0].n;
        if (nf > 0) differences.push(`${nf} kiracı tablosunda RLS zorunlu değil`);
      } finally { await pc.end(); }
    }
    const t3 = Date.now();
    for (const [t, n] of Object.entries(manifest.tables)) if (restored.tables[t] !== n) differences.push(`tablo ${t}: yedek ${n}, geri yüklenen ${restored.tables[t] ?? "yok"}`);
    for (const [slug, v] of Object.entries(manifest.tenants)) {
      const r = restored.tenants[slug];
      if (!r) { differences.push(`klinik ${slug}: yok`); continue; }
      for (const k of Object.keys(v) as (keyof typeof v)[]) if (String(v[k]) !== String(r[k])) differences.push(`klinik ${slug} ${k}: ${v[k]} ≠ ${r[k]}`);
    }
    if (manifest.files.digest !== restored.files.digest) differences.push(`dosyalar: yedek ${manifest.files.present}/${manifest.files.referenced}, geri yüklenen ${restored.files.present}/${restored.files.referenced}`);
    if (JSON.stringify(manifest.migrations) !== JSON.stringify(restored.migrations)) differences.push("migration listesi farklı");
    if (!o.keep) await admin.query(`drop database if exists ${target} with (force)`);
    return { backupDir: o.backupDir, target, ok: differences.length === 0, differences,
      timingsMs: { decrypt: t1 - t0, restore: t2 - t1, verify: t3 - t2, total: Date.now() - t0 },
      backupAgeMinutes: Math.round((Date.now() - Date.parse(manifest.createdAt)) / 60000),
      restored: { tables: restored.tables, tenants: restored.tenants, files: restored.files } };
  } finally {
    await admin.end();
    rmSync(work, { recursive: true, force: true });
  }
}

/** Saklama: en yeni N yedeği tut (eskiler silinir). */
export function pruneBackups(outDir: string, keep: number) {
  if (!existsSync(outDir)) return [];
  const dirs = readdirSync(outDir).filter((d) => d.startsWith("viadent-")).sort();
  const drop = dirs.slice(0, Math.max(0, dirs.length - keep));
  for (const d of drop) rmSync(join(outDir, d), { recursive: true, force: true });
  return drop;
}
