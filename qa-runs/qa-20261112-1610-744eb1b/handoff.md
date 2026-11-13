# Devir — qa-20261112-1610-744eb1b → cezeri-duzeltici

Revizyon: 744eb1b (gelistirme-gecmisi). Tur 1: 89/91 PASS; R01 ve R03 FAIL. Bulgular `bugs.md` / `bugs.json`.

1. **QA-801 (S3):** `packages/contracts/src/audit.ts` alan etiketlerine `outside_appointments` için Türkçe etiket ekle (ör. "Plan dışında kalan randevu"). Doğrulama: `cd apps/web && ./node_modules/.bin/vitest run test/audit-field-labels.test.ts`.
2. **QA-802 (S3):** `apps/api/test/roster-1211.test.ts` A kiracısına kalıcı aktif ünite eklememeli ya da eklediği üniteleri test sonunda pasifleştirmeli; `geri-bildirim-0811.test.ts` beklentisini (yalnız Ünite A/B/C aktif) DEĞİŞTİRME. Not: geri-bildirim-0811 testinin aktif üniteleri mi tüm üniteleri mi okuduğunu kontrol et; çözüm o testin varsayımına uymalı. Doğrulama: `cd apps/api && set -a; . ../../.env; set +a; npx vitest run test/roster-1211.test.ts test/geri-bildirim-0811.test.ts` (iki sırayla da).

Kurallar: `qa-runs/` altına dokunma; `apps/web/tsconfig.tsbuildinfo` commit etme; test beklentisi gevşetme; commit mesajı sonuna oturum satırları; `origin gelistirme-gecmisi`'ne push (force yok). Dönüşte revizyon ve çalıştırılan komut çıktılarını raporla.

---
## Tur 2 sonrası devir (QA-803)
QA-801/802 VERIFIED. Yeni: **QA-803 (S3, mevcut kusur)** — `apps/api/test/messaging-0711.test.ts` `gorev5.test.ts`'ten önce koşunca gorev5'in 8 testi düşüyor. Yeniden üretim: `cd apps/api && set -a; . ../../.env; set +a; npx vitest run test/messaging-0711.test.ts test/gorev5.test.ts --sequence.shuffle.files --sequence.seed=3` (8 düşer). Hatalar: `submit:error` yerine `submit:timeout/rejected` beklenen; `PROVIDER_NOT_CONFIGURED` beklenen yerde undefined; durum 'failed' yerine 'submitted'. messaging-0711'in bıraktığı yan etkiyi (ör. global fetch / process.env / SMS bağlantı durumu / kuyruğa alınmış mesajlar) bul ve o dosyada temizle (afterAll/afterEach); gorev5 beklentilerini değiştirme. Doğrula: aynı komut seed 1–4 ve tam takım hem normal hem `--sequence.shuffle.files --sequence.seed=3`.
