# Ortam — qa-20261109-0040-9a6382e

- Ürün revizyonu (kilit): `9a6382e3a718488288a55390b8f8e3acda49566b` (gelistirme-gecmisi). Önceki koşu: qa-20261108-1900-959f7ef (TESLİME ADAY f3e5d5e, canlıya alınmadı).
- Kapsam: 08.11 paketi (ADR-107) + ADR-108 Laboratuvar menüsü (ölçü/malzeme, malzeme siparişi ve takibi, tedarikçiler). Ürün sahibi onayı: "yaptıklarını yayına al" (09.11.2026 00:21) — canlıya alma bu koşu TESLİME ADAY olursa.
- Yerel test ortamı: PostgreSQL 16 (FORCE RLS), API :4000, worker, web :3000 (üretim derlemesi), her turda temiz seed (migration 0001–0041). Tur betiği her turdan önce derler ve yeniden başlatır; çalışan süreç ve HEAD `evidence/<tur>/stack-version.txt`.
- Dış servisler: SMS / e-belge / ödeme yalnız DENEME; gerçek mesaj/ödeme yok.
- Kimlik bilgileri `.demo-credentials`'tan ortam değişkeniyle; kayda/kanıta yazılmaz.
- Node v22.22.0, pnpm 10.28.0, Chromium (Playwright, /opt/pw-browsers/chromium).
