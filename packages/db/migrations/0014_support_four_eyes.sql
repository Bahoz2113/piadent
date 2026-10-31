-- Görev 11 (ADR-064): destek erişiminde dört göz. Üyelik 'pending' durumunda etkisizdir; ikinci bir klinik yöneticisi onaylar.
alter table memberships drop constraint memberships_status_check;
alter table memberships add constraint memberships_status_check check (status in ('pending','active','revoked'));
alter table memberships add column approved_by uuid references users(id);
alter table memberships add column approved_at timestamptz;
alter table memberships add column created_by uuid references users(id);
alter table memberships add constraint memberships_pending_support check (status <> 'pending' or role = 'support');
