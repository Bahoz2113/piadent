# Bulgu defteri — qa-20261108-1900-959f7ef

## Tur 1 (959f7ef, temiz seed) — 76/79 PASS
- **QA-501 (S2, FIX_READY 6d31dbd)** — N06 iki profilde: koyu + lacivert görünümde `/bugun` axe color-contrast ciddi/kritik (yeni Bugünün randevuları listesi; iptal satırı soluk metin hipotezi). Kanıt evidence/tur1/browser-n.log, masaustu-N06-koyu-bugun.jpg. Devir fix1.md.
- **QA-502 (S3, FIX_READY 6d31dbd)** — R04/R05: geri-bildirim-0411.spec.ts telefon-360'ta menü açılmadan İş akışı bağlantısı (zaman aşımı). Kanıt evidence/tur1/R04-R05-e2e-temiz-seed.log. Devir fix1.md.
- I01–I09 hepsi PASS; API, contracts, web birim, typecheck, V06, R07 PASS.

## Tester betiği düzeltmeleri (ürün kodu değil)
- browser-f F12: randevu formundaki işlem seçici adı "İşlem" → "İşlemler (isteğe bağlı)" (ADR-107 kabul değişikliği; ölçüt aynı: > 50 seçenek, fiyat görünür, tek seçici).
- round.sh: i-cases.mjs eklendi (I01–I06). tur-final.sh: R07 için rls-0811.sql (önceki kontroller + appointment_procedures).
- i-cases: koşuya özel hekim ("Zz Dt. QA I …"), F01 ile aynı gerekçe (seed/E2E randevularıyla saat çakışması).

## Tur 2 (6d31dbd, temiz seed) — 76/79 PASS
- QA-501 VERIFIED (N06 iki profilde axe ciddi/kritik 0), QA-502 VERIFIED (0411 Panel telefon-360 geçti).
- **QA-503 (S3, FLAKY, FIX_READY f3e5d5e)** — geri-bildirim-0811 "Randevu ver" telefon-360'ta zaman aşımı (tur 1'de geçmişti). İz: sayfa geneli "Hekim" seçicisi Randevular süzgecini de sayıyor (7 seçenek) → formdaki 3 seçenekli listede indeks 6 bekleniyor. Test kodu yarışı; ürün davranışı değil. Devir fix2.md. I08, R04, R05 bu nedenle FAIL.
