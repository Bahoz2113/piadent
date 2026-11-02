-- Faz 2.1 (ADR-081): tahsilat ve iade makbuzu.
-- Makbuz numarası kiracı + seri (TM tahsilat, IM iade) + yıl (klinik saat dilimi) bazında boşluksuz sıradır; tahsilat/iade
-- kaydının eklendiği transaction'da AFTER INSERT tetikleyicisiyle üretilir (geri alınan işlem numara tüketmez; tüm yazma
-- yolları — hasta hesabı, çevrim içi ödeme webhook'u, iade — otomatik kapsanır). Makbuz kaydı ekle-yalnızdır; düzeltme ters kayıtla.

create table receipt_counters (
  tenant_id uuid not null references tenants(id),
  series    text not null check (series in ('TM','IM')),
  year      integer not null check (year between 2000 and 2200),
  last_no   integer not null default 0 check (last_no >= 0),
  primary key (tenant_id, series, year)
);

create table receipts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  patient_id  uuid not null,
  kind        text not null check (kind in ('payment','refund')),
  payment_id  uuid,
  refund_id   uuid,
  series      text not null check (series in ('TM','IM')),
  year        integer not null,
  seq         integer not null check (seq > 0),
  receipt_no  text not null,
  amount      numeric(14,2) not null check (amount > 0),
  currency    char(3) not null default 'TRY' check (currency = 'TRY'),
  issued_at   timestamptz not null,
  issued_by   uuid not null references users(id),
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, series, year, seq),
  unique (tenant_id, receipt_no),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, payment_id) references payments(tenant_id, id),
  foreign key (tenant_id, refund_id)  references refunds(tenant_id, id),
  check ((kind = 'payment' and payment_id is not null and refund_id is null) or (kind = 'refund' and refund_id is not null)),
  check (receipt_no = series || '-' || year::text || '-' || lpad(seq::text, 6, '0'))
);
create unique index receipts_payment_uq on receipts (tenant_id, payment_id) where kind = 'payment';
create unique index receipts_refund_uq  on receipts (tenant_id, refund_id)  where kind = 'refund';
create index receipts_patient_idx on receipts (tenant_id, patient_id, issued_at desc);

-- Sıra numarası: sayaç satırı kilitlenir (aynı kiracı/seri/yıl için yazarlar sıralanır), aynı transaction'da makbuz eklenir.
create or replace function app.issue_receipt(p_tenant uuid, p_patient uuid, p_kind text, p_payment uuid, p_refund uuid,
                                             p_amount numeric, p_at timestamptz, p_by uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_series text; v_year integer; v_seq integer; v_tz text; v_id uuid;
begin
  v_series := case p_kind when 'payment' then 'TM' when 'refund' then 'IM' end;
  if v_series is null then raise exception 'receipt_invalid_kind' using errcode = '23514'; end if;
  select timezone into v_tz from tenants where id = p_tenant;
  v_year := extract(year from p_at at time zone coalesce(v_tz, 'Europe/Istanbul'))::integer;
  insert into receipt_counters(tenant_id, series, year, last_no) values (p_tenant, v_series, v_year, 1)
    on conflict (tenant_id, series, year) do update set last_no = receipt_counters.last_no + 1
    returning last_no into v_seq;
  insert into receipts(tenant_id, patient_id, kind, payment_id, refund_id, series, year, seq, receipt_no, amount, issued_at, issued_by)
    values (p_tenant, p_patient, p_kind, p_payment, p_refund, v_series, v_year, v_seq,
            v_series || '-' || v_year::text || '-' || lpad(v_seq::text, 6, '0'), p_amount, p_at, p_by)
    returning id into v_id;
  return v_id;
end $$;
revoke all on function app.issue_receipt(uuid, uuid, text, uuid, uuid, numeric, timestamptz, uuid) from public;

create or replace function app.payment_receipt() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.issue_receipt(new.tenant_id, new.patient_id, 'payment', new.id, null, new.amount, new.paid_at, new.received_by);
  return new;
end $$;
revoke all on function app.payment_receipt() from public;
create trigger payment_receipt after insert on payments for each row execute function app.payment_receipt();

create or replace function app.refund_receipt() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from payments where id = new.payment_id and tenant_id = new.tenant_id;
  perform app.issue_receipt(new.tenant_id, v_patient, 'refund', new.payment_id, new.id, new.amount, new.refunded_at, new.created_by);
  return new;
end $$;
revoke all on function app.refund_receipt() from public;
create trigger refund_receipt after insert on refunds for each row execute function app.refund_receipt();

-- Makbuz kayıtları değiştirilemez/silinemez (uygulama rolüne yalnız select+insert; insert yalnız tetikleyiciden gelir).
create or replace function app.receipts_immutable() returns trigger language plpgsql as $$
begin raise exception 'receipt_immutable' using errcode = '55000'; end $$;
create trigger receipts_immutable before update or delete on receipts for each row execute function app.receipts_immutable();

do $$ declare t text; begin
  foreach t in array array['receipt_counters','receipts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id())$p$, t);
  end loop;
end $$;
grant select on receipts to viadent_app, viadent_worker;
grant select on receipt_counters to viadent_app; -- yalnız okuma (sağlık/yedek doğrulaması); artış yalnız app.issue_receipt ile

-- Geriye dönük: mevcut tahsilat ve iadeler işlem zamanına göre numaralandırılır (kiracı bağlamı app.for_each_tenant ile kurulur, ADR-077).
select app.for_each_tenant($q$
  insert into receipts(tenant_id, patient_id, kind, payment_id, refund_id, series, year, seq, receipt_no, amount, issued_at, issued_by)
  select x.tenant_id, x.patient_id, x.kind, x.payment_id, x.refund_id, x.series, x.year,
         row_number() over (partition by x.series, x.year order by x.at, x.id) as seq,
         x.series || '-' || x.year::text || '-' || lpad((row_number() over (partition by x.series, x.year order by x.at, x.id))::text, 6, '0'),
         x.amount, x.at, x.by
    from (
      select p.tenant_id, p.patient_id, 'payment' as kind, p.id as payment_id, null::uuid as refund_id, 'TM' as series,
             extract(year from p.paid_at at time zone t.timezone)::integer as year, p.paid_at as at, p.id, p.amount, p.received_by as by
        from payments p join tenants t on t.id = p.tenant_id
      union all
      select f.tenant_id, p.patient_id, 'refund', f.payment_id, f.id, 'IM',
             extract(year from f.refunded_at at time zone t.timezone)::integer, f.refunded_at, f.id, f.amount, f.created_by
        from refunds f join payments p on p.id = f.payment_id join tenants t on t.id = f.tenant_id
    ) x
$q$);
select app.for_each_tenant($q$
  insert into receipt_counters(tenant_id, series, year, last_no)
  select tenant_id, series, year, max(seq) from receipts group by tenant_id, series, year
  on conflict (tenant_id, series, year) do update set last_no = greatest(receipt_counters.last_no, excluded.last_no)
$q$);
