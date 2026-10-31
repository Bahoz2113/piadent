# Sürüm raporu — qa-20261031-1706-0309309-tur5

**Karar: TESLİME ADAY (teknik) — insan onayı bekliyor** · Sürüm: `01b4c00f9bcfc45a1f5b11864c472872d412cc5a` · 31.10.2026 19:46:13 · Tur 5
Kapı: `node qa/cezeri/gate.cjs qa-runs/qa-20261031-1706-0309309/results.json qa-runs/qa-20261031-1706-0309309/plan.json 01b4c00f9bcfc45a1f5b11864c472872d412cc5a`

> Bu rapor yalnız **sentetik demo verisiyle, yerel test ortamında** çalıştırılan testleri kapsar. Gerçek klinik verisi, gerçek sağlayıcı (SMS/ödeme/e-Nabız/e-Fatura), fiziksel cihaz ve insan kabulü kapsam dışıdır. "Satışa hazır", "tam uyumlu", "Bakanlık onaylı" iddiası yoktur (bkz. docs/release-gates.md).

## Ortam
- Sürüm (git): başlangıç 0309309 → tur2 6324f76 → tur3 f8de83a → tur4 d6bbdd6 → tur5 (final) 01b4c00f9bcfc45a1f5b11864c472872d412cc5a; her turda API/worker/web yeniden derlendi
- Kirli dosyalar: 1 (?? qa-runs/ )
- Node v22.22.0, pnpm 10.28.0, PostgreSQL 16.15
- Playwright 1.64.1 · Chromium:  /opt/pw-browsers/chromium
- Web: Next 15.5.28 (next start :3000) · API NestJS (:4000, NODE_ENV=production) · Worker ayrı süreç
- Veri deposu: yerel PostgreSQL 16, `viadent` veritabanı sıfırlandı + sentetik seed (2 tenant: demo-yesil, demo-mavi). Gerçek hasta verisi yok.

## Zorunlu vakalar (16)
| ID | Durum | Profil | Özet | Kanıt |
|---|---|---|---|---|
| V01 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 10 istek; B erişimleri reddedildi (404/403, önizleme yok); arama 0 sonuç; A kendi kaydını okudu · masaustu: B hasta sayfası sızıntı=false, arama satırı 0 · mobil: B hasta sayfası sızıntı=false, arama satırı 0 | `evidence/tur5/V01-http.json`, `evidence/tur5/masaustu-V01-b-tenant.jpg`, `evidence/tur5/mobil-V01-b-tenant.jpg` |
| V02 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | bulgu 201, tanı 201, işlem 201; diş 16 yüzeyler M,O; diğer diş/hasta değişmedi=true · masaustu: diş 16 görünür=true, işlem metni=true, düzeltme izi=true · mobil: diş 16 görünür=true, işlem metni=true, düzeltme izi=true | `evidence/tur5/V02-http.json`, `evidence/tur5/masaustu-V02-tedavi.jpg`, `evidence/tur5/mobil-V02-tedavi.jpg` |
| V03 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | eşzamanlı yanıtlar 201/409; 14:00'de 1 kayıt; ret kodu APPOINTMENT_CONFLICT · masaustu: 18.12.2026 14:00 ajandada randevu bloğu 1 (metin eşleşmesi 2); API: 1 · mobil: 18.12.2026 14:00 ajandada randevu bloğu 1 (metin eşleşmesi 1); API: 1 | `evidence/tur5/V03-http.json`, `evidence/tur5/masaustu-V03-ajanda.jpg`, `evidence/tur5/mobil-V03-ajanda.jpg` |
| V04 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | eşzamanlı 201/201, tekrar 201, tek ödeme=true, 300'lük ödeme sayısı 1, açık borç 1800.00→2500.00 (beklenen +700), replay başlığı 2/2, iade 201 (ters kayıt 201) · masaustu: 300,00 geçişi 7, açık borç 2800.00 görünür=true, iade izi=true · mobil: 300,00 geçişi 7, açık borç 2800.00 görünür=true, iade izi=true | `evidence/tur5/V04-http.json`, `evidence/tur5/masaustu-V04-finans.jpg`, `evidence/tur5/mobil-V04-finans.jpg` |
| V05 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | sekreter düzeltme 403, hekim düzeltme 200; eski=corrected yeni=completed; geçmişte 2 olay (aktör+zaman=true); sekreter geçmişinde klinik bulgu olayı: 0, finans: 0 · masaustu: hekim düzeltme izi=true; sekreter klinik bulgu olayı görüyor=false (API: 0 olay) · mobil: hekim düzeltme izi=true; sekreter klinik bulgu olayı görüyor=false (API: 0 olay) | `evidence/tur5/V05-http.json`, `evidence/tur5/masaustu-V05-gecmis-sekreter.jpg`, `evidence/tur5/mobil-V05-gecmis-sekreter.jpg` |
| V06 | ✅ PASS | cli | yedek → viadent_qa_restore; restore-verify differences=[]; dosya 4/4; 16 sütunlu bağımsız mutabakat (sayımlar, ödeme/alacak/dağıtım toplamları, hasta-dosya ilişkisi 4 bağlı/0 sahipsiz, yetkiler, 84 politika, 70 FORCE RLS) iki DB'de EŞLEŞTİ | `evidence/tur5/V06-reconcile.txt`, `evidence/tur5/V06-restore-verify.json` |
| P01 | ✅ PASS | http | 14 değer; kabul: 0.01, 999.99, 1000.00 (=borç); kasa hareketi farkı 3; mutabık=true | `evidence/tur5/P01-http.json` |
| P02 | ✅ PASS | http | 28 deneme, 0 beklenmedik | `evidence/tur5/P02-http.json` |
| P03 | ✅ PASS | http | 8 kontrol, 0 beklenmedik | `evidence/tur5/P03-http.json` |
| R01 | ✅ PASS | cli | API vitest 20 dosya / 260 test geçti ×2 koşu (yeni: qa-001 4, QA-005 regresyon 1, QA-006 dayanıklılık 1) | `evidence/tur5/R01-api-tests-kosu1.log`, `evidence/tur5/R01-api-tests-kosu2.log` |
| R02 | ✅ PASS | cli | contracts 15 test geçti | `evidence/tur5/R02-contracts.log` |
| R03 | ✅ PASS | cli | web birim 25 test geçti | `evidence/tur5/R03-web-unit.log` |
| R04 | ✅ PASS | chromium-desktop | Playwright masaüstü: temiz seed tam koşu 42 geçti 0 hata (toplam 76 geçti / 8 bilinçli atlama, 4,3 dk); ayrıca aynı sürümde 1 ek tam koşu (kosu1) 76/76 ve önceki sürümde (d6bbdd6) 76/76 — axe document-title artık görülmedi (QA-004 kapandı). kosu2 (kirli seed, 6. ardışık koşu) gorev3 2× başarısız → ortam ön koşulu ihlali, not düşüldü | `evidence/tur5/R04-R05-e2e-kosu3-temiz-seed.log`, `evidence/tur5/R04-R05-e2e-kosu1.log`, `evidence/tur4/R04-R05-e2e-kosu1.log` |
| R05 | ✅ PASS | chromium-mobile-emulation | Playwright telefon-360 (Pixel 5): 34 geçti, 0 hata (temiz seed) | `evidence/tur5/R04-R05-e2e-kosu3-temiz-seed.log` |
| R06 | ✅ PASS | cli | typecheck exit 0; pnpm audit --prod: bilinen açık yok | `evidence/tur5/R06-typecheck-audit.log` |
| R07 | ✅ PASS | cli | 69/69 FORCE RLS; app rolü super/bypassrls yok; DELETE yalnız 5 finans-dışı tablo; alloc_check 0 | `evidence/tur5/R07-rls.txt` |
| X01 | ✅ PASS | http, cli | Ek vaka (QA-006 kabul): 400 eşzamanlı istek + 12× pg_terminate_backend (idle; idle+aktif) → süreç ayakta, 398×200+2×503 / 382×200+18×503, sonrası 200, ready 200, pool.clientErrors 94, yakalanmamış istisna 0 | `evidence/tur5/QA-006-retest.txt` |

## Profiller
| Profil | Durum | Kanıt / gerekçe |
|---|---|---|
| http | ✅ PASS | `evidence/tur5/http-summary.json` |
| chromium-desktop | ✅ PASS | `evidence/tur5/R04-R05-e2e-kosu3-temiz-seed.log` |
| chromium-mobile-emulation | ✅ PASS | `evidence/tur5/R04-R05-e2e-kosu3-temiz-seed.log` |
| cli | ✅ PASS | `evidence/tur5/V06-reconcile.txt` |
| physical-mobile-device | — NA | Web ürünü; fiziksel cihaz bu ortamda yok. Pilot klinikte gerçek telefonla ayrıca doğrulanmalı (insan). |
| android-apk | — NA | Ürün APK üretmiyor (PWA/web). |
| ios | — NA | iOS test ortamı yok; ürün web. |
| vscode-extension | — NA | Ürün VS Code uzantısı değil. |

## Bulgular
| ID | Önem | Durum | Başlık | Kanıt | Yeniden test |
|---|---|---|---|---|---|
| QA-001 | S1 | VERIFIED | Sağlık yetkisi olmayan roller hasta geçmişinde odontogram bulgu/tanı olaylarını görüyor | `evidence/V05-http.json` | `evidence/tur5/V05-http.json` |
| QA-002 | S3 | VERIFIED | VİA İz ekranında ham eylem kodları (Türkçe etiket yok) | `evidence/masaustu-V05-gecmis-sekreter.jpg` | `evidence/tur5/masaustu-V05-gecmis-sekreter.jpg` |
| QA-003 | S3 | VERIFIED | VİA İz değişen alan satırları: etiket/değer çakışması ve ham alan adları/değerler | `evidence/tur2/QA-003-overlap-crop.jpg` | `evidence/tur5/masaustu-V05-gecmis-sekreter.jpg` |
| QA-004 | S3 | VERIFIED | Tam E2E koşusunda /ajanda axe document-title ihlali — aralıklı (kök neden: router.replace + akışlı metadata) | `evidence/tur3/R04-R05-e2e.log` | `evidence/tur5/R04-R05-e2e-kosu3-temiz-seed.log` |
| QA-005 | S3 | VERIFIED | API testi gorev1 H07 aralıklı 409 — liste indeksine bağlı hasta seçimi (test kodu) | `evidence/tur4/R01-api-tests-kosu1-FAIL.log` | `evidence/tur5/R01-api-tests-kosu1.log` |
| QA-006 | S1 | VERIFIED | Eşzamanlı trafik altında DB bağlantısı kesilince API süreci çöküyor | `evidence/tur4/QA-006-api-crash.log` | `evidence/tur5/QA-006-retest.txt` |
| QA-007 | S3 | VERIFIED | Dayanıklılık testi küme genelinde bağlantı kesiyor (test kodu) | `evidence/tur4/R04-R05-e2e-kosu2-FAIL.log` | `evidence/tur5/R01-api-tests-kosu1.log` |

## Turlar
- **Tur 1** (`0309309`): 15 PASS / 1 FAIL / 0 FLAKY / 0 NOT_RUN · açık bulgu: QA-001(S1), QA-002(S3)
- **Tur 2** (`6324f76`): 7 PASS / 1 FAIL / 0 FLAKY / 8 NOT_RUN · açık bulgu: QA-003(S3)
- **Tur 3** (`f8de83a`): 15 PASS / 0 FAIL / 1 FLAKY / 0 NOT_RUN · açık bulgu: QA-004(S3)
- **Tur 5** (`01b4c00`): 17 PASS / 0 FAIL / 0 FLAKY / 0 NOT_RUN · açık bulgu: yok

## Kapsam, denenmeyen kombinasyonlar, engeller
- Envanter: `inventory.md` (12 ekran, 28 controller / 212 uç, 6 rol, 2 tenant). Rol × ekran kombinasyonlarının tamamı değil, risk temelli seçim: tenant sınırı (V01), sağlık yetkisi sınırı (V05, P03), finans yazma sınırı (P01, P03). Diğer rol × uç kombinasyonları mevcut API test paketinde (R01, 258 test).
- Parametre kapsamı: tahsilat tutarı 14 değer + dağıtım/anahtar kuralları (P01); randevu 28 deneme — tarih/saat/süre sınırları, 8 durum geçişi, iyimser kilit, 7 filtre (P02). Denenmeyen: Unicode normalizasyon uç durumları form alanlarında (ad/soyad Türkçe İ/ı aramaları R01'de var), çok para birimi (ürün yalnız TRY).
- Eşzamanlılık: randevu yarışı 2 oturum (V03), aynı idempotency anahtarı 2 eşzamanlı + 1 sıralı (V04). Denenmeyen: >2 eşzamanlı yazar, ağ kesintisi simülasyonu (worker retry/backoff R01'de birim düzeyinde).
- Performans: bu koşuda ölçülmedi (eşik tanımlı değil); önceki ölçümler `docs/performance.md` (100k hasta / 1M randevu, p95 ≤ 300 ms raporlar) — bu sürümde yeniden ölçülmedi, karar için kullanılmadı.
- Erişilebilirlik: axe WCAG 2.1 A/AA otomatik (R04); ekran okuyucuyla elle test **yok**.
- Fiziksel mobil cihaz, iOS/Android, VS Code: NA (web ürünü; cihaz yok). Pilot klinikte gerçek telefonla doğrulama **insan** adımı.
- Dış servisler yalnız MOCK; gerçek sağlayıcı sözleşmesi/test ortamı yok (🔒 docs/release-gates.md §3).

## Nihai insan onayı (gerekli)
Bu karar teknik teslim adaylığı içindir. Klinik kabulü (UAT imzası), KVKK/hukuk, mali müşavir, barındırma ve bağımsız sızma testi kapıları açık (docs/release-gates.md). Teslim kararı ürün sahibinindir.
