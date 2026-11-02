-- ADR-086 düzeltme: sağlayıcı tarafından iptal edilen düzenlenmiş fatura numarasını korur (issued → cancelled). Eski kısıt numarayı yalnız
-- 'issued' durumuna bağlıyordu; yeni kısıt: issued ⇒ numara+tarih var; numara varsa durum issued ya da cancelled (taslak/ret/bekleyen numarasız).
alter table invoices drop constraint invoices_check1;
alter table invoices add constraint invoices_issued_no_check
  check ((status <> 'issued' or (invoice_no is not null and issued_at is not null)) and (invoice_no is null or status in ('issued','cancelled')));
