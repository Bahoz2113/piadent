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

## Son koşu sonuçları (22.10.2026, Görev 2 sonrası)
| Paket | Test | Sonuç |
|---|---|---|
| `@viadent/contracts` | Türkçe normalize, telefon, TCKN biçimi, saat dilimi (gece yarısı, DST), durum makinesi, rol matrisi | **11/11 geçti** |
| `@viadent/web` (vitest) | WCAG kontrast — 11 metin/zemin çifti ≥ 4.5:1, beyaz/birincil, turuncu vurgu kısıtı, odak ≥ 3:1 | **14/14 geçti** |
| `@viadent/api` | `tenant-isolation` 12 · `permissions-session` 12 · `scheduling-patients` 18 · `gorev1` 19 · `gorev2` 17 | **78/78 geçti** |
| `@viadent/web` (Playwright) | `critical-flow` 2 + `gorev1` 4 + `gorev2` 3 senaryo × {1366 px, 360 px} | **18/18 geçti** |
| Typecheck | contracts, db, api, worker, web | **temiz** |
| `next build` | üretim derlemesi | **başarılı** |

### Görev 1 testlerinin kapsadığı kurallar (`gorev1.test.ts`)
Çalışma saati dışı → 422 + bloklar; bilinçli onayla kayıt ve audit izi · bloğa taşan randevu ve tatil günü · çakışan blok reddi · sekreter takvim yönetemez · tanımsız saat = kısıt yok · pasif hekime randevu yok · işlem türü varsayılanı ve pasif tür · kapatma randevuyu silmez, çakışanı döner, VİA Akış görevi açar, kapalı aralığa onayla bile randevu yok, başka hekim etkilenmez, iptalde görev kapanır · klinik kapsamlı kapatma · **eşzamanlı kapatma + randevu (4 tur)** · haftalık okuma ve 14 gün sınırı · 18 yaş altı uyarısı, yasal temsil dayanağı, ters yön, tekil çift, gerekçeli sonlandırma, başka kliniğin hastası yakın yapılamaz · anamnez: sekreter/yönetici erişemez, özet alanı `null`; asistan kaydı onay bekler ve klinik görev yalnız sağlık rollerine görünür; hekim onayı; sürümleme, eski temel 409, tanımsız soru reddi, audit içerik taşımaz, uygulama rolü UPDATE edemez · davet: tek kullanım, token düz saklanmaz, kısa parola, süresi dolmuş/iptal edilmiş davet, mevcut kullanıcı kendi parolasıyla, yanlış parola · rol değişikliği bir sonraki istekte etkili, kendine uygulanamaz.

### Görev 2 testlerinin kapsadığı kurallar (`gorev2.test.ts`, 17)
Katalog yalnız yöneticide, kod tekil ve değiştirilemez · yayınlanmış tarife API **ve doğrudan SQL** ile değişmez, kopyadan yeni sürüm, boş tarife yayınlanamaz · hekime özel tarife önceliği, geleceğe tarihli tarife bugünü etkilemez · konum kapsamı ve FDI/yüzey kuralları (geçersiz diş 19/56, ön dişte O yüzeyi) · indirim gerekçesi ve üst sınır, tarifede olmayan işlemde elle fiyat + açıklama · sekreter plan okur ama kalem ekleyemez, klinik haritayı okuyamaz · **AT-05:** teklif sunulan sürüm kilitli, kararsız yanıt durumu değiştirmez, kabul edilen fiyat API ve DB'de değişmez, tarife sonradan değişse de snapshot korunur, değişiklik yeni sürümle, eski kabul yeni kabule kadar geçerli, eşzamanlı iki kabul → [200, 409] · geliş kaydı olmayan ziyarete işlem bağlanamaz; asistan/sekreter işlem kaydedemez · kısmi gerçekleşme 1000.00 + 1000.00 + 999.99 = 2999.99, kalan aşılamaz · iptal gerekçeli ve kalanı serbest bırakır, düzeltme eski kaydı silmez · plansız işlem tarifeden fiyatlanır, kabul edilmemiş kalem gerçekleştirilemez · bulgu/tanı ekleme, hatalı kayıt gerekçesi, audit tanı metni taşımaz · çapraz tenant: başka kliniğin hastası, planı, plan sürümü, tanısı 404 · VİA Akış: randevusuz kabul edilmiş plan ve yanıtsız teklif görevi açılır ve kaynak çözülünce kapanır.

### Görev 2 E2E (`gorev2.spec.ts`, 1366 px + 360 px)
Hekim: odontogramda seed bulgusu erişilebilir adla (“Diş 16; Çürük…”) → kabul edilmiş kalemi bugünkü ziyarete bağlayıp gerçekleştirme → yeni plan → odontogramdan diş 37 + O yüzeyi → tarife fiyatı görünür → teklif → kabul → silme düğmesi kaybolur · Sekreter: klinik harita kapalı uyarısı, plan görünür, “Gerçekleştir/Yeni plan” yok · Tedavi takibi listesi ve yönetici katalog/tarife ekranı (yayınlanmış tarife salt okunur) · her ekranda 360 px yatay taşma yok.

## Kabul testleri eşlemesi
| Test | Durum | Kanıt |
|---|---|---|
| AT-01 çapraz tenant (hasta ID, geçmiş, randevu, not, arama, randevu bağlama; erişim reddi audit'i) | **geçti** | tenant-isolation.test.ts. Dosya ve export uçları henüz yok → Görev 4/6'da genişletilecek |
| AT-02 sekreter API ile klinik not | **geçti** | permissions-session.test.ts. İade ucu henüz yok → Görev 3 |
| AT-03 eşzamanlı randevu | **geçti** | 6 eşzamanlı istek → 1 × 201, 5 × 409; koltuk çakışması; `[)` sınırı; iptal kapasite bırakır |
| AT-04 gelecek doğum tarihi / ortak telefon | **geçti** | API + DB tetikleyicisi + E2E (arayüz mesajı) |
| AT-05 kabul edilmiş plan fiyatı değişmez | **geçti** | gorev2.test.ts (API + doğrudan SQL tetikleyici, tarife değişimi, yeni sürüm, eşzamanlı kabul) + E2E |
| AT-06..AT-14, AT-16, AT-17 | açık | İlgili modüller yok (Görev 3–7) |
| AT-15 klinik değiştirme, eski sekme | **geçti** | eski bağlamla okuma/yazma 409; yeni bağlamda yalnız yeni kliniğin verisi; rol yeni kliniğe göre |
| AT-18 360 px, klavye, ekran okuyucu | **kısmi** | E2E: 6 ana sayfada 360 px'de yatay taşma yok (ölçüt düzeltildi, aşağıya bkz.), “İçeriğe geç”, dialog erişilebilir adı, durumlar metin+renk, çalışma saati dışı/kapatma desen+metinle. Ekran okuyucuyla elle test ve renk körlüğü simülasyonu **yapılmadı** |
| AT-19 gece yarısı raporu | **kısmi** | Gün sınırı birim testi geçti; rapor modülü yok |
| AT-20 erişimi kaldırılan kullanıcı | **geçti** (API) | açık oturumla sonraki istek 403 `MEMBERSHIP_REVOKED`; çıkış sonrası 401. Worker kullanıcı adına iş yürütmüyor; dosya erişimi Görev 4 |

## RLS / güvenlik kontrolleri (geçti)
Uygulama rolü superuser/BYPASSRLS/tablo sahibi değil · `tenant_id` taşıyan **29 tablonun tamamında** RLS + FORCE (test artık tabloları otomatik keşfediyor; yeni tablo unutulursa kırılır) · bağlamsız sorgu 0 satır · havuzda bağlam sızmıyor · yanlış tenant_id ile INSERT reddediliyor · audit UPDATE/DELETE reddediliyor · istemci gövdesindeki `tenantId` yok sayılıyor · CSRF başlığı zorunlu · token DB'de düz değil · 5 hatalı girişte kilit.

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

## Çalıştırılmayan / yapılamayan
- Performans hedefi (100.000 hasta, p95 500 ms) **ölçülmedi**.
- Windows üzerinde kurulum bu oturumda **denenmedi** (geliştirme Linux konteynerde yapıldı); README adımları Docker Desktop + Node 22 + pnpm varsayar.
- Ekran okuyucu (NVDA/VoiceOver) testi yapılmadı.
