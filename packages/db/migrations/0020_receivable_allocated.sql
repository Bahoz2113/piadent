-- Görev 14 (ADR-076): açık borç raporları 300k alacak / 240k dağıtımda 4–10 sn sürüyordu (her alacak için dağıtım toplamı).
-- Dağıtım toplamı alacakta tutulur (yalnız tetikleyici yazar; dağıtımlar ekle-yalnız olduğundan toplam tutarlıdır) ve açık alacaklar kısmi dizinle bulunur.
alter table receivables add column allocated_amount numeric(14,2) not null default 0 check (allocated_amount >= 0);

-- Kiracı kiracı veri işlemi (ADR-077): FORCE RLS altında bağlamsız UPDATE sessizce 0 satır etkiler; bu yardımcı her kiracı için bağlamı kurar.
create or replace function app.for_each_tenant(stmt text) returns integer language plpgsql as $$
declare t record; total integer := 0; n integer;
begin
  for t in select id from tenants loop
    perform set_config('app.tenant_id', t.id::text, true);
    execute stmt; get diagnostics n = row_count; total := total + n;
  end loop;
  perform set_config('app.tenant_id', '', true);
  return total;
end $$;
revoke all on function app.for_each_tenant(text) from public;
select app.for_each_tenant('update receivables r set allocated_amount = coalesce((select sum(a.amount) from allocations a where a.receivable_id = r.id), 0)');

create or replace function app.receivable_alloc_sync() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update receivables set allocated_amount = allocated_amount + new.amount where id = new.receivable_id;
  return new;
end $$;
revoke all on function app.receivable_alloc_sync() from public;
create trigger receivable_alloc_sync after insert on allocations for each row execute function app.receivable_alloc_sync();

-- receivables_guard: allocated_amount yalnız tetikleyiciyle değişir; uygulama güncellemesi (iptal) bu sütuna dokunmaz. Doğrudan değiştirme tetikleyici dışında engellenir.
create or replace function app.receivables_guard() returns trigger language plpgsql as $$
begin
  if new.amount is distinct from old.amount or new.patient_id is distinct from old.patient_id or new.source is distinct from old.source
     or new.performed_procedure_id is distinct from old.performed_procedure_id or new.currency is distinct from old.currency
     or new.created_at is distinct from old.created_at or new.description is distinct from old.description
     or new.practitioner_id is distinct from old.practitioner_id then
    raise exception 'receivable_immutable' using errcode = '55000';
  end if;
  if new.allocated_amount is distinct from old.allocated_amount and current_setting('app.alloc_sync', true) is distinct from '1' then
    raise exception 'receivable_allocated_readonly' using errcode = '55000';
  end if;
  if not (old.status = new.status or (old.status = 'active' and new.status = 'cancelled')) then
    raise exception 'receivable_invalid_transition' using errcode = '55000';
  end if;
  if new.status = 'cancelled' and old.status = 'active' and new.allocated_amount <> 0 then
    raise exception 'receivable_has_allocations' using errcode = '23514';
  end if;
  return new;
end $$;
create or replace function app.receivable_alloc_sync() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('app.alloc_sync', '1', true);
  update receivables set allocated_amount = allocated_amount + new.amount where id = new.receivable_id;
  perform set_config('app.alloc_sync', '0', true);
  return new;
end $$;

create index receivables_open_idx on receivables (tenant_id, patient_id, due_date) where status = 'active' and amount > allocated_amount;

-- Ödemede dağıtılan ve iade edilen toplam (avans = tutar − dağıtılan − iade); yalnız tetikleyiciler yazar (uygulama rolünün payments'ta update yetkisi yok).
alter table payments add column allocated_amount numeric(14,2) not null default 0 check (allocated_amount >= 0);
alter table payments add column refunded_amount numeric(14,2) not null default 0 check (refunded_amount >= 0);
select app.for_each_tenant('update payments p set allocated_amount = coalesce((select sum(a.amount) from allocations a where a.payment_id = p.id), 0), refunded_amount = coalesce((select sum(f.amount) from refunds f where f.payment_id = p.id), 0)');
create or replace function app.payment_alloc_sync() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update payments set allocated_amount = allocated_amount + new.amount where id = new.payment_id;
  return new;
end $$;
create or replace function app.payment_refund_sync() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update payments set refunded_amount = refunded_amount + new.amount where id = new.payment_id;
  return new;
end $$;
revoke all on function app.payment_alloc_sync() from public; revoke all on function app.payment_refund_sync() from public;
create trigger payment_alloc_sync after insert on allocations for each row execute function app.payment_alloc_sync();
create trigger payment_refund_sync after insert on refunds for each row execute function app.payment_refund_sync();
create index payments_advance_idx on payments (tenant_id, patient_id) where amount > allocated_amount + refunded_amount;
-- Tutarlılık denetimi (geri yükleme doğrulaması ve testler için): allocated_amount = sum(allocations)
create or replace view app.receivable_alloc_check as
  select r.id, r.allocated_amount, coalesce(sum(a.amount), 0) as computed from receivables r left join allocations a on a.receivable_id = r.id group by r.id, r.allocated_amount having r.allocated_amount <> coalesce(sum(a.amount), 0)
  union all
  select p.id, p.allocated_amount, coalesce((select sum(a.amount) from allocations a where a.payment_id = p.id), 0) from payments p where p.allocated_amount <> coalesce((select sum(a.amount) from allocations a where a.payment_id = p.id), 0)
  union all
  select p.id, p.refunded_amount, coalesce((select sum(f.amount) from refunds f where f.payment_id = p.id), 0) from payments p where p.refunded_amount <> coalesce((select sum(f.amount) from refunds f where f.payment_id = p.id), 0);
grant select on app.receivable_alloc_check to viadent_app, viadent_backup;
