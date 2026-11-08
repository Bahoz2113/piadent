-- Ürün sahibi geri bildirimi 08.11.2026 (ADR-107).
--  * appointment_procedures: randevuya birden fazla planlanan işlem bağlanır (sıralı). Randevu verirken işlem ZORUNLU DEĞİL —
--    sekreter hekim muayenesinden önce işlemi/tanıyı bilemez; işlem ve tanı hekim tarafından sonra girilir.
--    appointments.procedure_id geriye uyumluluk için ilk işlemi taşımaya devam eder. Fiyat tarifeden okunur, saklanmaz
--    (tahakkuk yalnız gerçekleşen işlemden doğar — PİA Net kuralı değişmez).
--  * Kaynak adı "koltuk" yerine "ünite": demo varsayılan adları ("Koltuk 1…3", "Ünit A/B") "Ünite A/B/C" olur.
--    Kliniğin kendi verdiği diğer adlara dokunulmaz.
create table appointment_procedures (
  tenant_id       uuid not null references tenants(id),
  appointment_id  uuid not null,
  procedure_id    uuid not null,
  position        smallint not null check (position between 1 and 10),
  created_at      timestamptz not null default now(),
  primary key (tenant_id, appointment_id, procedure_id),
  unique (tenant_id, appointment_id, position),
  foreign key (tenant_id, appointment_id) references appointments(tenant_id, id),
  foreign key (tenant_id, procedure_id) references procedures(tenant_id, id)
);
create index appointment_procedures_procedure_idx on appointment_procedures (tenant_id, procedure_id);
alter table appointment_procedures enable row level security;
alter table appointment_procedures force row level security;
create policy tenant_isolation on appointment_procedures using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
grant select, insert on appointment_procedures to viadent_app;
grant select on appointment_procedures to viadent_worker;

-- Mevcut tek işlemli randevular listeye taşınır (FORCE RLS: kiracı kiracı).
select app.for_each_tenant($q$
  insert into appointment_procedures (tenant_id, appointment_id, procedure_id, position)
  select tenant_id, id, procedure_id, 1 from appointments where procedure_id is not null
  on conflict do nothing
$q$);

select app.for_each_tenant($q$
  update chairs set name = case name
      when 'Koltuk 1' then 'Ünite A' when 'Koltuk 2' then 'Ünite B' when 'Koltuk 3' then 'Ünite C'
      when 'Ünit A' then 'Ünite A' when 'Ünit B' then 'Ünite B' when 'Ünit C' then 'Ünite C' end
   where name in ('Koltuk 1', 'Koltuk 2', 'Koltuk 3', 'Ünit A', 'Ünit B', 'Ünit C')
     and not exists (select 1 from chairs c2 where c2.tenant_id = chairs.tenant_id and c2.name like 'Ünite %')
$q$);
