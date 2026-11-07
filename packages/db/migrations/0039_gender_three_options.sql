-- Ürün sahibi kararı 07.11.2026 (ADR-106): cinsiyet yalnız Kadın / Erkek / Belirtmek istemiyorum.
-- "Diğer" seçeneği kaldırıldı; varsa eski kayıtlar "belirtmek istemiyorum"a çevrilir (canlıda 0 kayıt). Girilmemiş (null) kalabilir.
select app.for_each_tenant($q$ update patients set gender = 'unspecified' where gender = 'other' $q$);
alter table patients drop constraint patients_gender_check;
alter table patients add constraint patients_gender_check check (gender in ('female', 'male', 'unspecified'));
