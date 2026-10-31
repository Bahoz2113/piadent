/**
 * Havuz dayanıklılığı (QA-006). pg-pool, istemci havuzdan alınırken (`connect()`) kendi 'error' dinleyicisini kaldırır;
 * sorgu arası ya da transaction adımları arasında (BEGIN → set_config → iş → COMMIT) DB bağlantıyı keserse (57P01:
 * yeniden başlatma, failover, pooler geri dönüşümü) pg Client dinleyicisiz 'error' yayar → uncaughtException → süreç çöker.
 *
 * Çözüm: 'acquire' olayında her istemciye tek seferlik (işaretli) hata dinleyicisi. pg bu durumda `_queryable=false`
 * yapıp bekleyen sorguları reddeder; istek 5xx ile biter, `release()` istemciyi havuzdan düşürür (pg-pool `_release`
 * sorgulanamaz istemciyi kapatır). Dinleyici içinde `release(err)` ÇAĞRILMAZ: `withContext`'in `finally` dalındaki
 * `release()` ile çift bırakma hatasına yol açar.
 */
import type pg from "pg";

const GUARDED = Symbol.for("viadent.pool.clientErrorGuard");
type GuardedClient = pg.PoolClient & { [GUARDED]?: true };

export interface PoolGuardStats { clientErrors: number; idleErrors: number; lastErrorAt: string | null }

/** Havuza bağlantı hatası dinleyicileri ekler; sayaçları döner (sağlık ucu/metrik için). Mesajlar kırpılır, parametre/veri loglanmaz. */
export function guardPool(pool: pg.Pool, label: string): PoolGuardStats {
  const stats: PoolGuardStats = { clientErrors: 0, idleErrors: 0, lastErrorAt: null };
  const brief = (e: unknown) => `${(e as { code?: string })?.code ?? ""} ${String((e as Error)?.message ?? e).slice(0, 120)}`.trim();
  // Boştaki istemci (havuzda bekleyen) hatası: pg-pool istemciyi kendisi düşürür.
  pool.on("error", (e) => {
    stats.idleErrors++;
    stats.lastErrorAt = new Date().toISOString();
    console.error(`[${label}] boşta bağlantı hatası: ${brief(e)}`);
  });
  // Havuzdan alınmış istemci: sorgu arası gelen hata. Tek seferlik; istemci havuzda yaşadığı sürece dinleyici kalır.
  pool.on("acquire", (client: GuardedClient) => {
    if (client[GUARDED]) return;
    client[GUARDED] = true;
    client.on("error", (e) => {
      stats.clientErrors++;
      stats.lastErrorAt = new Date().toISOString();
      console.error(`[${label}] kullanımdaki bağlantı kesildi: ${brief(e)}`);
    });
  });
  return stats;
}

/** Bağlantı kesilmesi/erişilemezlik hatası mı? (503 kararı ve süreç düzeyinde "çökme" yerine log için.) */
export function isConnectionError(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? "";
  const msg = String((e as Error)?.message ?? "");
  return code === "57P01" || code === "57P02" || code === "57P03" || code.startsWith("08") || code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EPIPE"
    || /Connection terminated|not queryable|connection error/i.test(msg);
}
