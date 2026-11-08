# Düzeltme dönüşü 2 — f3e5d5e (6d31dbd + yalnız test kodu)
- QA-503: geri-bildirim-0811.spec.ts "Randevu ver" seçicileri randevu formu bölümüne kapsandı (Hekim, Gün, Ünite, İşlemler, Seçilen işlemler; saatler "3 · Uygun saatler" bölümü); son hekim aynı öğeden okunup seçiliyor. Doğrulamalar aynı ("Koltuk" yokluğu sayfa genelinde kaldı).
- Düzeltici kusuru önce üretti (eski spec, temiz seed, --repeat-each=5: 29/30, aynı iz: sayım 7, indeks 6 asılı); sonra 30/30 temiz seed + 30/30 birikmiş veride.
- Ürün kodu değişmedi. Durum FIX_READY; tester tur 3'te tam regresyonla yeniden sınar.
