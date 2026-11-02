-- Faz 1.1 (ADR-084): anamnez soru şablonu yönetimi. Şablon sürümlüdür; yayınlanmış/emekli sürüm değişmez; eski anamnez kayıtları
-- kendi şablon sürümüne bağlı kalır (template_id). template_id NULL = yerleşik DEMO soru seti (questionnaire_version 'demo-2026.10').
create table anamnesis_templates (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  version       integer not null check (version > 0),
  status        text not null default 'draft' check (status in ('draft','published','retired')),
  title         text not null check (length(title) between 2 and 120),
  questions     jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 60),
  note          text,
  created_by    uuid not null references users(id),
  published_by  uuid references users(id),
  published_at  timestamptz,
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, version),
  check ((status = 'published') = (published_at is not null and retired_at is null)),
  check (status <> 'retired' or retired_at is not null)
);
create unique index anamnesis_templates_published_uq on anamnesis_templates (tenant_id) where status = 'published';

create or replace function app.anamnesis_templates_guard() returns trigger language plpgsql as $$
begin
  if new.tenant_id <> old.tenant_id or new.version <> old.version or new.created_at <> old.created_at then raise exception 'anamnesis_template_immutable' using errcode = '55000'; end if;
  if old.status = 'retired' then raise exception 'anamnesis_template_retired' using errcode = '55000'; end if;
  if old.status = 'published' and new.status = 'published' and (new.questions is distinct from old.questions or new.title is distinct from old.title) then
    raise exception 'anamnesis_template_locked' using errcode = '55000';           -- yayınlanmış sorular değişmez; yeni sürüm açılır
  end if;
  if old.status = 'published' and new.status = 'draft' then raise exception 'anamnesis_template_invalid_transition' using errcode = '55000'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger anamnesis_templates_guard before update on anamnesis_templates for each row execute function app.anamnesis_templates_guard();

alter table anamnesis_versions add column template_id uuid;
alter table anamnesis_versions add foreign key (tenant_id, template_id) references anamnesis_templates(tenant_id, id);

alter table anamnesis_templates enable row level security;
alter table anamnesis_templates force row level security;
create policy tenant_isolation on anamnesis_templates using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
grant select, insert, update on anamnesis_templates to viadent_app;
grant select on anamnesis_templates to viadent_worker;
