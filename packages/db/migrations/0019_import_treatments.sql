-- Görev 14 (ADR-075): tedavi (gerçekleşen işlem) geçmişi içe aktarımı. Ziyaret bağı aktarılan kayıtta isteğe bağlıdır (kaynakta randevu kimliği
-- çoğu zaman yoktur); aktarılan işlem ALACAK ÜRETMEZ (finansal durum açılış bakiyesiyle gelir), bedel yalnız bilgi amaçlı snapshot'tır.
alter table performed_procedures add column import_batch_id uuid;
alter table performed_procedures add column external_ref text check (external_ref is null or length(external_ref) between 1 and 60);
alter table performed_procedures add foreign key (tenant_id, import_batch_id) references import_batches(tenant_id, id);
alter table performed_procedures alter column appointment_id drop not null;
alter table performed_procedures add constraint performed_procedures_visit_or_import check (appointment_id is not null or import_batch_id is not null);
create unique index performed_procedures_external_ref_uq on performed_procedures (tenant_id, external_ref) where external_ref is not null and status <> 'cancelled';
create index performed_procedures_import_batch_idx on performed_procedures (tenant_id, import_batch_id) where import_batch_id is not null;

alter table import_batches drop constraint import_batches_kind_check;
alter table import_batches add constraint import_batches_kind_check check (kind in ('patients','opening_balances','appointment_history','treatment_history'));
