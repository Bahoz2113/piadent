-- Ürün sahibi geri bildirimi 07.11.2026 (ADR-099 … ADR-101).
--  * closures.kind: "Kapatmalar" sekmesi kaldırıldı; hekim çalışma saatleri altında resmî tatil (tüm klinik), rapor ve izin (hekim) tarihle girilir.
--    Eski kayıtlar 'closure' olarak kalır (davranış aynı: kapalı aralığa randevu verilmez).
--  * patient_health_notes: anamnez modülü yerine hasta kartında kronik hastalık, sürekli kullanılan ilaç ve alerji. Sağlık verisidir:
--    içerik yalnız patient.health.read rollerine döner; diğer roller yalnız "kayıt var" işaretini görür. Eski anamnez verisi silinmez.
--  * payments.appointment_id: randevu sayfasında alınan kısmi/tam ödeme (avans) randevuya bağlanır (izlenebilirlik); ödeme mantığı değişmez.
alter table closures add column kind text not null default 'closure'
  check (kind in ('closure', 'public_holiday', 'sick_leave', 'leave'));
alter table closures add constraint closures_kind_scope_chk
  check ((kind <> 'public_holiday' or scope = 'clinic') and (kind not in ('sick_leave', 'leave') or scope = 'practitioner'));

create table patient_health_notes (
  tenant_id            uuid not null references tenants(id),
  patient_id           uuid not null,
  chronic_conditions   text check (chronic_conditions is null or length(chronic_conditions) between 1 and 1000),
  regular_medications  text check (regular_medications is null or length(regular_medications) between 1 and 1000),
  allergies            text check (allergies is null or length(allergies) between 1 and 1000),
  updated_by           uuid not null references users(id),
  updated_at           timestamptz not null default now(),
  primary key (tenant_id, patient_id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id)
);
alter table patient_health_notes enable row level security;
alter table patient_health_notes force row level security;
create policy tenant_isolation on patient_health_notes using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
grant select, insert, update on patient_health_notes to viadent_app;
grant select on patient_health_notes to viadent_worker;

alter table payments add column appointment_id uuid;
alter table payments add constraint payments_appointment_fk foreign key (tenant_id, appointment_id) references appointments(tenant_id, id);
create index payments_appointment_idx on payments (tenant_id, appointment_id) where appointment_id is not null;

-- Anamnez modülü arayüzden kaldırıldığından "güncel ve onaylı anamnez" hazırlık kuralı pasifleşir (satır silinmez; FORCE RLS: kiracı kiracı).
select app.for_each_tenant($q$ update readiness_rules set active = false where kind = 'anamnesis_reviewed' and active $q$);
