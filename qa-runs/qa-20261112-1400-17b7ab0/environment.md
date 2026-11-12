# Ortam — qa-20261112-1400-17b7ab0
- Ürün revizyonu (kilit): `17b7ab0e54d6bb9153521f19548be3d2b111a7bd` (gelistirme-gecmisi). Değişiklik: apps/web/components/appointment/new-appointment-page.tsx (ödeme planı) + testler. Önceki TESLİME ADAY: db5c4ff (canlı).
- Yerel test ortamı: PostgreSQL 16 (FORCE RLS), API :4000, worker, web :3000 (üretim derlemesi), her turda temiz seed (0001–0041). Tur betiği derler ve yeniden başlatır (evidence/<tur>/stack-version.txt).
- Dış servisler yalnız DENEME; gerçek mesaj/ödeme yok. Kimlik bilgileri .demo-credentials'tan ortam değişkeniyle; kayda yazılmaz.
- Node v22, pnpm 10, Chromium (Playwright). Fiziksel telefon yok: 360 px emülasyon.
