# Bulgu defteri — qa-20261102-1209-12fc6fd (sürüm 12fc6fd)

| ID | Önem | Durum | Vaka | Başlık | Sorumlu |
|---|---|---|---|---|---|
| QA-101 | S1 | OPEN | N05 | Sağlık yetkisi olmayan rol klinik çıktı belgesinde yazma işlemi yapabiliyor (yönetici iptal 200; sekreter "yazdırıldı" kanıtı 200) | Kodlama (cezeri-duzeltici) |
| QA-102 | S2 | OPEN | N05 | Klinik çıktı belgesinin varlığı/olayları sağlık yetkisi olmayan rollere hasta geçmişinde (PİA İz) görünüyor | Kodlama |
| QA-103 | S3 | OPEN | N02 | Sağlayıcının düzenlediği (MOCK) / iptal ettiği faturada da "TASLAK — resmî belge değildir" uyarısı, "e-Belge sağlayıcısı bağlı değil" metni ve "Taslağı yazdır" (TASLAK filigranı) gösteriliyor | Kodlama |

## QA-101 (S1) — Klinik çıktı belgesi yazma uçlarında sağlık kapısı yok
- **Ortam/sürüm:** yerel test, `12fc6fd`, sentetik hasta "Epikriz Sınama" (A kliniği).
- **Adımlar:** (1) Hekim `POST /documents` ile EPIKRIZ üretir (201). (2) Sekreter `GET /documents/:id` → **404** (doğru: varlık gizli). (3) Sekreter `POST /documents/:id/print` → **200 `{ok:true}`** ve belgeye `printed` kanıt olayı yazılır. (4) Var olmayan id ile aynı istek → 404 (yani 200/404 farkı varlık kahini). (5) Yönetici (`patient.health.read` yok, `document.revoke` var) `POST /documents/:id/revoke` → **200**; belge iptal oldu (Geçmiş'te "Belge iptal edildi · Selma Tekin").
- **Beklenen (ADR-085):** klinik çıktı belgeleri sağlık verisidir; `patient.health.read` olmayan rol için tüm uçlarda 404 (varlığı bile görünmez), durum değiştiremez, kanıt yazamaz.
- **Gözlenen:** okuma uçları korunuyor, yazma/yan uçlar (print, revoke; muhtemelen decision ve kanıt dosyası bağlama) korunmuyor.
- **Etki:** sağlık yetkisi olmayan rol hekimin klinik belgesini geri alınamaz biçimde iptal edebiliyor ve kanıt zincirine yetkisiz olay ekleyebiliyor; varlık sızıntısı. Kritik iş akışı + yetki ihlali → S1.
- **Kanıt:** `evidence/tur1/N05-http.json` (secPrint 200), `evidence/tur1/N05-yan-uclar.json`, `evidence/tur1/masaustu-N05-sekreter-gecmis.jpg` (yöneticinin iptal olayı).
- **Kök neden ipucu:** `apps/api/src/documents/documents.controller.ts` — kategori kapısı yalnız `render()` (satır ~157), `list` (~249) ve `detail` (~266) içinde; `print`, `decision`, `revoke` ve kanıt/dosya bağlama uçları kategoriyi kontrol etmiyor. Tek yardımcı (ör. `loadDocForWrite(c, ctx, id)`) tüm belge uçlarında kullanılmalı.

## QA-102 (S2) — Hasta geçmişinde klinik çıktı belgesi olayları
- **Adımlar:** QA-101 senaryosu sonrası sekreter `GET /patients/:id/history` → `document.issue` (entityType `patient_document`, entityId = epikriz id, aktör hekim, `content_hash`, `template_version_id`) ve `document.revoke` olayları döner; UI Geçmiş sekmesinde "Belge düzenlendi · Dt. Elif Aras" görünür.
- **Beklenen:** sağlık yetkisi olmayan rol için klinik çıktı belgesine ait olaylar geçmişte görünmez (QA-001'deki klinik varlık filtresiyle tutarlı).
- **Kanıt:** `evidence/tur1/N05-http.json` (histLeak=true, histSample), `evidence/tur1/{masaustu,mobil}-N05-sekreter-gecmis.jpg`.
- **Kök neden ipucu:** `patients.service.ts history()` `CLINICAL_ENTITY_TYPES` yalnız varlık türüne bakıyor; `patient_document` olayları kategoriye göre (clinical_output) ayrıca süzülmeli. `document.issue/print/decision/revoke` olayları için belge kategorisi birleştirilmeli.

## QA-103 (S3) — Düzenlenmiş/iptal faturada taslak uyarıları
- **Adımlar:** MOCK e-belge bağlantısıyla gönderilip `issued` (MOCK202697C69990F) ve sonra `cancelled` olan faturayı Finans → Fatura taslakları → Aç.
- **Gözlenen:** üstte sabit "TASLAK — resmî belge değildir … e-Belge sağlayıcısı bağlı değil" uyarısı, altta "Taslağı yazdır" (TASLAK filigranlı çıktı). Aynı ekranda "Fatura no: MOCK… · MOCK sağlayıcı — resmî belge değil" ve "Sağlayıcı: mock (mock)".
- **Beklenen:** uyarı ve yazdırma durumu yansıtmalı: taslak → TASLAK; sağlayıcıda/düzenlenmiş/iptal → sağlayıcı durumu ("MOCK sağlayıcı tarafından düzenlendi — resmî değil" / gerçek sağlayıcıda "Sağlayıcı belgesi: …"), "bağlı değil" metni bağlantı durumuna göre. Gerçek sağlayıcı geldiğinde düzenlenmiş faturada "TASLAK" ifadesi yanıltıcı olur.
- **Kanıt:** `evidence/tur1/masaustu-N02-fatura-ayrinti.jpg`.

## Ortam / betik notları (ürün kusuru değil)
- Tarayıcı betiğinin ilk iki koşusunda N02/N05 "FAIL" tester betiği hatasıydı (hasta adı "Epikriz Sınama" metin aramasına takıldı; diyalog seçici; "Belge düzenlendi" etiketi kalıpta yoktu). Betik düzeltildi; son koşu `evidence/tur1/browser-n-summary.json`.
- n-cases N02'de "Unicode ad" kontrolü listede ilk şahıs faturasını (yuvarlama faturası, aynı alıcı adı) okudu; ad yine "Şükrü Çağlayan İğdır" olarak birebir döndü.
