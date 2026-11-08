# Düzeltme dönüşü 1 — db5c4ff (9a6382e + yalnız test kodu)
- QA-601: gorev13 PİA Akış eşik testi referans anı kliniğin saat dilimindeki bugünün 12:00si (tenants.timezone); randevular, hekim seçim penceresi ve refreshViaAkis aynı anla. Doğrulamalar aynı.
- Düzeltici: önce 00:39 FAIL (1/8), sonra 00:40 PASS (8/8); tam API 438/438. Ürün kurallarının now parametresine dayandığı incelendi (gerçek saat yalnız kayıt damgalarında).
- Durum FIX_READY; tester tur 2 tam regresyonla (gece penceresinde) yeniden sınar.
