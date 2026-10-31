-- Görev 10: güvenlik derinleştirme (ADR-058…061)
--  * MFA kurtarma kodları (yalnız SHA-256 özeti; tek kullanımlık)
--  * Klinik düzeyinde MFA zorunluluğu (rol listesi); ortam değişkeni platform tabanı olarak kalır
--  * T.C. kimlik no alan düzeyinde şifreli (uygulama anahtarı) + HMAC arama dizini; düz metin sütunu geçiş sonrası boşaltılır
--  * Süreli üyelik (destek erişimi): memberships.expires_at + 'support' rolü (salt okunur, sağlık içeriği yok)

create table mfa_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id),
  code_hash  bytea not null unique,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
create index mfa_recovery_user_idx on mfa_recovery_codes (user_id);
grant select, insert, update, delete on mfa_recovery_codes to viadent_app;

alter table tenants add column require_mfa_roles text[] not null default '{}';
-- Klinik yöneticisi kendi kliniğinin ayarını günceller (yalnız bu sütun)
grant update (require_mfa_roles) on tenants to viadent_app;
create policy tenant_settings_update on tenants for update to viadent_app using (id = app.tenant_id()) with check (id = app.tenant_id());

alter table patients add column national_id_enc  text;   -- v2.<kid>… (ADR-052 anahtar halkası)
alter table patients add column national_id_hmac text check (national_id_hmac is null or national_id_hmac ~ '^[0-9a-f]{64}$');
alter table patients drop constraint patients_check;      -- (national_id is null) = (national_id_type is null): geçiş döneminde düz metin veya şifreli
alter table patients add constraint patients_national_id_consistent
  check ((national_id_type is null) = (national_id is null and national_id_enc is null)) ;
alter table patients add constraint patients_national_id_enc_pair check ((national_id_enc is null) = (national_id_hmac is null));
drop index patients_national_id_uq;
create unique index patients_national_id_uq on patients (tenant_id, national_id_type, national_id) where national_id is not null and status = 'active';
create unique index patients_national_id_hmac_uq on patients (tenant_id, national_id_hmac) where national_id_hmac is not null and status = 'active';

alter table memberships drop constraint memberships_role_check;
alter table memberships add constraint memberships_role_check check (role in ('clinic_admin','dentist','secretary','assistant','finance','support'));
alter table memberships add column expires_at timestamptz;
alter table memberships add column grant_reason text;
alter table memberships add constraint memberships_support_bounded check (role <> 'support' or (expires_at is not null and grant_reason is not null));
