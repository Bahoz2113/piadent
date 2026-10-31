# Doğrulama

Yalnız **çalıştırılmış** testler “geçti” olarak yazılır. Ortam: Ubuntu 24.04, Node 22.22, PostgreSQL 16 (yerel küme), Chromium (Playwright 1.64). Tarih: 22.10.2026.

## Komutlar
```bash
pnpm typecheck                      # 5 paket
pnpm test                           # contracts + web(kontrast) + api(entegrasyon, gerçek PostgreSQL)
# E2E: API + web çalışırken, sentetik seed yüklü
cd apps/web && E2E_PASSWORD=<.demo-credentials> npx playwright test
```
API entegrasyon testleri her koşuda `viadent_test` veritabanını **silip yeniden kurar** (migration + sentetik seed), sonra uygulamayı kısıtlı `viadent_app` rolüyle başlatır.

## Son koşu sonuçları (23.10.2026, Görev 4 sonrası)
| Paket | Test | Sonuç |
|---|---|---|
| `@viadent/contracts` | Türkçe normalize, telefon, TCKN biçimi, saat dilimi (gece yarısı, DST), durum makinesi, rol matrisi, prim yuvarlaması, finans rolleri, ödeme şeması | **14/14 geçti** |
| `@viadent/web` (vitest) | WCAG kontrast — 11 metin/zemin çifti ≥ 4.5:1, beyaz/birincil, turuncu vurgu kısıtı, odak ≥ 3:1 | **14/14 geçti** |
| `@viadent/api` | `tenant-isolation` 12 · `permissions-session` 12 · `scheduling-patients` 18 · `gorev1` 19 · `gorev2` 17 · `gorev3` 21 · `gorev4` 19 | **118/118 geçti** |
| `@viadent/web` (Playwright) | `critical-flow` 2 + `gorev1` 4 + `gorev2` 3 + `gorev3` 2 + `gorev4` 3 senaryo × {1366 px, 360 px} | **28/28 geçti** (temiz seed, worker çalışırken) |
| Typecheck | contracts, db, api, worker, web | **temiz** |
| `next build` | üretim derlemesi | **başarılı** |

### Görev 1 testlerinin kapsadığı kurallar (`gorev1.test.ts`)
Çalışma saati dışı → 422 + bloklar; bilinçli onayla kayıt ve audit izi · bloğa taşan randevu ve tatil günü · çakışan blok reddi · sekreter takvim yönetemez · tanımsız saat = kısıt yok · pasif hekime randevu yok · işlem türü varsayılanı ve pasif tür · kapatma randevuyu silmez, çakışanı döner, VİA Akış görevi açar, kapalı aralığa onayla bile randevu yok, başka hekim etkilenmez, iptalde görev kapanır · klinik kapsamlı kapatma · **eşzamanlı kapatma + randevu (4 tur)** · haftalık okuma ve 14 gün sınırı · 18 yaş altı uyarısı, yasal temsil dayanağı, ters yön, tekil çift, gerekçeli sonlandırma, başka kliniğin hastası yakın yapılamaz · anamnez: sekreter/yönetici erişemez, özet alanı `null`; asistan kaydı onay bekler ve klinik görev yalnız sağlık rollerine görünür; hekim onayı; sürümleme, eski temel 409, tanımsız soru reddi, audit içerik taşımaz, uygulama rolü UPDATE edemez · davet: tek kullanım, token düz saklanmaz, kısa parola, süresi dolmuş/iptal edilmiş davet, mevcut kullanıcı kendi parolasıyla, yanlış parola · rol değişikliği bir sonraki istekte etkili, kendine uygulanamaz.

### Görev 2 testlerinin kapsadığı kurallar (`gorev2.test.ts`, 17)
Katalog yalnız yöneticide, kod tekil ve değiştirilemez · yayınlanmış tarife API **ve doğrudan SQL** ile değişmez, kopyadan yeni sürüm, boş tarife yayınlanamaz · hekime özel tarife önceliği, geleceğe tarihli tarife bugünü etkilemez · konum kapsamı ve FDI/yüzey kuralları (geçersiz diş 19/56, ön dişte O yüzeyi) · indirim gerekçesi ve üst sınır, tarifede olmayan işlemde elle fiyat + açıklama · sekreter plan okur ama kalem ekleyemez, klinik haritayı okuyamaz · **AT-05:** teklif sunulan sürüm kilitli, kararsız yanıt durumu değiştirmez, kabul edilen fiyat API ve DB'de değişmez, tarife sonradan değişse de snapshot korunur, değişiklik yeni sürümle, eski kabul yeni kabule kadar geçerli, eşzamanlı iki kabul → [200, 409] · geliş kaydı olmayan ziyarete işlem bağlanamaz; asistan/sekreter işlem kaydedemez · kısmi gerçekleşme 1000.00 + 1000.00 + 999.99 = 2999.99, kalan aşılamaz · iptal gerekçeli ve kalanı serbest bırakır, düzeltme eski kaydı silmez · plansız işlem tarifeden fiyatlanır, kabul edilmemiş kalem gerçekleştirilemez · bulgu/tanı ekleme, hatalı kayıt gerekçesi, audit tanı metni taşımaz · çapraz tenant: başka kliniğin hastası, planı, plan sürümü, tanısı 404 · VİA Akış: randevusuz kabul edilmiş plan ve yanıtsız teklif görevi açılır ve kaynak çözülünce kapanır.

### Görev 2 E2E (`gorev2.spec.ts`, 1366 px + 360 px)
Hekim: odontogramda seed bulgusu erişilebilir adla (“Diş 16; Çürük…”) → kabul edilmiş kalemi bugünkü ziyarete bağlayıp gerçekleştirme → yeni plan → odontogramdan diş 37 + O yüzeyi → tarife fiyatı görünür → teklif → kabul → silme düğmesi kaybolur · Sekreter: klinik harita kapalı uyarısı, plan görünür, “Gerçekleştir/Yeni plan” yok · Tedavi takibi listesi ve yönetici katalog/tarife ekranı (yayınlanmış tarife salt okunur) · her ekranda 360 px yatay taşma yok.

### Görev 3 testlerinin kapsadığı kurallar (`gorev3.test.ts`, 21 — gerçek PostgreSQL, uygulama rolü)
**AT-07** 1.000 alacak → 600 dağıtım → açık borç 400 → 100 iade → dağıtım ters kaydı → açık borç 500, alacak tutarı 1.000 kalır, ters kayıt gerekçeli ve izlenebilir, kasa hareketleri +600/−100, audit zinciri, hareket defteri mutabık · prim 600×%10 = 60, iade −10 · iade fazlası 409 · doğrudan SQL iade tetikleyiciyle reddedilir · uygulama rolü ödeme/dağıtım/iade güncelleyemez/silemez, alacak tutarı değişmez · **AT-06** aynı anahtar iki kez → tek ödeme + tek kasa hareketi, yanıt aynı ve `Idempotent-Replayed`; aynı anahtar farklı içerik 409; anahtarsız 428; 5 eşzamanlı aynı istek → tek kayıt · **AT-08** alacak yokken 300 → avans 300, borç 0 (eksi değil); alacak gelince otomatik karışmaz; kısmi dağıtım; alacak ve ödeme sınırı aşılamaz; dağıtım geri alma avansı geri verir; ters kayıt tekrar ters çevrilemez · **AT-09** iki kullanıcı aynı ödemeyi aynı anda iki alacağa (5 tur) → [201, 409], toplam ≤ ödeme; iki ödemeden aynı alacağa eşzamanlı → alacak aşılmaz; API'siz doğrudan aşan dağıtımı tetikleyici reddeder · işlem tamamlanınca alacak, işlem iptalinde alacak iptal + tahsilat avansa · **AT-02** sekreter iade/elle alacak/gelir raporu 403, hekim/asistan hesap 403, yönetici rapor görür ama tahsilat giremez, reddedilen iade iz bırakmaz · çapraz tenant: B'nin hesabı/ödemesi/alacağı/kasası 404/422, bakiyelerde görünmez · **AT-19** 23:59:30 ve 00:00:30 doğru güne; satır toplamı = metrik; iki gün = aralık · işlem tutarı ve tahsilat ayrı, net = tahsilat − iade, iptal edilen işlem ayrı · gelecek tarihli / 40 gün önceki ödeme ve 100 günlük rapor 422 · gider + ters kaydı kasada net sıfır, kapanış = açılış + giriş + çıkış · bakiyeler: borç ve avans ayrı, seed yaşlandırması 31–60 · **AT-10** geriye dönük prim kuralı 422; %10 → %20 sonrası yeni dağıtım %20, önceki tahakkuk %10 kalır, eski dağıtımın ters kaydı %10 ile; sekreter kural ekleyemez.

### Görev 3 E2E (`gorev3.spec.ts`, 1366 px + 360 px)
Finans bakiye listesinden hastaya → sekreter tahsilat alır, öneriyle dağıtır, iade düğmesi görmez, “Açık borç” kutusundan formül açılır, mutabakat notu görünür → finans 50 ₺ iade eder, dağıtım ters kaydı defterde görünür → /finans özetinde Tahsilat kutusu kaynak ödemelere açılır · hekim hasta hesabını ve klinik finansı göremez · 360 px taşma yok.

### Görev 4 testlerinin kapsadığı kurallar (`gorev4.test.ts`, 19 — gerçek PostgreSQL, uygulama rolü, geçici özel depo)
Katalog 17 tür, hepsi DEMO/incelenmemiş, yalnız 2 sentetik onaylı şablon; finans belge göremez · şablonda tanımsız alan 422; onaylı sürüm API ve doğrudan SQL ile değişmez; sekreter şablon yönetemez · **AT-14** önizleme = üretim (aynı SHA-256), metin snapshot, DEMO başlığı, onay isteği; kabul yöntem + personel beyanı ister; kanıt olayları belge özetini taşır; karar bir kez; v2 onaylanıp v1 kullanımdan kalkınca eski kabul edilmiş belge v1 metni ve özetiyle kalır, kullanımdan kalkan sürümden belge üretilemez, yeni belge v2'ye bağlanır; belge metni/kanıt/kararlı istek DB'de değiştirilemez · iptal gerekçeli, iptalden sonra karar/yazdırma yok · hekime özel tür sekretere 403, bilgilendirme türü karar gerektirmez · **AT-11** eksik bayt “yüklendi” sayılmaz (422, deneme sayılır, durum initiated, tekrar yolu); tarama bitmeden indirme 409 + erişim reddi izi; temiz PNG taranır, hash başlığıyla iner, olay zinciri tam; içerik özel depoda · EICAR → karantina, indirilemez, yöneticiye görev, gerekçeli silmede görev kapanır · tür uyuşmazlığı → reddedildi; PDF'de JavaScript → karantina; temiz PDF → kullanılabilir · 5 başarısız denemede reddedildi; JSON gövde içerik sayılmaz · klinik dosyayı sekreter yükleyemez/göremez (404), asistan görür, yönetici listesinde yok; tarama zamanı olmadan DB available'a izin vermez · clamd INSTREAM sözleşme testi (sahte clamd: FOUND/OK; clamd yoksa dosya temiz sayılmaz) · **AT-12** izin yoksa 422; aynı anahtar tek mesaj; MOCK'a iletilir → submitted; 25 saat sonra unknown; olaylar queued→submitted→unknown, delivered yok · izin kuyruktayken geri çekilirse iptal; randevu izni kampanyayı kapsamaz; geçmiş korunur; hekim mesaj gönderemez · kontrol: sekreter planlayamaz, geçmiş tarih 422; görev sekretere; randevu verilince bağlanır ve görev kapanır · VİA Hazır: kabul edilmiş planda KAN-01 + yarınki randevu → anamnez ve belge eksik, görev açılır; belge plan kalemleriyle üretilir; karar bekleyen belge “kaydedilmedi” der; kabul + hekim istisnası (sekreter 403) → hazır, görev kapanır · çapraz tenant: B hekimi A'nın belge/dosya/iletişim/kontrol/hazırlık uçlarında 404, indirme 404, A şablonuyla A hastasına belge 422 · **dayanıklılık:** DB boştaki API bağlantılarını kapatınca API çökmez (düzeltmeden önce test işlenmemiş hatayla düşüyordu).

### Görev 4 E2E (`gorev4.spec.ts`, 1366 px + 360 px; worker çalışırken)
Sekreter: DEMO şablonu plan kalemleriyle önizler (DEMO uyarısı) → üretir → personel beyanı işaretlenmeden kabul kaydedilemez → kabul kaydedilir, “elektronik imza değildir” notu · temiz PNG yükler → gerçek kuyrukta taranıp “Kullanılabilir” olur · EICAR → “Karantinada”, indir düğmesi yok · İletişim: seed izni “İzin var”, MOCK uyarısı, mesaj kuyruğa alınır → “Sağlayıcıya iletildi (teslim bilinmiyor)”, “Teslim edildi” hiç görünmez · Hekim kontrol planlar · Yönetici şablon ve VİA Hazır kurallarını ve DEMO/inceleme uyarısını görür · taşma yok.

## Kabul testleri eşlemesi
| Test | Durum | Kanıt |
|---|---|---|
| AT-01 çapraz tenant (hasta ID, geçmiş, randevu, not, arama, randevu bağlama; erişim reddi audit'i) | **geçti** | tenant-isolation.test.ts. Dosya ve export uçları henüz yok → Görev 4/6'da genişletilecek |
| AT-02 sekreter API ile klinik not / iade | **geçti** | permissions-session.test.ts (not) + gorev3.test.ts (iade 403, iz bırakmaz) |
| AT-03 eşzamanlı randevu | **geçti** | 6 eşzamanlı istek → 1 × 201, 5 × 409; koltuk çakışması; `[)` sınırı; iptal kapasite bırakır |
| AT-04 gelecek doğum tarihi / ortak telefon | **geçti** | API + DB tetikleyicisi + E2E (arayüz mesajı) |
| AT-05 kabul edilmiş plan fiyatı değişmez | **geçti** | gorev2.test.ts (API + doğrudan SQL tetikleyici, tarife değişimi, yeni sürüm, eşzamanlı kabul) + E2E |
| AT-06 aynı ödeme anahtarı | **geçti** | gorev3.test.ts (tekrar, farklı içerik, 5 eşzamanlı) |
| AT-07 1.000 / 600 / 100 iade | **geçti** | gorev3.test.ts + E2E |
| AT-08 alacaksız ödeme → avans | **geçti** | gorev3.test.ts |
| AT-09 eşzamanlı dağıtım | **geçti** | gorev3.test.ts (5 tur + ters yön + doğrudan SQL) |
| AT-10 kur / prim oranı değişimi | **geçti (prim)** | gorev3.test.ts. Kur kısmı: çoklu para birimi davranışı kapalı (ADR-028); TRY dışı değer reddi test edildi, kur snapshot davranışı açılınca test edilecek |
| AT-11 dosya yükleme hatası / zararlı dosya | **geçti** | gorev4.test.ts + E2E (temel tarayıcı; clamd yalnız sözleşme testiyle — gerçek ClamAV bu ortamda yok) |
| AT-12 SMS teslim sonucu gelmez | **geçti (MOCK)** | gorev4.test.ts + E2E: submitted → unknown, delivered uydurulmaz. Gerçek sağlayıcı Görev 5 |
| AT-13 webhook tekrar/ters sıra/geçersiz imza | açık | Görev 5 |
| AT-14 onaydan sonra şablon değişir | **geçti** | gorev4.test.ts (API + doğrudan SQL) |
| AT-16, AT-17 | açık | Görev 7 |
| AT-15 klinik değiştirme, eski sekme | **geçti** | eski bağlamla okuma/yazma 409; yeni bağlamda yalnız yeni kliniğin verisi; rol yeni kliniğe göre |
| AT-18 360 px, klavye, ekran okuyucu | **kısmi** | E2E: 6 ana sayfada 360 px'de yatay taşma yok (ölçüt düzeltildi, aşağıya bkz.), “İçeriğe geç”, dialog erişilebilir adı, durumlar metin+renk, çalışma saati dışı/kapatma desen+metinle. Ekran okuyucuyla elle test ve renk körlüğü simülasyonu **yapılmadı** |
| AT-19 gece yarısı raporu | **geçti** (finans özeti) | gorev3.test.ts: 23:59:30 / 00:00:30, satır = toplam, iki gün = aralık. Diğer raporlar Görev 6 |
| AT-20 erişimi kaldırılan kullanıcı | **geçti** (API) | açık oturumla sonraki istek 403 `MEMBERSHIP_REVOKED`; çıkış sonrası 401. Worker kullanıcı adına iş yürütmüyor; dosya erişimi Görev 4 |

## RLS / güvenlik kontrolleri (geçti)
Uygulama rolü superuser/BYPASSRLS/tablo sahibi değil · `tenant_id` taşıyan **53 tablonun tamamında** RLS + FORCE (test artık tabloları otomatik keşfediyor; yeni tablo unutulursa kırılır) · bağlamsız sorgu 0 satır · havuzda bağlam sızmıyor · yanlış tenant_id ile INSERT reddediliyor · audit UPDATE/DELETE reddediliyor · istemci gövdesindeki `tenantId` yok sayılıyor · CSRF başlığı zorunlu · token DB'de düz değil · 5 hatalı girişte kilit.

## Elle yapılan görsel kontrol
Playwright ekran görüntüleriyle (1366 px ve 360 px) Giriş, Bugün, Hastalar, Hasta 360, Geçmiş, Ajanda, Yeni hasta çekmecesi incelendi. Bulunan ve düzeltilen hatalar: masaüstünde mobil menü düğmesi görünmesi, 360 px'de aramanın daralması, çekmecenin erişilebilir adının olmaması (E2E yakaladı), telefonun biçimsiz gösterimi.

## Görev 1'de bulunup düzeltilen hatalar
- **360 px'de Yönetim sayfası 496 px'e genişliyordu:** tablo başlığındaki `sr-only` metin mutlak konumla kaydırma kabından taşıyordu; mobil tarayıcı sayfayı uzaklaştırıyor, çekmece düğmeleri tıklanamıyordu. `.table-wrap` konumlandırıldı.
- **Taşma testi bu hatayı kaçırıyordu:** mobil emülasyonda `innerWidth` uzaklaştırılmış düzen genişliğini verdiği için ölçüt `scrollWidth ≤ görünüm alanı` olarak düzeltildi.
- Çekmece içeriği küçük ekranda alt düğme çubuğunun üzerine binebiliyordu (flex `min-height: 0`).
- Telefonda kullanıcı/rol/klinik görünmüyor, klinik değiştirilemiyordu → menüye hesap bloğu (ADR-020).
- Haftalık görünümde dilim düğmeleri tarayıcının gri zeminini alıyordu; Pazar başlığı satırları kaydırıyordu; çalışma günü özetinde “Pazartesi” ile “Pazar” aynı kısaltmayı alıyordu.
- Seed'deki sentetik ilişki etiketi anlamsızdı (“Anne”) → “Kardeş”.

## Görev 2'de bulunup düzeltilen hatalar
- API konum nesnesini `null` alanlarla döndürüyordu; aynı nesne geri gönderilince doğrulama reddediyordu (fiyat yenilemede zincirleme hata) → konum şeması `null` toleranslı.
- RLS testi sabit 19 tablo listesine bakıyordu; yeni tedavi tabloları kapsam dışıydı → otomatik keşif.
- 360 px'de plan tablosu sütunları okunamaz biçimde daralıyordu → tablo en az 720 px, kendi kabında yatay kayar; odontograma kaydırma ipucu.
- Takip ekranındaki ilerleme çubuğu tanımsız renk değişkeni yüzünden boş görünüyordu.
- Menüde Tedavi hâlâ “Plan” etiketiyle görünüyordu.
- Dört uç (gerçekleşen işlem iptal/düzeltme, plan sürümü iptali, tarife kaldırma) bulunamayan/başka kliniğe ait kimlikte 404 yerine 409 dönüyordu. RLS nedeniyle varlık sızmıyordu (var olmayan kimlik de aynı yanıtı alıyordu) ama sözleşme tutarsızdı → önce varlık kontrolü; çapraz tenant testi 6 uç daha kapsayacak şekilde genişletildi.
- `gorev1.spec` anamnez senaryosu temiz seed'de yarış koşuluna düşüyordu (onay düğmesine panel yüklenmeden bakılıyordu) → test bekleyecek şekilde düzeltildi; temiz seed + tam koşu 18/18.

## Görev 3'te bulunup düzeltilen hatalar
- Dağıtım/iade tetikleyicisindeki satır kilidi (`FOR UPDATE`) uygulama rolünde UPDATE yetkisi istediği için 500 dönüyordu; ödemeye UPDATE yetkisi vermek yerine kilit alan iki tetikleyici dar `SECURITY DEFINER` yapıldı (ADR-027). Gider ters kaydında gereksiz kilit kaldırıldı (tekil indeks yeterli).
- 0004 backfill'i sahip rolüyle FORCE RLS altında hiç satır görmeyecekti; backfill süresince ilgili tablolar geçici olarak FORCE dışı bırakılıp hemen geri alındı (dev veritabanında 2/2 doğrulandı).
- Worker bilinmeyen outbox konusunu “dead” yapıyordu; `via_net.changed` VİA Akış yenilemesi olarak işleniyor.
- Ağ hatasında “işlem kaydedilmedi” demek finans komutunda yanlıştı (yanıt kaybolmuş olabilir) → idempotent isteklerde “sonuç bilinmiyor, tekrar gönderin — çift kayıt oluşmaz”.
- 360 px'de hesap tabloları okunamaz biçimde daralıyordu → geniş tablolar en az 880 px, kendi kabında kayar.
- E2E: seçici “İade” metnini toplam kutusunun erişilebilir adında da buluyordu; tutar okuma yeniden yüklemeyle yarışıyordu.

## Görev 4'te bulunup düzeltilen hatalar
- **Worker ve API, veritabanı boştaki bağlantıları kapatınca çöküyordu** (pg havuzunun `error` olayı dinlenmiyordu; DB yeniden başlatma/failover süreci düşürürdü). Her iki havuza dinleyici eklendi; regresyon testi düzeltme olmadan düştüğü doğrulanarak eklendi.
- VİA Akış'a eklenen SQL'lerde aynı parametre hem metin hem uuid olarak kullanılıyordu (“inconsistent types deduced”); worker taraması sessizce yeniden deneme döngüsüne düşüyordu → açık tür dönüşümü.
- Göreli `STORAGE_DIR` API ve worker'da farklı dizinlere çözülüyordu → depo köküne göre çözülür.
- Önceden var olan iki test kararsızlığı: rol değişikliği testi finans kullanıcısını kalıcı olarak sekretere çeviriyordu (dosya sırasına göre Görev 3 testleri 403 alıyordu) → test eski rolü geri yükler; “geciken randevu” testi günün saatine bağlıydı (10:00'dan önce başarısız) → tarama sabit klinik saatiyle çalıştırılır.

## Çalıştırılmayan / yapılamayan
- Gerçek ClamAV (clamd) bu ortamda kurulu değil (imza veritabanı indirilemiyor); yalnız sahte clamd ile protokol sözleşmesi test edildi.
- Yazdırma penceresi E2E'de açılmadı (tarayıcı diyaloğu otomasyonu kilitler); `printed` kanıt olayı API testinde doğrulandı.
- Performans hedefi (100.000 hasta, p95 500 ms) **ölçülmedi**.
- Windows üzerinde kurulum bu oturumda **denenmedi** (geliştirme Linux konteynerde yapıldı); README adımları Docker Desktop + Node 22 + pnpm varsayar.
- Ekran okuyucu (NVDA/VoiceOver) testi yapılmadı.
