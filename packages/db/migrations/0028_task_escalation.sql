-- Faz 4.3 (ADR-087): PİA Akış SLA / yükseltme. Vadesi klinik eşiğinden (akis_settings.escalationHours, varsayılan 24) uzun süredir geçmiş
-- açık görev yöneticiye yükseltilir: görev kopyalanmaz, atanan rol korunur; yönetici kuyruğunda da görünür ve "yükseltildi" işaretlenir.
alter table tasks add column escalated_at timestamptz;
alter table tasks add column escalated_to_role text check (escalated_to_role is null or escalated_to_role in ('clinic_admin','dentist','secretary','assistant','finance'));
create index tasks_escalated_idx on tasks (tenant_id, escalated_to_role) where escalated_at is not null and status in ('open','in_progress','blocked');
