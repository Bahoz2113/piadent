-- Görev 9: parola değişikliği ve yönetici sıfırlaması (ADR-056)
alter table users add column password_changed_at timestamptz;
alter table users add column must_change_password boolean not null default false;   -- geçici parolayla giriş → yalnız Hesabım açık
