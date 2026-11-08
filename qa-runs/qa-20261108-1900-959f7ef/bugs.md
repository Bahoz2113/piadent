# Bulgu defteri — qa-20261108-1900-959f7ef

## Tur 1 (959f7ef, temiz seed) — 76/79 PASS
- **QA-501 (S2, AÇIK)** — N06 iki profilde: koyu + lacivert görünümde `/bugun` axe color-contrast ciddi/kritik (yeni Bugünün randevuları listesi; iptal satırı soluk metin hipotezi). Kanıt evidence/tur1/browser-n.log, masaustu-N06-koyu-bugun.jpg. Devir fix1.md.
- **QA-502 (S3, AÇIK)** — R04/R05: geri-bildirim-0411.spec.ts telefon-360'ta menü açılmadan İş akışı bağlantısı (zaman aşımı). Kanıt evidence/tur1/R04-R05-e2e-temiz-seed.log. Devir fix1.md.
- I01–I09 hepsi PASS; API, contracts, web birim, typecheck, V06, R07 PASS.

## Tester betiği düzeltmeleri (ürün kodu değil)
- browser-f F12: randevu formundaki işlem seçici adı "İşlem" → "İşlemler (isteğe bağlı)" (ADR-107 kabul değişikliği; ölçüt aynı: > 50 seçenek, fiyat görünür, tek seçici).
- round.sh: i-cases.mjs eklendi (I01–I06). tur-final.sh: R07 için rls-0811.sql (önceki kontroller + appointment_procedures).
- i-cases: koşuya özel hekim ("Zz Dt. QA I …"), F01 ile aynı gerekçe (seed/E2E randevularıyla saat çakışması).
