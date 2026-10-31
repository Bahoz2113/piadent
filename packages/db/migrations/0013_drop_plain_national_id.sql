-- Görev 11 (ADR-062): düz metin kimlik no sütunu kaldırılır. Güvenlik: geçiş yapılmamış satır varsa migration durur
-- (önce `pnpm db:encrypt-ids --apply`); veri kaybı olmaz.
do $$
declare n integer;
begin
  select count(*) into n from patients where national_id is not null;
  if n > 0 then
    raise exception 'patients.national_id sütununda % düz metin kayıt var; önce `pnpm db:encrypt-ids --apply` çalıştırın', n;
  end if;
end $$;
alter table patients drop constraint patients_national_id_consistent;
drop index patients_national_id_uq;
alter table patients drop column national_id;
alter table patients add constraint patients_national_id_consistent check ((national_id_type is null) = (national_id_enc is null));
