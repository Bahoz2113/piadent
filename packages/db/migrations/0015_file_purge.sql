-- Görev 12 (ADR-067): silinmiş/reddedilmiş/karantinadaki dosya içeriğinin fiziksel imhası.
-- Üst veri (ad, özet, kanıt olayları) kalır; yalnız nesne içeriği diskten kaldırılır ve purged_at yazılır.
alter table file_assets add column purged_at timestamptz;
alter table file_assets add constraint file_assets_purged_status check (purged_at is null or status in ('deleted','rejected','quarantined'));
create index file_assets_purge_idx on file_assets (status, purged_at) where purged_at is null and status in ('deleted','rejected','quarantined');

alter table file_access_events drop constraint file_access_events_action_check;
alter table file_access_events add constraint file_access_events_action_check check (action in ('upload_initiated','upload_failed','uploaded','scan_clean','scan_infected','scan_rejected',
  'downloaded','access_denied','deleted','purged'));

-- Hata düzeltmesi (Görev 12 testinde bulundu): erişilebilir dosya silinince available_at/sha256 dolu kalır ve eski eşitlik kısıtı
-- ((status='available') = (available_at ve sha256 dolu)) bozulurdu → silme 500 veriyordu. Kısıt tek yönlü: available ise ikisi dolu olmalı.
alter table file_assets drop constraint file_assets_check;
alter table file_assets add constraint file_assets_available_check check (status <> 'available' or (available_at is not null and sha256 is not null));
