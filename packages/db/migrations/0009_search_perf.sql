-- Görev 7 performans ölçümü (100.000 hasta) bulguları — ADR-047
--  * Telefon parça araması (ör. “0532 11”) için trigram dizini; mevcut btree yalnız tam eşleşmede işe yarıyordu.
--  * Dosya no araması sayısal karşılaştırmaya çevrildi (uygulama), mevcut (tenant_id, file_no) benzersiz dizini kullanılır.
create index patients_phone_trgm on patients using gin (phone_digits gin_trgm_ops);
