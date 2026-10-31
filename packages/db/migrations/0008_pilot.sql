-- Görev 7: pilot ve güvenli yayın (VD-014)
--  * İçe aktarma: batch + satır (dry-run → onay → gerekirse geri alma), kaynak dosya özeti ile tekrar çalıştırmada mükerrer yok (AT-16)
--  * Hasta kaynak numarası (external_ref) ve açılış bakiyesi alacak kaynağı (hayalî geçmiş işlem üretilmez)
--  * TOTP iki adımlı doğrulama (yönetici/finans için zorunlu kılınabilir) ve giriş meydan okuması
--  * Yedek rolü (viadent_backup, roller betiğiyle BYPASSRLS + yalnız okuma) için okuma yetkileri

-- ================================================================ içe aktarma
create table import_batches (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  kind             text not null check (kind in ('patients','opening_balances')),
  format           text not null check (format in ('csv','json')),
  file_name        text not null check (length(file_name) between 1 and 200),
  file_sha256      text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status           text not null default 'dry_run' check (status in ('dry_run','committed','rolled_back')),
  mapping          jsonb not null,
  summary          jsonb not null,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  committed_by     uuid references users(id),
  committed_at     timestamptz,
  rolled_back_by   uuid references users(id),
  rolled_back_at   timestamptz,
  rollback_reason  text,
  unique (tenant_id, id),
  unique (tenant_id, kind, file_sha256),
  check ((status = 'committed' or status = 'rolled_back') = (committed_at is not null)),
  check ((status = 'rolled_back') = (rolled_back_at is not null and rollback_reason is not null))
);

create table import_rows (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  batch_id   uuid not null,
  row_no     integer not null check (row_no > 0),
  status     text not null check (status in ('valid','error','duplicate','already_imported','imported','skipped','rolled_back')),
  errors     jsonb not null default '[]'::jsonb,
  warnings   jsonb not null default '[]'::jsonb,
  data       jsonb not null,                 -- normalize edilmiş satır (kişisel veri; RLS + saklama politikası, ADR-046)
  amount     numeric(14,2),
  target_id  uuid,
  unique (tenant_id, id),
  unique (tenant_id, batch_id, row_no),
  foreign key (tenant_id, batch_id) references import_batches(tenant_id, id)
);
create index import_rows_batch_idx on import_rows (tenant_id, batch_id, status);

alter table patients add column external_ref text check (external_ref is null or length(external_ref) between 1 and 60);
alter table patients add column import_batch_id uuid;
alter table patients add foreign key (tenant_id, import_batch_id) references import_batches(tenant_id, id);
create unique index patients_external_ref_uq on patients (tenant_id, external_ref) where external_ref is not null and status = 'active';

alter table receivables drop constraint receivables_source_check;
alter table receivables add constraint receivables_source_check check (source in ('performed_procedure','manual','opening_balance'));
alter table receivables add column import_batch_id uuid;
alter table receivables add foreign key (tenant_id, import_batch_id) references import_batches(tenant_id, id);
alter table receivables add check ((source = 'opening_balance') = (import_batch_id is not null));

do $$
declare t text;
begin
  foreach t in array array['import_batches','import_rows'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
                     using (tenant_id = app.tenant_id())
                     with check (tenant_id = app.tenant_id())$p$, t);
  end loop;
end $$;
grant select, insert, update on import_batches, import_rows to viadent_app;

-- ================================================================ iki adımlı doğrulama (TOTP, RFC 6238)
alter table users add column mfa_secret_enc text;
alter table users add column mfa_pending_enc text;
alter table users add column mfa_enabled_at timestamptz;
alter table users add column mfa_last_step bigint;          -- aynı kodun tekrar kullanımını engeller
alter table users add check ((mfa_enabled_at is null) = (mfa_secret_enc is null));

create table mfa_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  token_hash  bytea not null unique,         -- SHA-256 (oturum belirteciyle aynı biçim)
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index mfa_challenges_user_idx on mfa_challenges (user_id, created_at desc);
grant select, insert, update on mfa_challenges to viadent_app;

-- ================================================================ yedek rolü: yalnız okuma (rol, roller betiğiyle BYPASSRLS olarak oluşturulur)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'viadent_backup') then
    execute 'grant usage on schema public, app to viadent_backup';
    execute 'grant select on all tables in schema public to viadent_backup';
    execute 'grant select on all sequences in schema public to viadent_backup';
    execute 'alter default privileges in schema public grant select on tables to viadent_backup';
    execute 'alter default privileges in schema public grant select on sequences to viadent_backup';
  end if;
end $$;
