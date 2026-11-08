-- Ürün sahibi isteği 09.11.2026 (ADR-109): POS entegrasyonu — Faz 0 (sağlayıcıdan bağımsız çekirdek).
--  * pos_terminals: şubeye bağlı fiziksel/sanal POS tanımı. Sürücü: 'manual' (bağımsız banka POS'u — çekim cihazda yapılır,
--    sonuç elle eşleştirilir) veya 'mock' (DENEME cihazı — tutarı "cihaza gönderen" akışın etiketli benzetimi). Gerçek
--    sürücüler (Token / Pavo vb.) sağlayıcı sözleşmesi ve test cihazıyla ayrı fazda eklenir.
--  * pos_intents: ödeme niyeti durum makinesi. Onaylanan niyet aynı transaction'da tahsilat (payments) doğurur.
--    Kart verisi TUTULMAZ: yalnız son 4 hane + onay kodu + taksit (6493 / PCI kapsamı dışı kalmak için). Tam kart no,
--    CVV, iz verisi hiçbir sütunda yer alamaz (son 4 hane tam 4 rakam).
--  * Bir terminalde aynı anda en çok bir açık niyet (oluşturuldu / kart bekleniyor / sonuç bilinmiyor): sonuç belirsizken
--    ikinci çekim başlatılamaz (çift çekim koruması).
--  * pos_settlements: terminal + klinik günü için gün sonu mutabakatı (sistem toplamı ↔ POS gün sonu fişi). Değiştirilemez.
--  Yazılım para tutmaz ve aktarmaz; para doğrudan bankanın üye işyeri hesabına geçer.
create table pos_terminals (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  name            text not null check (length(name) between 2 and 80),
  branch_id       uuid,
  cash_account_id uuid not null,
  driver          text not null check (driver in ('manual','mock')),
  bank_name       text check (bank_name is null or length(bank_name) between 2 and 80),
  terminal_ref    text check (terminal_ref is null or terminal_ref ~ '^[A-Za-z0-9 ._-]{2,40}$'),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name),
  foreign key (tenant_id, branch_id) references branches(tenant_id, id),
  foreign key (tenant_id, cash_account_id) references cash_accounts(tenant_id, id)
);

create table pos_intents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  intent_no       integer not null check (intent_no > 0),
  terminal_id     uuid not null,
  patient_id      uuid not null,
  appointment_id  uuid,
  amount          numeric(14,2) not null check (amount > 0),
  currency        char(3) not null default 'TRY' check (currency = 'TRY'),
  installments    smallint not null default 1 check (installments between 1 and 12),
  mode            text not null check (mode in ('device','manual')),
  status          text not null check (status in ('created','awaiting_card','approved','declined','cancelled','unknown')),
  allocations     jsonb not null default '[]'::jsonb,
  note            text check (note is null or length(note) <= 300),
  auth_code       text check (auth_code is null or auth_code ~ '^[A-Za-z0-9]{4,12}$'),
  card_last4      char(4) check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  provider_ref    text check (provider_ref is null or length(provider_ref) <= 80),
  failure_reason  text check (failure_reason is null or length(failure_reason) <= 300),
  payment_id      uuid,
  created_by      uuid not null references users(id),
  resolved_by     uuid references users(id),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  completed_at    timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, intent_no),
  unique (tenant_id, payment_id),
  foreign key (tenant_id, terminal_id) references pos_terminals(tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, appointment_id) references appointments(tenant_id, id),
  foreign key (tenant_id, payment_id) references payments(tenant_id, id),
  check ((status = 'approved') = (payment_id is not null)),
  check (status <> 'approved' or (auth_code is not null and card_last4 is not null and completed_at is not null)),
  check (status not in ('declined','cancelled') or completed_at is not null)
);
create unique index pos_intents_one_open on pos_intents (tenant_id, terminal_id) where status in ('created','awaiting_card','unknown');
create index pos_intents_terminal_day on pos_intents (tenant_id, terminal_id, completed_at);

-- Son durumdan geri dönüş yok; onaylı niyetin tutarı/kart özeti değişmez.
create function app.pos_intent_guard() returns trigger language plpgsql as $$
begin
  if old.status in ('approved','declined','cancelled') then
    raise exception 'POS_INTENT_FINAL' using errcode = 'check_violation';
  end if;
  if (new.terminal_id, new.patient_id, new.amount, new.mode, new.intent_no, new.created_by) is distinct from
     (old.terminal_id, old.patient_id, old.amount, old.mode, old.intent_no, old.created_by) then
    raise exception 'POS_INTENT_LOCKED' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger pos_intent_guard before update on pos_intents for each row execute function app.pos_intent_guard();

create table pos_settlements (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  terminal_id     uuid not null,
  business_date   date not null,
  system_count    integer not null check (system_count >= 0),
  system_total    numeric(14,2) not null check (system_total >= 0),
  slip_count      integer not null check (slip_count >= 0),
  slip_total      numeric(14,2) not null check (slip_total >= 0),
  note            text check (note is null or length(note) between 3 and 300),
  closed_by       uuid not null references users(id),
  closed_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, terminal_id, business_date),
  foreign key (tenant_id, terminal_id) references pos_terminals(tenant_id, id),
  -- Fark varsa açıklama zorunlu.
  check ((system_count = slip_count and system_total = slip_total) or note is not null)
);

alter table payments add column pos_intent_id uuid;
alter table payments add constraint payments_pos_intent_fk foreign key (tenant_id, pos_intent_id) references pos_intents(tenant_id, id);
create unique index payments_pos_intent_uq on payments (tenant_id, pos_intent_id) where pos_intent_id is not null;

do $$ declare t text; begin
  foreach t in array array['pos_terminals','pos_intents','pos_settlements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id())', t);
    execute format('grant select on %I to viadent_worker', t);
  end loop;
end $$;
grant select, insert on pos_terminals to viadent_app;
grant update (name, branch_id, bank_name, terminal_ref, active) on pos_terminals to viadent_app;
grant select, insert on pos_intents to viadent_app;
grant update (status, auth_code, card_last4, provider_ref, failure_reason, payment_id, resolved_by, sent_at, completed_at) on pos_intents to viadent_app;
grant select, insert on pos_settlements to viadent_app;
