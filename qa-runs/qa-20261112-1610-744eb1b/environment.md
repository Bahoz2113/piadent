# Ortam — qa-20261112-1610-744eb1b
- Ürün revizyonu (kilit): `744eb1b0809e9e27c6364eb35980e2d7ae9918c0` (gelistirme-gecmisi). Değişiklik: Anasayfa (875cff7) + ADR-110 çalışma listesi (744eb1b, migration 0042). Önceki TESLİME ADAY 17b7ab0 (canlıya alınmadı); canlıdaki db5c4ff.
- Yerel test ortamı: PostgreSQL 16 (FORCE RLS), API :4000, worker, web :3000 (üretim derlemesi), her turda temiz seed (0001–0042). Tur betiği derler ve yeniden başlatır (evidence/<tur>/stack-version.txt).
- Dış servisler yalnız DENEME; gerçek mesaj/ödeme yok. Kimlik bilgileri .demo-credentials'tan ortam değişkeniyle; kayda yazılmaz.
- Node v22, pnpm 10, Chromium (Playwright). Fiziksel telefon yok: 360 px emülasyon.
