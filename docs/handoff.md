# Devir notu (handoff)

**Son güncelleme:** 23.10.2026 · Oturum 5 (Görev 4 tamamlandı) · Dal: `main` · Son commit: `git log -1`

## Durum özeti
Oturum 1: tenant/rol/oturum → hasta → hekim/koltuk/randevu → VİA Akış → VİA İz çekirdeği.
Oturum 2 (Görev 1): çalışma saatleri, kapatmalar, işlem türleri, hekim/koltuk yönetimi, yakın/veli, sürümlü anamnez, ekip daveti, haftalık ajanda.
Oturum 3 (Görev 2): diş modeli (FDI), özgün odontogram, bulgu ve tanı, işlem kataloğu + sürümlü/hekime özel tarife, plan → teklif → karar → yeni sürüm (AT-05), ziyarete bağlı gerçekleşen işlem, tedavi takibi, VİA Akış plan görevleri. Oturum 4 (Görev 3): VİA Net — alacak, ödeme, dağıtım, avans, iade, kasa, gider ayrı kayıtlar; idempotency; DB tutar tetikleyicileri; işlemden otomatik alacak; tahsilat bazlı prim tahakkuku; klinik özeti (işlem ≠ tahsilat), bakiyeler, kasa raporu.
Oturum 5 (Görev 4): belge türü / şablon sürümü / hasta belgesi / onay isteği / kanıt olayı ayrımı (SHA-256, AT-14), özel dosya deposu + tarama portu (AT-11), amaç × kanal iletişim tercihi ve MOCK mesaj (AT-12), kontrol (follow-up), VİA Hazır temeli.
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
16. **İletişim:** amaç × kanal izin tablosu + geçmiş; MOCK mesaj (dışarı gitmez) → “iletildi (teslim bilinmiyor)” → 24 saat sonra “bilinmiyor”.
17. **Kontrol:** hekim planlar (Tedavi sekmesi) → vadeye 14 gün kala sekreterya görevi → randevu bağlanır.
18. **VİA Hazır:** yönetici kural tanımlar (işlem → belge, güncel onaylı anamnez); ajanda randevu ayrıntısında hazırlık paneli; yarınki eksikler Bugün'e görev; hekim gerekçeli istisna.
19. **Yönetim → Belge şablonları:** şablon/sürüm (taslak → onay → kullanımdan kaldır), belge türleri (etkin/pasif), VİA Hazır kuralları.

## Kurulum
`README.md` → Kurulum. Kısaca: `pnpm install` → `.env` → `pnpm db:up && pnpm db:roles && pnpm db:migrate && pnpm db:seed` → `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:web`. **Worker artık zorunludur**: dosya taraması ve mesaj kuyruğu onunla ilerler. Dosyalar `STORAGE_DIR` (varsayılan depo kökünde `.storage/`, git dışı) altında; üretimde `CLAMD_HOST` tanımlanmalı.
**Önceki oturumlardan gelen yerel veritabanı için:** `pnpm db:migrate` 0003/0004'ü ekler (0004, var olan gerçekleşen işlemler için alacak üretir); finans demo verisi (kasalar, %10 DEMO prim kuralı, 1.000/600 alacak-ödeme, 300 avans) için `pnpm db:reset && pnpm db:seed`.

## Sürümler
Node 22, pnpm 10.28, TS 5.9.3, NestJS 11.2.7, Next 15.5.28, React 19.1.10, zod 4.6.7, pg 8.23.1, PostgreSQL 16, Vitest 3.2.7, Playwright 1.64.1 (ADR-002).

## Migration durumu
| Dosya | İçerik | Durum |
|---|---|---|
| `0001_core.sql` | çekirdek tablolar, RLS, grant | uygulandı (dev + test) |
| `0002_agenda_patient_team.sql` | işlem türü, çalışma saati, kapatma, yakınlar, anamnez, davet | uygulandı (dev + test) |
| `0003_treatment.sql` | katalog, tarife, bulgu, tanı, plan/sürüm/kalem/karar, gerçekleşen işlem, değişmezlik tetikleyicileri, `clinical_notes.appointment_id`, plan görev türleri | uygulandı (dev + test) |
| `0005_documents_files.sql` | belge türü/şablon/sürüm, hasta belgesi, onay isteği, kanıt, dosya + erişim izi, iletişim tercihi, mesaj + teslim olayı, kontrol, VİA Hazır kural/istisna; değişmezlik ve durum tetikleyicileri; görev türleri | uygulandı (dev + test) |
| `0004_finance.sql` | kasa, alacak, ödeme, dağıtım, iade, gider, kasa hareketi, idempotency, prim kuralı/tahakkuku; tutar ve değişmezlik tetikleyicileri; geçmiş işlemler için alacak backfill | uygulandı (dev + test) |

## Testler (son koşu, hepsi çalıştırıldı)
contracts 14/14 · web kontrast 14/14 · API entegrasyon **118/118** (gerçek PostgreSQL; `gorev4` 19) · Playwright **28/28** (1366 px + 360 px, temiz seed, worker çalışırken) · typecheck 5 paket temiz · `next build` başarılı · RLS: `tenant_id` taşıyan 53 tablonun tamamında ENABLE+FORCE (otomatik keşif). Ayrıntı: `verification.md`.

## Kararlar
ADR-001…036 (`decisions.md`). Görev 4: belge kavramları ayrı, katalog VİADENT'in kendi sınıflandırması, Ek B yalnız referans, DEMO şablon (032) · kabul yüz yüze + personel beyanı, e-imza iddiası yok (033) · özel depo + tarama portu, temel tarayıcı tam antivirüs değil, üretimde clamd (034) · amaç × kanal izin, MOCK mesaj, teslim uydurulmaz (035) · kontrol bağlama ve VİA Hazır, tıbbi karar yok (036). Önceki: VİA Net (027–031), tedavi (021–026).

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
- Mesaj sağlayıcısı yalnız MOCK; hiçbir gerçek SMS/WhatsApp/e-posta gönderilmez.
- Önceki riskler sürüyor: bellek içi giriş hız sınırı, şifresiz kimlik no, tsx ile çalışan API/worker, sabit VİA Akış eşikleri, Windows kurulumu denenmedi, performans ölçülmedi, ekran okuyucuyla elle test yapılmadı.

## Açık engeller (dış)
- SMS/WhatsApp, e-Fatura, e-Nabız/DHBS, ödeme sağlayıcısı: erişim/sözleşme yok → Görev 5'te yalnız etiketli mock.
- Klinik içerik (anamnez, bulgu listesi, tanı kod sistemi, onam): klinisyen/hukuk onayı.
- Mali kurallar (KDV dahil/hariç gösterimi, yuvarlama, prim kesinti sırası, iade belgesi): mali müşavir onayı açık.
- Ödeme sağlayıcısı / sanal POS: sözleşme yok → yalnız manuel kart kaydı (ADR-030).
- Belge/onam içeriği ve kabul yönteminin hukuki uygunluğu: klinik + hukuk değerlendirmesi gerekli (ADR-033).
- ClamAV imza güncellemesi için ağ erişimi (üretim ortamı).

## İzlenebilirlik
`traceability.csv`: 125 kaynak ID'si. Ek A (Görev 4 sonrası): çalışıyor 21 · kısmi 23 · planlandı 21 · ertelendi 10 · engelli 4 · uygulanmayacak 1. Ek B: 43 başlık VİADENT belge türüne eşlendi (kısmi: tür + DEMO şablon altyapısı, gerçek metin yok), B03 ve B43 uygulanmayacak. Görev 4'te güncellenen Ek A: H11, H15 (çalışıyor); H10, H13, A02, A03, R14, R22 (kısmi).

## Sıradaki tek iş paketi
**Görev 5 — Sağlayıcılar ve VİA Köprü (VD-012)** — ayrıntı `backlog.md`. Prompttaki Görev 5 metniyle başlat.
