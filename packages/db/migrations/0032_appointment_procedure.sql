-- Randevuda planlanan işlem (ADR-094): randevu bir katalog işlemine bağlanabilir; fiyat tarifeden okunur (randevu fiyat saklamaz,
-- tahakkuk yalnız gerçekleşen işlemden doğar — PİA Net kuralı değişmez). İşlem türü (randevu türü) varsayılan bir işleme işaret edebilir.
alter table appointments add column procedure_id uuid;
alter table appointments add constraint appointments_procedure_fk foreign key (tenant_id, procedure_id) references procedures(tenant_id, id);
create index appointments_procedure_idx on appointments (tenant_id, procedure_id) where procedure_id is not null;

alter table appointment_types add column procedure_id uuid;
alter table appointment_types add constraint appointment_types_procedure_fk foreign key (tenant_id, procedure_id) references procedures(tenant_id, id);
