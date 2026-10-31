# Devir notu (handoff)

**Son güncelleme:** 22.10.2026 · Oturum 4 (Görev 3 tamamlandı) · Dal: `main` · Son commit: `git log -1`

## Durum özeti
Oturum 1: tenant/rol/oturum → hasta → hekim/koltuk/randevu → VİA Akış → VİA İz çekirdeği.
Oturum 2 (Görev 1): çalışma saatleri, kapatmalar, işlem türleri, hekim/koltuk yönetimi, yakın/veli, sürümlü anamnez, ekip daveti, haftalık ajanda.
Oturum 3 (Görev 2): diş modeli (FDI), özgün odontogram, bulgu ve tanı, işlem kataloğu + sürümlü/hekime özel tarife, plan → teklif → karar → yeni sürüm (AT-05), ziyarete bağlı gerçekleşen işlem, tedavi takibi, VİA Akış plan görevleri. Oturum 4 (Görev 3): VİA Net — alacak, ödeme, dağıtım, avans, iade, kasa, gider ayrı kayıtlar; idempotency; DB tutar tetikleyicileri; işlemden otomatik alacak; tahsilat bazlı prim tahakkuku; klinik özeti (işlem ≠ tahsilat), bakiyeler, kasa raporu.
Tüm veriler gerçek PostgreSQL'de; klinik içerik, fiyatlar ve prim oranı sentetik DEMO.

## Gerçekten çalışan akışlar
1. Giriş / çıkış, çok klinikli kullanıcıda klinik değiştirme, eski sekme koruması.
2. Hasta: oluşturma, arama, düzenleme, Hasta 360 (Özet / Tedavi / **Finans** / Sağlık / Geçmiş çalışır; Belgeler / İletişim dürüstçe “geliştirilmedi”).
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

## Kurulum
`README.md` → Kurulum. Kısaca: `pnpm install` → `.env` → `pnpm db:up && pnpm db:roles && pnpm db:migrate && pnpm db:seed` → `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:web`.
**Önceki oturumlardan gelen yerel veritabanı için:** `pnpm db:migrate` 0003/0004'ü ekler (0004, var olan gerçekleşen işlemler için alacak üretir); finans demo verisi (kasalar, %10 DEMO prim kuralı, 1.000/600 alacak-ödeme, 300 avans) için `pnpm db:reset && pnpm db:seed`.

## Sürümler
Node 22, pnpm 10.28, TS 5.9.3, NestJS 11.2.7, Next 15.5.28, React 19.1.10, zod 4.6.7, pg 8.23.1, PostgreSQL 16, Vitest 3.2.7, Playwright 1.64.1 (ADR-002).

## Migration durumu
| Dosya | İçerik | Durum |
|---|---|---|
| `0001_core.sql` | çekirdek tablolar, RLS, grant | uygulandı (dev + test) |
| `0002_agenda_patient_team.sql` | işlem türü, çalışma saati, kapatma, yakınlar, anamnez, davet | uygulandı (dev + test) |
| `0003_treatment.sql` | katalog, tarife, bulgu, tanı, plan/sürüm/kalem/karar, gerçekleşen işlem, değişmezlik tetikleyicileri, `clinical_notes.appointment_id`, plan görev türleri | uygulandı (dev + test) |
| `0004_finance.sql` | kasa, alacak, ödeme, dağıtım, iade, gider, kasa hareketi, idempotency, prim kuralı/tahakkuku; tutar ve değişmezlik tetikleyicileri; geçmiş işlemler için alacak backfill | uygulandı (dev + test) |

## Testler (son koşu, hepsi çalıştırıldı)
contracts 14/14 · web kontrast 14/14 · API entegrasyon **99/99** (gerçek PostgreSQL; `gorev3` 21) · Playwright **22/22** (1366 px + 360 px, temiz seed) · typecheck 5 paket temiz · `next build` başarılı · RLS: `tenant_id` taşıyan 39 tablonun tamamında ENABLE+FORCE (otomatik keşif). Ayrıntı: `verification.md`.

## Kararlar
ADR-001…031 (`decisions.md`). Görev 3: VİA Net hesap modeli, açık dağıtım, ters kayıt, DB tetikleyicisi + hasta kilidi, dar SECURITY DEFINER (027) · TRY ilk kapsam, kur alanları hazır/kapalı (028) · Idempotency-Key ve iade algoritması (029) · kart = manuel kayıt, sanal POS yok (030) · metrik ayrımı, klinik günü, prim snapshot'ı (031). Ödeme kaydı/dağıtım/iade davranışı kaynak envanterde test edilmedi; bunlar VİADENT tasarımıdır.

## Bilinen hatalar / riskler
- Finans: iade ikinci onay eşiği yok; makbuz/e-belge yok (Görev 5); banka/POS ekstre mutabakatı yok; ticari indirim / alacak düzeltmesi kaydı yok (yalnız alacak iptali); vergi dahil/hariç ayrımı yapılmadı; prim ödemesi Görev 6.
- Ödeme ekrandan en fazla 30 gün geriye girilebilir (daha eski kayıt Görev 7 içe aktarımıyla).
- Hekim işlem iptal edince bağlı alacak iptal olur ve dağıtılmış tahsilat avansa döner (para kaybolmaz); bu finans etkisi audit'te görünür ama finans onayı istemez — pilotta değerlendirilecek.
- Katalog, fiyatlar, bulgu türleri ve semboller DEMO; pilot hekimle doğrulanmadan gerçek klinikte kullanılmamalı. Tanı kodu serbest metin.
- Plan kalemi düzenleme ve gerçekleşen işlem düzeltme arayüzü yok (API var); arayüzde sil+ekle / iptal kullanılıyor.
- Odontogram planlı/gerçekleşen işlemleri yüzey rengiyle değil sembolle (P, ✓) gösterir.
- Telefon görünümünde plan tabloları kendi kabında yatay kayar (bilinçli; 720 px en az genişlik).
- Teklif çıktısı/PDF ve imzalı onam yok (Görev 4); karar kaydı hastanın beyanıdır.
- Önceki riskler sürüyor: bellek içi giriş hız sınırı, şifresiz kimlik no, tsx ile çalışan API/worker, sabit VİA Akış eşikleri, Windows kurulumu denenmedi, performans ölçülmedi, ekran okuyucuyla elle test yapılmadı.

## Açık engeller (dış)
- SMS/WhatsApp, e-Fatura, e-Nabız/DHBS, ödeme sağlayıcısı: erişim/sözleşme yok → Görev 5'te yalnız etiketli mock.
- Klinik içerik (anamnez, bulgu listesi, tanı kod sistemi, onam): klinisyen/hukuk onayı.
- Mali kurallar (KDV dahil/hariç gösterimi, yuvarlama, prim kesinti sırası, iade belgesi): mali müşavir onayı açık.
- Ödeme sağlayıcısı / sanal POS: sözleşme yok → yalnız manuel kart kaydı (ADR-030).

## İzlenebilirlik
`traceability.csv`: 125 kaynak ID'si. Ek A (Görev 3 sonrası): çalışıyor 19 · kısmi 17 · planlandı 29 · ertelendi 10 · engelli 4 · uygulanmayacak 1. Ek B değişmedi. Görev 3'te güncellenen: H06, R02, R11, T07 (çalışıyor); O03, R01, R20, T08, T09, T12 (kısmi).

## Sıradaki tek iş paketi
**Görev 4 — Belge, dosya ve takip (VD-011)** — ayrıntı `backlog.md`. Prompttaki Görev 4 metniyle başlat.
