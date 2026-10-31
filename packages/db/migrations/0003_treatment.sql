-- VİADENT 0003 (Görev 2): işlem kataloğu, sürümlü tarife, tanı, odontogram bulgusu,
-- tedavi planı (sürüm / kalem / karar) ve ziyarete bağlı gerçekleşen işlem.
-- Para: numeric(14,2). Kabul edilmiş/sunulmuş plan sürümü ve yayınlanmış tarife DB'de de değiştirilemez.

-- ---------------------------------------------------------------- işlem kataloğu — T01
create table procedures (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  code             text not null check (code ~ '^[A-Z0-9][A-Z0-9.-]{1,19}$'),
  name             text not null check (length(name) between 2 and 120),
  category         text,
  tooth_scope      text not null check (tooth_scope in ('tooth','surface','quadrant','arch','mouth')),
  default_minutes  integer check (default_minutes between 5 and 720),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);

-- ---------------------------------------------------------------- tarife sürümleri — T02 / T03
create table tariff_versions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  name             text not null check (length(name) between 2 and 120),
  practitioner_id  uuid,                         -- dolu ise hekime özel tarife (T03)
  valid_from       date not null,
  currency         char(3) not null default 'TRY',
  status           text not null default 'draft' check (status in ('draft','published','retired')),
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  published_at     timestamptz,
  published_by     uuid references users(id),
  unique (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  check ((status = 'draft') = (published_at is null))
);
create table tariff_items (
  tenant_id          uuid not null references tenants(id),
  tariff_version_id  uuid not null,
  procedure_id       uuid not null,
  price              numeric(14,2) not null check (price >= 0),
  primary key (tariff_version_id, procedure_id),
  foreign key (tenant_id, tariff_version_id) references tariff_versions(tenant_id, id),
  foreign key (tenant_id, procedure_id) references procedures(tenant_id, id)
);

create or replace function app.tariff_items_guard() returns trigger language plpgsql as $$
declare v_status text;
begin
  select status into v_status from tariff_versions where id = coalesce(new.tariff_version_id, old.tariff_version_id);
  if v_status <> 'draft' then
    raise exception 'tariff_version_not_draft' using errcode = '55000';
  end if;
  return coalesce(new, old);
end $$;
create trigger tariff_items_guard before insert or update or delete on tariff_items
  for each row execute function app.tariff_items_guard();

create or replace function app.tariff_versions_guard() returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' and (new.name is distinct from old.name or new.valid_from is distinct from old.valid_from
       or new.practitioner_id is distinct from old.practitioner_id or new.currency is distinct from old.currency) then
    raise exception 'tariff_version_frozen' using errcode = '55000';
  end if;
  if not ((old.status = new.status) or (old.status = 'draft' and new.status = 'published') or (old.status = 'published' and new.status = 'retired')) then
    raise exception 'tariff_invalid_transition' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger tariff_versions_guard before update on tariff_versions
  for each row execute function app.tariff_versions_guard();

-- Konum (diş / çeyrek / çene / tüm ağız) tutarlılığı için ortak kontrol ifadesi tablolarda tekrarlanır.

-- ---------------------------------------------------------------- tanı — H05
create table diagnoses (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  patient_id      uuid not null,
  location_kind   text not null check (location_kind in ('tooth','quadrant','arch','mouth')),
  tooth           text,
  surfaces        text[] not null default '{}',
  quadrant        smallint,
  arch            text,
  code            text,                          -- klinik kodlama kaynağı doğrulanana kadar serbest/boş (ADR-023)
  description     text not null check (length(description) between 2 and 500),
  status          text not null default 'active' check (status in ('active','resolved','entered_in_error')),
  status_reason   text,
  appointment_id  uuid,
  recorded_by     uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, appointment_id) references appointments(tenant_id, id),
  foreign key (tenant_id, recorded_by) references memberships(tenant_id, id),
  check ((location_kind = 'tooth') = (tooth is not null)),
  check ((location_kind = 'quadrant') = (quadrant is not null)),
  check ((location_kind = 'arch') = (arch is not null)),
  check ((status = 'active') = (status_reason is null))
);
create index diagnoses_patient_idx on diagnoses (tenant_id, patient_id);

-- ---------------------------------------------------------------- odontogram bulgusu (mevcut durum) — H04
create table odontogram_findings (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  patient_id     uuid not null,
  tooth          text not null,
  surfaces       text[] not null default '{}',
  finding_type   text not null check (finding_type in ('caries','filling','crown','root_canal','missing','implant','bridge_pontic','fracture','other')),
  note           text,
  status         text not null default 'current' check (status in ('current','historic','entered_in_error')),
  status_reason  text,
  recorded_by    uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, recorded_by) references memberships(tenant_id, id),
  check ((status = 'current') = (status_reason is null))
);
create index findings_patient_idx on odontogram_findings (tenant_id, patient_id);

-- ---------------------------------------------------------------- tedavi planı — V04
create table treatment_plans (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  patient_id  uuid not null,
  title       text not null check (length(title) between 2 and 120),
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id)
);

create table plan_versions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  plan_id            uuid not null,
  version            integer not null check (version > 0),
  status             text not null default 'draft'
                     check (status in ('draft','proposed','accepted','rejected','superseded','cancelled')),
  tariff_version_id  uuid,
  practitioner_id    uuid not null,
  note               text,
  proposed_at        timestamptz,
  proposed_by        uuid references users(id),
  decided_at         timestamptz,
  status_reason      text,
  created_by         uuid not null references users(id),
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, plan_id, version),
  foreign key (tenant_id, plan_id) references treatment_plans(tenant_id, id),
  foreign key (tenant_id, tariff_version_id) references tariff_versions(tenant_id, id),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  check ((status = 'draft') = (proposed_at is null) or status = 'cancelled')
);
create unique index plan_versions_one_draft on plan_versions (tenant_id, plan_id) where status = 'draft';
create unique index plan_versions_one_accepted on plan_versions (tenant_id, plan_id) where status = 'accepted';

create table plan_items (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  plan_version_id   uuid not null,
  procedure_id      uuid not null,
  procedure_code    text not null,
  procedure_name    text not null,
  location_kind     text not null check (location_kind in ('tooth','quadrant','arch','mouth')),
  tooth             text,
  surfaces          text[] not null default '{}',
  quadrant          smallint,
  arch              text,
  quantity          integer not null default 1 check (quantity between 1 and 50),
  unit_price        numeric(14,2) not null check (unit_price >= 0),
  price_source      text not null check (price_source in ('tariff','manual')),
  price_note        text,
  discount          numeric(14,2) not null default 0 check (discount >= 0),
  discount_reason   text,
  line_total        numeric(14,2) generated always as (unit_price * quantity - discount) stored,
  session_no        integer not null default 1 check (session_no between 1 and 50),
  sort              integer not null default 0,
  created_at        timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, plan_version_id) references plan_versions(tenant_id, id),
  foreign key (tenant_id, procedure_id) references procedures(tenant_id, id),
  check ((location_kind = 'tooth') = (tooth is not null)),
  check ((location_kind = 'quadrant') = (quadrant is not null)),
  check ((location_kind = 'arch') = (arch is not null)),
  check (discount <= unit_price * quantity),
  check ((discount > 0) = (discount_reason is not null)),
  check (price_source = 'tariff' or price_note is not null)
);
create index plan_items_version_idx on plan_items (tenant_id, plan_version_id);

-- Yalnız taslak sürümün kalemleri değişebilir (AT-05: kabul edilmiş fiyat snapshot'ı korunur).
create or replace function app.plan_items_guard() returns trigger language plpgsql as $$
declare v_status text;
begin
  select status into v_status from plan_versions where id = coalesce(new.plan_version_id, old.plan_version_id);
  if v_status <> 'draft' then
    raise exception 'plan_version_not_draft' using errcode = '55000';
  end if;
  return coalesce(new, old);
end $$;
create trigger plan_items_guard before insert or update or delete on plan_items
  for each row execute function app.plan_items_guard();

-- Sürüm durum makinesi ve dondurma.
create or replace function app.plan_versions_guard() returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' and (new.tariff_version_id is distinct from old.tariff_version_id
       or new.practitioner_id is distinct from old.practitioner_id or new.note is distinct from old.note
       or new.version is distinct from old.version or new.plan_id is distinct from old.plan_id) then
    raise exception 'plan_version_frozen' using errcode = '55000';
  end if;
  if old.status <> new.status and not (
       (old.status = 'draft' and new.status in ('proposed','cancelled')) or
       (old.status = 'proposed' and new.status in ('accepted','rejected','superseded','cancelled')) or
       (old.status = 'accepted' and new.status in ('superseded','cancelled'))) then
    raise exception 'plan_invalid_transition' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger plan_versions_guard before update on plan_versions
  for each row execute function app.plan_versions_guard();

-- Hasta kararı (kabul / ret / kararsız) ayrı, yalnız eklenen kayıttır.
create table plan_decisions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  plan_version_id  uuid not null,
  decision         text not null check (decision in ('accepted','rejected','undecided')),
  note             text,
  recorded_by      uuid not null,
  recorded_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, plan_version_id) references plan_versions(tenant_id, id),
  foreign key (tenant_id, recorded_by) references memberships(tenant_id, id)
);

-- ---------------------------------------------------------------- gerçekleşen işlem — VD-008
create table performed_procedures (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  patient_id       uuid not null,
  appointment_id   uuid not null,                -- ziyaret bağı zorunlu
  plan_item_id     uuid,
  procedure_id     uuid not null,
  procedure_code   text not null,
  procedure_name   text not null,
  location_kind    text not null check (location_kind in ('tooth','quadrant','arch','mouth')),
  tooth            text,
  surfaces         text[] not null default '{}',
  quadrant         smallint,
  arch             text,
  quantity         integer not null default 1 check (quantity between 1 and 50),
  amount           numeric(14,2) not null check (amount >= 0),   -- bedel snapshot'ı (alacak Görev 3'te)
  price_basis      text not null check (price_basis in ('plan','tariff','manual')),
  practitioner_id  uuid not null,
  status           text not null default 'completed' check (status in ('completed','cancelled','corrected')),
  status_reason    text,
  corrects_id      uuid,
  note             text,
  completed_by     uuid not null,
  completed_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, appointment_id) references appointments(tenant_id, id),
  foreign key (tenant_id, plan_item_id) references plan_items(tenant_id, id),
  foreign key (tenant_id, procedure_id) references procedures(tenant_id, id),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  foreign key (tenant_id, completed_by) references memberships(tenant_id, id),
  foreign key (tenant_id, corrects_id) references performed_procedures(tenant_id, id),
  check ((location_kind = 'tooth') = (tooth is not null)),
  check ((status = 'completed') = (status_reason is null))
);
create index performed_patient_idx on performed_procedures (tenant_id, patient_id, completed_at desc);
create index performed_item_idx on performed_procedures (tenant_id, plan_item_id) where plan_item_id is not null;

-- Gerçekleşen işlem silinmez; yalnız durum (iptal/düzeltildi) + gerekçe değişebilir.
create or replace function app.performed_guard() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'status' - 'status_reason') is distinct from (to_jsonb(old) - 'status' - 'status_reason') then
    raise exception 'performed_procedure_immutable' using errcode = '55000';
  end if;
  if old.status <> 'completed' then
    raise exception 'performed_procedure_closed' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger performed_guard before update on performed_procedures
  for each row execute function app.performed_guard();

-- Klinik notu ziyarete bağlama (VD-006 kalanı).
alter table clinical_notes add column appointment_id uuid;
alter table clinical_notes add constraint clinical_notes_appointment_fk
  foreign key (tenant_id, appointment_id) references appointments(tenant_id, id);

-- VİA Akış: plan takibi.
alter table tasks drop constraint tasks_kind_check;
alter table tasks add constraint tasks_kind_check
  check (kind in ('overdue_checkin','contact_pending','missing_contact','closure_conflict','anamnesis_review',
                  'plan_unscheduled','plan_decision_pending','follow_up','manual'));

-- ================================================================ RLS + yetkiler
do $$
declare t text;
begin
  foreach t in array array['procedures','tariff_versions','tariff_items','diagnoses','odontogram_findings',
                           'treatment_plans','plan_versions','plan_items','plan_decisions','performed_procedures'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
                     using (tenant_id = app.tenant_id())
                     with check (tenant_id = app.tenant_id())$p$, t);
  end loop;
end $$;

grant select, insert, update on procedures, tariff_versions, diagnoses, odontogram_findings, plan_versions, performed_procedures to viadent_app;
grant select, insert, update, delete on tariff_items, plan_items to viadent_app;  -- tetikleyici: yalnız taslakta
grant select, insert on treatment_plans, plan_decisions to viadent_app;
grant select on treatment_plans, plan_versions, plan_items, plan_decisions, performed_procedures to viadent_worker;
