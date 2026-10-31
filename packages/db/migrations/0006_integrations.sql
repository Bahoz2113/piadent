-- VİADENT 0006 (Görev 5): VİA Köprü — sağlayıcı bağlantıları, dış işler (outbound job), denemeler, doğrulanmış webhook olayları,
-- online ödeme isteği. Sağlayıcı kabulü (transport) ile işin nihai sonucu (outcome) ayrı tutulur; aynı webhook iki etki doğurmaz.
-- Gerçek sağlayıcı sözleşmesi/test erişimi yok: yalnız açık etiketli MOCK adaptör (ADR-037).

create table integration_connections (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  kind               text not null check (kind in ('sms','whatsapp','email','payment','e_invoice','health_registry','signature')),
  provider           text not null check (length(provider) between 2 and 40),
  mode               text not null default 'mock' check (mode in ('mock','sandbox','live')),
  status             text not null default 'active' check (status in ('active','disabled','blocked')),
  blocked_reason     text,
  config             jsonb not null default '{}'::jsonb,          -- gizli bilgi İÇERMEZ
  webhook_secret_enc text,                                         -- AES-256-GCM (uygulama anahtarıyla), düz metin değil
  secret_rotated_at  timestamptz,
  activated_by       uuid references users(id),
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, kind, provider),
  check ((status = 'blocked') = (blocked_reason is not null)),
  check (mode = 'mock' or status <> 'active' or activated_by is not null)
);

create table integration_jobs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  connection_id     uuid not null,
  operation         text not null check (operation in ('sms.send','payment.create_link','payment.refund')),
  source_type       text not null,
  source_id         uuid not null,
  idempotency_key   text not null check (length(idempotency_key) between 8 and 120),
  payload           jsonb not null,                                -- sağlayıcıya gidecek en az veri
  approval_status   text not null default 'not_required' check (approval_status in ('not_required','pending','approved','rejected')),
  requested_by      uuid not null references users(id),
  approved_by       uuid references users(id),
  approved_at       timestamptz,
  reject_reason     text,
  transport_status  text not null default 'queued' check (transport_status in ('held','queued','sending','accepted','rejected','unknown','dead','cancelled')),
  outcome_status    text not null default 'pending' check (outcome_status in ('pending','succeeded','failed','unknown','not_applicable')),
  attempts          integer not null default 0,
  max_attempts      integer not null default 6 check (max_attempts between 1 and 20),
  next_attempt_at   timestamptz not null default now(),
  last_error        text,
  provider_ref      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, operation, idempotency_key),
  foreign key (tenant_id, connection_id) references integration_connections(tenant_id, id),
  check (approved_by is null or approved_by <> requested_by),              -- dört göz
  check (approval_status <> 'pending' or transport_status = 'held'),
  check (approval_status <> 'rejected' or transport_status = 'cancelled')
);
create index integration_jobs_due_idx on integration_jobs (next_attempt_at) where transport_status in ('queued','unknown');
create index integration_jobs_source_idx on integration_jobs (tenant_id, source_type, source_id);
create unique index integration_jobs_provider_ref_uq on integration_jobs (tenant_id, connection_id, provider_ref) where provider_ref is not null;

create table integration_attempts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  job_id      uuid not null,
  attempt     integer not null,
  kind        text not null check (kind in ('submit','status_query')),
  result      text not null check (result in ('accepted','rejected','timeout','error','not_found')),
  detail      text,                                                  -- hata kodu/özet; hasta verisi yok
  started_at  timestamptz not null,
  finished_at timestamptz not null default now(),
  foreign key (tenant_id, job_id) references integration_jobs(tenant_id, id)
);
create index integration_attempts_job_idx on integration_attempts (tenant_id, job_id, started_at);

create table webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  connection_id      uuid not null,
  provider_event_id  text not null,
  event_type         text not null,
  occurred_at        timestamptz,
  received_at        timestamptz not null default now(),
  payload_sha256     text not null,
  payload            jsonb not null,
  status             text not null check (status in ('processed','ignored_stale','ignored_unknown','error')),
  job_id             uuid,
  detail             text,
  unique (tenant_id, connection_id, provider_event_id),               -- aynı olay iki etki doğurmaz
  foreign key (tenant_id, connection_id) references integration_connections(tenant_id, id)
);
-- İmzası/zamanı geçersiz istekler: içerik saklanmaz, yalnız neden ve zaman (bağlantının tenant'ında; hedefi çözülemeyen istek yalnız loglanır).
create table webhook_rejections (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  connection_id  uuid not null,
  reason         text not null check (reason in ('signature_invalid','timestamp_out_of_window','malformed')),
  received_at    timestamptz not null default now(),
  foreign key (tenant_id, connection_id) references integration_connections(tenant_id, id)
);

create table online_payment_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  patient_id    uuid not null,
  amount        numeric(14,2) not null check (amount > 0),
  currency      char(3) not null default 'TRY' check (currency = 'TRY'),
  description   text not null check (length(description) between 2 and 120),
  status        text not null default 'created' check (status in ('created','link_ready','paid','failed','expired','cancelled')),
  checkout_url  text,
  provider_ref  text,
  payment_id    uuid,
  failure_reason text,
  created_by    uuid not null references users(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '3 days',
  paid_at       timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, payment_id) references payments(tenant_id, id),
  check ((status = 'paid') = (payment_id is not null))
);

-- Ödeme kaynağı: manuel kayıt veya sağlayıcı onayı (Plan §06: “Kart seçimi sağlayıcıdan para alındığını kanıtlamaz”).
alter table payments add column source text not null default 'manual' check (source in ('manual','provider'));
alter table payments add column provider_ref text;
alter table payments add check ((source = 'provider') = (provider_ref is not null));
create unique index payments_provider_ref_uq on payments (tenant_id, provider_ref) where provider_ref is not null;
alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check check (method in ('cash','card_manual','bank_transfer','other','online'));
alter table payments add check ((method = 'online') = (source = 'provider'));
alter table refunds drop constraint refunds_method_check;
alter table refunds add constraint refunds_method_check check (method in ('cash','card_manual','bank_transfer','other','online'));
alter table refunds add column provider_ref text;
create unique index refunds_provider_ref_uq on refunds (tenant_id, provider_ref) where provider_ref is not null;
alter table cash_accounts drop constraint cash_accounts_kind_check;
alter table cash_accounts add constraint cash_accounts_kind_check check (kind in ('cash','bank','pos_manual','provider'));

alter table messages add column integration_job_id uuid;
alter table messages add foreign key (tenant_id, integration_job_id) references integration_jobs(tenant_id, id);

alter table tasks drop constraint tasks_kind_check;
alter table tasks add constraint tasks_kind_check
  check (kind in ('overdue_checkin','contact_pending','missing_contact','closure_conflict','anamnesis_review',
                  'plan_unscheduled','plan_decision_pending','follow_up','readiness_missing','file_quarantined',
                  'integration_dead','integration_approval','manual'));

-- Webhook: oturumsuz istek bağlantı kimliğinden tenant'ı çözmek için dar SECURITY DEFINER (davet modeliyle aynı yaklaşım).
create policy owner_webhook_lookup on integration_connections for select to viadent_owner using (true);
create or replace function app.webhook_target(p_connection uuid)
  returns table (tenant_id uuid, kind text, provider text, mode text, status text, webhook_secret_enc text)
  language sql stable security definer set search_path = public, pg_temp as $$
  select tenant_id, kind, provider, mode, status, webhook_secret_enc from integration_connections where id = p_connection
$$;
revoke all on function app.webhook_target(uuid) from public;
grant execute on function app.webhook_target(uuid) to viadent_app;


do $$
declare t text;
begin
  foreach t in array array['integration_connections','integration_jobs','integration_attempts','webhook_events','webhook_rejections','online_payment_requests'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
                     using (tenant_id = app.tenant_id())
                     with check (tenant_id = app.tenant_id())$p$, t);
  end loop;
end $$;

grant select, insert, update on integration_connections, integration_jobs, online_payment_requests to viadent_app;
grant select, insert on integration_attempts, webhook_events, webhook_rejections to viadent_app;
grant update (status, job_id, detail) on webhook_events to viadent_app;   -- yalnız işlem sonucu; içerik değişmez
grant select, update on integration_jobs, online_payment_requests to viadent_worker;
grant select on integration_connections to viadent_worker;
grant select, insert on integration_attempts to viadent_worker;
grant update on messages to viadent_worker;

-- Görev 4'ten kalan kuyruktaki MOCK mesajlar (outbox yolu kaldırıldı): sessizce gönderilmiş sayılmaz, iptal edilir.
alter table messages no force row level security;
update messages set status = 'cancelled', status_reason = 'VİA Köprü geçişi: kuyruktaki mesaj iptal edildi; yeniden gönderin', status_at = now() where status = 'queued';
alter table messages force row level security;
update outbox_events set status = 'done', processed_at = now(), last_error = 'VİA Köprü geçişi: integration_jobs kullanılır' where topic = 'message.send' and status in ('pending','processing');
