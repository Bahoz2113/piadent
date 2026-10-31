-- Görev 6: Operasyon ve raporlar (VD-013, V08/V09)
--  * Tedarikçi / cari kartı (laboratuvar, medikal firma, diğer) ve cari hareketleri (borç = fatura/maliyet, ödeme), ters kayıtla düzeltme
--  * Laboratuvar iş emri: aşama durum makinesi, olay günlüğü, maliyet satırları (revizyon yeni maliyet kaydıdır) → cari borç
--  * Hekim primi: tedavi bazlı kural + prim ödemesi (kazanım ve fiilî ödeme ayrı hareket)
--  * Stok: kalem, lot (son kullanma), hareket; miktar hareketlerden türetilir, doğrudan ezilmez, eksiye düşmez
-- Tüm yeni tablolar tenant_id + RLS (ENABLE + FORCE) + bileşik FK.

-- ================================================================ tedarikçi / cari kartı (T15, T16, T18)
create table suppliers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  kind          text not null check (kind in ('lab','medical','other')),
  name          text not null check (length(name) between 2 and 120),
  contact_name  text check (contact_name is null or length(contact_name) <= 120),
  phone         text check (phone is null or length(phone) <= 30),
  email         text check (email is null or length(email) <= 200),
  tax_no        text check (tax_no is null or tax_no ~ '^[0-9]{10,11}$'),
  note          text check (note is null or length(note) <= 500),
  active        boolean not null default true,
  created_by    uuid not null references users(id),
  created_at    timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index suppliers_name_uq on suppliers (tenant_id, lower(name));

-- Cari hareket: bill = kliniğin tedarikçiye borcu artar (fatura/maliyet), payment = ödeme. Düzeltme yalnız tam ters kayıtla.
create table supplier_entries (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  supplier_id      uuid not null,
  kind             text not null check (kind in ('bill','payment')),
  amount           numeric(14,2) not null check (amount <> 0),
  currency         char(3) not null default 'TRY' check (currency = 'TRY'),
  description      text not null check (length(description) between 2 and 200),
  document_no      text check (document_no is null or length(document_no) <= 60),
  source           text not null default 'manual' check (source in ('manual','lab_cost','stock_receipt')),
  source_id        uuid,
  cash_account_id  uuid,
  occurred_at      timestamptz not null,
  reverses_id      uuid,
  reason           text,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id),
  foreign key (tenant_id, cash_account_id) references cash_accounts(tenant_id, id),
  foreign key (tenant_id, reverses_id) references supplier_entries(tenant_id, id),
  check ((amount < 0) = (reverses_id is not null)),
  check ((reverses_id is null) or (reason is not null and length(reason) >= 3)),
  check ((kind = 'payment') = (cash_account_id is not null)),
  check ((source = 'manual') = (source_id is null))
);
create unique index supplier_entries_reverse_uq on supplier_entries (tenant_id, reverses_id) where reverses_id is not null;
create unique index supplier_entries_source_uq on supplier_entries (tenant_id, source, source_id) where source <> 'manual' and reverses_id is null;
create index supplier_entries_sup_idx on supplier_entries (tenant_id, supplier_id, occurred_at);

create or replace function app.supplier_entries_guard() returns trigger language plpgsql as $$
declare orig record;
begin
  if new.reverses_id is not null then
    select * into orig from supplier_entries where id = new.reverses_id;
    if orig.reverses_id is not null then raise exception 'reversal_of_reversal' using errcode = '23514'; end if;
    if orig.kind <> new.kind or orig.supplier_id <> new.supplier_id or new.amount <> -orig.amount
       or orig.cash_account_id is distinct from new.cash_account_id then
      raise exception 'reversal_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger supplier_entries_guard before insert on supplier_entries for each row execute function app.supplier_entries_guard();

-- ================================================================ laboratuvar iş emri (H12, R09) — Plan §06: draft, sent, in_production, received, revision, accepted, cancelled
create table lab_orders (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  order_no         integer not null check (order_no > 0),
  patient_id       uuid not null,
  practitioner_id  uuid not null,
  supplier_id      uuid not null,
  plan_item_id     uuid,
  appointment_id   uuid,                                   -- prova/teslim randevusu (VİA Akış hazırlık görevi)
  work_type        text not null check (length(work_type) between 2 and 120),
  teeth            text[] not null default '{}',
  shade            text check (shade is null or length(shade) <= 30),
  instructions     text check (instructions is null or length(instructions) <= 1000),   -- yalnız teknik bilgi; laboratuvara gider
  target_date      date,
  status           text not null default 'draft' check (status in ('draft','sent','in_production','received','revision','accepted','cancelled')),
  revision_count   integer not null default 0 check (revision_count >= 0),
  sent_at          timestamptz,
  received_at      timestamptz,
  accepted_at      timestamptz,
  cancel_reason    text,
  row_version      integer not null default 1,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, order_no),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id),
  foreign key (tenant_id, plan_item_id) references plan_items(tenant_id, id),
  foreign key (tenant_id, appointment_id) references appointments(tenant_id, id),
  check ((status = 'cancelled') = (cancel_reason is not null)),
  check (status = 'draft' or status = 'cancelled' or target_date is not null),
  check (teeth <@ array['11','12','13','14','15','16','17','18','21','22','23','24','25','26','27','28',
                        '31','32','33','34','35','36','37','38','41','42','43','44','45','46','47','48',
                        '51','52','53','54','55','61','62','63','64','65','71','72','73','74','75','81','82','83','84','85']::text[])
);
create index lab_orders_status_idx on lab_orders (tenant_id, status, target_date);
create index lab_orders_patient_idx on lab_orders (tenant_id, patient_id, created_at desc);

-- Durum makinesi DB'de de uygulanır; hasta değişmez, laboratuvar yalnız taslakta değişir.
create or replace function app.lab_orders_guard() returns trigger language plpgsql as $$
declare ok boolean;
begin
  if new.patient_id <> old.patient_id or new.order_no <> old.order_no then raise exception 'lab_order_immutable' using errcode = '23514'; end if;
  if new.supplier_id <> old.supplier_id and old.status <> 'draft' then raise exception 'lab_supplier_locked' using errcode = '23514'; end if;
  if new.status <> old.status then
    ok := case old.status
      when 'draft' then new.status in ('sent','cancelled')
      when 'sent' then new.status in ('in_production','received','cancelled')
      when 'in_production' then new.status in ('received','cancelled')
      when 'received' then new.status in ('accepted','revision')
      when 'revision' then new.status in ('in_production','received','cancelled')
      else false end;
    if not ok then raise exception 'lab_invalid_transition' using errcode = '23514'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger lab_orders_guard before update on lab_orders for each row execute function app.lab_orders_guard();

create table lab_events (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity,
  tenant_id     uuid not null references tenants(id),
  lab_order_id  uuid not null,
  kind          text not null check (kind in ('created','sent','in_production','received','revision_requested','accepted','cancelled',
                                                'note','cost_added','cost_reversed','target_changed','updated')),
  from_status   text,
  to_status     text,
  note          text check (note is null or length(note) <= 500),
  at            timestamptz not null default now(),
  by_user       uuid not null references users(id),
  unique (tenant_id, id),
  foreign key (tenant_id, lab_order_id) references lab_orders(tenant_id, id)
);
create index lab_events_order_idx on lab_events (tenant_id, lab_order_id, at);

create table lab_costs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  lab_order_id       uuid not null,
  stage              text not null check (stage in ('initial','revision','extra')),
  revision_no        integer not null default 0 check (revision_no >= 0),
  amount             numeric(14,2) not null check (amount <> 0),
  description        text not null check (length(description) between 2 and 200),
  supplier_entry_id  uuid not null,
  reverses_id        uuid,
  reason             text,
  created_by         uuid not null references users(id),
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, lab_order_id) references lab_orders(tenant_id, id),
  foreign key (tenant_id, supplier_entry_id) references supplier_entries(tenant_id, id),
  foreign key (tenant_id, reverses_id) references lab_costs(tenant_id, id),
  check ((amount < 0) = (reverses_id is not null))
);
create unique index lab_costs_reverse_uq on lab_costs (tenant_id, reverses_id) where reverses_id is not null;

-- ================================================================ hekim primi: tedavi bazlı kural + prim ödemesi (R19, R20)
alter table commission_rule_versions drop constraint commission_rule_versions_basis_check;
alter table commission_rule_versions add constraint commission_rule_versions_basis_check check (basis in ('collection','treatment'));
-- Bir hekim için bir günde tek etkin kural (temel ne olursa olsun) → aynı işlem/tahsilat için çift prim oluşmaz.
drop index commission_rule_uq;
create unique index commission_rule_uq on commission_rule_versions (tenant_id, coalesce(practitioner_id, '00000000-0000-0000-0000-000000000000'::uuid), valid_from);

alter table commission_accruals alter column allocation_id drop not null;
alter table commission_accruals add column performed_procedure_id uuid;
alter table commission_accruals add column basis text not null default 'collection' check (basis in ('collection','treatment'));
alter table commission_accruals add foreign key (tenant_id, performed_procedure_id) references performed_procedures(tenant_id, id);
alter table commission_accruals add check ((basis = 'collection') = (allocation_id is not null));
alter table commission_accruals add check ((basis = 'treatment') = (performed_procedure_id is not null));
create unique index commission_treatment_uq on commission_accruals (tenant_id, performed_procedure_id) where basis = 'treatment' and reverses_id is null;
create unique index commission_treatment_rev_uq on commission_accruals (tenant_id, reverses_id) where basis = 'treatment' and reverses_id is not null;

create table commission_payouts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  practitioner_id  uuid not null,
  amount           numeric(14,2) not null check (amount <> 0),
  period_from      date,
  period_to        date,
  cash_account_id  uuid not null,
  paid_at          timestamptz not null,
  note             text check (note is null or length(note) <= 300),
  reverses_id      uuid,
  reason           text,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  foreign key (tenant_id, cash_account_id) references cash_accounts(tenant_id, id),
  foreign key (tenant_id, reverses_id) references commission_payouts(tenant_id, id),
  check ((amount < 0) = (reverses_id is not null)),
  check ((reverses_id is null) or (reason is not null and length(reason) >= 3)),
  check (period_from is null or period_to is null or period_from <= period_to)
);
create unique index commission_payouts_reverse_uq on commission_payouts (tenant_id, reverses_id) where reverses_id is not null;

-- Ödenen prim, hekimin net tahakkukunu (tahakkuk − ters prim) aşamaz; hekim bazında kilit.
create or replace function app.commission_payouts_guard() returns trigger language plpgsql as $$
declare accrued numeric; paid numeric; orig record;
begin
  perform pg_advisory_xact_lock(hashtext('commission:' || new.practitioner_id::text));
  if new.reverses_id is not null then
    select * into orig from commission_payouts where id = new.reverses_id;
    if orig.reverses_id is not null or orig.practitioner_id <> new.practitioner_id or new.amount <> -orig.amount
       or orig.cash_account_id <> new.cash_account_id then
      raise exception 'reversal_mismatch' using errcode = '23514';
    end if;
    return new;
  end if;
  select coalesce(sum(amount), 0) into accrued from commission_accruals where practitioner_id = new.practitioner_id;
  select coalesce(sum(amount), 0) into paid from commission_payouts where practitioner_id = new.practitioner_id;
  if paid + new.amount > accrued then raise exception 'payout_exceeds_accrued' using errcode = '23514'; end if;
  return new;
end $$;
create trigger commission_payouts_guard before insert on commission_payouts for each row execute function app.commission_payouts_guard();

-- ================================================================ kasa hareketi kaynakları
alter table cash_movements drop constraint cash_movements_source_check;
alter table cash_movements add constraint cash_movements_source_check
  check (source in ('payment','refund','expense','supplier_payment','commission_payout'));

-- ================================================================ stok: kalem, lot, hareket (miktar hareketlerden türetilir)
create table stock_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  code          text not null check (code ~ '^[A-Za-z0-9._-]{2,30}$'),
  name          text not null check (length(name) between 2 and 120),
  unit          text not null check (unit in ('adet','kutu','paket','ml','g','set','kartus')),
  category      text check (category is null or length(category) <= 60),
  track_lots    boolean not null default false,
  min_level     numeric(12,3) not null default 0 check (min_level >= 0),
  active        boolean not null default true,
  created_by    uuid not null references users(id),
  created_at    timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index stock_items_code_uq on stock_items (tenant_id, lower(code));

create table stock_lots (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  item_id      uuid not null,
  lot_no       text not null check (length(lot_no) between 1 and 60),
  expiry_date  date,
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, item_id, lot_no),
  foreign key (tenant_id, item_id) references stock_items(tenant_id, id)
);

create table stock_movements (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  item_id                 uuid not null,
  lot_id                  uuid,
  kind                    text not null check (kind in ('receipt','usage','waste','adjustment','return')),
  quantity                numeric(12,3) not null check (quantity <> 0),
  unit_cost               numeric(14,2) check (unit_cost is null or unit_cost >= 0),
  supplier_id             uuid,
  patient_id              uuid,
  performed_procedure_id  uuid,
  reason                  text check (reason is null or length(reason) <= 300),
  occurred_at             timestamptz not null,
  reverses_id             uuid,
  created_by              uuid not null references users(id),
  created_at              timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, item_id) references stock_items(tenant_id, id),
  foreign key (tenant_id, lot_id) references stock_lots(tenant_id, id),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, performed_procedure_id) references performed_procedures(tenant_id, id),
  foreign key (tenant_id, reverses_id) references stock_movements(tenant_id, id),
  check (kind <> 'receipt' or quantity > 0 or reverses_id is not null),
  check (kind not in ('usage','waste','return') or quantity < 0 or reverses_id is not null),
  check (kind not in ('waste','adjustment') or (reason is not null and length(reason) >= 3)),
  check (performed_procedure_id is null or patient_id is not null)
);
create unique index stock_movements_reverse_uq on stock_movements (tenant_id, reverses_id) where reverses_id is not null;
create index stock_movements_item_idx on stock_movements (tenant_id, item_id, occurred_at);
create index stock_movements_patient_idx on stock_movements (tenant_id, patient_id) where patient_id is not null;

-- Eksi stok olmaz (kalem ve lot bazında); lot takipli kalemde lot zorunlu; lot kaleme ait olmalı. Kalem bazında kilit.
create or replace function app.stock_movements_guard() returns trigger language plpgsql as $$
declare it record; lot record; bal numeric; lbal numeric; orig record;
begin
  perform pg_advisory_xact_lock(hashtext('stock:' || new.item_id::text));
  select * into it from stock_items where id = new.item_id;
  if it.track_lots and new.lot_id is null then raise exception 'stock_lot_required' using errcode = '23514'; end if;
  if not it.track_lots and new.lot_id is not null then raise exception 'stock_lot_not_tracked' using errcode = '23514'; end if;
  if new.lot_id is not null then
    select * into lot from stock_lots where id = new.lot_id;
    if lot.item_id <> new.item_id then raise exception 'stock_lot_mismatch' using errcode = '23514'; end if;
  end if;
  if new.reverses_id is not null then
    select * into orig from stock_movements where id = new.reverses_id;
    if orig.reverses_id is not null or orig.item_id <> new.item_id or orig.lot_id is distinct from new.lot_id
       or orig.kind <> new.kind or new.quantity <> -orig.quantity then
      raise exception 'reversal_mismatch' using errcode = '23514';
    end if;
  end if;
  if new.quantity < 0 then
    select coalesce(sum(quantity), 0) into bal from stock_movements where item_id = new.item_id;
    if bal + new.quantity < 0 then raise exception 'stock_negative' using errcode = '23514'; end if;
    if new.lot_id is not null then
      select coalesce(sum(quantity), 0) into lbal from stock_movements where lot_id = new.lot_id;
      if lbal + new.quantity < 0 then raise exception 'stock_negative' using errcode = '23514'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger stock_movements_guard before insert on stock_movements for each row execute function app.stock_movements_guard();

-- ================================================================ görev türleri
alter table tasks drop constraint tasks_kind_check;
alter table tasks add constraint tasks_kind_check
  check (kind in ('overdue_checkin','contact_pending','missing_contact','closure_conflict','anamnesis_review',
                  'plan_unscheduled','plan_decision_pending','follow_up','readiness_missing','file_quarantined',
                  'integration_dead','integration_approval','lab_overdue','lab_review','lab_not_ready',
                  'stock_low','lot_expiring','manual'));

-- ================================================================ RLS + yetkiler
do $$
declare t text;
begin
  foreach t in array array['suppliers','supplier_entries','lab_orders','lab_events','lab_costs','commission_payouts',
                           'stock_items','stock_lots','stock_movements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
                     using (tenant_id = app.tenant_id())
                     with check (tenant_id = app.tenant_id())$p$, t);
  end loop;
end $$;

-- Hareket tabloları yalnız eklenir (düzeltme ters kayıtla).
grant select, insert, update on suppliers, lab_orders, stock_items to viadent_app;
grant select, insert on supplier_entries, lab_events, lab_costs, commission_payouts, stock_lots, stock_movements to viadent_app;
grant update (expiry_date) on stock_lots to viadent_app;
grant select on suppliers, lab_orders, stock_items, stock_lots, stock_movements to viadent_worker;
