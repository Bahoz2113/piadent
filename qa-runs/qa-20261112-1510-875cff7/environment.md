# Ortam — qa-20261112-1510-875cff7
- Ürün revizyonu (kilit): `875cff76ffd8dc3358554f0399f73f113e0e440d` (gelistirme-gecmisi). Değişiklik: apps/web/app/(app)/bugun (Anasayfa kartları), shell menü adı + testler. Önceki TESLİME ADAY: 17b7ab0 (canlıya alınmadı), canlıdaki: db5c4ff.
- Yerel test ortamı: PostgreSQL 16 (FORCE RLS), API :4000, worker, web :3000 (üretim derlemesi), her turda temiz seed (0001–0041). Tur betiği derler ve yeniden başlatır (evidence/<tur>/stack-version.txt).
- Dış servisler yalnız DENEME; gerçek mesaj/ödeme yok. Kimlik bilgileri .demo-credentials'tan ortam değişkeniyle; kayda yazılmaz.
- Node v22, pnpm 10, Chromium (Playwright). Fiziksel telefon yok: 360 px emülasyon.
