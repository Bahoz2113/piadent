# Bulgu defteri — qa-20261108-1900-959f7ef

Açık bulgu yok (koşu başlangıcı).

## Tester betiği düzeltmeleri (ürün kodu değil)
- browser-f F12: randevu formundaki işlem seçici adı "İşlem" → "İşlemler (isteğe bağlı)" (ADR-107 kabul değişikliği; ölçüt aynı: > 50 seçenek, fiyat görünür, tek seçici).
- round.sh: i-cases.mjs eklendi (I01–I06). tur-final.sh: R07 için rls-0811.sql (önceki kontroller + appointment_procedures).
- i-cases: koşuya özel hekim ("Zz Dt. QA I …"), F01 ile aynı gerekçe (seed/E2E randevularıyla saat çakışması).
