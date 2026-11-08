# Ortam — qa-20261108-1900-959f7ef

- Ürün revizyonu (kilit): `959f7efbd5bf7f9a452972b2c4cadbbc9e978d4f` (gelistirme-gecmisi, push edildi). Önceki koşu: qa-20261107-1245-bbba373 (TESLİME ADAY, f91df0d; canlıda).
- Kapsam: 08.11.2026 geri bildirimi (ADR-107) — randevuda işlem isteğe bağlı ve birden fazla (0040 appointment_procedures), randevu ayrıntısında ziyarete birden fazla tanı, Koltuk → Ünite (0040 demo adları), Panel başlığı klinik adı + tarih ve bugünün randevuları, PİA Akış ayrı "İş akışı" sekmesi (/is-akisi).
- Yerel test ortamı: PostgreSQL 16 (FORCE RLS), API :4000, worker, web :3000 (üretim derlemesi), her turda temiz seed (migration 0001–0040). Tur betiği her turdan önce derler ve yeniden başlatır; çalışan süreç ve HEAD `evidence/<tur>/stack-version.txt`.
- Dış servisler: SMS yalnız DENEME; e-belge/ödeme DENEME; gerçek mesaj/ödeme yok.
- Kimlik bilgileri `.demo-credentials`'tan ortam değişkeniyle; kayda/kanıta yazılmaz.
- Node v22.22.0, pnpm 10.28.0, Chromium (Playwright, /opt/pw-browsers/chromium).
