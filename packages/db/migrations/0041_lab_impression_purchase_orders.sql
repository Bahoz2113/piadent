-- Ürün sahibi geri bildirimi 08.11.2026 (ADR-108): "Laboratuvar" menüsü.
--  * lab_orders: hasta için alınan ÖLÇÜ (tür + tarih) ve İSTENEN MALZEME laboratuvar iş emrinde yapılandırılmış alanlar olarak tutulur.
--  * purchase_orders / purchase_order_lines / purchase_receipts: tedarikçiye malzeme siparişi ve takibi
--    (taslak → gönderildi → kısmi teslim → teslim alındı; iptal). Teslim alma stok GİRİŞ hareketi doğurur (bakiye yine yalnız
--    hareketlerden hesaplanır); istenirse aynı transaction'da tedarikçi cari borcu (fatura). Sipariş satırı silinmez; teslim
--    miktarı yalnız artar ve sipariş miktarını aşamaz (DB kısıtı). Sipariş fiyatı bilgi amaçlıdır; borç yalnız teslimde doğar.
alter table lab_orders
  add column impression_type text check (impression_type is null or impression_type in ('digital_scan','silicone','alginate','plaster_model','bite_record','none')),
  add column impression_taken_on date,
  add column material text check (material is null or material in ('zirconia','emax','pfm','metal','pmma','composite','acrylic','cocr','titanium','other'));
alter table lab_orders add constraint lab_orders_impression_date_chk check (impression_taken_on is null or impression_type is not null);

create table purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  order_no       integer not null check (order_no > 0),
  supplier_id    uuid not null,
  status         text not null default 'draft' check (status in ('draft','sent','partial','received','cancelled')),
  expected_date  date,
  note           text check (note is null or length(note) <= 500),
  sent_at        timestamptz,
  received_at    timestamptz,
  cancelled_at   timestamptz,
  cancel_reason  text check (cancel_reason is null or length(cancel_reason) between 3 and 300),
  row_version    integer not null default 1,
  created_by     uuid not null references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, order_no),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id),
  check (status <> 'cancelled' or (cancelled_at is not null and cancel_reason is not null))
);
create index purchase_orders_status_idx on purchase_orders (tenant_id, status, expected_date);

create table purchase_order_lines (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  order_id       uuid not null,
  position       smallint not null check (position between 1 and 50),
  stock_item_id  uuid not null,
  quantity       numeric(12,3) not null check (quantity > 0),
  unit_price     numeric(14,2) check (unit_price is null or unit_price > 0),
  received_qty   numeric(12,3) not null default 0,
  unique (tenant_id, id),
  unique (tenant_id, order_id, position),
  unique (tenant_id, order_id, stock_item_id),
  foreign key (tenant_id, order_id) references purchase_orders(tenant_id, id),
  foreign key (tenant_id, stock_item_id) references stock_items(tenant_id, id),
  check (received_qty >= 0 and received_qty <= quantity)
);

create table purchase_receipts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  line_id        uuid not null,
  movement_id    uuid not null,
  quantity       numeric(12,3) not null check (quantity > 0),
  bill_id        uuid,
  created_by     uuid not null references users(id),
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, movement_id),
  foreign key (tenant_id, line_id) references purchase_order_lines(tenant_id, id),
  foreign key (tenant_id, movement_id) references stock_movements(tenant_id, id),
  foreign key (tenant_id, bill_id) references supplier_entries(tenant_id, id)
);

-- Teslim miktarı yalnız artar (geri alma = stok hareketinin ters kaydı ayrı akıştır; sipariş geçmişi korunur).
create function app.purchase_line_guard() returns trigger language plpgsql as $$
begin
  if new.received_qty < old.received_qty then raise exception 'PURCHASE_RECEIVED_DECREASE' using errcode = 'check_violation'; end if;
  if (new.order_id, new.position, new.stock_item_id, new.quantity, new.unit_price) is distinct from (old.order_id, old.position, old.stock_item_id, old.quantity, old.unit_price)
     and old.received_qty > 0 then
    raise exception 'PURCHASE_LINE_LOCKED' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger purchase_line_guard before update on purchase_order_lines for each row execute function app.purchase_line_guard();

do $$ declare t text; begin
  foreach t in array array['purchase_orders','purchase_order_lines','purchase_receipts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id())', t);
    execute format('grant select on %I to viadent_worker', t);
  end loop;
end $$;
grant select, insert, update on purchase_orders to viadent_app;
grant select, insert on purchase_order_lines to viadent_app;
grant update (received_qty) on purchase_order_lines to viadent_app;
grant select, insert on purchase_receipts to viadent_app;

-- Sipariş teslimiyle doğan cari fatura: kaynak = teslim kaydı grubu (purchase_receipt; source_id = ilk teslim satırının id'si, tekil).
alter table supplier_entries drop constraint supplier_entries_source_check;
alter table supplier_entries add constraint supplier_entries_source_check check (source in ('manual','lab_cost','stock_receipt','purchase_receipt'));

-- PİA Akış: geciken malzeme siparişi görevi.
alter table tasks drop constraint tasks_kind_check;
alter table tasks add constraint tasks_kind_check
  check (kind in ('overdue_checkin','contact_pending','missing_contact','closure_conflict','anamnesis_review',
                  'plan_unscheduled','plan_decision_pending','follow_up','readiness_missing','file_quarantined',
                  'integration_dead','integration_approval','lab_overdue','lab_review','lab_not_ready',
                  'stock_low','lot_expiring','stock_shortage','purchase_overdue','manual'));
