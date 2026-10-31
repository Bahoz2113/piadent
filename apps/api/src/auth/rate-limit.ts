/**
 * Giriş / davet / doğrulama denemesi sınırlayıcısı — PostgreSQL'de paylaşılan sayaç (Görev 8, ADR-053).
 * Birden çok API sürecinde aynı sınır geçerlidir; süreç yeniden başlayınca sıfırlanmaz. Anahtar SHA-256 özetiyle saklanır.
 * Pencere: ilk hatadan itibaren 15 dk. Sayaç pencere dolunca bir sonraki hatada 1'den başlar.
 */
import { createHash } from "node:crypto";
import type pg from "pg";

export const WINDOW_SECONDS = 15 * 60;
export const MAX_FAILS = 5;
/** Hesap başına üst sınır: IP değiştirerek parola denemeyi sınırlar (kilitleme DoS'una karşı eşik daha yüksek). */
export const ACCOUNT_MAX_FAILS = 20;

const h = (key: string) => createHash("sha256").update(key).digest();

export async function isLocked(pool: pg.Pool, key: string, max = MAX_FAILS): Promise<boolean> {
  const r = await pool.query("select fail_count from auth_throttle where key_hash = $1 and first_at > now() - make_interval(secs => $2)", [h(key), WINDOW_SECONDS]);
  return (r.rows[0]?.fail_count ?? 0) >= max;
}

export async function recordFail(pool: pg.Pool, key: string): Promise<void> {
  await pool.query(
    `insert into auth_throttle(key_hash, fail_count) values ($1, 1)
     on conflict (key_hash) do update set
       fail_count = case when auth_throttle.first_at <= now() - make_interval(secs => $2) then 1 else auth_throttle.fail_count + 1 end,
       first_at   = case when auth_throttle.first_at <= now() - make_interval(secs => $2) then now() else auth_throttle.first_at end`,
    [h(key), WINDOW_SECONDS]);
}

export async function clearFails(pool: pg.Pool, key: string): Promise<void> {
  await pool.query("delete from auth_throttle where key_hash = $1", [h(key)]);
}

export async function failCount(pool: pg.Pool, key: string): Promise<number> {
  const r = await pool.query("select fail_count from auth_throttle where key_hash = $1 and first_at > now() - make_interval(secs => $2)", [h(key), WINDOW_SECONDS]);
  return r.rows[0]?.fail_count ?? 0;
}

/** Kademeli gecikme (ADR-065): 3. hatadan itibaren (n-2)×400 ms, üst sınır maxMs. Kilide gelmeden tahmin hızını düşürür; üst sınır kilitleme DoS'unu büyütmez. */
export const BACKOFF_STEP_MS = 400;
export const BACKOFF_FROM_FAIL = 3;
export function backoffMs(fails: number, maxMs: number): number {
  if (maxMs <= 0 || fails < BACKOFF_FROM_FAIL) return 0;
  return Math.min((fails - BACKOFF_FROM_FAIL + 1) * BACKOFF_STEP_MS, maxMs);
}
