-- PİA-DENT 0002 (Görev 1): işlem türleri, çalışma saatleri, kapatmalar, hasta yakınları,
-- sürümlü anamnez, ekip daveti. Tüm tablolar tenant'a aittir ve RLS ile korunur.

-- ---------------------------------------------------------------- işlem (randevu) türleri — T04
create table appointment_types (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  name             text not null check (length(name) between 2 and 80),
  default_minutes  integer not null check (default_minutes between 5 and 720),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);
alter table appointments add column appointment_type_id uuid;
alter table appointments add constraint appointments_type_fk
  foreign key (tenant_id, appointment_type_id) references appointment_types(tenant_id, id);

-- ---------------------------------------------------------------- haftalık çalışma saatleri — T05
-- weekday: ISO (1 = Pazartesi … 7 = Pazar). Dakika cinsinden [start_min, end_min), klinik saatinde.
create table work_schedules (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  practitioner_id  uuid not null,
  weekday          smallint not null check (weekday between 1 and 7),
  start_min        integer not null check (start_min between 0 and 1439),
  end_min          integer not null check (end_min between 1 and 1440),
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  check (end_min > start_min),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  constraint work_schedules_no_overlap exclude using gist (
    tenant_id with =, practitioner_id with =, weekday with =, int4range(start_min, end_min, '[)') with &&
  )
);

-- ---------------------------------------------------------------- kapatmalar — T06
create table closures (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  scope            text not null check (scope in ('clinic','practitioner','chair')),
  practitioner_id  uuid,
  chair_id         uuid,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  reason           text not null check (length(reason) between 2 and 300),
  cancelled_at     timestamptz,
  cancelled_by     uuid references users(id),
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  check (ends_at > starts_at),
  check ((scope = 'practitioner') = (practitioner_id is not null)),
  check ((scope = 'chair') = (chair_id is not null)),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  foreign key (tenant_id, chair_id) references chairs(tenant_id, id)
);
create index closures_range_idx on closures using gist (tenant_id, tstzrange(starts_at, ends_at, '[)')) where cancelled_at is null;

-- ---------------------------------------------------------------- hasta yakınları / veli — H03
-- Yakınlık tek başına yetki değildir: yasal temsilci işareti kanıt + doğrulayan kullanıcı ister.
create table patient_relations (
  id                           uuid primary key default gen_random_uuid(),
  tenant_id                    uuid not null references tenants(id),
  patient_id                   uuid not null,
  related_patient_id           uuid,
  contact_name                 text,
  contact_phone_e164           text,
  relation                     text not null check (relation in ('mother','father','legal_guardian','spouse','child','sibling','relative','other')),
  is_legal_representative      boolean not null default false,
  representation_evidence      text,
  representation_verified_by   uuid references users(id),
  representation_verified_at   timestamptz,
  can_receive_info             boolean not null default false,
  valid_until                  date,
  note                         text,
  status                       text not null default 'active' check (status in ('active','ended')),
  ended_reason                 text,
  ended_at                     timestamptz,
  created_by                   uuid not null references users(id),
  created_at                   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, related_patient_id) references patients(tenant_id, id),
  check (related_patient_id is not null or contact_name is not null),
  check (related_patient_id is null or related_patient_id <> patient_id),
  check (not is_legal_representative or (representation_evidence is not null and representation_verified_by is not null and representation_verified_at is not null)),
  check ((status = 'ended') = (ended_at is not null))
);
create index patient_relations_patient_idx on patient_relations (tenant_id, patient_id) where status = 'active';
create unique index patient_relations_pair_uq on patient_relations (tenant_id, patient_id, related_patient_id)
  where related_patient_id is not null and status = 'active';

-- ---------------------------------------------------------------- sürümlü anamnez — H07
-- Her kayıt yeni sürümdür; önceki sürüm değişmez. Onay (hekim) ayrı kayıttır.
create table anamnesis_versions (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  patient_id             uuid not null,
  version                integer not null check (version > 0),
  questionnaire_version  text not null,
  answers                jsonb not null,
  critical_flags         text[] not null default '{}',
  recorded_by            uuid not null,
  created_at             timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, patient_id, version),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, recorded_by) references memberships(tenant_id, id)
);
create table anamnesis_reviews (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  anamnesis_id        uuid not null,
  reviewed_by         uuid not null,
  reviewed_at         timestamptz not null default now(),
  unique (tenant_id, anamnesis_id),
  foreign key (tenant_id, anamnesis_id) references anamnesis_versions(tenant_id, id),
  foreign key (tenant_id, reviewed_by) references memberships(tenant_id, id)
);

-- ---------------------------------------------------------------- ekip daveti — T20
create table invitations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  email             text not null,
  full_name         text not null,
  role              text not null check (role in ('clinic_admin','dentist','secretary','assistant','finance')),
  token_hash        bytea not null unique,
  expires_at        timestamptz not null,
  accepted_at       timestamptz,
  accepted_user_id  uuid references users(id),
  revoked_at        timestamptz,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index invitations_open_email_uq on invitations (tenant_id, lower(email))
  where accepted_at is null and revoked_at is null;

-- Davet bağlantısı oturum/tenant bağlamı olmadan açılır. Bu dar fonksiyon yalnız
-- geçerli bir token özetinin hangi tenant'a ait olduğunu söyler; gerisi RLS altında yürür.
create policy owner_token_lookup on invitations for select to viadent_owner using (true);
create or replace function app.invitation_tenant(p_token_hash bytea) returns uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  select tenant_id from invitations
   where token_hash = p_token_hash and accepted_at is null and revoked_at is null and expires_at > now()
$$;
revoke all on function app.invitation_tenant(bytea) from public;
grant execute on function app.invitation_tenant(bytea) to viadent_app;

-- ---------------------------------------------------------------- PİA Akış: kapatma çakışması
alter table tasks drop constraint tasks_kind_check;
alter table tasks add constraint tasks_kind_check
  check (kind in ('overdue_checkin','contact_pending','missing_contact','closure_conflict','anamnesis_review','follow_up','manual'));

-- ================================================================ RLS + yetkiler
do $$
declare t text;
begin
  foreach t in array array['appointment_types','work_schedules','closures','patient_relations',
                           'anamnesis_versions','anamnesis_reviews','invitations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
                     using (tenant_id = app.tenant_id())
                     with check (tenant_id = app.tenant_id())$p$, t);
  end loop;
end $$;

grant select, insert, update on appointment_types, work_schedules, closures, patient_relations, invitations to viadent_app;
grant delete on work_schedules to viadent_app; -- haftalık şablon değiştirilir; geçmiş randevuları etkilemez
grant select, insert on anamnesis_versions, anamnesis_reviews to viadent_app;
grant select on closures, anamnesis_versions, anamnesis_reviews, appointment_types to viadent_worker;
