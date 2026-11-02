-- Faz 3 (ADR-086): sağlayıcı adaptör iskeleti genişler — e-belge (gönder/iptal) ve WhatsApp işlemleri. Gerçek sağlayıcı yok; yalnız
-- etiketli MOCK bağlantı. Fatura durumu sağlayıcı yanıtıyla (worker) değişir: issued yalnız provider_ref + invoice_no ile.
alter table integration_jobs drop constraint integration_jobs_operation_check;
alter table integration_jobs add constraint integration_jobs_operation_check
  check (operation in ('sms.send','whatsapp.send','payment.create_link','payment.refund','einvoice.submit','einvoice.cancel','health_registry.submit'));
grant update (status, provider_ref, invoice_no, issued_at, rejected_reason, provider_connection_id, cancel_reason, cancelled_at, updated_at) on invoices to viadent_worker;
