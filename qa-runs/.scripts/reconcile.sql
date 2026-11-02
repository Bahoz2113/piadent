-- CEZERİ V06 bağımsız mutabakat (sahip/yedek rolüyle, RLS bağlamı her kiracı için tek tek değil: yedek rolü BYPASSRLS).
select (select count(*) from patients)||'|'||(select count(*) from appointments)||'|'||(select count(*) from payments)||'|'||(select coalesce(sum(amount),0) from payments)
 ||'|'||(select coalesce(sum(amount),0) from receivables where status='active')||'|'||(select coalesce(sum(amount),0) from allocations)
 ||'|'||(select count(*) from file_assets where patient_id is not null)||'|'||(select count(*) from file_assets f where patient_id is not null and not exists (select 1 from patients p where p.id=f.patient_id))
 ||'|'||(select count(*) from memberships)||'|'||(select count(*) from audit_events)||'|'||(select count(*) from performed_procedures)||'|'||(select count(*) from odontogram_findings)
 ||'|'||(select count(*) from patient_documents)||'|'||(select count(*) from receipts)||'|'||(select string_agg(receipt_no,',' order by receipt_no) from (select receipt_no from receipts order by receipt_no desc limit 3) x)
 ||'|'||(select count(*) from invoices)||'|'||(select count(*) from invoice_lines)||'|'||(select coalesce(sum(grand_total),0) from invoices)||'|'||(select count(*) from anamnesis_templates)
 ||'|'||(select count(*) from procedure_consumables)||'|'||(select count(*) from stock_movements)||'|'||(select coalesce(sum(quantity),0) from stock_movements)
 ||'|'||(select string_agg(grantee||':'||privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants where table_name='receipts')
 ||'|'||(select count(*) from pg_policies where schemaname='public')||'|'||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relforcerowsecurity);
