-- Ürün sahibi geri bildirimi 07.11.2026 (ADR-105): hasta kartında "Görüntülemeler" — röntgen, tomografi (CBCT/BT), MR, fotoğraf.
--  * Mevcut dosya altyapısı (özel depo, yükleme → tarama → kullanılabilir, erişim izi) kullanılır; görüntüleme dosyası
--    radiograph / clinical_photo kategorisindedir (sağlık verisi: yalnız patient.health.read rolleri görür).
--  * Ek alanlar: görüntüleme türü, çekim tarihi, ilgili dişler, not. Dosya klinik (kiracı) düzeyindedir; şube kısıtı yoktur —
--    bir şubede yüklenen film diğer şubede aynı hasta kartında görünür.
--  * DICOM (.dcm) dosyası saklanır ve indirilir (tarayıcıda önizleme yok; imza baytı "DICM" ile doğrulanır).
alter table file_assets drop constraint file_assets_declared_type_check;
alter table file_assets add constraint file_assets_declared_type_check
  check (declared_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/dicom'));
alter table file_assets add column imaging_kind text
  check (imaging_kind in ('periapical', 'panoramic', 'bitewing', 'cephalometric', 'occlusal', 'cbct', 'ct', 'mr', 'ultrasound', 'intraoral_photo', 'extraoral_photo', 'other'));
alter table file_assets add column taken_on date;
alter table file_assets add column teeth text[] not null default '{}';
alter table file_assets add column imaging_note text check (imaging_note is null or length(imaging_note) between 1 and 500);
alter table file_assets add constraint file_assets_imaging_category_chk
  check (imaging_kind is null or category in ('radiograph', 'clinical_photo'));
alter table file_assets add constraint file_assets_dicom_category_chk
  check (declared_type <> 'application/dicom' or category = 'radiograph');
create index file_assets_imaging_idx on file_assets (tenant_id, patient_id, taken_on desc) where category in ('radiograph', 'clinical_photo');
