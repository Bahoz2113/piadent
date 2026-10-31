-- Görev 13 (ADR-073): PİA Akış eşikleri klinik ayarı. Boş nesne = varsayılanlar (uygulama sabitleri); yalnız bilinen anahtarlar, sınırlar uygulamada doğrulanır.
alter table tenants add column akis_settings jsonb not null default '{}'::jsonb;
alter table tenants add constraint tenants_akis_settings_obj check (jsonb_typeof(akis_settings) = 'object');
grant update (akis_settings) on tenants to viadent_app;
