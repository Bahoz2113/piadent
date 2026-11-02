-- QA-109 (ADR-091): gizli dosyanın (ADR-089: klinik hassasiyetli veya klinik çıktı belgesine bağlı) karantina görevi `clinical` hassasiyetli
-- ve açıksa hekime (`dentist`) atanır. 0030 öncesi worker bu görevleri dosyadan bağımsız `general` + `clinic_admin` açıyordu; bu migration mevcut
-- kayıtları aynı kurala getirir. Kapanmış görevde yalnız hassasiyet değişir (atanan rol geçmiş kaydı olarak kalır). İdari dosya görevleri değişmez.
-- FORCE RLS altında kiracı kiracı çalışır (app.for_each_tenant, ADR-077). Tekrar çalıştırmak güvenlidir (yalnız `clinical` olmayanlar güncellenir).
select app.for_each_tenant($q$
  update tasks t
     set sensitivity = 'clinical',
         assignee_role = case when t.status in ('open','in_progress','blocked') then 'dentist' else t.assignee_role end,
         updated_at = now()
    from file_assets f
   where t.kind = 'file_quarantined' and t.source_type = 'file' and f.id = t.source_id and t.sensitivity <> 'clinical'
     and not (f.sensitivity = 'administrative' and not exists (
           select 1 from patient_documents cod join document_types cdt on cdt.id = cod.document_type_id
            where cod.id = f.patient_document_id and cdt.category = 'clinical_output'))
$q$);
