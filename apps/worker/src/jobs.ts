import pg from "pg";
import { documentsMaintenance, importRetentionDays, purgeAuthThrottle, purgeFileContents, purgeImportRows, refreshViaAkis, scanFile, scannerFromEnv, storageFromEnv, withContext, type ScannerPort, type StoragePort } from "@viadent/db";

export interface WorkerDeps { storage: StoragePort; scanner: ScannerPort }
let defaultDeps: WorkerDeps | null = null;
const deps = (d?: WorkerDeps) => d ?? (defaultDeps ??= { storage: storageFromEnv(), scanner: scannerFromEnv() });

const MAX_ATTEMPTS = 8;

/** Outbox'tan iş alır (SKIP LOCKED), aynı tenant'ın tekrar eden yenileme isteklerini birleştirir. */
export async function processOutbox(pool: pg.Pool, batch = 50, d?: WorkerDeps): Promise<number> {
  const client = await pool.connect();
  let claimed: { id: number; tenant_id: string; topic: string; attempts: number; payload: Record<string, string> }[] = [];
  try {
    await client.query("begin");
    const r = await client.query(
      `update outbox_events set status = 'processing', attempts = attempts + 1
        where id in (select id from outbox_events where status = 'pending' and available_at <= now()
                      order by id limit $1 for update skip locked)
        returning id, tenant_id, topic, attempts, payload`,
      [batch],
    );
    await client.query("commit");
    claimed = r.rows;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  const byTenant = new Map<string, typeof claimed>();
  for (const ev of claimed) {
    // via_net.changed: hesap değişti → VİA Akış koşulları yeniden değerlendirilir (finans görevleri buradan genişler).
    if (ev.topic === "file.scan") {
      try {
        await withContext<unknown>(pool, { tenantId: ev.tenant_id, userId: null }, (c) => scanFile(c, ev.tenant_id, ev.payload.fileId!, deps(d).storage, deps(d).scanner));
        await finish(pool, [ev.id], "done");
      } catch (e) {
        await retry(pool, ev, (e as Error).message.slice(0, 300));
      }
      continue;
    }
    if (ev.topic !== "via_akis.refresh" && ev.topic !== "via_net.changed") {
      await finish(pool, [ev.id], "dead", `bilinmeyen konu: ${ev.topic}`);
      continue;
    }
    byTenant.set(ev.tenant_id, [...(byTenant.get(ev.tenant_id) ?? []), ev]);
  }
  for (const [tenantId, events] of byTenant) {
    try {
      await withContext(pool, { tenantId, userId: null }, (c) => refreshViaAkis(c, tenantId));
      await finish(pool, events.map((e) => e.id), "done");
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      for (const ev of events) await retry(pool, ev, msg);
    }
  }
  return claimed.length;
}

async function retry(pool: pg.Pool, ev: { id: number; attempts: number }, msg: string) {
  if (ev.attempts >= MAX_ATTEMPTS) await finish(pool, [ev.id], "dead", msg);
  else await pool.query("update outbox_events set status = 'pending', last_error = $2, available_at = now() + make_interval(secs => $3) where id = $1",
    [ev.id, msg, Math.min(2 ** ev.attempts, 300)]);
}

async function finish(pool: pg.Pool, ids: number[], status: "done" | "dead", error?: string) {
  await pool.query("update outbox_events set status = $2, processed_at = now(), last_error = $3 where id = any($1::bigint[])", [ids, status, error ?? null]);
}

/** Zaman temelli görevler (geciken randevu vb.) için periyodik tarama. */
export async function scanAllTenants(pool: pg.Pool, now = new Date(), storage: StoragePort = storageFromEnv()) {
  const tenants = await pool.query("select id from tenants where status = 'active'");
  const out: Record<string, { created: number; closed: number }> = {};
  for (const t of tenants.rows) {
    out[t.id] = await withContext(pool, { tenantId: t.id, userId: null }, async (c) => {
      await documentsMaintenance(c, t.id, now);
      await purgeImportRows(c, importRetentionDays(), now);
      await purgeFileContents(c, storage, now);
      return refreshViaAkis(c, t.id, now);
    });
  }
  await purgeAuthThrottle(pool);
  return out;
}
