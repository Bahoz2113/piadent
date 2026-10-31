-- PİA-DENT 0001: kimlik, tenant, hasta, ajanda, görev (PİA Akış), audit (PİA İz), outbox.
-- Bu migration viadent_owner rolüyle çalışır. Uygulama rolleri tablo sahibi değildir.

create extension if not exists btree_gist;
create extension if not exists pg_trgm;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to viadent_app, viadent_worker;

-- İstek/iş başına transaction-local bağlam (set_config(..., true)). Boşsa NULL döner.
create or replace function app.tenant_id() returns uuid
  language sql stable as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;
create or replace function app.user_id() returns uuid
  language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------- işletme
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{3,48}$'),
  name        text not null check (length(name) between 2 and 120),
  timezone    text not null default 'Europe/Istanbul',
  currency    char(3) not null default 'TRY',
  status      text not null default 'active' check (status in ('active','suspended')),
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table branches (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  name        text not null,
  timezone    text,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id)
);

-- ---------------------------------------------------------------- kimlik (global)
create table users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  password_hash  text not null,
  full_name      text not null,
  status         text not null default 'active' check (status in ('active','disabled')),
  created_at     timestamptz not null default now()
);
create unique index users_email_uq on users (lower(email));

create table memberships (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  user_id         uuid not null references users(id),
  role            text not null check (role in ('clinic_admin','dentist','secretary','assistant','finance')),
  branch_id       uuid,
  status          text not null default 'active' check (status in ('active','revoked')),
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  unique (tenant_id, user_id),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches(tenant_id, id)
);

create table sessions (
  id                    uuid primary key default gen_random_uuid(),
  token_hash            bytea not null unique,
  user_id               uuid not null references users(id),
  active_membership_id  uuid references memberships(id),
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  revoked_at            timestamptz,
  last_seen_at          timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

-- Tenant içi sayaç (dosya no vb.); satır kilidiyle artırılır.
create table tenant_counters (
  tenant_id  uuid not null references tenants(id),
  name       text not null,
  value      bigint not null default 0,
  primary key (tenant_id, name)
);

-- ---------------------------------------------------------------- kaynaklar
create table practitioners (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  branch_id      uuid not null,
  membership_id  uuid,
  display_name   text not null,
  title          text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches(tenant_id, id),
  foreign key (tenant_id, membership_id) references memberships(tenant_id, id)
);

create table chairs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  branch_id   uuid not null,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, branch_id, name),
  foreign key (tenant_id, branch_id) references branches(tenant_id, id)
);

-- ---------------------------------------------------------------- hasta
create table patients (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id),
  file_no                  bigint not null,
  first_name               text not null check (length(first_name) between 1 and 80),
  last_name                text not null check (length(last_name) between 1 and 80),
  search_text              text not null,
  birth_date               date,
  gender                   text check (gender in ('female','male','other','unspecified')),
  national_id_type         text check (national_id_type in ('tckn','passport','other')),
  national_id              text,
  phone_e164               text,
  phone_digits             text,
  email                    text,
  city                     text,
  preferred_language       text not null default 'tr',
  primary_practitioner_id  uuid,
  referral_source          text,
  status                   text not null default 'active' check (status in ('active','archived')),
  created_at               timestamptz not null default now(),
  created_by               uuid not null references users(id),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references users(id),
  version                  integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, file_no),
  check ((national_id is null) = (national_id_type is null)),
  foreign key (tenant_id, primary_practitioner_id) references practitioners(tenant_id, id)
);
create index patients_search_trgm on patients using gin (search_text gin_trgm_ops);
create index patients_phone_idx on patients (tenant_id, phone_digits);
create unique index patients_national_id_uq on patients (tenant_id, national_id_type, national_id)
  where national_id is not null and status = 'active';

-- Doğum tarihi gelecekte olamaz (sunucu doğrulamasına ek savunma; saat dilimi payı 1 gün).
create or replace function app.patients_guard() returns trigger language plpgsql as $$
begin
  if new.birth_date is not null and new.birth_date > (current_date + 1) then
    raise exception 'birth_date_in_future' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger patients_guard before insert or update on patients
  for each row execute function app.patients_guard();

-- Minimum klinik not (VD-006 başlangıcı): yalnız ekleme; düzeltme yeni kayıtla yapılır.
create table clinical_notes (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  patient_id            uuid not null,
  author_membership_id  uuid not null,
  body                  text not null check (length(body) between 1 and 20000),
  corrects_note_id      uuid,
  correction_reason     text,
  created_at            timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, author_membership_id) references memberships(tenant_id, id),
  foreign key (tenant_id, corrects_note_id) references clinical_notes(tenant_id, id),
  check ((corrects_note_id is null) = (correction_reason is null))
);

-- ---------------------------------------------------------------- ajanda
create table appointments (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  branch_id        uuid not null,
  patient_id       uuid not null,
  practitioner_id  uuid not null,
  chair_id         uuid,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'planned'
                   check (status in ('planned','confirmed','checked_in','in_progress','completed','no_show','cancelled')),
  contact_outcome  text not null default 'not_contacted'
                   check (contact_outcome in ('not_contacted','informed','unreachable')),
  reason           text,
  note             text,
  cancel_reason    text,
  checked_in_at    timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid not null references users(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references users(id),
  version          integer not null default 1,
  unique (tenant_id, id),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '12 hours'),
  check ((status = 'cancelled') = (cancel_reason is not null)),
  foreign key (tenant_id, branch_id) references branches(tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  foreign key (tenant_id, chair_id) references chairs(tenant_id, id),
  -- [başlangıç, bitiş) aralığı; iptal edilen randevu kapasiteyi bırakır.
  constraint appointments_practitioner_no_overlap exclude using gist (
    tenant_id with =, practitioner_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled'),
  constraint appointments_chair_no_overlap exclude using gist (
    tenant_id with =, chair_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled' and chair_id is not null)
);
create index appointments_day_idx on appointments (tenant_id, starts_at);
create index appointments_patient_idx on appointments (tenant_id, patient_id, starts_at desc);

-- ---------------------------------------------------------------- PİA Akış görevleri
create table tasks (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  kind                    text not null check (kind in ('overdue_checkin','contact_pending','missing_contact','follow_up','manual')),
  sensitivity             text not null default 'general' check (sensitivity in ('general','clinical','finance')),
  source_type             text not null,
  source_id               uuid,
  patient_id              uuid,
  dedupe_key              text not null,
  title                   text not null,
  reason                  text not null,
  next_step               text not null,
  assignee_role           text check (assignee_role in ('clinic_admin','dentist','secretary','assistant','finance')),
  assignee_membership_id  uuid,
  due_at                  timestamptz,
  status                  text not null default 'open' check (status in ('open','in_progress','blocked','done','cancelled')),
  closed_reason           text,
  closed_at               timestamptz,
  closed_by               uuid references users(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, assignee_membership_id) references memberships(tenant_id, id),
  check ((status in ('done','cancelled')) = (closed_at is not null))
);
-- Aynı olay aynı görev türünde bir kez açık olur.
create unique index tasks_open_dedupe_uq on tasks (tenant_id, dedupe_key)
  where status in ('open','in_progress','blocked');
create index tasks_open_idx on tasks (tenant_id, status, due_at);

-- ---------------------------------------------------------------- PİA İz (audit)
create table audit_events (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid references tenants(id),
  actor_user_id        uuid,
  actor_membership_id  uuid,
  action               text not null,
  entity_type          text not null,
  entity_id            uuid,
  patient_id           uuid,
  changes              jsonb not null default '{}'::jsonb,
  correlation_id       text,
  created_at           timestamptz not null default now()
);
create index audit_entity_idx on audit_events (tenant_id, entity_type, entity_id, created_at desc);
create index audit_patient_idx on audit_events (tenant_id, patient_id, created_at desc);

create or replace function app.audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only' using errcode = '42501';
end $$;
create trigger audit_no_update before update or delete on audit_events
  for each statement execute function app.audit_immutable();

-- ---------------------------------------------------------------- outbox
create table outbox_events (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references tenants(id),
  topic         text not null,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending' check (status in ('pending','processing','done','dead')),
  attempts      integer not null default 0,
  available_at  timestamptz not null default now(),
  last_error    text,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);
create index outbox_pending_idx on outbox_events (status, available_at) where status = 'pending';

-- ================================================================ RLS
do $$
declare t text;
begin
  foreach t in array array['branches','tenant_counters','practitioners','chairs','patients',
                           'clinical_notes','appointments','tasks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
                     using (tenant_id = app.tenant_id())
                     with check (tenant_id = app.tenant_id())$p$, t);
  end loop;
end $$;

alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenant_self on tenants for select to viadent_app
  using (id = app.tenant_id()
         or id in (select m.tenant_id from memberships m where m.user_id = app.user_id() and m.status = 'active'));
-- Tenant açılışı (provisioning) yalnız migration/işletim rolüyle yapılır.
create policy owner_provision on tenants to viadent_owner using (true) with check (true);
create policy worker_list on tenants for select to viadent_worker using (status = 'active');
create policy worker_ctx on tenants for select to viadent_worker using (id = app.tenant_id());

alter table memberships enable row level security;
alter table memberships force row level security;
create policy own_or_tenant on memberships
  using (user_id = app.user_id() or tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());

alter table audit_events enable row level security;
alter table audit_events force row level security;
create policy audit_read on audit_events for select using (tenant_id = app.tenant_id());
create policy audit_write on audit_events for insert
  with check (tenant_id = app.tenant_id() or (tenant_id is null and app.tenant_id() is null));

alter table outbox_events enable row level security;
alter table outbox_events force row level security;
create policy outbox_tenant on outbox_events to viadent_app
  using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
-- İşçi yalnız kuyruk satırlarını görür; payload hasta içeriği taşımaz (yalnız kimlik/konu).
create policy outbox_worker on outbox_events to viadent_worker using (true) with check (true);

-- ================================================================ yetkiler
revoke all on all tables in schema public from public;
grant select, insert, update on users, sessions to viadent_app;
grant select on tenants to viadent_app, viadent_worker;
grant select, insert, update on memberships, branches, tenant_counters, practitioners, chairs,
  patients, appointments, tasks to viadent_app;
grant select, insert on clinical_notes to viadent_app;
grant select, insert on audit_events to viadent_app, viadent_worker;
grant select, insert, update on outbox_events to viadent_app, viadent_worker;
-- İşçi: PİA Akış üretimi için gerekli en az yetki.
grant select on patients, appointments, practitioners, memberships to viadent_worker;
grant select, insert, update on tasks to viadent_worker;
-- İşçi için aynı tenant politikaları (RLS policy'leri tüm rollere uygulanır; tenant bağlamı zorunlu).
grant execute on function app.tenant_id(), app.user_id() to viadent_app, viadent_worker;
