# Düzeltme 2 — cezeri-duzeltici dönüşü (0d3a235)
- QA-803 kök neden: messaging-0711'in son testi A kiracısında kalıcı Netgsm SMS bağlantısı (live, active) açıp silmiyordu; gorev5 MOCK SMS'i kapatınca /messages yedek olarak bu bağlantıyı buluyor → 409 yerine kuyruk + submit:error zinciri.
- Düzeltme: `apps/api/test/messaging-0711.test.ts` açtığı bağlantıyı afterAll'da siler ve doğrular. Ürün kodu ve gorev5 beklentileri değişmedi.
- Düzeltici raporu: önce 8 düşüş üretildi; sonra iki dosya seed 1–4 25/25; tam takım normal ve seed=3 445/445.
