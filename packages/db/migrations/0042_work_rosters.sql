-- Ürün sahibi isteği 12.11.2026 (ADR-110): Hekimler → aylık çalışma listesi.
-- Yönetici hekim × gün için çalışma planı yazar: "çalışıyor" (tek blok başlangıç–bitiş, isteğe bağlı ünite) ya da "çalışmıyor".
-- Kayıt varsa o gün için haftalık çalışma şablonunun (work_schedules) yerine geçer; uygun saatler ve "çalışma saati dışı"
-- uyarısı bu planı kullanır. Kayıt yoksa haftalık şablon geçerlidir. Satır silinmesi = o günü şablona döndürmek (audit'li).
create table work_rosters (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  practitioner_id  uuid not null,
  work_date        date not null,
  kind             text not null check (kind in ('work','off')),
  start_min        integer check (start_min between 0 and 1439),
  end_min          integer check (end_min between 1 and 1440),
  chair_id         uuid,
  note             text check (note is null or length(note) between 1 and 120),
  updated_by       uuid not null references users(id),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, practitioner_id, work_date),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  foreign key (tenant_id, chair_id) references chairs(tenant_id, id),
  check ((kind = 'work' and start_min is not null and end_min is not null and end_min > start_min and start_min % 15 = 0 and end_min % 15 = 0)
      or (kind = 'off' and start_min is null and end_min is null and chair_id is null))
);
create index work_rosters_date_idx on work_rosters (tenant_id, work_date);
-- Aynı ünite aynı gün çakışan saatlerde iki hekime verilemez.
alter table work_rosters add constraint work_rosters_chair_no_overlap exclude using gist (
  tenant_id with =, chair_id with =, work_date with =, int4range(start_min, end_min, '[)') with &&
) where (chair_id is not null);

alter table work_rosters enable row level security;
alter table work_rosters force row level security;
create policy tenant_isolation on work_rosters using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
grant select, insert, update, delete on work_rosters to viadent_app; -- planlama tablosu: hücre şablona döndürülebilir (audit'li)
grant select on work_rosters to viadent_worker;
