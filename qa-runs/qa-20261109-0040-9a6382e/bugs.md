# Bulgu defteri — qa-20261109-0040-9a6382e

## Tur 1 (9a6382e, temiz seed) — 84/86 PASS
- **QA-601 (S3, FLAKY, AÇIK)** — R01: gorev13 "PİA Akış eşikleri" testi 00:30'da düştü (40 dk önceki randevu önceki güne düşüyor; test gerçek saate bağlı). Devir fix1.md. Bu sürümün değişiklikleriyle ilgisi yok; önceki koşularda gündüz geçti.
- R07 FAIL = **tester betiği hatası**: rls-0911.sql sütun düzeyindeki UPDATE yetkisini `role_table_grants`'ta arıyordu (sütun yetkisi orada görünmez). Doğru beklenti: tablo düzeyinde UPDATE/DELETE/TRUNCATE yok + sütun düzeyinde yalnız `purchase_order_lines.received_qty`. Sorgu ve ölçüt düzeltildi (gevşetilmedi; DB'nin gerçek durumu J03 ile de doğrulandı). Tur 2'de yeniden sınanır.
- J01–J07 ve I/H/… tüm vakalar PASS; E2E 130 geçti / 0 hata; web 127; contracts 21.

## Tester betiği düzeltmeleri (ürün kodu değil)
- round.sh: j-cases.mjs (J01–J04). tur-final.sh: R07 rls-0911.sql (önceki + purchase_* tabloları). results-0911.cjs: J05–J07 laboratuvar-0811.spec.ts başlıklarından.
- j-cases q(): hata sonrası rollback (25P02 dersi).
