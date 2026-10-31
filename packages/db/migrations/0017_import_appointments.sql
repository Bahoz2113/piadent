-- Görev 13 (ADR-072): geçmiş randevu içe aktarımı. Kaynak randevu no ile tekrar aktarım engellenir; aktarım toplu işi izlenir.
alter table appointments add column external_ref text check (external_ref is null or length(external_ref) between 1 and 60);
alter table appointments add column import_batch_id uuid;
alter table appointments add foreign key (tenant_id, import_batch_id) references import_batches(tenant_id, id);
-- Geri alınan aktarım randevuyu iptal eder (silme yok); aynı kaynak no yeniden aktarılabilsin diye iptaller benzersizlik dışında.
create unique index appointments_external_ref_uq on appointments (tenant_id, external_ref) where external_ref is not null and status <> 'cancelled';
create index appointments_import_batch_idx on appointments (tenant_id, import_batch_id) where import_batch_id is not null;

alter table import_batches drop constraint import_batches_kind_check;
alter table import_batches add constraint import_batches_kind_check check (kind in ('patients','opening_balances','appointment_history'));
