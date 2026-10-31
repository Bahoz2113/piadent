-- VİADENT 0004 (Görev 3): VİA Net — alacak, ödeme, dağıtım, avans, iade, kasa hareketi, gider,
-- idempotency anahtarı ve tahsilat bazlı hekim primi tahakkuku.
-- İlkeler: para numeric(14,2); hareketler silinmez/güncellenmez, düzeltme ters kayıtla yapılır;
-- tutar sınırları DB tetikleyicisinde de (API'nin arkasında ikinci savunma) kilitle denetlenir.
-- İlk kapsam TRY: currency sütunları ve kur alanları hazır; TRY dışı değer şimdilik reddedilir (ADR-028).

-- ---------------------------------------------------------------- kasa / banka hesapları — T07 / T08
create table cash_accounts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  name        text not null check (length(name) between 2 and 80),
  kind        text not null check (kind in ('cash','bank','pos_manual')),
  currency    char(3) not null default 'TRY' check (currency = 'TRY'),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

-- ---------------------------------------------------------------- alacak (borçlandırma)
create table receivables (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  patient_id              uuid not null,
  source                  text not null check (source in ('performed_procedure','manual')),
  performed_procedure_id  uuid,
  description             text not null check (length(description) between 2 and 200),
  amount                  numeric(14,2) not null check (amount > 0),
  currency                char(3) not null default 'TRY' check (currency = 'TRY'),
  -- Çoklu para birimi için ayrılmış alanlar (davranış kapalı): özgün tutar/para birimi, işlem kuru, kur zamanı, kaynak.
  original_amount         numeric(14,2),
  original_currency       char(3),
  fx_rate                 numeric(18,8),
  fx_at                   timestamptz,
  fx_source               text,
  practitioner_id         uuid,
  due_date                date not null,
  status                  text not null default 'active' check (status in ('active','cancelled')),
  cancel_reason           text,
  cancelled_at            timestamptz,
  cancelled_by            uuid references users(id),
  created_by              uuid not null references users(id),
  created_at              timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, performed_procedure_id) references performed_procedures(tenant_id, id),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  check ((source = 'performed_procedure') = (performed_procedure_id is not null)),
  check ((status = 'cancelled') = (cancel_reason is not null and cancelled_at is not null)),
  check (original_currency is null)                       -- çoklu para birimi kapalı
);
create unique index receivables_performed_uq on receivables (tenant_id, performed_procedure_id) where performed_procedure_id is not null;
create index receivables_patient_idx on receivables (tenant_id, patient_id, created_at);

-- ---------------------------------------------------------------- ödeme (tahsilat)
create table payments (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  patient_id       uuid not null,
  amount           numeric(14,2) not null check (amount > 0),
  currency         char(3) not null default 'TRY' check (currency = 'TRY'),
  original_amount  numeric(14,2),
  original_currency char(3),
  fx_rate          numeric(18,8),
  fx_at            timestamptz,
  fx_source        text,
  method           text not null check (method in ('cash','card_manual','bank_transfer','other')),
  cash_account_id  uuid not null,
  paid_at          timestamptz not null,
  note             text,
  received_by      uuid not null references users(id),
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, cash_account_id) references cash_accounts(tenant_id, id),
  check (original_currency is null)
);
create index payments_patient_idx on payments (tenant_id, patient_id, paid_at);
create index payments_paid_idx on payments (tenant_id, paid_at);

-- ---------------------------------------------------------------- dağıtım (ödeme → alacak); ters kayıt negatif tutarla
create table allocations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  payment_id      uuid not null,
  receivable_id   uuid not null,
  amount          numeric(14,2) not null check (amount <> 0),
  reverses_id     uuid,
  reason          text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, payment_id) references payments(tenant_id, id),
  foreign key (tenant_id, receivable_id) references receivables(tenant_id, id),
  foreign key (tenant_id, reverses_id) references allocations(tenant_id, id),
  check ((amount < 0) = (reverses_id is not null)),
  check (amount > 0 or reason is not null)
);
create index allocations_payment_idx on allocations (tenant_id, payment_id);
create index allocations_receivable_idx on allocations (tenant_id, receivable_id);

-- ---------------------------------------------------------------- iade
create table refunds (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  payment_id       uuid not null,
  amount           numeric(14,2) not null check (amount > 0),
  method           text not null check (method in ('cash','card_manual','bank_transfer','other')),
  cash_account_id  uuid not null,
  reason           text not null check (length(reason) >= 3),
  refunded_at      timestamptz not null,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, payment_id) references payments(tenant_id, id),
  foreign key (tenant_id, cash_account_id) references cash_accounts(tenant_id, id)
);
create index refunds_payment_idx on refunds (tenant_id, payment_id);
create index refunds_at_idx on refunds (tenant_id, refunded_at);

-- ---------------------------------------------------------------- gider (ters kayıt negatif tutarla)
create table expenses (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  category         text not null check (length(category) between 2 and 60),
  description      text not null check (length(description) between 2 and 200),
  amount           numeric(14,2) not null check (amount <> 0),
  currency         char(3) not null default 'TRY' check (currency = 'TRY'),
  cash_account_id  uuid not null,
  occurred_at      timestamptz not null,
  reverses_id      uuid,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, cash_account_id) references cash_accounts(tenant_id, id),
  foreign key (tenant_id, reverses_id) references expenses(tenant_id, id),
  check ((amount < 0) = (reverses_id is not null))
);
create unique index expenses_reverse_uq on expenses (tenant_id, reverses_id) where reverses_id is not null;
create index expenses_at_idx on expenses (tenant_id, occurred_at);

-- ---------------------------------------------------------------- kasa hareketi (giriş +, çıkış −)
create table cash_movements (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  cash_account_id  uuid not null,
  amount           numeric(14,2) not null check (amount <> 0),
  source           text not null check (source in ('payment','refund','expense')),
  source_id        uuid not null,
  occurred_at      timestamptz not null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, source, source_id),
  foreign key (tenant_id, cash_account_id) references cash_accounts(tenant_id, id)
);
create index cash_movements_at_idx on cash_movements (tenant_id, occurred_at);

-- ---------------------------------------------------------------- idempotency (Plan §07: anahtar + tenant + işlem türü)
create table idempotency_keys (
  tenant_id     uuid not null references tenants(id),
  operation     text not null,
  key           text not null check (key ~ '^[A-Za-z0-9_-]{8,100}$'),
  request_hash  text not null,
  status_code   integer,
  response      jsonb,
  created_by    uuid not null references users(id),
  created_at    timestamptz not null default now(),
  primary key (tenant_id, operation, key)
);

-- ---------------------------------------------------------------- hekim primi (tahsilat dağıtımı bazlı) — AT-10
create table commission_rule_versions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  practitioner_id  uuid,                        -- boş: tüm hekimler
  basis            text not null default 'collection' check (basis in ('collection')),
  rate             numeric(5,2) not null check (rate >= 0 and rate <= 100),
  valid_from       date not null,
  note             text,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id)
);
create unique index commission_rule_uq on commission_rule_versions (tenant_id, coalesce(practitioner_id, '00000000-0000-0000-0000-000000000000'::uuid), basis, valid_from);

create table commission_accruals (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  practitioner_id  uuid not null,
  allocation_id    uuid not null,
  rule_version_id  uuid not null,
  base_amount      numeric(14,2) not null,
  rate             numeric(5,2) not null,      -- kural oranının snapshot'ı
  amount           numeric(14,2) not null,
  reverses_id      uuid,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, allocation_id),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  foreign key (tenant_id, allocation_id) references allocations(tenant_id, id),
  foreign key (tenant_id, rule_version_id) references commission_rule_versions(tenant_id, id),
  foreign key (tenant_id, reverses_id) references commission_accruals(tenant_id, id)
);
create index commission_accruals_prac_idx on commission_accruals (tenant_id, practitioner_id, created_at);

-- ================================================================ değişmezlik ve tutar tetikleyicileri
-- Alacak: tutar/kaynak değişmez; yalnız active → cancelled.
create or replace function app.receivables_guard() returns trigger language plpgsql as $$
begin
  if new.amount is distinct from old.amount or new.patient_id is distinct from old.patient_id or new.source is distinct from old.source
     or new.performed_procedure_id is distinct from old.performed_procedure_id or new.currency is distinct from old.currency
     or new.created_at is distinct from old.created_at or new.description is distinct from old.description
     or new.practitioner_id is distinct from old.practitioner_id then
    raise exception 'receivable_immutable' using errcode = '55000';
  end if;
  if not (old.status = new.status or (old.status = 'active' and new.status = 'cancelled')) then
    raise exception 'receivable_invalid_transition' using errcode = '55000';
  end if;
  if new.status = 'cancelled' and old.status = 'active'
     and (select coalesce(sum(amount), 0) from allocations where receivable_id = new.id) <> 0 then
    raise exception 'receivable_has_allocations' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger receivables_guard before update on receivables for each row execute function app.receivables_guard();

-- Dağıtım: ödeme ve alacak satırı kilitlenir; ödemenin kullanılabilir tutarı ve alacağın açık bakiyesi aşılamaz.
-- SECURITY DEFINER: satır kilidi (FOR UPDATE) UPDATE yetkisi ister; uygulama rolünün ödemede UPDATE yetkisi bilinçli olarak yok.
-- Fonksiyon sahibi de FORCE RLS'e tabidir (tenant_isolation), dolayısıyla tenant sınırı korunur.
create or replace function app.allocations_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; r record; pay_alloc numeric; pay_ref numeric; rec_alloc numeric; orig record; orig_left numeric;
begin
  select * into p from payments where id = new.payment_id for update;
  select * into r from receivables where id = new.receivable_id for update;
  if p.patient_id <> r.patient_id then raise exception 'allocation_patient_mismatch' using errcode = '23514'; end if;
  if new.amount > 0 and r.status <> 'active' then raise exception 'allocation_receivable_cancelled' using errcode = '23514'; end if;
  select coalesce(sum(amount), 0) into pay_alloc from allocations where payment_id = new.payment_id;
  select coalesce(sum(amount), 0) into pay_ref from refunds where payment_id = new.payment_id;
  select coalesce(sum(amount), 0) into rec_alloc from allocations where receivable_id = new.receivable_id;
  if pay_alloc + new.amount > p.amount - pay_ref then raise exception 'allocation_exceeds_payment' using errcode = '23514'; end if;
  if rec_alloc + new.amount > r.amount then raise exception 'allocation_exceeds_receivable' using errcode = '23514'; end if;
  if new.reverses_id is not null then
    select * into orig from allocations where id = new.reverses_id;
    if orig.amount <= 0 or orig.payment_id <> new.payment_id or orig.receivable_id <> new.receivable_id then
      raise exception 'allocation_reverse_invalid' using errcode = '23514';
    end if;
    select orig.amount + coalesce(sum(amount), 0) into orig_left from allocations where reverses_id = new.reverses_id;
    if orig_left + new.amount < 0 then raise exception 'allocation_reverse_exceeds' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
create trigger allocations_guard before insert on allocations for each row execute function app.allocations_guard();

-- İade: ödemeyi aşamaz; iade sonrası dağıtılmış tutar ödemenin kalanını aşamaz (önce dağıtım ters kaydı gerekir).
create or replace function app.refunds_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; pay_alloc numeric; pay_ref numeric;
begin
  select * into p from payments where id = new.payment_id for update;
  select coalesce(sum(amount), 0) into pay_ref from refunds where payment_id = new.payment_id;
  select coalesce(sum(amount), 0) into pay_alloc from allocations where payment_id = new.payment_id;
  if pay_ref + new.amount > p.amount then raise exception 'refund_exceeds_payment' using errcode = '23514'; end if;
  if pay_alloc > p.amount - pay_ref - new.amount then raise exception 'refund_requires_deallocation' using errcode = '23514'; end if;
  return new;
end $$;
create trigger refunds_guard before insert on refunds for each row execute function app.refunds_guard();

-- Prim tahakkuku: ters kayıt orijinalin oranını kullanır.
create or replace function app.commission_guard() returns trigger language plpgsql as $$
declare orig record;
begin
  if new.reverses_id is not null then
    select * into orig from commission_accruals where id = new.reverses_id;
    if orig.rate <> new.rate or orig.rule_version_id <> new.rule_version_id then
      raise exception 'commission_reverse_rate_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger commission_guard before insert on commission_accruals for each row execute function app.commission_guard();

-- ================================================================ geçmiş veri: Görev 2'de oluşan gerçekleşen işlemler için alacak
-- Sahip rolüne FORCE RLS uygulandığı için tablolar bu transaction içinde geçici olarak FORCE dışı bırakılır ve hemen geri alınır.
alter table performed_procedures no force row level security;
alter table tenants no force row level security;
alter table memberships no force row level security;
insert into receivables (tenant_id, patient_id, source, performed_procedure_id, description, amount, practitioner_id, due_date, created_by, created_at)
select pp.tenant_id, pp.patient_id, 'performed_procedure', pp.id, pp.procedure_code || ' · ' || pp.procedure_name, pp.amount, pp.practitioner_id,
       (pp.completed_at at time zone t.timezone)::date, m.user_id, pp.completed_at
  from performed_procedures pp
  join tenants t on t.id = pp.tenant_id
  join memberships m on m.id = pp.completed_by
 where pp.status = 'completed' and pp.amount > 0;
alter table performed_procedures force row level security;
alter table tenants force row level security;
alter table memberships force row level security;

-- ================================================================ RLS + yetkiler
do $$
declare t text;
begin
  foreach t in array array['cash_accounts','receivables','payments','allocations','refunds','expenses','cash_movements',
                           'idempotency_keys','commission_rule_versions','commission_accruals'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
                     using (tenant_id = app.tenant_id())
                     with check (tenant_id = app.tenant_id())$p$, t);
  end loop;
end $$;

-- Hareket tabloları yalnız ekleme: UPDATE/DELETE yetkisi yok (alacak yalnız iptal için UPDATE, tetikleyiciyle sınırlı).
grant select, insert, update on cash_accounts, receivables, idempotency_keys to viadent_app;
grant select, insert on payments, allocations, refunds, expenses, cash_movements, commission_rule_versions, commission_accruals to viadent_app;
grant select on receivables, payments, allocations to viadent_worker;
