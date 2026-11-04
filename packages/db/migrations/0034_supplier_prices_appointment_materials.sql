-- Ürün sahibi geri bildirimi 04.11.2026 madde 9 (ADR-097): ürün listesi + tedarikçi fiyat listesi; randevuda kullanılan ek malzeme
-- ve kliniğin malzeme gideri.
--  * supplier_prices: tedarikçinin bir stok kalemi için birim fiyatı; sürümlüdür (yalnız ekleme). Geçerli fiyat = en yeni valid_from ≤ bugün.
--  * stock_movements.appointment_id: randevuya bağlı kullanım (hasta zorunlu). Kullanım hareketine birim maliyet SNAPSHOT'ı yazılır
--    (son alış maliyeti, yoksa geçerli en düşük tedarikçi fiyatı); sonradan fiyat değişse de geçmiş gider değişmez. Ters kayıt aynı maliyeti taşır.
create table supplier_prices (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  supplier_id    uuid not null,
  stock_item_id  uuid not null,
  unit_price     numeric(14,2) not null check (unit_price > 0),
  valid_from     date not null,
  supplier_code  text check (supplier_code is null or length(supplier_code) <= 60),
  note           text check (note is null or length(note) <= 300),
  created_by     uuid not null references users(id),
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, supplier_id, stock_item_id, valid_from),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id),
  foreign key (tenant_id, stock_item_id) references stock_items(tenant_id, id)
);
create index supplier_prices_item_idx on supplier_prices (tenant_id, stock_item_id, valid_from desc);

alter table supplier_prices enable row level security;
alter table supplier_prices force row level security;
create policy tenant_isolation on supplier_prices using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
grant select, insert on supplier_prices to viadent_app;
grant select on supplier_prices to viadent_worker;

alter table stock_movements add column appointment_id uuid;
alter table stock_movements add constraint stock_movements_appointment_fk foreign key (tenant_id, appointment_id) references appointments(tenant_id, id);
alter table stock_movements add constraint stock_movements_appointment_patient_chk check (appointment_id is null or patient_id is not null);
create index stock_movements_appointment_idx on stock_movements (tenant_id, appointment_id) where appointment_id is not null;
