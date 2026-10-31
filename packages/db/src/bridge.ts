/**
 * VİA Köprü — dış sağlayıcı katmanı (port/adapter). Worker ve API ortak kullanır.
 *  - Sağlayıcı kabulü (transport: accepted/rejected/unknown/dead) ile işin nihai sonucu (outcome) ayrıdır.
 *  - Sağlayıcı çağrısı DB transaction'ı dışında yapılır: önce iş "sending" işaretlenir, sonra sonuç ayrı transaction'da yazılır.
 *  - Zaman aşımı = sonuç bilinmiyor: kör yeniden gönderim yerine aynı idempotency anahtarıyla durum sorgusu (mutabakat).
 *  - Gerçek sağlayıcı sözleşmesi/test erişimi yok: yalnız açık etiketli MOCK adaptör (ADR-037). Canlı gönderim ayrı kapıdır.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { withContext } from "./context.js";

// ------------------------------------------------------------------ sır şifreleme (sürümlü anahtar halkası, ADR-052)
// VIADENT_SECRET_KEY: güncel anahtar (32 bayt base64) — yeni şifrelemeler bununla yapılır.
// VIADENT_SECRET_KEYS_OLD: virgülle ayrılmış eski anahtarlar — yalnız çözmek için (döndürme sonrası geçiş dönemi).
// Biçim v2: "v2.<kid>.<iv>.<etiket>.<veri>"; kid = anahtarın SHA-256 özetinin ilk 8 hanesi (anahtarı ele vermez).
// Eski biçim v1 (kid'siz) okunmaya devam eder; `pnpm db:rotate-keys` hepsini güncel anahtarla yeniden yazar.
function parseKey(k: string, name: string): Buffer {
  const b = Buffer.from(k.trim(), "base64");
  if (b.length !== 32) throw new Error(`${name} 32 bayt (base64) olmalı`);
  return b;
}
export const keyId = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8);
function keyring(): { current: Buffer; all: Buffer[] } {
  const k = process.env.VIADENT_SECRET_KEY;
  if (!k) throw new Error("VIADENT_SECRET_KEY tanımlı değil (.env.example)");
  const current = parseKey(k, "VIADENT_SECRET_KEY");
  const old = (process.env.VIADENT_SECRET_KEYS_OLD ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => parseKey(x, "VIADENT_SECRET_KEYS_OLD"));
  return { current, all: [current, ...old] };
}
export function currentKeyId(): string { return keyId(keyring().current); }
/** Güncel anahtarın kendisi (yalnız türetme için; dışa yazılmaz). */
export function currentKeyBuffer(): Buffer { return keyring().current; }
export function encryptSecret(plain: string): string {
  const key = keyring().current;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v2.${keyId(key)}.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}
function open(key: Buffer, iv: string, tag: string, enc: string): string {
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}
export function decryptSecret(blob: string): string {
  const parts = blob.split(".");
  const { all } = keyring();
  if (parts[0] === "v2" && parts.length === 5) {
    const [, kid, iv, tag, enc] = parts as [string, string, string, string, string];
    const key = all.find((k) => keyId(k) === kid);
    if (!key) throw new Error(`şifreli sırrın anahtarı (${kid}) anahtar halkasında yok — VIADENT_SECRET_KEYS_OLD eksik`);
    return open(key, iv, tag, enc);
  }
  if (parts[0] === "v1" && parts.length === 4) {
    const [, iv, tag, enc] = parts as [string, string, string, string];
    for (const k of all) { try { return open(k, iv, tag, enc); } catch { /* sıradaki anahtar */ } }
    throw new Error("v1 sır hiçbir anahtarla çözülemedi");
  }
  throw new Error("şifreli sır biçimi tanınmadı");
}
/** Güncel anahtarla yazılmamışsa (v1 veya eski kid) döndürme gerekir. */
export function needsRotation(blob: string): boolean {
  const p = blob.split(".");
  return !(p[0] === "v2" && p[1] === currentKeyId());
}
export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

// ------------------------------------------------------------------ webhook imzası (HMAC-SHA256, zaman damgalı)
export const WEBHOOK_TOLERANCE_SECONDS = 300;
export function signWebhook(secret: string, rawBody: string, t = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${sig}`;
}
export function verifyWebhook(secret: string, rawBody: string, header: string | undefined, nowSec = Math.floor(Date.now() / 1000)):
  { ok: true; t: number } | { ok: false; reason: "signature_invalid" | "timestamp_out_of_window" } {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1 ?? "";
  if (!Number.isFinite(t) || !/^[0-9a-f]{64}$/.test(v1)) return { ok: false, reason: "signature_invalid" };
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v1, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature_invalid" };
  if (Math.abs(nowSec - t) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: "timestamp_out_of_window" };
  return { ok: true, t };
}

// ------------------------------------------------------------------ sağlayıcı portu
export type Operation = "sms.send" | "payment.create_link" | "payment.refund";
export type SubmitResult =
  | { outcome: "accepted"; providerRef: string; data?: Record<string, string> }
  | { outcome: "rejected"; code: string; message: string };
export class ProviderError extends Error {
  constructor(public readonly kind: "timeout" | "unavailable", message: string) { super(message); }
}
export interface ProviderAdapter {
  readonly id: string;
  readonly label: string;
  readonly isMock: boolean;
  supports(op: Operation): boolean;
  /** Aynı idempotency anahtarıyla tekrarlanan çağrı aynı sonucu döndürmeli (sağlayıcı tarafı tekilleştirme). */
  submit(op: Operation, payload: Record<string, unknown>, idempotencyKey: string): Promise<SubmitResult>;
  /** Sonucu belirsiz kalan isteğin durumunu anahtarla sorgular (mutabakat). */
  query(op: Operation, idempotencyKey: string): Promise<SubmitResult | { outcome: "not_found" }>;
}

export interface MockConfig { behavior?: "accept" | "reject" | "timeout" | "unavailable"; queryResult?: "accepted" | "not_found" }

/**
 * MOCK sağlayıcı — HİÇBİR şey dışarı gönderilmez. Davranış bağlantı ayarından gelir (test/demo için):
 * accept | reject | timeout (istek sağlayıcıya ulaşmış ama yanıt gelmemiş gibi) | unavailable (5xx benzeri, yeniden denenebilir).
 * Sağlayıcı referansı anahtardan deterministik türetilir → aynı anahtar = aynı referans (idempotent).
 */
export class MockProviderAdapter implements ProviderAdapter {
  readonly id = "mock";
  readonly label = "MOCK sağlayıcı (gerçek gönderim/çekim yok)";
  readonly isMock = true;
  constructor(private readonly cfg: MockConfig = {}) {}
  supports(op: Operation) { return ["sms.send", "payment.create_link", "payment.refund"].includes(op); }
  private ref(op: Operation, key: string) {
    return `mock_${op.replace(/\W/g, "_")}_${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
  }
  private accepted(op: Operation, key: string): SubmitResult {
    const providerRef = this.ref(op, key);
    return { outcome: "accepted", providerRef, data: op === "payment.create_link" ? { checkoutUrl: `https://odeme.mock.invalid/odeme/${providerRef}` } : undefined };
  }
  async submit(op: Operation, _payload: Record<string, unknown>, key: string): Promise<SubmitResult> {
    switch (this.cfg.behavior ?? "accept") {
      case "reject": return { outcome: "rejected", code: "MOCK_REJECTED", message: "MOCK sağlayıcı isteği reddetti" };
      case "timeout": throw new ProviderError("timeout", "MOCK: yanıt zaman aşımı");
      case "unavailable": throw new ProviderError("unavailable", "MOCK: sağlayıcı geçici olarak kullanılamıyor (503)");
      default: return this.accepted(op, key);
    }
  }
  async query(op: Operation, key: string) {
    return (this.cfg.queryResult ?? "accepted") === "accepted" ? this.accepted(op, key) : { outcome: "not_found" as const };
  }
}

export interface Connection { id: string; kind: string; provider: string; mode: string; status: string; config: MockConfig }
/** Adaptör kaydı. MOCK dışı sağlayıcı yok; canlı mod ayrıca dağıtım kapısı ister (VIADENT_EXTERNAL_SEND_ENABLED). */
export type AdapterRegistry = (c: Connection) => ProviderAdapter | { unavailable: string };
export const defaultRegistry: AdapterRegistry = (c) => {
  if (c.status !== "active") return { unavailable: "Bağlantı etkin değil" };
  if (c.provider === "mock" && c.mode === "mock") return new MockProviderAdapter(c.config);
  if (c.mode === "live" && process.env.VIADENT_EXTERNAL_SEND_ENABLED !== "true") return { unavailable: "Canlı dış gönderim kapısı kapalı" };
  return { unavailable: `“${c.provider}” için doğrulanmış adaptör yok (sözleşme/test erişimi bekleniyor)` };
};

// ------------------------------------------------------------------ iş işleyici
export const backoffSeconds = (attempt: number) => Math.min(2 ** attempt * 15, 3600);
const SENDING_STALE_MINUTES = 5;

interface JobRow { id: string; tenant_id: string; operation: Operation; transport_status: string; idempotency_key: string; payload: Record<string, unknown>;
  attempts: number; max_attempts: number; source_type: string; source_id: string; connection_id: string }

/** Tüm aktif tenant'larda vadesi gelen işleri işler. Her iş: (1) kilitle + "sending" (2) sağlayıcı çağrısı (3) sonucu yaz. */
export async function processIntegrationJobs(pool: pg.Pool, registry: AdapterRegistry = defaultRegistry, now = new Date()): Promise<number> {
  const tenants = await pool.query("select id from tenants where status = 'active'");
  let n = 0;
  for (const t of tenants.rows) {
    // Çöken worker'dan kalan "sending" işler belirsizdir → mutabakata alınır.
    await withContext(pool, { tenantId: t.id, userId: null }, (c) => c.query(
      `update integration_jobs set transport_status = 'unknown', last_error = 'Gönderim yarıda kaldı; durum sorgulanacak', updated_at = now()
        where transport_status = 'sending' and updated_at < $1::timestamptz - make_interval(mins => $2)`, [now, SENDING_STALE_MINUTES]));
    for (;;) {
      const job = await withContext(pool, { tenantId: t.id, userId: null }, async (c) => {
        const r = await c.query(
          `select j.*, cn.id as cid, cn.kind, cn.provider, cn.mode, cn.status as cstatus, cn.config
             from integration_jobs j join integration_connections cn on cn.id = j.connection_id
            where j.transport_status in ('queued','unknown') and j.next_attempt_at <= $1
            order by j.next_attempt_at limit 1 for update of j skip locked`, [now]);
        const row = r.rows[0];
        if (!row) return null;
        const phase = row.transport_status === "unknown" ? "status_query" : "submit";
        await c.query("update integration_jobs set transport_status = 'sending', attempts = attempts + 1, updated_at = now() where id = $1", [row.id]);
        return { row: row as JobRow & { kind: string; provider: string; mode: string; cstatus: string; config: MockConfig; cid: string }, phase };
      });
      if (!job) break;
      n++;
      await runJob(pool, t.id, job.row, job.phase as "submit" | "status_query", registry, now);
    }
  }
  return n;
}

async function runJob(pool: pg.Pool, tenantId: string, j: JobRow & { kind: string; provider: string; mode: string; cstatus: string; config: MockConfig; cid: string },
  phase: "submit" | "status_query", registry: AdapterRegistry, now: Date) {
  const started = new Date();
  const attempt = j.attempts + 1;
  const adapter = registry({ id: j.cid, kind: j.kind, provider: j.provider, mode: j.mode, status: j.cstatus, config: j.config ?? {} });
  // SMS: gönderim anında iletişim izni yeniden kontrol edilir (Görev 4 kuralı).
  let payload = j.payload;
  if (phase === "submit" && j.operation === "sms.send") {
    const ok = await withContext(pool, { tenantId, userId: null }, async (c) => {
      const m = (await c.query("select patient_id, purpose, channel from messages where id = $1", [j.source_id])).rows[0];
      const pref = m && (await c.query("select status from communication_preferences where patient_id = $1 and purpose = $2 and channel = $3 order by recorded_at desc limit 1",
        [m.patient_id, m.purpose, m.channel])).rows[0];
      // Alıcı iş kaydında saklanmaz; gönderim anında hasta kaydından okunur (veri en aza indirme).
      const p = m && (await c.query("select phone_e164, email from patients where id = $1", [m.patient_id])).rows[0];
      const to = m?.channel === "email" ? p?.email : p?.phone_e164;
      if (pref?.status === "granted" && to) { payload = { ...j.payload, to }; return true; }
      if (pref?.status === "granted") {
        await finish(c, tenantId, j, { transport: "cancelled", outcome: "failed", error: "Alıcı bilgisi yok" }, attempt, phase, "rejected", started);
        await sideEffectFailed(c, tenantId, j, "Alıcı bilgisi yok");
        return false;
      }
      await finish(c, tenantId, j, { transport: "cancelled", outcome: "not_applicable", error: "Gönderim anında iletişim izni yok" }, attempt, phase, "rejected", started);
      await c.query("update messages set status = 'cancelled', status_reason = 'Gönderim anında iletişim izni yok', status_at = now() where id = $1", [j.source_id]);
      await c.query("insert into delivery_events(tenant_id, message_id, status, source, detail) values ($1,$2,'cancelled','system','İzin geri çekilmiş')", [tenantId, j.source_id]);
      return false;
    });
    if (!ok) return;
  }
  if ("unavailable" in adapter) {
    await withContext(pool, { tenantId, userId: null }, async (c) => {
      await finish(c, tenantId, j, { transport: "dead", outcome: "failed", error: adapter.unavailable }, attempt, phase, "error", started);
      await sideEffectFailed(c, tenantId, j, adapter.unavailable);
      await deadTask(c, tenantId, j, adapter.unavailable);
    });
    return;
  }
  let result: SubmitResult | { outcome: "not_found" } | null = null;
  let err: ProviderError | Error | null = null;
  try {
    result = phase === "submit" ? await adapter.submit(j.operation, payload, j.idempotency_key) : await adapter.query(j.operation, j.idempotency_key);
  } catch (e) { err = e as Error; }

  await withContext(pool, { tenantId, userId: null }, async (c) => {
    if (result?.outcome === "accepted") {
      await finish(c, tenantId, j, { transport: "accepted", outcome: "pending", providerRef: result.providerRef }, attempt, phase, "accepted", started);
      await sideEffectAccepted(c, tenantId, j, result.providerRef, result.data, adapter.label);
    } else if (result?.outcome === "rejected") {
      await finish(c, tenantId, j, { transport: "rejected", outcome: "failed", error: `${result.code}: ${result.message}` }, attempt, phase, "rejected", started);
      await sideEffectFailed(c, tenantId, j, result.message);
    } else if (result?.outcome === "not_found") {
      // Sağlayıcı isteği hiç almamış: aynı anahtarla yeniden göndermek güvenli.
      await finish(c, tenantId, j, { transport: "queued", next: new Date(now.getTime() + backoffSeconds(attempt) * 1000), error: "Sağlayıcıda kayıt yok; yeniden gönderilecek" },
        attempt, phase, "not_found", started);
    } else {
      const kind = err instanceof ProviderError ? err.kind : "unavailable";
      const msg = (err?.message ?? "bilinmeyen hata").slice(0, 300);
      if (attempt >= j.max_attempts) {
        await finish(c, tenantId, j, { transport: "dead", outcome: kind === "timeout" ? "unknown" : "failed", error: `Deneme sınırı doldu: ${msg}` }, attempt, phase, kind === "timeout" ? "timeout" : "error", started);
        if (kind === "timeout" && j.operation === "sms.send") {
          // Sağlayıcıya ulaşıp ulaşmadığı bilinmiyor: “başarısız” da “gönderildi” de denmez.
          await c.query("update messages set status = 'unknown', status_reason = 'Sağlayıcıdan yanıt alınamadı; durum doğrulanamadı', status_at = now() where id = $1 and status = 'queued'", [j.source_id]);
          await c.query("insert into delivery_events(tenant_id, message_id, status, source, detail) values ($1,$2,'unknown','timeout','Deneme sınırı doldu; sonuç bilinmiyor')", [tenantId, j.source_id]);
        } else if (kind !== "timeout") {
          await sideEffectFailed(c, tenantId, j, `Deneme sınırı doldu: ${msg}`);
        }
        await deadTask(c, tenantId, j, msg);
      } else if (kind === "timeout") {
        // Yanıt yok ≠ başarısız: kör yeniden gönderim yok, durum sorgusu planlanır.
        await finish(c, tenantId, j, { transport: "unknown", next: new Date(now.getTime() + backoffSeconds(attempt) * 1000), error: msg }, attempt, phase, "timeout", started);
      } else {
        await finish(c, tenantId, j, { transport: phase === "status_query" ? "unknown" : "queued", next: new Date(now.getTime() + backoffSeconds(attempt) * 1000), error: msg },
          attempt, phase, "error", started);
      }
    }
  });
}

async function finish(c: pg.PoolClient, tenantId: string, j: JobRow,
  r: { transport: string; outcome?: string; providerRef?: string; next?: Date; error?: string }, attempt: number, phase: string, result: string, started: Date) {
  await c.query(
    `update integration_jobs set transport_status = $2,
            outcome_status = case when outcome_status in ('succeeded','failed') then outcome_status else coalesce($3, outcome_status) end,
            provider_ref = coalesce($4, provider_ref),
            next_attempt_at = coalesce($5, next_attempt_at), last_error = $6, updated_at = now(),
            completed_at = case when $2 in ('dead','cancelled','rejected') then now() else completed_at end
      where id = $1`, [j.id, r.transport, r.outcome ?? null, r.providerRef ?? null, r.next ?? null, r.error ?? null]);
  await c.query("insert into integration_attempts(tenant_id, job_id, attempt, kind, result, detail, started_at) values ($1,$2,$3,$4,$5,$6,$7)",
    [tenantId, j.id, attempt, phase, result, r.error ?? (r.providerRef ? `ref ${r.providerRef}` : null), started]);
}

async function sideEffectAccepted(c: pg.PoolClient, tenantId: string, j: JobRow, providerRef: string, data: Record<string, string> | undefined, label: string) {
  if (j.operation === "sms.send") {
    await c.query("update messages set status = 'submitted', provider_message_id = $2, submitted_at = now(), status_at = now(), status_reason = null where id = $1 and status in ('queued','unknown')",
      [j.source_id, providerRef]);
    await c.query("insert into delivery_events(tenant_id, message_id, status, source, detail) values ($1,$2,'submitted','provider',$3)", [tenantId, j.source_id, `${label}: kabul edildi`]);
  } else if (j.operation === "payment.create_link") {
    await c.query("update online_payment_requests set status = 'link_ready', checkout_url = $2, provider_ref = $3 where id = $1 and status = 'created'",
      [j.source_id, data?.checkoutUrl ?? null, providerRef]);
  }
}
async function sideEffectFailed(c: pg.PoolClient, tenantId: string, j: JobRow, reason: string) {
  if (j.operation === "sms.send") {
    await c.query("update messages set status = 'failed', status_reason = $2, status_at = now() where id = $1 and status in ('queued','submitted','unknown')", [j.source_id, reason]);
    await c.query("insert into delivery_events(tenant_id, message_id, status, source, detail) values ($1,$2,'failed','provider',$3)", [tenantId, j.source_id, reason]);
  } else if (j.operation === "payment.create_link") {
    await c.query("update online_payment_requests set status = 'failed', failure_reason = $2 where id = $1 and status in ('created','link_ready')", [j.source_id, reason]);
  }
}
async function deadTask(c: pg.PoolClient, tenantId: string, j: JobRow, reason: string) {
  await c.query(
    `insert into tasks(tenant_id, kind, source_type, source_id, dedupe_key, title, reason, next_step, assignee_role, due_at)
     values ($1,'integration_dead','integration_job',$2::uuid,'integration_dead:' || $2::text,'Dış işlem başarısız (VİA Köprü)',$3,
             'VİA Köprü ekranında hatayı inceleyin; sağlayıcı düzeldiyse yeniden deneyin veya gerekçeyle iptal edin.','clinic_admin', now())
     on conflict (tenant_id, dedupe_key) where status in ('open','in_progress','blocked') do nothing`,
    [tenantId, j.id, `${j.operation}: ${reason}`.slice(0, 400)]);
}
