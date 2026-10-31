-- PİA-DENT 0005 (Görev 4): belge türü / şablon sürümü / hasta belgesi / onay isteği / kanıt olayı (ayrı kavramlar),
-- özel depoda dosya (yükleme ≠ seçme, tarama bitmeden erişim yok), amaç bazlı iletişim tercihi, mesaj (teslim ≠ gönderim),
-- kontrol (follow-up) ve PİA Hazır ziyaret hazırlığı kuralları.
-- Hukuki not: hiçbir tablo veya durum "elektronik imza" iddiası taşımaz; kabul yöntemi kaydedilen olgudur (ADR-033).

-- ================================================================ belge türü ve şablon
create table document_types (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  code               text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  name               text not null check (length(name) between 2 and 120),
  category           text not null check (category in ('consent','information','administrative','privacy','insurance','other')),
  requires_acceptance boolean not null default false,       -- kabul/ret kararı beklenir mi (bilgilendirme yalnız teslim edilir)
  issuer_role        text check (issuer_role in ('dentist','secretary')), -- null: belge yetkisi olan herkes
  review_status      text not null default 'demo_unreviewed' check (review_status in ('demo_unreviewed','clinically_reviewed')),
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);

create table templates (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  document_type_id  uuid not null,
  name              text not null check (length(name) between 2 and 120),
  language          text not null default 'tr' check (language in ('tr','en')),
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, document_type_id) references document_types(tenant_id, id)
);

create table template_versions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  template_id  uuid not null,
  version      integer not null check (version >= 1),
  status       text not null default 'draft' check (status in ('draft','approved','retired')),
  body         text not null check (length(body) between 10 and 20000),
  body_hash    text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  is_demo      boolean not null default true,       -- sentetik içerik; gerçek klinik/hukuk metni değildir
  change_note  text,
  created_by   uuid not null references users(id),
  created_at   timestamptz not null default now(),
  approved_by  uuid references users(id),
  approved_at  timestamptz,
  unique (tenant_id, id),
  unique (template_id, version),
  foreign key (tenant_id, template_id) references templates(tenant_id, id),
  check ((status = 'draft') = (approved_at is null))
);
create unique index template_versions_one_draft on template_versions (template_id) where status = 'draft';

-- Onaylanmış şablon sürümünün metni/hash'i değişmez (AT-14). Geçiş: draft → approved → retired.
create or replace function app.template_versions_guard() returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' and (new.body is distinct from old.body or new.body_hash is distinct from old.body_hash
       or new.version is distinct from old.version or new.template_id is distinct from old.template_id) then
    raise exception 'template_version_frozen' using errcode = '55000';
  end if;
  if not (old.status = new.status or (old.status = 'draft' and new.status = 'approved') or (old.status = 'approved' and new.status = 'retired')) then
    raise exception 'template_invalid_transition' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger template_versions_guard before update on template_versions for each row execute function app.template_versions_guard();

-- ================================================================ hasta belgesi ve onay isteği
create table patient_documents (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  patient_id           uuid not null,
  document_type_id     uuid not null,
  template_version_id  uuid not null,
  appointment_id       uuid,
  plan_version_id      uuid,
  title                text not null,
  content              text not null,                  -- üretim anındaki metin (snapshot)
  content_hash         text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  status               text not null default 'issued' check (status in ('issued','revoked')),
  revoke_reason        text,
  revoked_at           timestamptz,
  revoked_by           uuid references users(id),
  issued_by            uuid not null references users(id),
  issued_at            timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, document_type_id) references document_types(tenant_id, id),
  foreign key (tenant_id, template_version_id) references template_versions(tenant_id, id),
  foreign key (tenant_id, appointment_id) references appointments(tenant_id, id),
  foreign key (tenant_id, plan_version_id) references plan_versions(tenant_id, id),
  check ((status = 'revoked') = (revoke_reason is not null and revoked_at is not null))
);
create index patient_documents_patient_idx on patient_documents (tenant_id, patient_id, issued_at desc);

-- Üretilmiş belgenin metni, hash'i ve şablon sürümü değişmez; yalnız issued → revoked.
create or replace function app.patient_documents_guard() returns trigger language plpgsql as $$
begin
  if new.content is distinct from old.content or new.content_hash is distinct from old.content_hash
     or new.template_version_id is distinct from old.template_version_id or new.patient_id is distinct from old.patient_id
     or new.document_type_id is distinct from old.document_type_id then
    raise exception 'patient_document_immutable' using errcode = '55000';
  end if;
  if not (old.status = new.status or (old.status = 'issued' and new.status = 'revoked')) then
    raise exception 'patient_document_invalid_transition' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger patient_documents_guard before update on patient_documents for each row execute function app.patient_documents_guard();

create table consent_requests (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  patient_document_id  uuid not null,
  channel              text not null default 'in_person' check (channel in ('in_person')),   -- uzaktan kanallar Görev 5
  status               text not null default 'issued' check (status in ('issued','delivered','viewed','accepted','declined','expired','revoked')),
  expires_at           timestamptz not null,
  decided_at           timestamptz,
  decided_by           uuid references users(id),
  created_at           timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, patient_document_id),
  foreign key (tenant_id, patient_document_id) references patient_documents(tenant_id, id),
  check ((status in ('accepted','declined')) = (decided_at is not null))
);

-- Karar verilmiş istek tekrar değişmez (kabul edilmiş belge yeniden “reddedildi” olamaz); yalnız iptal (revoked).
create or replace function app.consent_requests_guard() returns trigger language plpgsql as $$
begin
  if old.status in ('declined','expired','revoked') and new.status <> old.status then
    raise exception 'consent_request_closed' using errcode = '55000';
  end if;
  if old.status = 'accepted' and new.status not in ('accepted','revoked') then
    raise exception 'consent_request_closed' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger consent_requests_guard before update on consent_requests for each row execute function app.consent_requests_guard();

-- Kanıt olayları yalnız eklenir; her olay belgenin o anki hash'ini taşır.
create table evidence_events (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  patient_document_id  uuid not null,
  kind                 text not null check (kind in ('issued','printed','presented_in_person','viewed','accepted','declined','revoked','expired','scan_attached')),
  method               text check (method in ('wet_signature_on_paper','verbal_in_person')),
  document_hash        text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  file_id              uuid,
  note                 text,
  actor_user_id        uuid references users(id),
  actor_membership_id  uuid,
  at                   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_document_id) references patient_documents(tenant_id, id),
  check (kind <> 'accepted' or method is not null)
);
create index evidence_doc_idx on evidence_events (tenant_id, patient_document_id, at);

-- ================================================================ dosya (özel depo; içerik DB'de değil)
create table file_assets (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  patient_id           uuid not null,
  appointment_id       uuid,
  patient_document_id  uuid,
  category             text not null check (category in ('radiograph','clinical_photo','clinical_document','document_scan','identity','other')),
  sensitivity          text not null check (sensitivity in ('clinical','administrative')),
  original_name        text not null check (length(original_name) between 1 and 200),
  declared_type        text not null check (declared_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  declared_size        bigint not null check (declared_size between 1 and 20971520),
  detected_type        text,
  size_bytes           bigint,
  sha256               text check (sha256 ~ '^[0-9a-f]{64}$'),
  object_key           text not null,
  status               text not null default 'initiated' check (status in ('initiated','uploaded','quarantined','available','rejected','deleted')),
  status_reason        text,
  scan_engine          text,
  scanned_at           timestamptz,
  upload_failures      integer not null default 0,
  uploaded_by          uuid not null references users(id),
  created_at           timestamptz not null default now(),
  available_at         timestamptz,
  deleted_at           timestamptz,
  deleted_by           uuid references users(id),
  unique (tenant_id, id),
  unique (tenant_id, object_key),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, appointment_id) references appointments(tenant_id, id),
  foreign key (tenant_id, patient_document_id) references patient_documents(tenant_id, id),
  check ((status = 'available') = (available_at is not null and sha256 is not null)),
  check ((status = 'deleted') = (deleted_at is not null))
);
create index file_assets_patient_idx on file_assets (tenant_id, patient_id, created_at desc);
alter table evidence_events add foreign key (tenant_id, file_id) references file_assets(tenant_id, id);

-- Durum makinesi (Plan §06): initiated → uploaded → available | quarantined | rejected; initiated → rejected (yükleme hatası tekrarı tükenince);
-- herhangi → deleted (karantinadaki dosya dahil, gerekçeyle). Tarama bitmeden available olmaz.
create or replace function app.file_assets_guard() returns trigger language plpgsql as $$
begin
  if new.sha256 is distinct from old.sha256 and old.sha256 is not null then
    raise exception 'file_hash_immutable' using errcode = '55000';
  end if;
  if new.object_key is distinct from old.object_key or new.patient_id is distinct from old.patient_id then
    raise exception 'file_immutable' using errcode = '55000';
  end if;
  if old.status <> new.status and not (
       (old.status = 'initiated' and new.status in ('initiated','uploaded','rejected','deleted')) or
       (old.status = 'uploaded' and new.status in ('available','quarantined','rejected')) or
       (old.status in ('available','quarantined','rejected') and new.status = 'deleted')) then
    raise exception 'file_invalid_transition' using errcode = '55000';
  end if;
  if new.status = 'available' and new.scanned_at is null then
    raise exception 'file_not_scanned' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger file_assets_guard before update on file_assets for each row execute function app.file_assets_guard();

create table file_access_events (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  file_id              uuid not null,
  action               text not null check (action in ('upload_initiated','upload_failed','uploaded','scan_clean','scan_infected','scan_rejected',
                                                       'downloaded','access_denied','deleted')),
  actor_user_id        uuid references users(id),
  detail               text,
  at                   timestamptz not null default now(),
  foreign key (tenant_id, file_id) references file_assets(tenant_id, id)
);
create index file_access_file_idx on file_access_events (tenant_id, file_id, at);

-- ================================================================ iletişim tercihi (amaç × kanal, yalnız eklenen geçmiş)
create table communication_preferences (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  patient_id   uuid not null,
  purpose      text not null check (purpose in ('appointment_reminder','treatment_followup','payment_reminder','survey','marketing')),
  channel      text not null check (channel in ('sms','whatsapp','email','phone')),
  status       text not null check (status in ('granted','withdrawn')),
  source       text not null check (source in ('in_person','paper_form','phone','patient_request')),
  note         text,
  recorded_by  uuid not null references users(id),
  recorded_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id)
);
create index comm_pref_patient_idx on communication_preferences (tenant_id, patient_id, purpose, channel, recorded_at desc);

-- ================================================================ mesaj (gönderim ≠ teslim; belirsiz yanıt unknown) — AT-12
create table messages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  patient_id       uuid not null,
  purpose          text not null check (purpose in ('appointment_reminder','treatment_followup','payment_reminder','survey','marketing')),
  channel          text not null check (channel in ('sms','whatsapp','email')),
  recipient_masked text not null,
  body             text not null check (length(body) between 2 and 640),
  provider         text not null check (provider in ('mock')),       -- gerçek sağlayıcı Görev 5
  provider_message_id text,
  status           text not null default 'queued' check (status in ('draft','queued','submitted','delivered','failed','cancelled','unknown')),
  status_reason    text,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  status_at        timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id)
);
create index messages_patient_idx on messages (tenant_id, patient_id, created_at desc);
create table delivery_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  message_id  uuid not null,
  status      text not null,
  source      text not null check (source in ('system','provider','timeout')),
  detail      text,
  at          timestamptz not null default now(),
  foreign key (tenant_id, message_id) references messages(tenant_id, id)
);

-- ================================================================ kontrol (follow-up) — Akış E / H11
create table follow_ups (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  patient_id      uuid not null,
  due_date        date not null,
  reason          text not null check (length(reason) between 3 and 200),   -- genel ifade; klinik ayrıntı klinik notta
  practitioner_id uuid,
  status          text not null default 'open' check (status in ('open','scheduled','done','cancelled')),
  appointment_id  uuid,
  cancel_reason   text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  foreign key (tenant_id, appointment_id) references appointments(tenant_id, id),
  check ((status = 'cancelled') = (cancel_reason is not null)),
  check (status not in ('scheduled','done') or appointment_id is not null)
);
create index follow_ups_open_idx on follow_ups (tenant_id, status, due_date);

-- ================================================================ PİA Hazır: ziyaret hazırlığı kuralları (yetkili klinik tanımlar)
create table readiness_rules (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  kind              text not null check (kind in ('document_for_procedure','anamnesis_reviewed')),
  procedure_id      uuid,
  document_type_id  uuid,
  max_age_days      integer check (max_age_days between 1 and 3650),
  active            boolean not null default true,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, procedure_id) references procedures(tenant_id, id),
  foreign key (tenant_id, document_type_id) references document_types(tenant_id, id),
  check ((kind = 'document_for_procedure') = (procedure_id is not null and document_type_id is not null)),
  check ((kind = 'anamnesis_reviewed') = (max_age_days is not null))
);
create table readiness_exceptions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  appointment_id  uuid not null,
  item_key        text not null,
  reason          text not null check (length(reason) >= 5),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  unique (tenant_id, appointment_id, item_key),
  foreign key (tenant_id, appointment_id) references appointments(tenant_id, id)
);

alter table tasks drop constraint tasks_kind_check;
alter table tasks add constraint tasks_kind_check
  check (kind in ('overdue_checkin','contact_pending','missing_contact','closure_conflict','anamnesis_review',
                  'plan_unscheduled','plan_decision_pending','follow_up','readiness_missing','file_quarantined','manual'));

-- ================================================================ RLS + yetkiler
do $$
declare t text;
begin
  foreach t in array array['document_types','templates','template_versions','patient_documents','consent_requests','evidence_events',
                           'file_assets','file_access_events','communication_preferences','messages','delivery_events',
                           'follow_ups','readiness_rules','readiness_exceptions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
                     using (tenant_id = app.tenant_id())
                     with check (tenant_id = app.tenant_id())$p$, t);
  end loop;
end $$;

grant select, insert, update on document_types, template_versions, patient_documents, consent_requests, file_assets,
  messages, follow_ups, readiness_rules to viadent_app;
grant select, insert on templates, evidence_events, file_access_events, communication_preferences, delivery_events, readiness_exceptions to viadent_app;
-- Worker: tarama, mesaj gönderimi (mock), süre aşımı ve PİA Akış/Hazır görevleri.
grant select, update on file_assets, messages, consent_requests, follow_ups to viadent_worker;
grant select, insert on file_access_events, delivery_events, evidence_events to viadent_worker;
grant select on patient_documents, document_types, communication_preferences, readiness_rules, readiness_exceptions to viadent_worker;
