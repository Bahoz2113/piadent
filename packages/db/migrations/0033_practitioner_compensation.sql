-- Ürün sahibi geri bildirimi 04.11.2026 madde 8 (ADR-096): Hekimler modülü — ücret modeli sürümleri ve maaş ödemeleri.
-- Ücret modeli: 'commission' (yalnız prim), 'salary' (yalnız sabit maaş), 'salary_commission' (maaş + prim). Sürümlüdür, yalnız
-- ileriye başlatılır (API), mevcut tahakkuklar değişmez. Model 'salary' iken prim kuralı tahakkuk doğurmaz (ledger.ts).
-- Aylık maaş hakedişi = o ayın SON gününde geçerli sürümün maaşı. Maaş ödemesi kasadan çıkıştır; ayın hakedişini aşamaz
-- (tetikleyici + hekim bazında kilit); silinmez, ters kayıtla geri alınır. Bordro/SGK/stopaj hesabı kapsam dışıdır.
create table practitioner_compensation_versions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  practitioner_id  uuid not null,
  pay_model        text not null check (pay_model in ('commission','salary','salary_commission')),
  monthly_salary   numeric(14,2) check (monthly_salary is null or monthly_salary > 0),
  valid_from       date not null,
  note             text check (note is null or length(note) <= 300),
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, practitioner_id, valid_from),
  foreign key (tenant_id, practitioner_id) references practitioners(tenant_id, id),
  check ((pay_model = 'commission') = (monthly_salary is null))
);
create index practitioner_compensation_idx on practitioner_compensation_versions (tenant_id, practitioner_id, valid_from desc);

create table salary_payments (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  practitioner_id  uuid not null,
  period           date not null check (extract(day from period) = 1),
  amount           numeric(14,2) not null check (amount <> 0),
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
  foreign key (tenant_id, reverses_id) references salary_payments(tenant_id, id),
  check ((amount < 0) = (reverses_id is not null)),
  check ((reverses_id is null) or (reason is not null and length(reason) >= 3))
);
create unique index salary_payments_reverse_uq on salary_payments (tenant_id, reverses_id) where reverses_id is not null;
create index salary_payments_prac_idx on salary_payments (tenant_id, practitioner_id, period);

-- Ayın maaş hakedişi (son günde geçerli sürüm; model 'commission' ise 0).
create or replace function app.salary_due(p_practitioner uuid, p_period date) returns numeric language sql stable as $$
  select coalesce((
    select case when v.pay_model = 'commission' then 0 else v.monthly_salary end
      from practitioner_compensation_versions v
     where v.practitioner_id = p_practitioner and v.valid_from <= (p_period + interval '1 month' - interval '1 day')::date
     order by v.valid_from desc, v.created_at desc limit 1), 0)
$$;

create or replace function app.salary_payments_guard() returns trigger language plpgsql as $$
declare paid numeric; due numeric; orig record;
begin
  perform pg_advisory_xact_lock(hashtext('salary:' || new.practitioner_id::text));
  if new.reverses_id is not null then
    select * into orig from salary_payments where id = new.reverses_id;
    if orig.reverses_id is not null or orig.practitioner_id <> new.practitioner_id or new.amount <> -orig.amount
       or orig.cash_account_id <> new.cash_account_id or orig.period <> new.period then
      raise exception 'reversal_mismatch' using errcode = '23514';
    end if;
    return new;
  end if;
  due := app.salary_due(new.practitioner_id, new.period);
  select coalesce(sum(amount), 0) into paid from salary_payments where practitioner_id = new.practitioner_id and period = new.period;
  if paid + new.amount > due then raise exception 'salary_exceeds_due' using errcode = '23514'; end if;
  return new;
end $$;
create trigger salary_payments_guard before insert on salary_payments for each row execute function app.salary_payments_guard();

alter table cash_movements drop constraint cash_movements_source_check;
alter table cash_movements add constraint cash_movements_source_check
  check (source in ('payment','refund','expense','supplier_payment','commission_payout','salary_payment'));

alter table practitioner_compensation_versions enable row level security;
alter table practitioner_compensation_versions force row level security;
create policy tenant_isolation on practitioner_compensation_versions using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
alter table salary_payments enable row level security;
alter table salary_payments force row level security;
create policy tenant_isolation on salary_payments using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());

-- Sürümler ve ödemeler değiştirilmez/silinmez: yalnız okuma + ekleme.
grant select, insert on practitioner_compensation_versions to viadent_app;
grant select, insert on salary_payments to viadent_app;
grant select on practitioner_compensation_versions, salary_payments to viadent_worker;
grant execute on function app.salary_due(uuid, date) to viadent_app, viadent_worker;
