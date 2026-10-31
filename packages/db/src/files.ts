/**
 * Özel dosya deposu ve zararlı içerik taraması (portlar + adaptörler). API ve worker ortak kullanır.
 *  - İçerik DB'ye gömülmez; DB'de metadata, hash ve durum tutulur (Plan §07).
 *  - Depo web kökünün dışında, yalnız sunucu sürecinin okuyabildiği dizindir (0700/0600). S3 uyumlu adaptör sonra eklenebilir.
 *  - Tarama bitmeden dosya "available" olmaz (DB tetikleyicisi de zorlar).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type pg from "pg";

// ------------------------------------------------------------------ depo portu
export interface StoragePort {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

export class LocalDiskStorage implements StoragePort {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private path(key: string): string {
    if (!/^[0-9a-f-]{36}\/\d{4}\/[0-9a-f-]{36}$/.test(key)) throw new Error("geçersiz nesne anahtarı");
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error("depo dışı yol");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    const tmp = `${p}.part`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, p); // yarım yazılmış dosya asla nesne anahtarında görünmez
  }
  async get(key: string) { return readFile(this.path(key)); }
  async exists(key: string) { try { await stat(this.path(key)); return true; } catch { return false; } }
}

/** Göreli STORAGE_DIR depo köküne (pnpm-workspace.yaml) göre çözülür; API ve worker farklı dizinden çalışsa da aynı depoyu görür. */
function repoRoot(): string {
  let d = process.cwd();
  for (let i = 0; i < 6; i++) { if (existsSync(join(d, "pnpm-workspace.yaml"))) return d; const up = dirname(d); if (up === d) break; d = up; }
  return process.cwd();
}
export function storageFromEnv(): StoragePort {
  const dir = process.env.STORAGE_DIR || ".storage";
  return new LocalDiskStorage(isAbsolute(dir) ? dir : join(repoRoot(), dir));
}
export const objectKey = (tenantId: string, fileId: string, at = new Date()) => `${tenantId}/${at.getUTCFullYear()}/${fileId}`;
export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

// ------------------------------------------------------------------ tür tespiti (imza baytları)
export function detectType(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

// ------------------------------------------------------------------ tarayıcı portu
export type ScanVerdict =
  | { verdict: "clean"; engine: string; detectedType: string }
  | { verdict: "infected"; engine: string; reason: string }     // → karantina
  | { verdict: "rejected"; engine: string; reason: string };    // → reddedildi (tür uyuşmazlığı vb.)
export interface ScannerPort { scan(data: Buffer, declaredType: string): Promise<ScanVerdict> }

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/**
 * Temel tarayıcı (VİADENT, "basic-1"): EICAR test imzası, çalıştırılabilir/komut dosyası başlıkları, beyan/gerçek tür uyuşmazlığı,
 * PDF içinde etkin içerik (JavaScript, Launch, gömülü dosya). TAM ANTİVİRÜS DEĞİLDİR — üretimde ClamAV (clamd) zorunludur (ADR-034).
 */
export class BasicScanner implements ScannerPort {
  async scan(data: Buffer, declaredType: string): Promise<ScanVerdict> {
    const engine = "viadent-basic-1";
    const latin = data.toString("latin1");
    if (latin.includes(EICAR)) return { verdict: "infected", engine, reason: "EICAR test imzası" };
    const head = data.subarray(0, 4);
    if (head.subarray(0, 2).toString("latin1") === "MZ" || head.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || latin.startsWith("#!")) {
      return { verdict: "infected", engine, reason: "Çalıştırılabilir dosya / komut dosyası" };
    }
    const detected = detectType(data);
    if (!detected) return { verdict: "rejected", engine, reason: "Dosya türü tanınmadı" };
    if (detected !== declaredType) return { verdict: "rejected", engine, reason: `Beyan edilen tür (${declaredType}) ile içerik (${detected}) uyuşmuyor` };
    if (detected === "application/pdf" && /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/.test(latin)) {
      return { verdict: "infected", engine, reason: "PDF içinde etkin içerik (JavaScript/Launch/gömülü dosya)" };
    }
    return { verdict: "clean", engine, detectedType: detected };
  }
}

/** ClamAV clamd INSTREAM istemcisi. Önce clamd, sonra temel kontroller (tür uyuşmazlığı) uygulanır. */
export class ClamdScanner implements ScannerPort {
  constructor(private readonly host: string, private readonly port: number, private readonly basic = new BasicScanner(), private readonly timeoutMs = 30_000) {}
  instream(data: Buffer): Promise<string> {
    return new Promise((resolveP, reject) => {
      const sock = createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => { sock.destroy(); reject(new Error("clamd zaman aşımı")); }, this.timeoutMs);
      sock.on("error", (e) => { clearTimeout(timer); reject(e); });
      sock.on("data", (d) => chunks.push(d));
      sock.on("end", () => { clearTimeout(timer); resolveP(Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim()); });
      sock.on("connect", () => {
        sock.write("zINSTREAM\0");
        for (let i = 0; i < data.length; i += 65536) {
          const part = data.subarray(i, i + 65536);
          const len = Buffer.alloc(4); len.writeUInt32BE(part.length);
          sock.write(len); sock.write(part);
        }
        sock.write(Buffer.alloc(4)); // bitiş
      });
    });
  }
  async scan(data: Buffer, declaredType: string): Promise<ScanVerdict> {
    const reply = await this.instream(data);
    if (/FOUND$/.test(reply)) return { verdict: "infected", engine: "clamav", reason: reply.replace(/^stream:\s*/, "") };
    if (!/OK$/.test(reply)) throw new Error(`clamd yanıtı anlaşılamadı: ${reply.slice(0, 80)}`);
    const b = await this.basic.scan(data, declaredType);
    return b.verdict === "clean" ? { ...b, engine: "clamav+viadent-basic-1" } : { ...b, engine: `clamav+${b.engine}` };
  }
}

export function scannerFromEnv(): ScannerPort {
  const h = process.env.CLAMD_HOST;
  return h ? new ClamdScanner(h, Number(process.env.CLAMD_PORT ?? 3310)) : new BasicScanner();
}

// ------------------------------------------------------------------ tarama işi (worker; tenant bağlamlı transaction içinde)
export async function scanFile(c: pg.PoolClient, tenantId: string, fileId: string, storage: StoragePort, scanner: ScannerPort): Promise<string> {
  const f = (await c.query("select id, status, object_key, declared_type, sha256, patient_id from file_assets where id = $1 for update", [fileId])).rows[0];
  if (!f || f.status !== "uploaded") return "skip";
  const data = await storage.get(f.object_key);
  if (sha256(data) !== f.sha256) {
    await c.query("update file_assets set status = 'rejected', status_reason = 'Depodaki içerik hash ile uyuşmuyor', scanned_at = now(), scan_engine = 'integrity' where id = $1", [fileId]);
    await c.query("insert into file_access_events(tenant_id, file_id, action, detail) values ($1,$2,'scan_rejected','hash uyuşmazlığı')", [tenantId, fileId]);
    return "rejected";
  }
  const v = await scanner.scan(data, f.declared_type);
  if (v.verdict === "clean") {
    await c.query("update file_assets set status = 'available', detected_type = $2, scan_engine = $3, scanned_at = now(), available_at = now() where id = $1", [fileId, v.detectedType, v.engine]);
    await c.query("insert into file_access_events(tenant_id, file_id, action, detail) values ($1,$2,'scan_clean',$3)", [tenantId, fileId, v.engine]);
    return "available";
  }
  const status = v.verdict === "infected" ? "quarantined" : "rejected";
  await c.query("update file_assets set status = $2, status_reason = $3, scan_engine = $4, scanned_at = now() where id = $1", [fileId, status, v.reason, v.engine]);
  await c.query("insert into file_access_events(tenant_id, file_id, action, detail) values ($1,$2,$3,$4)",
    [tenantId, fileId, v.verdict === "infected" ? "scan_infected" : "scan_rejected", v.reason]);
  if (status === "quarantined") {
    await c.query(
      `insert into tasks(tenant_id, kind, sensitivity, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
       values ($1,'file_quarantined','general','file',$2::uuid,$3,'file_quarantined:' || $2::text,'Karantinaya alınan dosya',
               'Yüklenen bir dosya zararlı içerik taramasından geçemedi ve karantinaya alındı: ' || $4,
               'Dosyayı açmayın. Kaynağını yükleyen kişiyle doğrulayın; gerekirse dosyayı gerekçeyle silin.', 'clinic_admin', now())
       on conflict (tenant_id, dedupe_key) where status in ('open','in_progress','blocked') do nothing`,
      [tenantId, fileId, f.patient_id, v.reason]);
  }
  return status;
}
