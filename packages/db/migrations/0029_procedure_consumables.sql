-- Faz 4.5 (ADR-087): işlem başına sarf reçetesi. Katalog kalemine bağlı stok kalemleri + adet; işlem tamamlanınca otomatik 'usage'
-- hareketi (performed_procedure_id bağıyla, mevcut ters kayıt mekanizmasıyla geri alınabilir). Stok yetersizse klinik işlem ENGELLENMEZ;
-- sarf atlanır ve asistana 'stock_shortage' görevi düşer (klinik kayıt stok muhasebesine rehin olmaz).
create table procedure_consumables (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  procedure_id   uuid not null,
  stock_item_id  uuid not null,
  quantity       numeric(12,3) not null check (quantity > 0),
  created_by     uuid not null references users(id),
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, procedure_id, stock_item_id),
  foreign key (tenant_id, procedure_id) references procedures(tenant_id, id),
  foreign key (tenant_id, stock_item_id) references stock_items(tenant_id, id)
);
alter table procedure_consumables enable row level security;
alter table procedure_consumables force row level security;
create policy tenant_isolation on procedure_consumables using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
grant select, insert, update, delete on procedure_consumables to viadent_app;
grant select on procedure_consumables to viadent_worker;

alter table tasks drop constraint tasks_kind_check;
alter table tasks add constraint tasks_kind_check
  check (kind in ('overdue_checkin','contact_pending','missing_contact','closure_conflict','anamnesis_review',
                  'plan_unscheduled','plan_decision_pending','follow_up','readiness_missing','file_quarantined',
                  'integration_dead','integration_approval','lab_overdue','lab_review','lab_not_ready',
                  'stock_low','lot_expiring','stock_shortage','manual'));
