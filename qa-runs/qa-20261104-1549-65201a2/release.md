# Teslim kararı — qa-20261104-1549-65201a2

**Karar: TESLİME ADAY** (`node qa/cezeri/gate.cjs results.json plan.json bef63fec0fbadabc238d141be1c9cbc4db3e646e` → `TESLİME ADAY`, çıkış 0)

- Ürün sürümü: `bef63fec0fbadabc238d141be1c9cbc4db3e646e` (65201a2 + fix1 QA-201/202 + fix2 QA-203/204). Sonraki commit'ler yalnız tester dosyalarıdır (`git diff bef63fe..HEAD -- apps packages`: yalnız tsbuildinfo).
- Kapsam: ürün sahibi geri bildirimi 04.11.2026 (12 madde + Panel) → F01–F12; önceki koşunun (qa-20261102-1209-12fc6fd) 27 zorunlu vakası tam regresyon. Toplam 39 zorunlu vaka, hepsi PASS; açık bulgu 0 (S0–S3).
- Ortam: yerel test, temiz seed, yalnız MOCK dış servis; canlıya gönderim yok (`environment.md`).
- **Bu karar satışa hazır / tam uyumlu / Bakanlık onaylı anlamına gelmez; canlıya alma ürün sahibinin onayını bekler.**

## Vakalar
| Vaka | Durum | Profil | Özet | Kanıt |
|---|---|---|---|---|
| V01 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 10 istek; B erişimleri reddedildi (404/403, önizleme yok); arama 0 sonuç; A kendi kaydını okudu · masaustu: B hasta sayfası sızıntı=false, arama satırı 0 · mobil: B hasta sayfası sızıntı=false, arama satırı 0 (tur2, temiz seed, bef63fe) | `evidence/tur2/V01-http.json` |
| V02 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | bulgu 201, tanı 201, işlem 201; diş 16 yüzeyler M,O; diğer diş/hasta değişmedi=true · masaustu: diş 16 görünür=true, işlem metni=true, düzeltme izi=true · mobil: diş 16 görünür=true, işlem metni=true, düzeltme izi=true (tur2, temiz seed, bef63fe) | `evidence/tur2/V02-http.json` |
| V03 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | eşzamanlı yanıtlar 201/409; 09:00'de 1 kayıt; ret kodu APPOINTMENT_CONFLICT · masaustu: 29.01.2027 09:00 ajandada randevu bloğu 1 (metin eşleşmesi 2); API: 1 · mobil: 29.01.2027 09:00 ajandada randevu bloğu 1 (metin eşleşmesi 1); API: 1 (tur2, temiz seed, bef63fe) | `evidence/tur2/V03-http.json` |
| V04 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | eşzamanlı 201/201, tekrar 201, tek ödeme=true, 300'lük ödeme sayısı 1, açık borç 1800.00→2500.00 (beklenen +700), replay başlığı 2/2, iade 201 (ters kayıt 201) · masaustu: 300,00 geçişi 7, açık borç 2800.00 görünür=true, iade izi=true · mobil: 300,00 geçişi 7, açık borç 2800.00 görünür=true, iade izi=true (tur2, temiz seed, bef6 | `evidence/tur2/V04-http.json` |
| V05 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | sekreter düzeltme 403, hekim düzeltme 200; eski=corrected yeni=completed; geçmişte 2 olay (aktör+zaman=true); sekreter geçmişinde klinik bulgu olayı: 0, finans: 0 · masaustu: hekim düzeltme izi=true; sekreter klinik bulgu olayı görüyor=false (API: 0 olay) · mobil: hekim düzeltme izi=true; sekreter klinik bulgu olayı görüyor=fals | `evidence/tur2/V05-http.json` |
| V06 | ✅ PASS | cli | şifreli yedek → izole viadent_qa_restore_tur2; restore-verify ok=true, differences=[0]; dosya 3/3; bağımsız mutabakat (reconcile.sql) iki DB'de EŞLEŞTİ | `evidence/tur2/V06-reconcile.txt` |
| P01 | ✅ PASS | http | 14 değer; kabul: 0.01, 999.99, 1000.00 (=borç); kasa hareketi farkı 3; mutabık=true (tur2, temiz seed, bef63fe) | `evidence/tur2/P01-http.json` |
| P02 | ✅ PASS | http | 28 deneme, 0 beklenmedik (tur2, temiz seed, bef63fe) | `evidence/tur2/P02-http.json` |
| P03 | ✅ PASS | http | 8 kontrol, 0 beklenmedik (tur2, temiz seed, bef63fe) | `evidence/tur2/P03-http.json` |
| R01 | ✅ PASS | cli | vitest API 385/385 (gerçek PostgreSQL; dashboard, hekim ücreti, malzeme, geçmişe randevu testleri dahil) | `evidence/tur2/R01-api.log` |
| R02 | ✅ PASS | cli | contracts 17/17 (telefon hane kuralı dahil) | `evidence/tur2/R02-contracts.log` |
| R03 | ✅ PASS | cli | web birim 86/86 (QA-201 Esc, QA-203 etiket, QA-204 rem dahil) | `evidence/tur2/R03-web.log` |
| R04 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | Playwright tam koşu temiz seed: 100 geçti + 10 bilinçli atlama, 0 hata, retries=0 (iki proje). İlk deneme bir test kurulumunda tarayıcı 'page' fixture zaman aşımıyla düştü (ortam arızası, kanıt R04-R05-e2e-deneme1-ortam-arizasi.log); temiz seed'de tam koşu tekrarlandı | `evidence/tur2/R04-R05-e2e-temiz-seed.log` |
| R05 | ✅ PASS | chromium-mobile-emulation | aynı koşu, telefon-360 projesi dahil | `evidence/tur2/R04-R05-e2e-temiz-seed.log` |
| R06 | ✅ PASS | cli | typecheck 5/5 Done; pnpm audit --prod: bilinen açık yok | `evidence/tur2/R06-typecheck-audit.log` |
| R07 | ✅ PASS | cli | 78 kiracı tablosunun hepsi FORCE RLS, politikasız tablo yok; yeni tablolar (practitioner_compensation_versions, salary_payments, supplier_prices) FORCE RLS; app rolü super/bypassrls/createrole=false; ekle-yalnız tablolarda UPDATE yok | `evidence/tur2/R07-rls.txt` |
| N01 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | TM ardışık 7,8,9,10,11; eşzamanlı 2 oturum 201/201 farklı no; replay aynı no; 422 numara tüketmedi=true; iade IM-2026-000002; yazdırma denetimi 1; asistan 403, B 404; değişmezlik=true · masaustu: listede TM-2026-000007; pencere no+uyarı=true; taşma 0 · mobil: listede TM-2026-000007; pencere no+uyarı=true; taşma 0 (tur2, temiz se | `evidence/tur2/N01-http.json` |
| N02 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 25 değer, beklenmedik 0; yuvarlama 0,60/0,10=true; Unicode ad korunur=true; roller sek 403/yön 403/B 404; sağlayıcısız gönder 409 numara=null; MOCK: issued MOCK2026E3E64E7DA → iptal cancelled · masaustu: liste: MOCK rozeti=true, iptal=true, taslak 'numara yok'=true; ayrıntıda 'resmî belge değil'=true, TASLAK ibaresi yok=true; se | `evidence/tur2/N02-http.json` |
| N03 | ✅ PASS | http | ekran 11 satır = CSV 11; XLSX 21 (başlık+veri+8 toplam+dipnot); tahsilat/iade satırlarının hepsinde makbuz no (11/11); sekreter 403 (tur2, temiz seed, bef63fe) | `evidence/tur2/N03-http.json` |
| N04 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | taslak 201, ikinci taslak 409; geçersiz şablon 422/422/422/422; yayın yönetici 403 hekim 200; yayınlanan düzenleme API 409 DB kilit=true; eski kayıt outdated=true; eski anahtar 422; yeni etiket Kalp pili var mı?; sekreter 403; B bağımsız · masaustu: son kayıt kendi sorusuyla (Kalp pili)=true; yürürlük yerleşik set bildirimi=true | `evidence/tur2/N04-http.json` |
| N05 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 3 tür hekim-only; sekreter önizleme 403; liste sızıntısı yok=true; ayrıntı sek 404 yön 404; geçmiş sızıntısı=false; komşu: print 404/404 karar 404/404 iptal 404/404 dosya 422/422 (gerçek/yok), durum issued, kanıt +0; KVKK yönetici dışa aktarımında klinik belge=false (hekim dışa aktarım 403); onam raporunda klinik satır=false; he | `evidence/tur2/N05-http.json` |
| N06 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | geçersiz 7 değer 422/422/422/422/422/422/422; geçerli 200; yeni oturumda gelir; sekreter etkilenmez; kimliksiz 401; CSRF başlıksız 403 · masaustu: uygulandı {"scheme":"dark","accent":"lacivert","scale":"4","root":"17px"}; axe ciddi/kritik []; yenilemede dark/lacivert; varsayılan yesil/16px; taşma 0 · mobil: uygulandı {"scheme":" | `evidence/tur2/N06-http.json` |
| N07 | ✅ PASS | http | sınır 0/169/2,5 → 422/422/422; hekim 403; eşik 2 sa: 1 sa geçmiş yükseltilmedi, 3 sa geçmiş → yönetici (rol korunur, kopya 1); yönetici görevi kendine yükseltilmedi (tur2, temiz seed, bef63fe) | `evidence/tur2/N07-http.json` |
| N08 | ✅ PASS | http | nakit-hareketleri: 24 satır, formül 0, para hücresi 21; borc-bakiye: 9 satır, formül 0, para hücresi 24; tedavi: 7 satır, formül 0, para hücresi 3; bilinmeyen biçim → CSV; sekreter 403 (tur2, temiz seed, bef63fe) | `evidence/tur2/N08-http.json` |
| N09 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | masaustu: stok satırı display=table-row (beklenen table-row), etiket Kalem, Sayım açıldı=true; taşma stok 0 rapor 0; ham kod=false; Excel=true · mobil: stok satırı display=grid (beklenen grid), etiket Kalem, Sayım açıldı=true; taşma stok 0 rapor 0; ham kod=false; Excel=true (tur2, temiz seed, bef63fe) | `evidence/tur2/masaustu-N09-stok.jpg` |
| N10 | ✅ PASS | http | hekim 403, tekrar 422, 0 adet 422, sahte kalem 422, B 404; işlem: eldiven 4→3, kartuş 30→28 (lot seçili); düzeltme sarfı tekrarlamadı=true; yetersiz stok: işlem 201, {"used":1,"shortages":1}, görev 1 (tur2, temiz seed, bef63fe) | `evidence/tur2/N10-http.json` |
| N11 | ✅ PASS | http | dışa aktarım klinik dosya yok/idari var, omitted files:clinical; geçmiş olay sekreter 0, yönetici 0, hekim 1; access_log dosya satırı 0; onam kanıtı gizli dosya kimliği sekreter=false, dışa aktarım=false; karantina görevi sekreter=false, yönetici=false, hekim=true; epikrize bağlı tarama sekreter 404/404 (tur2) | `evidence/tur2/file-sensitivity-probe.json` |
| F01 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 16/16 kontrol: hepsi geçti · masaustu: geçmiş dilim 64 (düğme 0), tıklayınca form açıldı=false; tarih alanına 01.01.2026 → değer "01.01.2026", uyarı 1 · mobil: geçmiş dilim -1 (düğme 0), tıklayınca form açıldı=false; tarih alanına 01.01.2026 → değer "01.01.2026", uyarı 1 (tur2, temiz seed, bef63fe) | `evidence/tur2/F01-http.json` |
| F02 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 4/4 kontrol (API); UI tarafı tarayıcı vakasında · masaustu: Geçmiş başlığında 'Sonuç bekliyor' 1, Yaklaşan'da 0, yaklaşan satır 1, Geldi düğmesi 1 · mobil: Geçmiş başlığında 'Sonuç bekliyor' 1, Yaklaşan'da 0, yaklaşan satır 1, Geldi düğmesi 1, Geldi sonrası rozet 0 (tur2, temiz seed, bef63fe) | `evidence/tur2/F02-http.json` |
| F03 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 26/26 kontrol: hepsi geçti · masaustu: listede maske false; kartta tam telefon true; giriş 0'lı 11 hane, 0'sız 10 hane, yurt dışı 17 rakam · mobil: listede maske false; kartta tam telefon true; giriş 0'lı 11 hane, 0'sız 10 hane, yurt dışı 17 rakam (tur2, temiz seed, bef63fe) | `evidence/tur2/F03-http.json` |
| F04 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | masaustu: hücre tıklaması karta gitti true; sürükle-seç sayfada kaldı true; klavye Enter true · mobil: hücre tıklaması karta gitti true; sürükle-seç sayfada kaldı true; klavye Enter true (tur2, temiz seed, bef63fe) | `evidence/tur2/masaustu-F04-satir.jpg` |
| F05 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 3/3 kontrol (API); UI işaretleri tarayıcı vakasında · masaustu: hekim: işlem yapılan diş(ler) 16, ayrıntı: Diş 16 Uygulanan işlemler CEK-01 Diş çekimi (basit) · 04.11.2026 · Dt. Elif Aras Planlanan Yok Mevcut durum Yok · masaustu: sekreter (sağlık yetkisi yok) kartta odontogram 0 · mobil: hekim: işlem yapılan diş(ler) 16, ayrınt | `evidence/tur2/F05-http.json` |
| F06 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 8/8 kontrol (API/DB); menü ve ekran tarayıcı vakasında · masaustu: menü [Panel, Hastalar, Randevular, Hekimler, Tedavi, Finans, Operasyon, Raporlar, Yönetim], başlık "Panel · PİA-DENT", KPI randevu 8=8, tahsilat 2.310,00 ₺ / API 2310.00, açık 21.350,00 ₺ / API 21350.00, tablo satırı 30, taşma 0 · masaustu: sekreter Panel: para k | `evidence/tur2/F06-http.json` |
| F07 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 42 rapor çalıştırması, 0 hata; menü dönüşü/varsayılan aralık tarayıcı vakasında · masaustu: 20 rapor açıldı, hata 0; varsayılan aralık 30 gün; menüden dönüş kart sayısı 20 · mobil: 20 rapor açıldı, hata 0; varsayılan aralık 30 gün; menüden dönüş kart sayısı 20 (tur2, temiz seed, bef63fe) | `evidence/tur2/F07-http.json` |
| F08 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 33/33 kontrol: hepsi geçti · masaustu: ekranda bu ay kalan 24.000,00 ₺ = API 24000.00; UI ile 1.000 ödeme sonrası API ödenen 7000.00; taşma 0 · mobil: ekranda bu ay kalan 23.000,00 ₺ = API 23000.00; UI ile 1.000 ödeme sonrası API ödenen atlandı; taşma 0 (tur2, temiz seed, bef63fe) | `evidence/tur2/F08-http.json` |
| F09 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 16/16 kontrol: hepsi geçti · masaustu: ekranda birim maliyet 100,00 ₺ = API 100.00; 'Fiyat tanımsız' 2; uyarı 1; Fiyat ekle penceresi açıldı; taşma 0 · mobil: ekranda birim maliyet 100,00 ₺ = API 100.00; 'Fiyat tanımsız' 2; uyarı 1; Fiyat ekle penceresi açıldı; taşma 0 (tur2, temiz seed, bef63fe) | `evidence/tur2/F09-http.json` |
| F10 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 17/17 kontrol: hepsi geçti · masaustu: ekranda gider 0,00 ₺ = API 0.00; satır 3=3; UI ile ekleme sonrası satır 4 · mobil: ekranda gider 45,00 ₺ = API 45.00; satır 4=4; UI ile ekleme sonrası satır atlandı (tur2, temiz seed, bef63fe) | `evidence/tur2/F10-http.json` |
| F11 | ✅ PASS | chromium-desktop, chromium-mobile-emulation | masaustu: 12/12 adım; başarısız: yok; yerel pencere 0 · mobil: 9/9 adım; başarısız: yok; yerel pencere 0 (tur2, temiz seed, bef63fe) | `evidence/tur2/masaustu-F11-kapatma.jpg` |
| F12 | ✅ PASS | http, chromium-desktop, chromium-mobile-emulation | 8/8 kontrol: hepsi geçti · masaustu: işlem seçenekleri 56; TEM-01 fiyatı 1.200,00 ₺ görünür=true; şerit: Açık borç 3.600,00 ₺ Avans 0,00 ₺ İşlem sonrası tahmini borç 4.800,00 ₺ · mobil: işlem seçenekleri 56; TEM-01 fiyatı 1.200,00 ₺ görünür=true; şerit: Açık borç 3.600,00 ₺ Avans 0,00 ₺ İşlem sonrası tahmini borç 4.800,00 ₺ (tur | `evidence/tur2/F12-http.json` |

## Profiller
| Profil | Durum | Kanıt / gerekçe |
|---|---|---|
| http | ✅ PASS | `evidence/tur2/f-summary.json` |
| chromium-desktop | ✅ PASS | `evidence/tur2/browser-f-summary.json` |
| chromium-mobile-emulation | ✅ PASS | `evidence/tur2/browser-f-summary.json` |
| cli | ✅ PASS | `evidence/tur2/V06-reconcile.txt` |
| physical-mobile-device | NA | Web ürünü; fiziksel cihaz bu ortamda yok. Pilot klinikte gerçek telefonla doğrulama insan adımı. |
| android-apk | NA | Ürün APK üretmiyor (web/PWA). |
| ios | NA | iOS test ortamı yok; ürün web. |
| vscode-extension | NA | Ürün VS Code uzantısı değil. |

## Bulgular
| ID | Seviye | Durum | Başlık | Yeniden sınama |
|---|---|---|---|---|
| QA-201 | S2 | VERIFIED | Kirli çekmece Esc ile uyarısız kapanıyor | `evidence/tur2/browser-f-summary.json` |
| QA-202 | S3 | VERIFIED | Randevu formunda yalnız Not/diğer alan değişince kirli sayılmıyor | `evidence/tur2/browser-f-summary.json` |
| QA-203 | S3 | VERIFIED | Yeni denetim alanları Türkçe etiketsiz | `evidence/tur2/R03-web.log` |
| QA-204 | S3 | VERIFIED | Grafik yazılarında px: yazı ölçeği uygulanmıyor | `evidence/tur2/R03-web.log` |

## Turlar
- **Tur 1 (65201a2):** F11 FAIL (QA-201 Esc, QA-202 kirli tanımı), R03 2/81 FAIL (QA-203, QA-204); V02/V05 tester betiği nedeniyle FAIL (genişleyen katalogda yüzeysiz dolgu seçimi — betik DOL-01'e sabitlendi, beklenti değişmedi). Kanıt: `evidence/tur1/`.
- **Tur 2 (bef63fe):** temiz seed, tüm vakalar + V06 + R01–R07. R04 ilk denemesinde bir test 'page' fixture kurulumunda zaman aşımına düştü (tarayıcı/ortam; ürün kodu çalışmadan) → temiz seed'de tam koşu tekrarlandı: 100 geçti + 10 bilinçli atlama, 0 hata (ilk deneme kanıtı saklandı: `evidence/tur2/R04-R05-e2e-deneme1-ortam-arizasi.log`).

## Denenmeyen kombinasyonlar
- support rolüyle telefon görünürlüğü (sentetik hesap yok; birim testi permissions-session.test.ts kapsar).
- Maaş ödemesi: çoklu kasa hesabı ve ay sonunda model değişimi kombinasyonları yalnız API testinde (tek ay); geçmiş aylara toplu ödeme UI'da denenmedi.
- Randevu malzemesi: lot takipli kalemde elle lot seçimi UI'da denenmedi (API otomatik seçim ve hata yolları denendi).
- Panel yazı ölçeği 5: masaüstü ve 360 px'te ek kontrol (`evidence/tur2/F06-olcek5.json`): sayfa taşması 0; mobilde eksen etiketleri SVG sol kenarından kart iç boşluğuna taşarak çiziliyor, okunur (kayıtlı risk: çok haneli etiketlerde kart kenarına yaklaşabilir).
- Fiziksel telefon, APK, iOS, VS Code: kapsam dışı (NA).

## Kayıtlı riskler
- Madde 7'nin kullanıcı belirtisi bildirilmedi; F07 bulunan iki kusurun düzeltmesini ve 20 raporun açıldığını doğrular.
- `beforeunload` uyarısı tarayıcı yereldir (tarayıcı kısıtı).
- Telefon girişi yurt dışında 17 rakama kadar yazdırır, API 8–15 haneyi doğrular.
- Canlı ortamda 0032–0034 uygulanmadı; canlıya alma ayrı, onaylı adımdır (Supabase migration + demo veri: standart işlem/ürün listesi ve tarife bağları).

## Nihai insan onayı
Bekliyor — ürün sahibi (Hadi).
