# Ortam — qa-20261107-1245-bbba373

- Ürün revizyonu (kilit): `bbba3736edd0586cdf838177db4e7589fa50784d` (gelistirme-gecmisi, push edildi). Önceki koşu: qa-20261107-0145-b910f90 (TESLİME ADAY, 1a6ba06).
- Kapsam: 07.11.2026 geri bildirimi 2. paket — ADR-103 anatomik odontogram + randevudan dişe işlem, ADR-104 her belge türüne DEMO şablon (0037), ADR-105 Görüntülemeler (0038), takvimde ay/yıl seçimi.
- Yerel test ortamı: PostgreSQL 16 (FORCE RLS), API :4000, worker (dosya taraması dahil), web :3000 (üretim derlemesi), her turda temiz seed (migration 0001–0038).
- Dış servisler: SMS yalnız DENEME; e-belge/ödeme DENEME; gerçek mesaj/ödeme yok. Görüntüleme dosyaları sentetik bayt (gerçek hasta görüntüsü yok).
- Kimlik bilgileri `.demo-credentials`'tan ortam değişkeniyle; kayda/kanıta yazılmaz.
- Node v22.22.0, pnpm 10.28.0, Chromium (Playwright, /opt/pw-browsers/chromium).
