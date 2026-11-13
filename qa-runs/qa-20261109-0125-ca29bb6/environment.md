# Ortam — qa-20261109-0125-ca29bb6

- Ürün revizyonu (kilit): `ca29bb6d7b7fa5563a4f2c1c507e121220a4fc45` (gelistirme-gecmisi; kirli dosya yalnız `apps/web/tsconfig.tsbuildinfo` — derleme önbelleği, ürün kodu değil). Önceki koşu: qa-20261109-0040-9a6382e (TESLİME ADAY db5c4ff, canlıda).
- Kapsam: ADR-109 POS entegrasyonu Faz 0 (pos_terminals, pos_intents, pos_settlements; migration 0042) + tam regresyon.
- Yerel test ortamı: PostgreSQL 16 (FORCE RLS), API :4000, worker, web :3000 (üretim derlemesi), her turda temiz seed (migration 0001–0042). Tur betiği her turdan önce derler ve yeniden başlatır; çalışan süreç ve HEAD `evidence/<tur>/stack-version.txt`.
- Dış servisler: SMS / e-belge / ödeme / POS yalnız DENEME; gerçek mesaj, ödeme veya kart çekimi yok. POS'ta "manual" sürücü dış sisteme bağlanmaz; "mock" sürücü benzetimdir.
- Sentetik kart: test PAN'ı yalnız reddedilmesi beklenen girişlerde kullanılır (gerçek kart değil); kanıtta maskelenir.
- Kimlik bilgileri `.demo-credentials`'tan ortam değişkeniyle; kayda/kanıta yazılmaz.
- Node v22.22.0, pnpm 10.28.0, Chromium (Playwright, /opt/pw-browsers/chromium).
- Fiziksel telefon / gerçek POS cihazı: yok (BLOCKED değil, plan dışı: Faz 0 gerçek cihaz iddia etmez).
