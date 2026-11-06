-- Ürün sahibi geri bildirimi 07.11.2026 (ADR-102): Mesajlar sekmesi, Netgsm SMS sağlayıcısı, zamanlanmış ve otomatik mesajlar.
--  * messages.provider: 'netgsm' eklenir (gerçek gönderim yalnız Netgsm kimlik bilgileri ortamda tanımlı ve canlı gönderim kapısı açıksa).
--  * message_schedules: hekim/sekreterin ileri tarihe kurduğu tek seferlik bilgi mesajı ("alarm"). Gönderim anında izin yeniden kontrol edilir.
--  * message_rules: klinik otomatik mesaj kuralları — randevudan X saat önce (hatırlatma) / tamamlanan randevudan X saat sonra (bilgilendirme).
--  * message_rule_runs: kural × randevu tek kez işlenir (gönderildi / izin yok / alıcı yok); tekrar gönderim olmaz.
alter table messages drop constraint messages_provider_check;
alter table messages add constraint messages_provider_check check (provider in ('mock', 'netgsm'));
alter table messages add column source text not null default 'manual' check (source in ('manual', 'schedule', 'rule'));

create table message_schedules (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  patient_id    uuid not null,
  purpose       text not null check (purpose in ('appointment_reminder','treatment_followup','payment_reminder','survey','marketing')),
  channel       text not null default 'sms' check (channel in ('sms')),
  body          text not null check (length(body) between 2 and 640),
  send_at       timestamptz not null,
  status        text not null default 'scheduled' check (status in ('scheduled', 'queued', 'skipped', 'cancelled')),
  status_reason text,
  message_id    uuid,
  created_by    uuid not null references users(id),
  created_at    timestamptz not null default now(),
  cancelled_by  uuid references users(id),
  cancelled_at  timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, message_id) references messages(tenant_id, id)
);
create index message_schedules_due_idx on message_schedules (tenant_id, send_at) where status = 'scheduled';

create table message_rules (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  kind          text not null check (kind in ('before_appointment', 'after_appointment')),
  hours         integer not null check (hours between 1 and 168),
  body          text not null check (length(body) between 2 and 640),
  active        boolean not null default true,
  created_by    uuid not null references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, kind)
);

create table message_rule_runs (
  tenant_id      uuid not null references tenants(id),
  rule_id        uuid not null,
  appointment_id uuid not null,
  outcome        text not null check (outcome in ('queued', 'no_consent', 'no_recipient', 'no_provider')),
  message_id     uuid,
  at             timestamptz not null default now(),
  primary key (tenant_id, rule_id, appointment_id),
  foreign key (tenant_id, rule_id) references message_rules(tenant_id, id),
  foreign key (tenant_id, appointment_id) references appointments(tenant_id, id),
  foreign key (tenant_id, message_id) references messages(tenant_id, id)
);

alter table message_schedules enable row level security;
alter table message_schedules force row level security;
create policy tenant_isolation on message_schedules using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
alter table message_rules enable row level security;
alter table message_rules force row level security;
create policy tenant_isolation on message_rules using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
alter table message_rule_runs enable row level security;
alter table message_rule_runs force row level security;
create policy tenant_isolation on message_rule_runs using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());

grant select, insert, update on message_schedules, message_rules to viadent_app;
grant select on message_rule_runs to viadent_app;
grant select, update on message_schedules to viadent_worker;
grant select on message_rules to viadent_worker;
grant select, insert on message_rule_runs to viadent_worker;
-- Zamanlanmış/otomatik mesajı worker kuyruğa alır (mesaj + dış iş satırı); mevcut işleyici gönderir.
grant insert on messages, integration_jobs to viadent_worker;
