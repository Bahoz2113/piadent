-- Faz 1.2 (ADR-085): klinik çıktı belgeleri (epikriz, hasta bilgi föyü, reçete yazısı). Hekim düzenler; sağlık verisi içerir
-- (görüntüleme patient.health.read ister). e-Reçete DEĞİLDİR: yalnız yazılı reçete/ilaç listesi çıktısı; resmî sistem iddiası yok.
alter table document_types drop constraint document_types_category_check;
alter table document_types add constraint document_types_category_check
  check (category in ('consent','information','administrative','privacy','insurance','clinical_output','other'));

-- Her kiracıya üç klinik çıktı türü (kodlar sabit; şablon gövdesini klinik yazar/onaylar).
select app.for_each_tenant($q$
  insert into document_types(tenant_id, code, name, category, requires_acceptance, issuer_role)
  select t.id, v.code, v.name, 'clinical_output', false, 'dentist'
    from tenants t cross join (values ('EPIKRIZ', 'Epikriz / tedavi özeti'), ('HASTA-FOYU', 'Hasta bilgi föyü (klinik)'), ('RECETE', 'Reçete yazısı (e-reçete değildir)')) as v(code, name)
   where t.id = app.tenant_id() and not exists (select 1 from document_types d where d.tenant_id = t.id and d.code = v.code)
$q$);

-- Belgeye serbest metin (hekim notu / ilaç listesi) bağlanabilir; içerik zaten render edilmiş metinde saklanır, bu sütun kaynağı korur.
alter table patient_documents add column free_text text;
