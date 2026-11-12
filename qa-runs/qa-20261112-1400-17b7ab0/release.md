# Sürüm raporu — qa-20261112-1400-17b7ab0-tur1

**Karar: TESLİME ADAY** · Sürüm: `8c11e52de6d3d2c14356d87aed5be6a3bd0064d7` · 12.11.2026 14:09:18 · Tur 1
Kapı: `node qa/cezeri/gate.cjs qa-20261112-1400-17b7ab0/results.json qa-20261112-1400-17b7ab0/plan.json 8c11e52de6d3d2c14356d87aed5be6a3bd0064d7`

> Bu rapor yalnız **sentetik demo verisiyle, yerel test ortamında** çalıştırılan testleri kapsar. Gerçek klinik verisi, gerçek sağlayıcı (SMS/ödeme/e-Nabız/e-Fatura), fiziksel cihaz ve insan kabulü kapsam dışıdır. "Satışa hazır", "tam uyumlu", "Bakanlık onaylı" iddiası yoktur (bkz. docs/release-gates.md).

## Ortam
- Ürün revizyonu (kilit): `17b7ab0e54d6bb9153521f19548be3d2b111a7bd` (gelistirme-gecmisi). Değişiklik: apps/web/components/appointment/new-appointment-page.tsx (ödeme planı) + testler. Önceki TESLİME ADAY: db5c4ff (canlı).
- Yerel test ortamı: PostgreSQL 16 (FORCE RLS), API :4000, worker, web :3000 (üretim derlemesi), her turda temiz seed (0001–0041). Tur betiği derler ve yeniden başlatır (evidence/<tur>/stack-version.txt).
- Dış servisler yalnız DENEME; gerçek mesaj/ödeme yok. Kimlik bilgileri .demo-credentials'tan ortam değişkeniyle; kayda yazılmaz.
- Node v22, pnpm 10, Chromium (Playwright). Fiziksel telefon yok: 360 px emülasyon.

## Zorunlu vakalar (87)
| ID | Durum | Profil | Özet | Kanıt |
|---|---|---|---|---|
| V01 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 10 istek; B erişimleri reddedildi (404/403, önizleme yok); arama 0 sonuç; A kendi kaydını okudu · masaustu: B hasta sayfası sızıntı=false, arama satırı 0 · mobil: B hasta sayfası sızıntı=false, arama satırı 0 (tur1, temiz seed, 8c11e52) | `evidence/tur1/V01-http.json`, `evidence/tur1/masaustu-V01-b-tenant.jpg`, `evidence/tur1/mobil-V01-b-tenant.jpg` |
| V02 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | bulgu 201, tanı 201, işlem 201; diş 16 yüzeyler M,O; diğer diş/hasta değişmedi=true · masaustu: diş 16 görünür=true, işlem metni=true, düzeltme izi=true · mobil: diş 16 görünür=true, işlem metni=true, düzeltme izi=true (tur1, temiz seed, 8c11e52) | `evidence/tur1/V02-http.json`, `evidence/tur1/masaustu-V02-tedavi.jpg`, `evidence/tur1/mobil-V02-tedavi.jpg` |
| V03 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | eşzamanlı yanıtlar 201/409; 14:00'de 1 kayıt; ret kodu APPOINTMENT_CONFLICT · masaustu: 07.01.2027 14:00 ajandada randevu bloğu 1 (metin eşleşmesi 2); API: 1 · mobil: 07.01.2027 14:00 ajandada randevu bloğu 1 (metin eşleşmesi 1); API: 1 (tur1, temiz seed, 8c11e52) | `evidence/tur1/V03-http.json`, `evidence/tur1/masaustu-V03-ajanda.jpg`, `evidence/tur1/mobil-V03-ajanda.jpg` |
| V04 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | eşzamanlı 201/201, tekrar 201, tek ödeme=true, 300'lük ödeme sayısı 1, açık borç 1800.00→2500.00 (beklenen +700), replay başlığı 2/2, iade 201 (ters kayıt 201) · masaustu: 300,00 geçişi 7, açık borç 2800.00 görünür=true, iade izi=true · mobil: 300,00 geçişi 7, açık borç 2800.00 görünür=true, iade izi=true (tur1, temiz seed, 8c11e52) | `evidence/tur1/V04-http.json`, `evidence/tur1/masaustu-V04-finans.jpg`, `evidence/tur1/mobil-V04-finans.jpg` |
| V05 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | sekreter düzeltme 403, hekim düzeltme 200; eski=corrected yeni=completed; geçmişte 2 olay (aktör+zaman=true); sekreter geçmişinde klinik bulgu olayı: 0, finans: 0 · masaustu: hekim düzeltme izi=true; sekreter klinik bulgu olayı görüyor=false (API: 0 olay) · mobil: hekim düzeltme izi=true; sekreter klinik bulgu olayı görüyor=false (API: 0 olay) (tur1, temiz seed, 8c11e52) | `evidence/tur1/V05-http.json`, `evidence/tur1/masaustu-V05-gecmis-sekreter.jpg`, `evidence/tur1/mobil-V05-gecmis-sekreter.jpg` |
| V06 | ✅ PASS | cli | şifreli yedek → izole viadent_qa_restore_tur1; restore-verify ok=true, differences=[0]; dosya 5/5; bağımsız mutabakat (reconcile.sql) iki DB'de EŞLEŞTİ | `evidence/tur1/V06-reconcile.txt`, `evidence/tur1/V06-restore-verify.json` |
| P01 | ✅ PASS | http | 14 değer; kabul: 0.01, 999.99, 1000.00 (=borç); kasa hareketi farkı 3; mutabık=true (tur1, temiz seed, 8c11e52) | `evidence/tur1/P01-http.json` |
| P02 | ✅ PASS | http | 28 deneme, 0 beklenmedik (tur1, temiz seed, 8c11e52) | `evidence/tur1/P02-http.json` |
| P03 | ✅ PASS | http | 8 kontrol, 0 beklenmedik (tur1, temiz seed, 8c11e52) | `evidence/tur1/P03-http.json` |
| R01 | ✅ PASS | cli | vitest API 438/438 (gerçek PostgreSQL; geri-bildirim-0711b, adr-098-admin, geri-bildirim-0711, randevu-0711, messaging-0711 dahil) | `evidence/tur1/R01-api.log` |
| R02 | ✅ PASS | cli | contracts 21/21 (telefon hane kuralı dahil) | `evidence/tur1/R02-contracts.log` |
| R03 | ✅ PASS | cli | web birim 128/128 | `evidence/tur1/R03-web.log` |
| R04 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | Playwright tam koşu temiz seed: 132 geçti + 10 bilinçli atlama, 0 hata, retries=0 (iki proje; geri-bildirim-0711, odontogram-0711, goruntuleme-0711 dahil) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| R05 | ✅ PASS | chromium-mobile-emulation | aynı koşu, telefon-360 projesi dahil | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| R06 | ✅ PASS | cli | typecheck 5/5 Done; pnpm audit --prod: bilinen açık yok | `evidence/tur1/R06-typecheck-audit.log` |
| R07 | ✅ PASS | cli | 86 kiracı tablosunun hepsi FORCE RLS, politikasız tablo yok; 0035–0036 tabloları (patient_health_notes, message_schedules, message_rules, message_rule_runs) FORCE RLS, uygulama rolünde DELETE yok; app rolü super/bypassrls/createrole=false | `evidence/tur1/R07-rls.txt` |
| N01 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | TM ardışık 7,8,9,10,11; eşzamanlı 2 oturum 201/201 farklı no; replay aynı no; 422 numara tüketmedi=true; iade IM-2026-000002; yazdırma denetimi 1; asistan 403, B 404; değişmezlik=true · masaustu: listede TM-2026-000007; pencere no+uyarı=true; taşma 0 · mobil: listede TM-2026-000007; pencere no+uyarı=true; taşma 0 (tur1, temiz seed, 8c11e52) | `evidence/tur1/N01-http.json`, `evidence/tur1/masaustu-N01-makbuz-pencere.jpg`, `evidence/tur1/mobil-N01-makbuz-pencere.jpg` |
| N02 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 25 değer, beklenmedik 0; yuvarlama 0,60/0,10=true; Unicode ad korunur=true; roller sek 403/yön 201/B 404; sağlayıcısız gönder 409 numara=null; MOCK: issued MOCK202635CB5AAF5 → iptal cancelled · masaustu: liste: DENEME rozeti=true, iptal=true, taslak 'numara yok'=true; ayrıntıda 'resmî belge değil'=true, TASLAK ibaresi yok=true; sekreter düğmesi 0; taşma 0 · mobil: liste: DENEME rozeti=true, iptal=true, taslak 'numara yok'=true; ayrıntıda 'resmî belge değil'=true, TASLAK ibaresi yok=true; sekreter düğmesi 0; taşma 0 (tur1, temiz seed, 8c11e52) | `evidence/tur1/N02-http.json`, `evidence/tur1/masaustu-N02-fatura.jpg`, `evidence/tur1/mobil-N02-fatura.jpg` |
| N03 | ✅ PASS | http | ekran 11 satır = CSV 11; XLSX 21 (başlık+veri+8 toplam+dipnot); tahsilat/iade satırlarının hepsinde makbuz no (11/11); sekreter 403 (tur1, temiz seed, 8c11e52) | `evidence/tur1/N03-http.json` |
| N04 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | taslak 201, ikinci taslak 409; geçersiz şablon 422/422/422/422; yayın sekreter 403 hekim 200; yayınlanan düzenleme API 409 DB kilit=true; eski kayıt outdated=true; eski anahtar 422; yeni etiket Kalp pili var mı?; sekreter 403; B bağımsız · masaustu: Sağlık özeti kartı=true; eski anamnez paneli yok=true · mobil: Sağlık özeti kartı=true; eski anamnez paneli yok=true (tur1, temiz seed, 8c11e52) | `evidence/tur1/N04-http.json`, `evidence/tur1/masaustu-N04-anamnez.jpg`, `evidence/tur1/mobil-N04-anamnez.jpg` |
| N05 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 3 tür hekim-only; sekreter önizleme 403; sekreter listede görmez=true, yönetici görür (ADR-098)=true; ayrıntı sek 404 yön 200; geçmiş sızıntısı=false; komşu: print 404/404 karar 404/404 iptal 404/404 dosya 422/422 (gerçek/yok), durum issued, kanıt +0; KVKK yönetici (sağlık yetkili) dışa aktarımında klinik belge=true (hekim dışa aktarım 403); onam raporunda klinik satır=false; hekim iptal 200 · masaustu: Belgeler'de epikriz görünür=false; Geçmiş'te belge olayı görünür=false · mobil: Belgeler'de epikriz görünür=false; Geçmiş'te belge olayı görünür=false (tur1, temiz seed, 8c11e52) · hazırlık kuralı klinik çıktı türüyle 422 | `evidence/tur1/N05-http.json`, `evidence/tur1/masaustu-N05-sekreter-gecmis.jpg`, `evidence/tur1/mobil-N05-sekreter-gecmis.jpg`, `evidence/tur1/N05-komsu.json`, `evidence/tur1/readiness-clinical-probe.json` |
| N06 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | geçersiz 7 değer 422/422/422/422/422/422/422; geçerli 200; yeni oturumda gelir; sekreter etkilenmez; kimliksiz 401; CSRF başlıksız 403 · masaustu: uygulandı {"scheme":"dark","accent":"lacivert","scale":"4","root":"17px"}; axe ciddi/kritik []; yenilemede dark/lacivert; varsayılan mavi/16px; taşma 0 · mobil: uygulandı {"scheme":"dark","accent":"lacivert","scale":"4","root":"17px"}; axe ciddi/kritik []; yenilemede dark/lacivert; varsayılan mavi/16px; taşma 0 (tur1, temiz seed, 8c11e52) | `evidence/tur1/N06-http.json`, `evidence/tur1/masaustu-N06-koyu-panel.jpg`, `evidence/tur1/mobil-N06-koyu-panel.jpg` |
| N07 | ✅ PASS | http | sınır 0/169/2,5 → 422/422/422; hekim 403; eşik 2 sa: 1 sa geçmiş yükseltilmedi, 3 sa geçmiş → yönetici (rol korunur, kopya 1); yönetici görevi kendine yükseltilmedi (tur1, temiz seed, 8c11e52) | `evidence/tur1/N07-http.json` |
| N08 | ✅ PASS | http | nakit-hareketleri: 24 satır, formül 0, para hücresi 21; borc-bakiye: 9 satır, formül 0, para hücresi 24; tedavi: 7 satır, formül 0, para hücresi 3; bilinmeyen biçim → CSV; sekreter 403 (tur1, temiz seed, 8c11e52) | `evidence/tur1/N08-http.json` |
| N09 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | masaustu: stok satırı display=table-row (beklenen table-row), etiket Kalem, Sayım açıldı=true; taşma stok 0 rapor 0; ham kod=false; Excel=true · mobil: stok satırı display=grid (beklenen grid), etiket Kalem, Sayım açıldı=true; taşma stok 0 rapor 0; ham kod=false; Excel=true (tur1, temiz seed, 8c11e52) | `evidence/tur1/masaustu-N09-stok.jpg`, `evidence/tur1/mobil-N09-stok.jpg` |
| N10 | ✅ PASS | http | hekim 403, tekrar 422, 0 adet 422, sahte kalem 422, B 404; işlem: eldiven 4→3, kartuş 30→28 (lot seçili); düzeltme sarfı tekrarlamadı=true; yetersiz stok: işlem 201, {"used":1,"shortages":1}, görev 1 (tur1, temiz seed, 8c11e52) | `evidence/tur1/N10-http.json` |
| N11 | ✅ PASS | http | yönetici (sağlık yetkili, ADR-098) listede ve dışa aktarımda klinik dosyayı görür=true/true; geçmiş olay sekreter 0, yönetici 1, hekim 1; access_log dosya satırı 1; onam kanıtı gizli dosya kimliği sekreter=false, dışa aktarım=true; karantina görevi sekreter=false, yönetici=true, hekim=true; epikrize bağlı tarama sekreter 404/404 (tur1) | `evidence/tur1/file-sensitivity-probe.json`, `evidence/tur1/file-trace-probe.json`, `evidence/tur1/evidence-file-probe.json`, `evidence/tur1/quarantine-task-probe.json`, `evidence/tur1/linked-file-probe.json` |
| F01 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 16/16 kontrol: hepsi geçti · masaustu: geçmiş dilim 88 (düğme 0), tıklayınca form açıldı=false; tarih alanına 01.01.2026 → değer "01.01.2026", uyarı 1 · mobil: geçmiş dilim -1 (düğme 0), tıklayınca form açıldı=false; tarih alanına 01.01.2026 → değer "01.01.2026", uyarı 1 (tur1, temiz seed, 8c11e52) | `evidence/tur1/F01-http.json`, `evidence/tur1/masaustu-F01-ajanda.jpg`, `evidence/tur1/mobil-F01-ajanda.jpg` |
| F02 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 4/4 kontrol (API); UI tarafı tarayıcı vakasında · masaustu: Geçmiş başlığında 'Sonuç bekliyor' 1, Yaklaşan'da 0, yaklaşan satır 1, Geldi düğmesi 1 · mobil: Geçmiş başlığında 'Sonuç bekliyor' 1, Yaklaşan'da 0, yaklaşan satır 1, Geldi düğmesi 1, Geldi sonrası rozet 0 (tur1, temiz seed, 8c11e52) | `evidence/tur1/F02-http.json`, `evidence/tur1/masaustu-F02-kart.jpg`, `evidence/tur1/mobil-F02-kart.jpg` |
| F03 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 26/26 kontrol: hepsi geçti · masaustu: listede maske false; kartta tam telefon true; giriş 0'lı 11 hane, 0'sız 10 hane, yurt dışı 17 rakam · mobil: listede maske false; kartta tam telefon true; giriş 0'lı 11 hane, 0'sız 10 hane, yurt dışı 17 rakam (tur1, temiz seed, 8c11e52) | `evidence/tur1/F03-http.json`, `evidence/tur1/masaustu-F03-telefon.jpg`, `evidence/tur1/mobil-F03-telefon.jpg` |
| F04 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | masaustu: hücre tıklaması karta gitti true; sürükle-seç sayfada kaldı true; klavye Enter true · mobil: hücre tıklaması karta gitti true; sürükle-seç sayfada kaldı true; klavye Enter true (tur1, temiz seed, 8c11e52) | `evidence/tur1/masaustu-F04-satir.jpg`, `evidence/tur1/mobil-F04-satir.jpg` |
| F05 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 3/3 kontrol (API); UI işaretleri tarayıcı vakasında · masaustu: hekim: işlem yapılan diş(ler) 16, ayrıntı: Diş 16 · büyük azı Çekildi Yapılan işlemler CEK-01 Diş çekimi (basit) · 12.11.2026 · Dt. Elif Aras · masaustu: sekreter (sağlık yetkisi yok) kartta odontogram 0 · mobil: hekim: işlem yapılan diş(ler) 16, ayrıntı: Diş 16 · büyük azı Çekildi Yapılan işlemler CEK-01 Diş çekimi (basit) · 12.11.2026 · Dt. Elif Aras · mobil: sekreter (sağlık yetkisi yok) kartta odontogram 0 (tur1, temiz seed, 8c11e52) | `evidence/tur1/F05-http.json`, `evidence/tur1/masaustu-F05-dis.jpg`, `evidence/tur1/masaustu-F05-sekreter.jpg`, `evidence/tur1/mobil-F05-dis.jpg`, `evidence/tur1/mobil-F05-sekreter.jpg` |
| F06 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 8/8 kontrol (API/DB); menü ve ekran tarayıcı vakasında · masaustu: menü [Panel, İş akışı, Hastalar, Randevular, Hekimler, Tedavi, Finans, Laboratuvar, Operasyon, Raporlar, Mesajlar, Yönetim], başlık "Panel · PİA-DENT", KPI randevu 9=9, tahsilat 3.580,00 ₺ / API 3580.00, açık 36.150,00 ₺ / API 36150.00, tablo satırı 30, taşma 0 · masaustu: sekreter Panel: para kartı 0, Aylık gelir grafiği 0 · mobil: menü [Panel, İş akışı, Hastalar, Randevular, Hekimler, Tedavi, Finans, Laboratuvar, Operasyon, Raporlar, Mesajlar, Yönetim], başlık "Panel · PİA-DENT", KPI randevu 9=9, tahsilat 3.580,00 ₺ / API 3580.00, açık 36.150,00 ₺ / API 36150.00, tablo satırı 30, taşma 0 · mobil: sekreter Panel: para kartı 0, Aylık gelir grafiği 0 (tur1, temiz seed, 8c11e52) | `evidence/tur1/F06-http.json`, `evidence/tur1/masaustu-F06-panel.jpg`, `evidence/tur1/masaustu-F06-sekreter.jpg`, `evidence/tur1/mobil-F06-panel.jpg`, `evidence/tur1/mobil-F06-sekreter.jpg` |
| F07 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 48 rapor çalıştırması, 0 hata; menü dönüşü/varsayılan aralık tarayıcı vakasında · masaustu: 13 rapor açıldı, hata 0; varsayılan aralık 30 gün; menüden dönüş kart sayısı 13 · mobil: 13 rapor açıldı, hata 0; varsayılan aralık 30 gün; menüden dönüş kart sayısı 13 (tur1, temiz seed, 8c11e52) | `evidence/tur1/F07-http.json`, `evidence/tur1/masaustu-F07-raporlar.jpg`, `evidence/tur1/mobil-F07-raporlar.jpg` |
| F08 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 33/33 kontrol: hepsi geçti · masaustu: ekranda bu ay kalan 24.000,00 ₺ = API 24000.00; UI ile 1.000 ödeme sonrası API ödenen 7000.00; taşma 0 · mobil: ekranda bu ay kalan 23.000,00 ₺ = API 23000.00; UI ile 1.000 ödeme sonrası API ödenen atlandı; taşma 0 (tur1, temiz seed, 8c11e52) | `evidence/tur1/F08-http.json`, `evidence/tur1/masaustu-F08-hekim.jpg`, `evidence/tur1/mobil-F08-hekim.jpg` |
| F09 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 16/16 kontrol: hepsi geçti · masaustu: ekranda birim maliyet 100,00 ₺ = API 100.00; 'Fiyat tanımsız' 3; uyarı 1; Fiyat ekle penceresi açıldı; taşma 0 · mobil: ekranda birim maliyet 100,00 ₺ = API 100.00; 'Fiyat tanımsız' 3; uyarı 1; Fiyat ekle penceresi açıldı; taşma 0 (tur1, temiz seed, 8c11e52) | `evidence/tur1/F09-http.json`, `evidence/tur1/masaustu-F09-urunler.jpg`, `evidence/tur1/mobil-F09-urunler.jpg` |
| F10 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 17/17 kontrol: hepsi geçti · masaustu: ekranda gider 0,00 ₺ = API 0.00; satır 3=3; UI ile ekleme sonrası satır 4 · mobil: ekranda gider 45,00 ₺ = API 45.00; satır 4=4; UI ile ekleme sonrası satır atlandı (tur1, temiz seed, 8c11e52) | `evidence/tur1/F10-http.json`, `evidence/tur1/masaustu-F10-malzeme.jpg`, `evidence/tur1/mobil-F10-malzeme.jpg` |
| F11 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | masaustu: 13/13 adım; başarısız: yok; yerel pencere 0 · mobil: 11/11 adım; başarısız: yok; yerel pencere 0 (tur1, temiz seed, 8c11e52) | `evidence/tur1/masaustu-F11-kapatma.jpg`, `evidence/tur1/mobil-F11-kapatma.jpg` |
| F12 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 8/8 kontrol: hepsi geçti · masaustu: tek işlem seçimi (eski iki alan 0); işlem seçenekleri 56; TEM-01 fiyatı 1.200,00 ₺ görünür=true; şerit: İşlem fiyatı 1.200,00 ₺ Mevcut açık borç 3.600,00 ₺ Avans 0,00 ₺ İşlem sonrası toplam borç 4.800,00 ₺ · mobil: tek işlem seçimi (eski iki alan 0); işlem seçenekleri 56; TEM-01 fiyatı 1.200,00 ₺ görünür=true; şerit: İşlem fiyatı 1.200,00 ₺ Mevcut açık borç 3.600,00 ₺ Avans 0,00 ₺ İşlem sonrası toplam borç 4.800,00 ₺ (tur1, temiz seed, 8c11e52) | `evidence/tur1/F12-http.json`, `evidence/tur1/masaustu-F12-form.jpg`, `evidence/tur1/mobil-F12-form.jpg` |
| G01 | ✅ PASS | http | 6/6 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G01-http.json` |
| G02 | ✅ PASS | http | 5/5 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G02-http.json` |
| G03 | ✅ PASS | http | 4/4 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G03-http.json` |
| G04 | ✅ PASS | http | 13/13 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G04-http.json` |
| G05 | ✅ PASS | http | 6/6 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G05-http.json` |
| G06 | ✅ PASS | http | 6/6 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G06-http.json` |
| G07 | ✅ PASS | http | 3/3 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G07-http.json` |
| G08 | ✅ PASS | http | 6/6 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G08-http.json` |
| G09 | ✅ PASS | http | 8/8 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G09-http.json` |
| G10 | ✅ PASS | http | 3/3 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G10-http.json` |
| G11 | ✅ PASS | http | 3/3 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G11-http.json` |
| G12 | ✅ PASS | http | 10/10 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G12-http.json` |
| G13 | ✅ PASS | http | 5/5 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G13-http.json` |
| G14 | ✅ PASS | http | 11/11 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G14-http.json` |
| G15 | ✅ PASS | http | 2/2 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/G15-http.json` |
| B01 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | geri-bildirim-0711 E2E: masaüstü geçti, telefon-360 geçti | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| B02 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | geri-bildirim-0711 E2E: masaüstü geçti, telefon-360 geçti | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| B03 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | geri-bildirim-0711 E2E: masaüstü geçti, telefon-360 geçti | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| B04 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | geri-bildirim-0711 E2E: masaüstü geçti, telefon-360 geçti | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| B05 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | geri-bildirim-0711 E2E: masaüstü geçti, telefon-360 geçti | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| B06 | ✅ PASS | chromium-desktop | geri-bildirim-0711 E2E: masaüstü geçti (indirme yalnız masaüstünde sınanır; telefonda bilinçli atlama) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| H01 | ✅ PASS | http | 9/9 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/H01-http.json` |
| H02 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | odontogram-0711.spec.ts E2E: masaüstü geçti, telefon-360 geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| H03 | ✅ PASS | http | 7/7 kontrol (39 şablon önizlendi): hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/H03-http.json` |
| H04 | ✅ PASS | http | 4/4 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/H04-http.json` |
| H05 | ✅ PASS | http | 24/24 kontrol (doğrulama: gelecek tarih=422, tür–kategori uyuşmazlığı=422, geçersiz diş=422, tekrarlı diş=422, DICOM fotoğraf=422, DICOM belge taraması=422, türsüz meta=422, uzun not=422, 21 MB=422, desteklenmeyen tür=422): hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/H05-http.json` |
| H06 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | goruntuleme-0711.spec.ts E2E: masaüstü geçti, telefon-360 geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| H07 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | goruntuleme-0711.spec.ts E2E: masaüstü geçti, telefon-360 geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| H08 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | odontogram-0711.spec.ts E2E: masaüstü geçti, telefon-360 geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| H09 | ✅ PASS | http | 11/11 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/H09-http.json` |
| H10 | ✅ PASS | http | 5/5 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/H10-http.json` |
| I01 | ✅ PASS | http | 4/4 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/I01-http.json` |
| I02 | ✅ PASS | http | 12/12 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/I02-http.json` |
| I03 | ✅ PASS | http | 9/9 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/I03-http.json` |
| I04 | ✅ PASS | http | 5/5 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/I04-http.json` |
| I05 | ✅ PASS | http | 8/8 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/I05-http.json` |
| I06 | ✅ PASS | http | 5/5 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/I06-http.json` |
| I07 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | geri-bildirim-0811.spec.ts E2E: masaüstü geçti, telefon-360 geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| I08 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | geri-bildirim-0811.spec.ts E2E: masaüstü geçti, telefon-360 geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| I09 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | geri-bildirim-0811.spec.ts E2E: masaüstü geçti, telefon-360 geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| J01 | ✅ PASS | http | 11/11 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/J01-http.json` |
| J02 | ✅ PASS | http | 16/16 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/J02-http.json` |
| J03 | ✅ PASS | http | 7/7 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/J03-http.json` |
| J04 | ✅ PASS | http | 4/4 kontrol: hepsi geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/J04-http.json` |
| J05 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | laboratuvar-0811.spec.ts E2E: masaüstü geçti, telefon-360 geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| J06 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | laboratuvar-0811.spec.ts E2E: masaüstü geçti, telefon-360 geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| J07 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | laboratuvar-0811.spec.ts E2E: masaüstü geçti, telefon-360 geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |
| L01 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | geri-bildirim-1211.spec.ts E2E: masaüstü geçti, telefon-360 geçti (tur1, temiz seed, 8c11e52) | `evidence/tur1/R04-R05-e2e-temiz-seed.log` |

## Profiller
| Profil | Durum | Kanıt / gerekçe |
|---|---|---|
| http | ✅ PASS | `evidence/tur1/g-summary.json` |
| chromium-desktop | ✅ PASS | `evidence/tur1/browser-f-summary.json` |
| chromium-mobile-emulation | ✅ PASS | `evidence/tur1/browser-f-summary.json` |
| cli | ✅ PASS | `evidence/tur1/V06-reconcile.txt` |
| physical-mobile-device | — NA | Web ürünü; fiziksel cihaz bu ortamda yok. Pilot klinikte gerçek telefonla doğrulama insan adımı. |
| android-apk | — NA | Ürün APK üretmiyor (web/PWA). |
| ios | — NA | iOS test ortamı yok; ürün web. |
| vscode-extension | — NA | Ürün VS Code uzantısı değil. |

## Bulgular
| ID | Önem | Durum | Başlık | Kanıt | Yeniden test |
|---|---|---|---|---|---|


## Turlar
- **Tur 1** (`8c11e52`): 87 PASS / 0 FAIL / 0 FLAKY / 0 NOT_RUN · açık bulgu: yok

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
