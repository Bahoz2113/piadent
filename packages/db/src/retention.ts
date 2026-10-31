/**
 * Saklama işleri (Görev 8, ADR-054). Worker her taramada çağırır; işler küçük ve idempotenttir.
 *  - İçe aktarma satır verisi: onaylanmış/geri alınmış aktarımda karar tarihinden, hiç onaylanmamış ön kontrolde oluşturma
 *    tarihinden IMPORT_ROW_RETENTION_DAYS (varsayılan 30) gün sonra satırların normalize verisi ve hata/uyarı metinleri
 *    (kaynak değerleri içerebilir) boşaltılır. Batch özeti (sayımlar, tutar mutabakatı), durumlar ve hedef kayıt kimlikleri kalır.
 *    Süre yetkili danışmanla kesinleştirilecek bir varsayılandır (Plan §08: süreler uydurulmaz).
 *  - Giriş deneme sayacı: 1 günden eski satırlar silinir.
 */
import type pg from "pg";
import type { StoragePort } from "./files.js";

export const importRetentionDays = () => {
  const n = Number(process.env.IMPORT_ROW_RETENTION_DAYS ?? 30);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
};

/** Klinik bağlamında (withContext) çağrılır. Dönüş: temizlenen batch sayısı. */
export async function purgeImportRows(c: pg.PoolClient, days = importRetentionDays(), now = new Date()): Promise<number> {
  const due = await c.query(
    `select id from import_batches
      where rows_purged_at is null
        and coalesce(rolled_back_at, committed_at, created_at) < $1::timestamptz - make_interval(days => $2)
      order by created_at limit 50`, [now.toISOString(), days]);
  for (const b of due.rows) {
    await c.query("update import_rows set data = '{}'::jsonb, errors = '[]'::jsonb, warnings = '[]'::jsonb where batch_id = $1", [b.id]);
    await c.query("update import_batches set rows_purged_at = $2 where id = $1", [b.id, now.toISOString()]);
  }
  return due.rows.length;
}

/** Dosya imhası (ADR-067): silinmiş dosya FILE_PURGE_DAYS (30), reddedilmiş/karantinadaki dosya FILE_QUARANTINE_PURGE_DAYS (7) gün sonra diskten kaldırılır.
 *  Üst veri ve kanıt olayları kalır; purged_at yazılır, erişim olayına 'purged' düşer. Tenant bağlamında (RLS) çalışır. */
export function filePurgeDays(): number { const n = Number(process.env.FILE_PURGE_DAYS ?? 30); return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30; }
export function quarantinePurgeDays(): number { const n = Number(process.env.FILE_QUARANTINE_PURGE_DAYS ?? 7); return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 7; }
export async function purgeFileContents(c: pg.PoolClient, storage: StoragePort, now = new Date(), days = filePurgeDays(), qDays = quarantinePurgeDays()): Promise<number> {
  const due = await c.query(
    `select id, tenant_id, object_key, status from file_assets
      where purged_at is null and (
        (status = 'deleted' and deleted_at < $1::timestamptz - make_interval(days => $2)) or
        (status in ('rejected','quarantined') and created_at < $1::timestamptz - make_interval(days => $3)))
      order by created_at limit 100`, [now.toISOString(), days, qDays]);
  for (const f of due.rows) {
    await storage.delete(f.object_key);
    await c.query("update file_assets set purged_at = $2 where id = $1", [f.id, now.toISOString()]);
    await c.query("insert into file_access_events(tenant_id, file_id, action, detail) values ($1,$2,'purged',$3)", [f.tenant_id, f.id, `içerik imha edildi (${f.status})`]);
  }
  return due.rows.length;
}

export async function purgeAuthThrottle(pool: pg.Pool): Promise<number> {
  return (await pool.query("delete from auth_throttle where first_at < now() - interval '1 day'")).rowCount ?? 0;
}
