# Ortam — qa-20261107-0145-b910f90

- Ürün revizyonu (kilit): `b910f90c9ac64b0991937a822f5386ef36690c0c` (gelistirme-gecmisi). Önceki koşu: qa-20261104-1549-65201a2 (TESLİME ADAY, bef63fe).
- Yerel test ortamı: PostgreSQL 16 (FORCE RLS), API :4000 (tsx), worker, web :3000 (next start, üretim derlemesi), temiz seed her turda.
- Dış servisler: SMS yalnız DENEME (Netgsm kimlik bilgisi yok, canlı gönderim kapısı kapalı); Netgsm adaptörü yerel sahte sunucuyla (G13). Online ödeme / e-belge DENEME. Gerçek mesaj/ödeme yok.
- Kimlik bilgileri `.demo-credentials`'tan ortam değişkeniyle; kayda/kanıta yazılmaz.
- Tur 3–4 sürümü: `1a6ba06ee076bb5eceb7505d362785325aa14121` (QA-301 düzeltmesi, push: origin/gelistirme-gecmisi). Migration 36 dosya (0001–0036); temiz DB'ye hepsi uygulandı. Ürün kodu temiz; değişen yalnız tester betikleri (`qa-runs/.scripts`) ve bu koşu klasörü. Tur 4: 07.11.2026 02:20–02:34 (Europe/Istanbul).

## Önceki koşunun ortam notları
# Ortam — qa-20261104-1549-65201a2
- Sürüm: `65201a20332722c10b67175f382213986e3a8602` (main, push edildi: origin/gelistirme-gecmisi)
- Kirli dosya: yalnız bu koşu klasörü (izlenmeyen); ürün kodu temiz (`git status` boş)
- Zaman: 04.11.2026 15:49 (Europe/Istanbul)
- Node v22.22.0, pnpm 10.28.0, PostgreSQL 16.15, Chromium (Playwright, /opt/pw-browsers/chromium)
- Ortam: yerel test; API :4000 (production), worker, web :3000 (next build + start). DB: yerel PostgreSQL 'viadent' (sentetik seed; koşu öncesi db:reset + migrate + seed) ve API test DB 'viadent_test' (global-setup ile yeniden kurulur).
- Migration: 34 dosya (0001–0034; yeni: 0032 randevu–işlem bağı, 0033 hekim ücret modeli + maaş ödemesi, 0034 tedarikçi fiyatı + randevu malzemesi); temiz DB'ye hepsi uygulandı.
- Dış servisler: yalnız MOCK; VIADENT_EXTERNAL_SEND_ENABLED=false → canlı gönderim kapalı.
- Kullanıcılar: seed'in sentetik demo hesapları (@demo-yesil.test, @demo-mavi.test). Parola .demo-credentials (git dışı) dosyasından ortam değişkeniyle okunur; kanıtlara yazılmaz.
- Önceki koşu: qa-runs/qa-20261102-1209-12fc6fd (TESLİME ADAY) — değiştirilmedi.
- Canlı demo (Vercel/Supabase) bu koşunun dışında: üretime gönderim yok. Canlıda 0032–0034 uygulanmadı.
