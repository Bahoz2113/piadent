/**
 * Tenant bağlamlı transaction. Bağlam yalnız transaction-local (set_config(..., true))
 * ayarlanır; COMMIT/ROLLBACK sonrası havuza dönen bağlantıda iz kalmaz (Plan §07, W04).
 */
import pg from "pg";

export interface DbContext {
  tenantId: string | null;
  userId: string | null;
}

export async function withContext<T>(pool: pg.Pool, ctx: DbContext, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [
      ctx.tenantId ?? "",
      ctx.userId ?? "",
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
