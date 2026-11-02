-- Faz 4.7 (ADR-082): görünüm tercihi (vurgu rengi, şema, ölçek) kullanıcı düzeyinde saklanır; kişisel veri değildir, kiracıdan bağımsızdır.
alter table users add column appearance jsonb not null default '{}'::jsonb check (jsonb_typeof(appearance) = 'object');
