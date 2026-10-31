# Devir notu (handoff)

**Son güncelleme:** 23.10.2026 · Oturum 7 (Görev 6 tamamlandı) · Dal: `main` · Son commit: `git log -1`

## Durum özeti
Oturum 1: tenant/rol/oturum → hasta → hekim/koltuk/randevu → VİA Akış → VİA İz çekirdeği.
Oturum 2 (Görev 1): çalışma saatleri, kapatmalar, işlem türleri, hekim/koltuk yönetimi, yakın/veli, sürümlü anamnez, ekip daveti, haftalık ajanda.
Oturum 3 (Görev 2): diş modeli (FDI), özgün odontogram, bulgu ve tanı, işlem kataloğu + sürümlü/hekime özel tarife, plan → teklif → karar → yeni sürüm (AT-05), ziyarete bağlı gerçekleşen işlem, tedavi takibi, VİA Akış plan görevleri. Oturum 4 (Görev 3): VİA Net — alacak, ödeme, dağıtım, avans, iade, kasa, gider ayrı kayıtlar; idempotency; DB tutar tetikleyicileri; işlemden otomatik alacak; tahsilat bazlı prim tahakkuku; klinik özeti (işlem ≠ tahsilat), bakiyeler, kasa raporu.
Oturum 5 (Görev 4): belge türü / şablon sürümü / hasta belgesi / onay isteği / kanıt olayı ayrımı (SHA-256, AT-14), özel dosya deposu + tarama portu (AT-11), amaç × kanal iletişim tercihi ve MOCK mesaj (AT-12), kontrol (follow-up), VİA Hazır temeli.
Oturum 6 (Görev 5): VİA Köprü — sağlayıcı portu + yalnız MOCK SMS/online ödeme adaptörü, dış iş kuyruğu (idempotency, retry/backoff, dead-letter, zaman aşımı → durum sorgusu), imzalı webhook (AT-13), dört göz onay kapısı, canlı gönderim kapısı; gerçek sağlayıcılar “erişim bekliyor”.
Oturum 7 (Görev 6): laboratuvar iş emri (aşama/revizyon/maliyet, iş föyü), tedarikçi/laboratuvar carisi, tedavi bazlı prim + prim ödemesi, temel stok (lot/SKT, hareket tabanlı), 19 rapor (toplam = alt kayıtlar, kaynağa iniş, CSV), VİA Akış laboratuvar ve stok görevleri.
Tüm veriler gerçek PostgreSQL'de; klinik içerik, fiyatlar, prim oranı ve belge şablonları sentetik DEMO.

## Gerçekten çalışan akışlar
1. Giriş / çıkış, çok klinikli kullanıcıda klinik değiştirme, eski sekme koruması.
2. Hasta: oluşturma, arama, düzenleme, Hasta 360 — yedi sekmenin tamamı çalışır (Özet / Tedavi / Finans / Sağlık / **Belgeler** / **İletişim** / Geçmiş).
3. Ajanda: gün/hafta, çakışma engeli, çalışma saati, kapatma, durum makinesi, iletişim sonucu.
4. Bugün: sayaçlar ve VİA Akış (7 tür) — geciken geliş, teyit, eksik iletişim, kapatma çakışması, anamnez onayı, **randevusuz kabul edilmiş plan**, **yanıtsız teklif** (“Planı aç” ile Tedavi sekmesine).
5. Klinik not: yalnız ekleme + gerekçeli düzeltme + **ziyarete bağlama**.
6. Yönetim: ekip/davet/rol, hekim/koltuk, çalışma saatleri, işlem türleri, kapatmalar, **Katalog ve tarife** (işlem ekle/düzenle/pasifleştir; tarife oluştur/kopyala, taslak fiyat düzenle, yayınla, kaldır).
7. **Tedavi sekmesi (hekim):** odontogram (daimi/süt/karma, dişe ve yüzeye tıklama, desen+sembol+erişilebilir ad) → seçili diş paneli (mevcut durum / tanı / planlı / gerçekleşen) → bulgu ve tanı ekleme → yeni plan → kalem ekleme (konum kapsamına göre diş/yüzey/çeyrek/çene/ağız, tarife fiyatı görünür; indirim + gerekçe; tarifede yoksa elle fiyat + açıklama) → fiyatları yenile → teklif → hasta kararı (kabul/ret/kararsız) → yeni sürüm → kabul edilen kalemi geliş kaydı yapılmış ziyarete bağlayıp gerçekleştirme → gerçekleşen listesinde gerekçeli iptal.
8. **Sekreter:** plan ve teklifi görür, hasta kararını kaydeder; odontogram/tanı ve işlem tamamlama kapalı.
9. **/tedavi takip:** karar bekleyen teklif, devam eden kabul edilmiş plan, randevusu olmayan plan; plan bedeli + ilerleme + sonraki randevu.
10. Worker: outbox, yeniden deneme, 60 sn tarama (plan görevleri dahil); `via_net.changed` olayı işlenir.
11. **Hasta 360 → Finans (VİA Net):** açık borç / kullanılabilir avans / toplam tahsilat / toplam borçlandırma kutuları ve “Nasıl oluştu?” formül açılımı; alacaklar, ödemeler, kronolojik hareket defteri (her satırdan sonra borç ve avans ayrı) ve mutabakat göstergesi. Sekreter/finans: tahsilat al (yöntem, kasa, vadesi eski olandan dağıtım önerisi, kalan avans), avansı dağıt, dağıtımı geri al. Finans: iade (önce dağıtılmamış kısım, sonra dağıtım ters kaydı), elle alacak, alacak iptali. Kart = manuel kayıt uyarısı.
12. **/finans (finans + yönetici):** günlük/aralık özet (işlem tutarı, tahsilat, iade, net tahsilat, gider; kutudan kaynak satırlara iniş; günlere göre), hasta bakiyeleri (borç/avans ayrı, yaşlandırma), kasa ve banka (açılış/giriş/çıkış/kapanış + hareketler), giderler (ekle, ters kayıt), hekim primi (tahakkuk/ters/net + satırlar), ayarlar (kasa hesapları, prim kuralı sürümleri).
13. Gerçekleşen işlem → aynı transaction'da alacak; işlem iptal/düzeltmesinde alacak iptal + tahsilat avansa döner.
14. **Belgeler:** onaylı şablondan (isteğe bağlı plan kalemleriyle) önizle → üret (metin + SHA-256 snapshot) → yazdır (kanıt) → yüz yüze kabul (ıslak imza/sözlü, personel beyanı zorunlu, isteğe bağlı taranmış nüsha) / ret → gerekçeli iptal; kanıt zaman çizelgesi ve bütünlük kontrolü. “Elektronik imza değildir” notu.
15. **Dosyalar:** kategori seçip yükle → “taranıyor” → kullanılabilir / karantinada / reddedildi; yarım yüklemede “tekrar dene”; indirme yalnız temiz dosyada; gerekçeli silme; klinik kategoriler yalnız sağlık rollerine. Worker çalışmıyorsa dosya “taranıyor”da kalır (yanlış başarı yok).
16. **İletişim:** amaç × kanal izin tablosu + geçmiş; MOCK mesaj (dışarı gitmez) → VİA Köprü işi → “iletildi (teslim bilinmiyor)” → teslim/başarısız yalnız imzalı sağlayıcı bildirimiyle; bildirim gelmezse 24 saat sonra “bilinmiyor”. Bağlantı kapalıysa/kanal erişim bekliyorsa mesaj oluşturulmaz (409).
17. **Kontrol:** hekim planlar (Tedavi sekmesi) → vadeye 14 gün kala sekreterya görevi → randevu bağlanır.
18. **VİA Hazır:** yönetici kural tanımlar (işlem → belge, güncel onaylı anamnez); ajanda randevu ayrıntısında hazırlık paneli; yarınki eksikler Bugün'e görev; hekim gerekçeli istisna.
19. **Yönetim → Belge şablonları:** şablon/sürüm (taslak → onay → kullanımdan kaldır), belge türleri (etkin/pasif), VİA Hazır kuralları.
20. **Yönetim → Entegrasyonlar (VİA Köprü):** bağlantılar (MOCK etiketi, etkin/kapalı, “erişim bekliyor” gerekçeleri, MOCK davranışı: kabul/ret/zaman aşımı/ulaşılamıyor + durum sorgusu sonucu, webhook yolu, sır yenileme — sır bir kez gösterilir, son 7 gün ret sayısı), dış işler (dikkat gerekenler/açık/tümü; onayla/reddet — kendi isteğini onaylayamaz; yeniden dene; iptal; ayrıntıda denemeler, bildirimler ve **imzalı MOCK bildirim simülasyonu**), sağlayıcı bildirim günlüğü (işlendi/tekrar/eski-ters sıra/eşleşmedi/inceleme) ve ret gerekçeleri, erişim bekleyen entegrasyon kataloğu. Canlı gönderim kapısı durumu görünür (KAPALI).
21. **Hasta 360 → Finans → Online ödeme istekleri (MOCK):** bağlantı iste → worker → “bağlantı hazır” (`mock.invalid`) → imzalı “ödendi” bildirimi → ödemeler tablosunda “Online · MOCK sağlayıcı” avans; online ödemede “Sağlayıcıdan iade” → onay kapısı → başka yetkili onaylar → worker → sağlayıcı kabulü → iade bildirimi gelince deftere iade.
22. **Bugün:** `integration_approval` ve `integration_dead` görevleri VİA Köprü'ye götürür; laboratuvar (geciken / kabul bekleyen / randevu için hazır değil) görevleri iş emrine, stok (en az seviye / SKT) görevleri stoğa götürür.
23. **Hasta 360 → Laboratuvar:** iş emri aç (laboratuvar, hekim, iş, FDI dişler, renk, teknik talimat, hedef teslim, prova randevusu) → laboratuvara gönder → üretimde → teslim alındı → hekim kabul veya gerekçeli revizyon (yeni hedef) → yeniden teslim → kabul; iptal gerekçeli; olay günlüğü; iş föyü (baş harf + iş emri no; yazdır); maliyet (yalnız yönetici/finans) → laboratuvar carisine borç, ters kayıt. Altında “Kullanılan malzeme (lot)”: hastaya lot bazında kullanım kaydı.
24. **Operasyon:** Laboratuvar panosu (laboratuvarda / geciken / kabul bekleyen / bu ay maliyet; süzgeçler), Stok (kalem, bakiye, lotlar ve SKT uyarıları; giriş — isteğe bağlı tedarikçi + birim maliyet + cari borç —, kullanım, fire/iade, sayım, hareketler ve ters kayıt; kalem tanımı yalnız yönetici), Tedarikçiler ve cari (tanım; borç/ödeme/bakiye; cari döküm, fatura ve ödeme girişi, ters kayıt).
25. **Raporlar:** rol bazlı katalog (Finans, Tedavi, Operasyon, Stok ve cari, Denetim, Analiz; her kartta Ek A kaynak ID'si) → süzgeç → toplam kutuları + satırlar + tanım notları → satırdan kaynak rapora veya hasta/iş emrine iniş → önceki rapora dönüş → CSV (yönetici, finans). Hekim klinik raporlarda yalnız kendi kayıtlarını görür.
26. **Finans → Hekim primi:** tahakkuk/ters/net, dönemde ödenen ve ödenecek bakiye; “Prim öde” (kasadan çıkış, bakiyeyi aşamaz) ve ödeme ters kaydı; tahakkuk satırlarında temel (tedavi/tahsilat). Ayarlar → prim kuralında temel seçimi.

## Kurulum
`README.md` → Kurulum. Kısaca: `pnpm install` → `.env` → `pnpm db:up && pnpm db:roles && pnpm db:migrate && pnpm db:seed` → `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:web`. **Worker artık zorunludur**: dosya taraması, mesaj ve tüm VİA Köprü dış işleri onunla ilerler. `.env`'de `VIADENT_SECRET_KEY` (32 bayt base64) zorunlu; `VIADENT_EXTERNAL_SEND_ENABLED=false` kalmalı. Dosyalar `STORAGE_DIR` (varsayılan depo kökünde `.storage/`, git dışı) altında; üretimde `CLAMD_HOST` tanımlanmalı.
**Önceki oturumlardan gelen yerel veritabanı için:** `pnpm db:migrate` 0003/0004'ü ekler (0004, var olan gerçekleşen işlemler için alacak üretir); finans demo verisi (kasalar, %10 DEMO prim kuralı, 1.000/600 alacak-ödeme, 300 avans) ve VİA Köprü bağlantıları (MOCK SMS/ödeme + erişim bekleyenler, sağlayıcı tahsilat hesabı), Görev 6 demo verisi (2 laboratuvar + 1 medikal firma, 3 iş emri — gecikmiş/kabul bekleyen/taslak —, 1.800 laboratuvar maliyeti, lot takipli implant ve anestezi kartuşu, en az seviyedeki eldiven, 7.500 stok faturası ve 3.000 kısmi ödeme) için `pnpm db:reset && pnpm db:seed` (`pnpm db:migrate` tek başına 0006'yı ekler ama bağlantı seed'lemez).

## Sürümler
Node 22, pnpm 10.28, TS 5.9.3, NestJS 11.2.7, Next 15.5.28, React 19.1.10, zod 4.6.7, pg 8.23.1, PostgreSQL 16, Vitest 3.2.7, Playwright 1.64.1 (ADR-002).

## Migration durumu
| Dosya | İçerik | Durum |
|---|---|---|
| `0001_core.sql` | çekirdek tablolar, RLS, grant | uygulandı (dev + test) |
| `0002_agenda_patient_team.sql` | işlem türü, çalışma saati, kapatma, yakınlar, anamnez, davet | uygulandı (dev + test) |
| `0003_treatment.sql` | katalog, tarife, bulgu, tanı, plan/sürüm/kalem/karar, gerçekleşen işlem, değişmezlik tetikleyicileri, `clinical_notes.appointment_id`, plan görev türleri | uygulandı (dev + test) |
| `0005_documents_files.sql` | belge türü/şablon/sürüm, hasta belgesi, onay isteği, kanıt, dosya + erişim izi, iletişim tercihi, mesaj + teslim olayı, kontrol, VİA Hazır kural/istisna; değişmezlik ve durum tetikleyicileri; görev türleri | uygulandı (dev + test) |
| `0007_operations.sql` | tedarikçi + cari hareketi, laboratuvar iş emri/olay/maliyet (durum tetikleyicisi), prim kuralı temeli + tedavi tahakkuku + prim ödemesi (tahakkuku aşamaz tetikleyicisi), stok kalemi/lot/hareket (eksi stok tetikleyicisi), kasa hareketi kaynakları, görev türleri | uygulandı (dev + test) |
| `0006_integrations.sql` | bağlantı, dış iş, deneme, webhook olayı/reddi, online ödeme isteği; ödeme/iade sağlayıcı alanları, `provider` kasa türü, dört göz check, `app.webhook_target`; Görev 4 bekleyen MOCK mesaj kuyruğunu iptal eder | uygulandı (dev + test) |
| `0004_finance.sql` | kasa, alacak, ödeme, dağıtım, iade, gider, kasa hareketi, idempotency, prim kuralı/tahakkuku; tutar ve değişmezlik tetikleyicileri; geçmiş işlemler için alacak backfill | uygulandı (dev + test) |

## Testler (son koşu, hepsi çalıştırıldı)
contracts 14/14 · web kontrast 14/14 · API entegrasyon **157/157** (gerçek PostgreSQL; `gorev6` 22: rapor mutabakatı, AT-19, prim, laboratuvar, stok, eşzamanlılık) · Playwright **40/40** (1366 px + 360 px, temiz seed, worker çalışırken) · typecheck 5 paket temiz · `next build` başarılı · RLS: `tenant_id` taşıyan 67 tablonun tamamında ENABLE+FORCE (otomatik keşif). Ayrıntı: `verification.md`.

## Kararlar
ADR-001…045 (`decisions.md`). Görev 6: laboratuvar durum makinesi, teslim ≠ kabul, iş föyü en az veri, cari ters kayıt (041) · tek etkin prim kuralı, tedavi primi, ters prim, prim ödemesi tahakkuku aşamaz (042) · hareket tabanlı stok, lot/SKT, eksi stok yok, resmî bildirim iddiası yok (043) · rapor toplamı = alt kayıtlar, anlık/dönem süzgeçleri, hekim yalnız kendi, güvenli CSV (044) · gerekçeli ertelemeler (045). Görev 5: port/adapter + yalnız MOCK + canlı gönderim kapısı (037) · dış iş yaşam döngüsü, zaman aşımında durum sorgusu, dead-letter (038) · webhook HMAC + replay penceresi + tekilleştirme + durum önceliği (039) · online ödeme ≠ tahsilat, sağlayıcı iadesi dört göz (040). Görev 4: belge kavramları ayrı, katalog VİADENT'in kendi sınıflandırması, Ek B yalnız referans, DEMO şablon (032) · kabul yüz yüze + personel beyanı, e-imza iddiası yok (033) · özel depo + tarama portu, temel tarayıcı tam antivirüs değil, üretimde clamd (034) · amaç × kanal izin, MOCK mesaj, teslim uydurulmaz (035) · kontrol bağlama ve VİA Hazır, tıbbi karar yok (036). Önceki: VİA Net (027–031), tedavi (021–026).

## Bilinen hatalar / riskler
- Finans: iade ikinci onay eşiği yok; makbuz/e-belge yok (Görev 5); banka/POS ekstre mutabakatı yok; ticari indirim / alacak düzeltmesi kaydı yok (yalnız alacak iptali); vergi dahil/hariç ayrımı yapılmadı; prim ödemesi Görev 6.
- Ödeme ekrandan en fazla 30 gün geriye girilebilir (daha eski kayıt Görev 7 içe aktarımıyla).
- Hekim işlem iptal edince bağlı alacak iptal olur ve dağıtılmış tahsilat avansa döner (para kaybolmaz); bu finans etkisi audit'te görünür ama finans onayı istemez — pilotta değerlendirilecek.
- Katalog, fiyatlar, bulgu türleri ve semboller DEMO; pilot hekimle doğrulanmadan gerçek klinikte kullanılmamalı. Tanı kodu serbest metin.
- Plan kalemi düzenleme ve gerçekleşen işlem düzeltme arayüzü yok (API var); arayüzde sil+ekle / iptal kullanılıyor.
- Odontogram planlı/gerçekleşen işlemleri yüzey rengiyle değil sembolle (P, ✓) gösterir.
- Telefon görünümünde plan tabloları kendi kabında yatay kayar (bilinçli; 720 px en az genişlik).
- Belge PDF çıktısı yok (tarayıcı yazdırması); uzaktan onay kanalı ve imza sağlayıcısı yok (Görev 5); belge/onam metinleri klinik ve hukuk onayı bekliyor (yalnız DEMO şablon).
- Temel dosya tarayıcısı tam antivirüs değildir; üretimde ClamAV zorunlu. “Silindi” dosyaların içeriği diskte kalır (imha işi açık). S3 adaptörü yok.
- Mesaj ve ödeme sağlayıcısı yalnız MOCK; hiçbir gerçek SMS/WhatsApp/e-posta gönderilmez, para hareket etmez. Webhook imza biçimi VİADENT'in kendi biçimidir; gerçek sağlayıcının biçimi adaptörde ayrıca uygulanıp test edilmeli.
- Görev 6: dış laboratuvar kullanıcısı yok (föy yazdırılıp iletilir); laboratuvar maliyetinin primden düşülmesi kuralı yok; satın alma siparişi ve stok değerleme yok; resmî ürün takip bildirimi yükümlülüğü doğrulanmadı; koltuk doluluğu metriği yok; kurum carisi ve çek/senet ertelendi; raporlar büyük veriyle ölçülmedi (senkron sorgu, 2.000/20.000 satır sınırı).
- VİA Köprü: online ödeme bağlantısının süre dolumu işi yok; sağlayıcı iadesi zaman aşımında durum sorgusu MOCK'ta var, gerçek API'de doğrulanmadı; webhook ret sayısı için uyarı/hız sınırı yok; `VIADENT_SECRET_KEY` döndürme prosedürü yok (değişirse eski sırlar çözülemez → bağlantı sırlarını yenile).
- SMS gönderimi onay kapısında değil (yalnız MOCK); gerçek sağlayıcı açılmadan önce toplu/otomatik mesajlar için onay politikası kararlaştırılmalı.
- Önceki riskler sürüyor: bellek içi giriş hız sınırı, şifresiz kimlik no, tsx ile çalışan API/worker, sabit VİA Akış eşikleri, Windows kurulumu denenmedi, performans ölçülmedi, ekran okuyucuyla elle test yapılmadı.

## Açık engeller (dış)
- SMS/WhatsApp, e-Fatura/e-Arşiv/e-SMM, e-Nabız/DHBS, ödeme kuruluşu, imza/doğrulama: yetkili doküman, sözleşme ve sandbox yok → altyapı hazır, yalnız etiketli MOCK (SMS, ödeme); diğerleri “erişim bekliyor” (VİA Köprü ekranında gerekçesiyle).
- Klinik içerik (anamnez, bulgu listesi, tanı kod sistemi, onam): klinisyen/hukuk onayı.
- Mali kurallar (KDV dahil/hariç gösterimi, yuvarlama, prim kesinti sırası, iade belgesi): mali müşavir onayı açık.
- Ödeme sağlayıcısı / sanal POS: sözleşme yok → yalnız manuel kart kaydı (ADR-030).
- Belge/onam içeriği ve kabul yönteminin hukuki uygunluğu: klinik + hukuk değerlendirmesi gerekli (ADR-033).
- ClamAV imza güncellemesi için ağ erişimi (üretim ortamı).

## İzlenebilirlik
`traceability.csv`: 125 kaynak ID'si. Ek A (Görev 6 sonrası): çalışıyor 38 · kısmi 22 · planlandı 5 · ertelendi 10 · engelli 4 · uygulanmayacak 1. Ek B: 43 başlık VİADENT belge türüne eşlendi (kısmi: tür + DEMO şablon altyapısı, gerçek metin yok), B03 ve B43 uygulanmayacak. Görev 4'te güncellenen Ek A: H11, H15 (çalışıyor); H10, H13, A02, A03, R14, R22 (kısmi). Görev 5: R24 engelli → kısmi (MOCK), R14 notu; E01/E02/E03 engelli (gerekçe güncellendi). Görev 6: Ek A rapor (R01–R24) ve tanımlama (T01–T20) satırlarının her biri güncellendi; ertelenenler gerekçeli (R06, R07, R10, R17, R21, T10, T11, T17); R16 engelli; H12, G05 güncellendi.

## Sıradaki tek iş paketi
**Görev 7 — Pilot ve güvenli yayın (VD-014)** — sentetik dry-run import, açık format export, backup/restore provası, güvenlik ve kabul testleri (AT-16/17), performans ölçümü (veri hacmi + donanım), canlıya alma ve rollback planı, pilot kontrol listesi; açık resmî entegrasyon/veri işleme/sözleşme kararları varken “satışa hazır” denmez. Ayrıntı `backlog.md`. Prompttaki Görev 7 metniyle başlat.
