# Sürüm raporu — qa-20261102-1209-12fc6fd-tur7

**Karar: TESLİME ADAY** · Sürüm: `95ac8de552fc240f6ddc0abdc7624e3b2ba4cfd0` · 02.11.2026 14:59:18 · Tur 7
Kapı: `node qa/cezeri/gate.cjs qa-runs/qa-20261102-1209-12fc6fd/results.json qa-runs/qa-20261102-1209-12fc6fd/plan.json 95ac8de552fc240f6ddc0abdc7624e3b2ba4cfd0`

> Bu rapor yalnız **sentetik demo verisiyle, yerel test ortamında** çalıştırılan testleri kapsar. Gerçek klinik verisi, gerçek sağlayıcı (SMS/ödeme/e-Nabız/e-Fatura), fiziksel cihaz ve insan kabulü kapsam dışıdır. "Satışa hazır", "tam uyumlu", "Bakanlık onaylı" iddiası yoktur (bkz. docs/release-gates.md).

## Ortam
- Sürüm: `95ac8de552fc240f6ddc0abdc7624e3b2ba4cfd0` (main; ürün = fix6 `609dccc` + önceki düzeltmeler), push: origin/gelistirme-gecmisi
- Migration: 31 dosya (0001–0031; 0030 karantina görevi, 0031 hazırlık kuralı); temiz DB'ye hepsi uygulandı
- Zaman: 02.11.2026 14:51 (Europe/Istanbul); Node v22.22.0, pnpm 10.28.0, PostgreSQL 16.15, Chromium (Playwright 1.64)
- Ortam: yerel test; API :4000 (production), worker, web :3000 (next build + start); her koşu öncesi db:reset + migrate + seed
- Dış servisler yalnız MOCK; VIADENT_EXTERNAL_SEND_ENABLED=false; sentetik demo hesapları, parola yalnız ortam değişkeniyle
- Canlı demo (Vercel/Supabase) bu koşunun dışında: üretime gönderim yok

## Zorunlu vakalar (27)
| ID | Durum | Profil | Özet | Kanıt |
|---|---|---|---|---|
| V01 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 10 istek; B erişimleri reddedildi (404/403, önizleme yok); arama 0 sonuç; A kendi kaydını okudu · masaustu: B hasta sayfası sızıntı=false, arama satırı 0 · mobil: B hasta sayfası sızıntı=false, arama satırı 0 (tur 7, temiz seed) | `evidence/tur7/V01-http.json`, `evidence/tur7/masaustu-V01-b-tenant.jpg`, `evidence/tur7/mobil-V01-b-tenant.jpg` |
| V02 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | bulgu 201, tanı 201, işlem 201; diş 16 yüzeyler M,O; diğer diş/hasta değişmedi=true · masaustu: diş 16 görünür=true, işlem metni=true, düzeltme izi=true · mobil: diş 16 görünür=true, işlem metni=true, düzeltme izi=true (tur 7, temiz seed) | `evidence/tur7/V02-http.json`, `evidence/tur7/masaustu-V02-tedavi.jpg`, `evidence/tur7/mobil-V02-tedavi.jpg` |
| V03 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | eşzamanlı yanıtlar 201/409; 10:00'de 1 kayıt; ret kodu APPOINTMENT_CONFLICT · masaustu: 25.02.2027 10:00 ajandada randevu bloğu 1 (metin eşleşmesi 2); API: 1 · mobil: 25.02.2027 10:00 ajandada randevu bloğu 1 (metin eşleşmesi 1); API: 1 (tur 7, temiz seed) | `evidence/tur7/V03-http.json`, `evidence/tur7/masaustu-V03-ajanda.jpg`, `evidence/tur7/mobil-V03-ajanda.jpg` |
| V04 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | eşzamanlı 201/201, tekrar 201, tek ödeme=true, 300'lük ödeme sayısı 1, açık borç 1800.00→2500.00 (beklenen +700), replay başlığı 2/2, iade 201 (ters kayıt 201) · masaustu: 300,00 geçişi 7, açık borç 2800.00 görünür=true, iade izi=true · mobil: 300,00 geçişi 7, açık borç 2800.00 görünür=true, iade izi=true (tur 7, temiz seed) | `evidence/tur7/V04-http.json`, `evidence/tur7/masaustu-V04-finans.jpg`, `evidence/tur7/mobil-V04-finans.jpg` |
| V05 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | sekreter düzeltme 403, hekim düzeltme 200; eski=corrected yeni=completed; geçmişte 2 olay (aktör+zaman=true); sekreter geçmişinde klinik bulgu olayı: 0, finans: 0 · masaustu: hekim düzeltme izi=true; sekreter klinik bulgu olayı görüyor=false (API: 0 olay) · mobil: hekim düzeltme izi=true; sekreter klinik bulgu olayı görüyor=false (API: 0 olay) (tur 7, temiz seed) | `evidence/tur7/V05-http.json`, `evidence/tur7/masaustu-V05-gecmis-sekreter.jpg`, `evidence/tur7/mobil-V05-gecmis-sekreter.jpg` |
| V06 | ✅ PASS | cli | şifreli yedek → izole viadent_qa_restore7b; restore-verify ok=true, differences=[]; dosya 3/3; 25 sütunlu bağımsız mutabakat iki DB'de EŞLEŞTİ (90 politika, 76 FORCE RLS) | `evidence/tur7/V06-reconcile.txt`, `evidence/tur7/V06-restore-verify.json` |
| P01 | ✅ PASS | http | 14 değer; kabul: 0.01, 999.99, 1000.00 (=borç); kasa hareketi farkı 3; mutabık=true (tur 7, temiz seed) | `evidence/tur7/P01-http.json` |
| P02 | ✅ PASS | http | 28 deneme, 0 beklenmedik (tur 7, temiz seed) | `evidence/tur7/P02-http.json` |
| P03 | ✅ PASS | http | 8 kontrol, 0 beklenmedik (tur 7, temiz seed) | `evidence/tur7/P03-http.json` |
| R01 | ✅ PASS | cli | vitest API 35 dosya, 364/364 (gerçek PostgreSQL; QA-101…110 regresyon testleri dahil) | `evidence/tur7/R01-api.log` |
| R02 | ✅ PASS | cli | contracts 15/15 | `evidence/tur7/R02-contracts.log` |
| R03 | ✅ PASS | cli | web birim 72/72 (kontrast + QA-103/110 dahil) | `evidence/tur7/R03-web.log` |
| R04 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | Playwright tam koşu temiz seed: 89 geçti + 9 bilinçli atlama, 0 hata, retries=0 (iki proje) | `evidence/tur7/R04-R05-e2e-temiz-seed.log` |
| R05 | ✅ PASS | chromium-mobile-emulation | aynı koşu, telefon-360 projesi dahil | `evidence/tur7/R04-R05-e2e-temiz-seed.log` |
| R06 | ✅ PASS | cli | typecheck 5/5 Done; pnpm audit --prod: bilinen açık yok | `evidence/tur7/R06-typecheck-audit.log` |
| R07 | ✅ PASS | cli | 75/75 kiracı tablosu FORCE RLS, politikasız tablo yok; app rolü super/bypassrls/createrole=false; ekle-yalnız tablolarda UPDATE yok | `evidence/tur7/R07-rls.txt` |
| N01 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | TM ardışık 7,8,9,10,11; eşzamanlı 2 oturum 201/201 farklı no; replay aynı no; 422 numara tüketmedi=true; iade IM-2026-000002; yazdırma denetimi 1; asistan 403, B 404; değişmezlik=true · masaustu: listede TM-2026-000007; pencere no+uyarı=true; taşma 0 · mobil: listede TM-2026-000007; pencere no+uyarı=true; taşma 0 (tur 7, temiz seed) | `evidence/tur7/N01-http.json`, `evidence/tur7/masaustu-N01-makbuz-pencere.jpg`, `evidence/tur7/mobil-N01-makbuz-pencere.jpg` |
| N02 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 25 değer, beklenmedik 0; yuvarlama 0,60/0,10=true; Unicode ad korunur=true; roller sek 403/yön 403/B 404; sağlayıcısız gönder 409 numara=null; MOCK: issued MOCK20261AFF707D1 → iptal cancelled · masaustu: liste: MOCK rozeti=true, iptal=true, taslak 'numara yok'=true; ayrıntıda 'resmî belge değil'=true, TASLAK ibaresi yok=true; sekreter düğmesi 0; taşma 0 · mobil: liste: MOCK rozeti=true, iptal=true, taslak 'numara yok'=true; ayrıntıda 'resmî belge değil'=true, TASLAK ibaresi yok=true; sekreter düğmesi 0; taşma 0 (tur 7, temiz seed) | `evidence/tur7/N02-http.json`, `evidence/tur7/masaustu-N02-fatura.jpg`, `evidence/tur7/mobil-N02-fatura.jpg` |
| N03 | ✅ PASS | http | ekran 11 satır = CSV 11; XLSX 20 (başlık+veri+7 toplam+dipnot); tahsilat/iade satırlarının hepsinde makbuz no (11/11); sekreter 403 (tur 7, temiz seed) | `evidence/tur7/N03-http.json` |
| N04 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | taslak 201, ikinci taslak 409; geçersiz şablon 422/422/422/422; yayın yönetici 403 hekim 200; yayınlanan düzenleme API 409 DB kilit=true; eski kayıt outdated=true; eski anahtar 422; yeni etiket Kalp pili var mı?; sekreter 403; B bağımsız · masaustu: son kayıt kendi sorusuyla (Kalp pili)=true; yürürlük yerleşik set bildirimi=true · mobil: son kayıt kendi sorusuyla (Kalp pili)=true; yürürlük yerleşik set bildirimi=true (tur 7, temiz seed) | `evidence/tur7/N04-http.json`, `evidence/tur7/masaustu-N04-anamnez.jpg`, `evidence/tur7/mobil-N04-anamnez.jpg` |
| N05 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 3 tür hekim-only; sekreter önizleme 403; liste sızıntısı yok=true; ayrıntı sek 404 yön 404; geçmiş sızıntısı=false; komşu: print 404/404 karar 404/404 iptal 404/404 dosya 422/422 (gerçek/yok), durum issued, kanıt +0; KVKK yönetici dışa aktarımında klinik belge=false (hekim dışa aktarım 403); onam raporunda klinik satır=false; hekim iptal 200 · masaustu: Belgeler'de epikriz görünür=false; Geçmiş'te belge olayı görünür=false · mobil: Belgeler'de epikriz görünür=false; Geçmiş'te belge olayı görünür=false (tur 7, temiz seed) · hazırlık kuralı klinik çıktı türüyle 422 (QA-110) | `evidence/tur7/N05-http.json`, `evidence/tur7/masaustu-N05-sekreter-gecmis.jpg`, `evidence/tur7/mobil-N05-sekreter-gecmis.jpg`, `evidence/tur7/N05-komsu.json`, `evidence/tur7/readiness-clinical-probe.json` |
| N06 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | geçersiz 7 değer 422/422/422/422/422/422/422; geçerli 200; yeni oturumda gelir; sekreter etkilenmez; kimliksiz 401; CSRF başlıksız 403 · masaustu: uygulandı {"scheme":"dark","accent":"lacivert","scale":"4","root":"17px"}; axe ciddi/kritik []; yenilemede dark/lacivert; varsayılan yesil/16px; taşma 0 · mobil: uygulandı {"scheme":"dark","accent":"lacivert","scale":"4","root":"17px"}; axe ciddi/kritik []; yenilemede dark/lacivert; varsayılan yesil/16px; taşma 0 (tur 7, temiz seed) | `evidence/tur7/N06-http.json`, `evidence/tur7/masaustu-N06-koyu-panel.jpg`, `evidence/tur7/mobil-N06-koyu-panel.jpg` |
| N07 | ✅ PASS | http | sınır 0/169/2,5 → 422/422/422; hekim 403; eşik 2 sa: 1 sa geçmiş yükseltilmedi, 3 sa geçmiş → yönetici (rol korunur, kopya 1); yönetici görevi kendine yükseltilmedi (tur 7, temiz seed) | `evidence/tur7/N07-http.json` |
| N08 | ✅ PASS | http | nakit-hareketleri: 23 satır, formül 0, para hücresi 20; borc-bakiye: 9 satır, formül 0, para hücresi 24; tedavi: 7 satır, formül 0, para hücresi 3; bilinmeyen biçim → CSV; sekreter 403 (tur 7, temiz seed) | `evidence/tur7/N08-http.json` |
| N09 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | masaustu: stok satırı display=table-row (beklenen table-row), etiket Kalem, Sayım açıldı=true; taşma stok 0 rapor 0; ham kod=false; Excel=true · mobil: stok satırı display=grid (beklenen grid), etiket Kalem, Sayım açıldı=true; taşma stok 0 rapor 0; ham kod=false; Excel=true (tur 7, temiz seed) | `evidence/tur7/masaustu-N09-stok.jpg`, `evidence/tur7/mobil-N09-stok.jpg` |
| N10 | ✅ PASS | http | hekim 403, tekrar 422, 0 adet 422, sahte kalem 422, B 404; işlem: eldiven 4→3, kartuş 30→28 (lot seçili); düzeltme sarfı tekrarlamadı=true; yetersiz stok: işlem 201, {"used":1,"shortages":1}, görev 1 (tur 7, temiz seed) | `evidence/tur7/N10-http.json` |
| N11 | ✅ PASS | http | dışa aktarım: klinik dosya yok, idari var, omitted files:clinical; geçmiş: sekreter 0, yönetici 0, hekim 1 olay; access_log dosya satırı 0; onam kanıtında gizli dosya kimliği sekreter=false, dışa aktarım=false, hekim bağlama 200; karantina görevi sekreter=false, yönetici=false, hekim=true; epikrize bağlı tarama sekreter listede=false, ayrıntı 404/404, içerik 404/404, silme 403/403, hekim 200 (tur 7, temiz seed) | `evidence/tur7/file-sensitivity-probe.json`, `evidence/tur7/file-trace-probe.json`, `evidence/tur7/evidence-file-probe.json`, `evidence/tur7/quarantine-task-probe.json`, `evidence/tur7/linked-file-probe.json` |

## Profiller
| Profil | Durum | Kanıt / gerekçe |
|---|---|---|
| http | ✅ PASS | `evidence/tur7/n-summary.json` |
| chromium-desktop | ✅ PASS | `evidence/tur7/browser-n-summary.json` |
| chromium-mobile-emulation | ✅ PASS | `evidence/tur7/browser-n-summary.json` |
| cli | ✅ PASS | `evidence/tur7/V06-reconcile.txt` |
| physical-mobile-device | — NA | Web ürünü; fiziksel cihaz bu ortamda yok. Pilot klinikte gerçek telefonla doğrulama insan adımı. |
| android-apk | — NA | Ürün APK üretmiyor (web/PWA). |
| ios | — NA | iOS test ortamı yok; ürün web. |
| vscode-extension | — NA | Ürün VS Code uzantısı değil. |

## Bulgular
| ID | Önem | Durum | Başlık | Kanıt | Yeniden test |
|---|---|---|---|---|---|
| QA-101 | S1 | VERIFIED | Klinik çıktı belgesi yazma uçlarında sağlık kapısı yok | `evidence/tur2b/N05-komsu.json` | `evidence/tur7/N05-komsu.json` |
| QA-102 | S2 | VERIFIED | Hasta geçmişinde klinik çıktı belgesi olayları | `evidence/tur2/N05-kesin-eslesme.json` | `evidence/tur7/N05-komsu.json` |
| QA-103 | S3 | VERIFIED | Düzenlenmiş/iptal faturada taslak uyarıları | `evidence/tur2b/masaustu-N02-fatura-ayrinti.jpg` | `evidence/tur7/masaustu-N02-fatura-ayrinti.jpg` |
| QA-104 | S1 | VERIFIED | KVKK hasta dışa aktarımında sağlık yetkisi olmayan yönetici klinik çıktı belgelerinin içeriğini ve bağlı kanıt/onay/dosya satırlarını alıyor | `evidence/tur3/N05-komsu.json` | `evidence/tur7/N05-komsu.json` |
| QA-105 | S2 | VERIFIED | Onam/belge raporu klinik çıktı belgelerini sağlık yetkisi olmayan role listeliyor | `evidence/tur3/N05-komsu.json` | `evidence/tur7/N05-komsu.json` |
| QA-106 | S2 | VERIFIED | Hasta dışa aktarımında sağlık yetkisi olmayan yönetici klinik hassasiyetli dosya metaverisini alıyor | `evidence/tur3/file-sensitivity-probe.json` | `evidence/tur7/file-sensitivity-probe.json` |
| QA-107 | S3 | VERIFIED | Klinik çıktı belgesine bağlı idari dosya sekretere görünüyor ve belge kimliğini veriyor | `evidence/tur3/linked-file-probe.json` | `evidence/tur7/linked-file-probe.json` |
| QA-108 | S3 | VERIFIED | Gizli klinik dosyanın izleri (geçmiş, access_log, onam kanıtı fileId) | `evidence/tur4/file-trace-probe.json` | `evidence/tur7/file-trace-probe.json` |
| QA-109 | S3 | VERIFIED | Karantina görevi gizli klinik dosyayı açık ediyor | `evidence/tur5/quarantine-task-probe.json` | `evidence/tur7/quarantine-task-probe.json` |
| QA-110 | S3 | VERIFIED | Hazırlık kuralı klinik çıktı türüne bağlanabiliyor | `evidence/tur6/readiness-clinical-probe.json` | `evidence/tur7/readiness-clinical-probe.json` |

## Turlar
- **Tur 1** (`12fc6fd`): 25 PASS / 1 FAIL / 0 FLAKY / 0 NOT_RUN · açık bulgu: QA-101(S1), QA-102(S2), QA-103(S3)
- **Tur 2** (`08438cf`): 17 PASS / 1 FAIL / 0 FLAKY / 8 NOT_RUN · açık bulgu: QA-104(S1), QA-105(S2)
- **Tur 3** (`bb49098`): 16 PASS / 2 FAIL / 0 FLAKY / 9 NOT_RUN · açık bulgu: QA-106(S2), QA-107(S3)
- **Tur 4–6** (`49a151b`, `fe98345`, `eb1c1f3`): kısmi yeniden sınama (HTTP + N + tester sondaları); her turda önceki bulgu VERIFIED, yeni bulgu QA-108, QA-109, QA-110 (S3) açıldı — ayrıntı `bugs.md`, kanıt `evidence/tur4…tur6`.
- **Tur 7** (`95ac8de`): 27 PASS / 0 FAIL / 0 FLAKY / 0 NOT_RUN · açık bulgu: yok

## Kapsam, denenmeyen kombinasyonlar, engeller
- Envanter: `inventory.md` (32 controller / 229 uç, 6 rol, 2 tenant). Rol × ekran kombinasyonlarının tamamı değil, risk temelli seçim: tenant sınırı (V01), sağlık yetkisi sınırı (V05, N05, N11, P03), finans yazma sınırı (P01, P03, N01–N03). Diğer rol × uç kombinasyonları API test paketinde (R01).
- Yeni kapsam (N01–N11): makbuz, fatura taslağı + MOCK e-belge, mali müşavir dökümü, anamnez şablonu, klinik çıktı belgeleri ve komşu yüzeyleri (dışa aktarım, onam raporu, dosyalar, geçmiş, kanıt, karantina görevi, hazırlık kuralı), görünüm, SLA yükseltme, XLSX, mobil kart, sarf reçetesi. Tester sondaları: `qa-runs/.scripts/*-probe.mjs`.
- Parametre kapsamı: tahsilat tutarı 14 değer + dağıtım/anahtar kuralları (P01); randevu 28 deneme — tarih/saat/süre sınırları, 8 durum geçişi, iyimser kilit, 7 filtre (P02). Denenmeyen: Unicode normalizasyon uç durumları form alanlarında (ad/soyad Türkçe İ/ı aramaları R01'de var), çok para birimi (ürün yalnız TRY).
- Eşzamanlılık: randevu yarışı 2 oturum (V03), aynı idempotency anahtarı 2 eşzamanlı + 1 sıralı (V04). Denenmeyen: >2 eşzamanlı yazar, ağ kesintisi simülasyonu (worker retry/backoff R01'de birim düzeyinde).
- Performans: bu koşuda ölçülmedi (eşik tanımlı değil); önceki ölçümler `docs/performance.md` (100k hasta / 1M randevu, p95 ≤ 300 ms raporlar) — bu sürümde yeniden ölçülmedi, karar için kullanılmadı.
- Erişilebilirlik: axe WCAG 2.1 A/AA otomatik (R04); ekran okuyucuyla elle test **yok**.
- Fiziksel mobil cihaz, iOS/Android, VS Code: NA (web ürünü; cihaz yok). Pilot klinikte gerçek telefonla doğrulama **insan** adımı.
- Dış servisler yalnız MOCK; gerçek sağlayıcı sözleşmesi/test ortamı yok (🔒 docs/release-gates.md §3).

## Nihai insan onayı (gerekli)
Bu karar teknik teslim adaylığı içindir. Klinik kabulü (UAT imzası), KVKK/hukuk, mali müşavir, barındırma ve bağımsız sızma testi kapıları açık (docs/release-gates.md). Teslim kararı ürün sahibinindir.
