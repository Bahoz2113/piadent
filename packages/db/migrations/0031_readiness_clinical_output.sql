-- QA-110 (ADR-092): PİA Hazır kuralı klinik çıktı belge türüne (ADR-085: EPIKRIZ, HASTA-FOYU, RECETE) bağlanamaz. 0031 öncesi API bunu
-- kabul ediyordu; böyle bir kural sağlık yetkisi olmayan role "Belge hazırlanmamış → Hazır" geçişiyle belgenin varlığını açık ediyordu.
--  1. Etkin klinik çıktı kuralları pasifleştirilir (satır silinmez; yönetici listesinde "Pasif" görünür, yeniden etkinleştirilemez).
--  2. Etiketinde klinik çıktı türü adı geçen `readiness_missing` görevleri `clinical` olur (sağlık yetkisize görünmez; denetim olayları
--     ADR-091 `notHiddenTaskEventSql` ile süzülür). Açık olanlar kapanır; PİA Akış randevu hâlâ eksikse klinik kalemsiz temiz görevi yeniden
--     açar (dedupe yalnız açık görevlerde). Kapalı görevin kapanış nedeni geçmiş kaydı olarak kalır.
-- Değerlendirme (`readinessFor`) ayrıca bu kuralları yok sayar; migration kayıtları o kurala getirir. FORCE RLS altında kiracı kiracı
-- (app.for_each_tenant, ADR-077). Tekrar çalıştırmak güvenlidir (yalnız etkin kural ve `clinical` olmayan görev güncellenir).
select app.for_each_tenant($q$
  update readiness_rules r set active = false
    from document_types dt
   where dt.id = r.document_type_id and dt.category = 'clinical_output' and r.active
$q$);
select app.for_each_tenant($q$
  update tasks t
     set sensitivity = 'clinical',
         status = case when t.status in ('open','in_progress','blocked') then 'done' else t.status end,
         closed_at = coalesce(t.closed_at, now()),
         closed_reason = case when t.status in ('open','in_progress','blocked') then 'Hazırlık kuralları güncellendi; görev yeniden değerlendirilecek' else t.closed_reason end,
         updated_at = now()
   where t.kind = 'readiness_missing' and t.sensitivity <> 'clinical'
     and exists (select 1 from readiness_rules r join document_types dt on dt.id = r.document_type_id
                  where r.document_type_id is not null and dt.category = 'clinical_output' and strpos(t.reason, dt.name) > 0)
$q$);
