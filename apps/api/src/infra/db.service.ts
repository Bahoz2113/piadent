import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import pg from "pg";
import { guardPool, withContext, type PoolGuardStats } from "@viadent/db";
import { CONFIG, type AppConfig } from "../config.js";

// Tarih (date) türünü saat dilimi dönüşümü olmadan metin olarak al (Plan §06).
pg.types.setTypeParser(1082, (v: string) => v);
// bigint (file_no vb.) → number (güvenli aralıkta).
pg.types.setTypeParser(20, (v: string) => Number(v));

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: pg.Pool;
  /** Bağlantı kesilme sayaçları (QA-006): /health/ready ve metrikler için. */
  readonly guard: PoolGuardStats;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, application_name: config.dbApplicationName });
    // DB bağlantıyı kapatırsa (yeniden başlatma, failover) API süreci çökmemeli: boştaki VE kullanımdaki istemciye dinleyici
    // (pg-pool alınan istemcinin dinleyicisini kaldırır; sorgu arası 57P01 aksi hâlde uncaughtException olur). Havuz yeni bağlantı açar.
    this.guard = guardPool(this.pool, "api");
  }

  /** Doğrulanmış tenant bağlamında transaction. Tenant kimliği istemciden ALINMAZ. */
  tx<T>(ctx: { tenantId: string; userId: string | null }, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    return withContext(this.pool, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  /** Yalnız kullanıcı bağlamı (tenant seçilmeden önce üyelik listesi vb.). */
  userTx<T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    return withContext(this.pool, { tenantId: null, userId }, fn);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
