-- Görev 8: pilot altyapısı
--  * Paylaşılan giriş deneme sayacı: birden çok API sürecinde aynı sınır (bellek içi sayaç her süreçte ayrıydı, ADR-007/053).
--    Anahtar düz metin değil SHA-256 özetidir (e-posta/IP veritabanında okunmaz). Klinik öncesi (giriş) olduğu için kiracısız.
--  * İçe aktarma satır verisinin saklama süresi sonunda temizlenmesi (ADR-054): batch'te iz, satırda boş veri.
create table auth_throttle (
  key_hash    bytea primary key,
  fail_count  integer not null check (fail_count > 0),
  first_at    timestamptz not null default now()
);
create index auth_throttle_first_idx on auth_throttle (first_at);
grant select, insert, update, delete on auth_throttle to viadent_app;
grant select, delete on auth_throttle to viadent_worker;

alter table import_batches add column rows_purged_at timestamptz;
grant update (data, errors, warnings) on import_rows to viadent_worker;
grant select on import_rows to viadent_worker;
grant select, update (rows_purged_at) on import_batches to viadent_worker;
