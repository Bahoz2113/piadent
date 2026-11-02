-- Faz 2.2 (ADR-083): fatura taslağı iç modeli. PİA-DENT fatura numarası ÜRETMEZ; invoice_no/provider_ref yalnız yetkili e-belge
-- sağlayıcısının yanıtıyla (issued) yazılır. Sağlayıcı yokken kayıtlar yalnız 'draft' ↔ 'cancelled' arasında dolaşır.
create table invoices (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  patient_id        uuid not null,
  doc_type          text not null check (doc_type in ('e_arsiv','e_fatura','e_smm')),
  status            text not null default 'draft' check (status in ('draft','pending_provider','issued','rejected','cancelled')),
  buyer_type        text not null check (buyer_type in ('individual','company')),
  buyer_name        text not null check (length(buyer_name) between 2 and 160),
  buyer_tax_no      text check (buyer_tax_no is null or buyer_tax_no ~ '^[0-9]{10}$'),
  buyer_tax_office  text,
  buyer_address     text,
  buyer_email       text,
  note              text,
  currency          char(3) not null default 'TRY' check (currency = 'TRY'),
  subtotal          numeric(14,2) not null default 0 check (subtotal >= 0),
  vat_total         numeric(14,2) not null default 0 check (vat_total >= 0),
  grand_total       numeric(14,2) not null default 0 check (grand_total >= 0),
  -- yalnız sağlayıcı yanıtıyla dolar
  provider_connection_id uuid,
  provider_ref      text,
  invoice_no        text,
  issued_at         timestamptz,
  rejected_reason   text,
  cancel_reason     text,
  cancelled_at      timestamptz,
  cancelled_by      uuid references users(id),
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, provider_connection_id) references integration_connections(tenant_id, id),
  check (buyer_type <> 'company' or buyer_tax_no is not null),
  check ((status = 'issued') = (invoice_no is not null and issued_at is not null)),
  check (status <> 'cancelled' or (cancel_reason is not null and cancelled_at is not null))
);
create index invoices_patient_idx on invoices (tenant_id, patient_id, created_at desc);
create index invoices_status_idx on invoices (tenant_id, status, created_at desc);

create table invoice_lines (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  invoice_id      uuid not null,
  line_no         integer not null check (line_no > 0),
  description     text not null check (length(description) between 2 and 200),
  quantity        integer not null check (quantity between 1 and 999),
  unit_price      numeric(14,2) not null check (unit_price > 0),
  vat_rate        integer not null check (vat_rate in (0,1,10,20)),
  line_total      numeric(14,2) not null check (line_total >= 0),   -- KDV hariç
  vat_amount      numeric(14,2) not null check (vat_amount >= 0),
  receivable_id   uuid,
  unique (tenant_id, id),
  unique (tenant_id, invoice_id, line_no),
  foreign key (tenant_id, invoice_id) references invoices(tenant_id, id) on delete cascade,
  foreign key (tenant_id, receivable_id) references receivables(tenant_id, id)
);

-- Durum makinesi + değişmezlik: düzenlenen/iptal edilen fatura satır ve alıcı bilgisi değiştirilemez; numara yalnız issued ile.
create or replace function app.invoices_guard() returns trigger language plpgsql as $$
begin
  if new.tenant_id <> old.tenant_id or new.patient_id <> old.patient_id or new.created_at <> old.created_at or new.created_by <> old.created_by then
    raise exception 'invoice_immutable' using errcode = '55000';
  end if;
  if old.status in ('issued','cancelled','rejected') and new.status <> old.status
     and not (old.status = 'issued' and new.status = 'cancelled')                      -- düzenlenmiş fatura yalnız iptal (sağlayıcı iptaliyle) olabilir
     and not (old.status = 'rejected' and new.status in ('draft','cancelled')) then     -- ret → düzelt (taslağa dön) ya da iptal
    raise exception 'invoice_invalid_transition' using errcode = '55000';
  end if;
  if old.status = 'draft' and new.status not in ('draft','pending_provider','cancelled') then
    raise exception 'invoice_invalid_transition' using errcode = '55000';
  end if;
  if old.status = 'pending_provider' and new.status not in ('pending_provider','issued','rejected') then
    raise exception 'invoice_invalid_transition' using errcode = '55000';
  end if;
  if old.status <> 'draft' and new.status = old.status
     and (new.buyer_name is distinct from old.buyer_name or new.buyer_tax_no is distinct from old.buyer_tax_no or new.doc_type is distinct from old.doc_type
          or new.grand_total is distinct from old.grand_total) then
    raise exception 'invoice_locked' using errcode = '55000';
  end if;
  if new.invoice_no is distinct from old.invoice_no and new.status <> 'issued' then
    raise exception 'invoice_no_only_from_provider' using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger invoices_guard before update on invoices for each row execute function app.invoices_guard();

-- Satırlar yalnız taslakta değişir.
create or replace function app.invoice_lines_guard() returns trigger language plpgsql as $$
declare v_status text; v_id uuid;
begin
  v_id := coalesce(new.invoice_id, old.invoice_id);
  select status into v_status from invoices where id = v_id;
  if v_status is distinct from 'draft' and tg_op <> 'DELETE' then raise exception 'invoice_lines_locked' using errcode = '55000'; end if;
  if v_status is distinct from 'draft' and tg_op = 'DELETE' and v_status is not null then raise exception 'invoice_lines_locked' using errcode = '55000'; end if;
  return coalesce(new, old);
end $$;
create trigger invoice_lines_guard before insert or update or delete on invoice_lines for each row execute function app.invoice_lines_guard();

do $$ declare t text; begin
  foreach t in array array['invoices','invoice_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id())$p$, t);
  end loop;
end $$;
grant select, insert, update on invoices to viadent_app;
grant select, insert, update, delete on invoice_lines to viadent_app;   -- yalnız taslakta (tetikleyici)
grant select on invoices, invoice_lines to viadent_worker;
grant update (status, provider_ref, invoice_no, issued_at, rejected_reason, provider_connection_id, updated_at) on invoices to viadent_worker; -- sağlayıcı yanıtı
