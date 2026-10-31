# Devir notu (handoff)

**Son güncelleme:** 22.10.2026 · Oturum 3 (Görev 2 tamamlandı) · Dal: `main` · Son commit: `git log -1`

## Durum özeti
Oturum 1: tenant/rol/oturum → hasta → hekim/koltuk/randevu → VİA Akış → VİA İz çekirdeği.
Oturum 2 (Görev 1): çalışma saatleri, kapatmalar, işlem türleri, hekim/koltuk yönetimi, yakın/veli, sürümlü anamnez, ekip daveti, haftalık ajanda.
Oturum 3 (Görev 2): diş modeli (FDI), özgün odontogram, bulgu ve tanı, işlem kataloğu + sürümlü/hekime özel tarife, plan → teklif → karar → yeni sürüm (AT-05), ziyarete bağlı gerçekleşen işlem, tedavi takibi, VİA Akış plan görevleri. Tüm veriler gerçek PostgreSQL'de; klinik içerik ve fiyatlar sentetik DEMO.

## Gerçekten çalışan akışlar
1. Giriş / çıkış, çok klinikli kullanıcıda klinik değiştirme, eski sekme koruması.
2. Hasta: oluşturma, arama, düzenleme, Hasta 360 (Özet / **Tedavi** / Sağlık / Geçmiş çalışır; Finans / Belgeler / İletişim dürüstçe “geliştirilmedi”).
3. Ajanda: gün/hafta, çakışma engeli, çalışma saati, kapatma, durum makinesi, iletişim sonucu.
4. Bugün: sayaçlar ve VİA Akış (7 tür) — geciken geliş, teyit, eksik iletişim, kapatma çakışması, anamnez onayı, **randevusuz kabul edilmiş plan**, **yanıtsız teklif** (“Planı aç” ile Tedavi sekmesine).
5. Klinik not: yalnız ekleme + gerekçeli düzeltme + **ziyarete bağlama**.
6. Yönetim: ekip/davet/rol, hekim/koltuk, çalışma saatleri, işlem türleri, kapatmalar, **Katalog ve tarife** (işlem ekle/düzenle/pasifleştir; tarife oluştur/kopyala, taslak fiyat düzenle, yayınla, kaldır).
7. **Tedavi sekmesi (hekim):** odontogram (daimi/süt/karma, dişe ve yüzeye tıklama, desen+sembol+erişilebilir ad) → seçili diş paneli (mevcut durum / tanı / planlı / gerçekleşen) → bulgu ve tanı ekleme → yeni plan → kalem ekleme (konum kapsamına göre diş/yüzey/çeyrek/çene/ağız, tarife fiyatı görünür; indirim + gerekçe; tarifede yoksa elle fiyat + açıklama) → fiyatları yenile → teklif → hasta kararı (kabul/ret/kararsız) → yeni sürüm → kabul edilen kalemi geliş kaydı yapılmış ziyarete bağlayıp gerçekleştirme → gerçekleşen listesinde gerekçeli iptal.
8. **Sekreter:** plan ve teklifi görür, hasta kararını kaydeder; odontogram/tanı ve işlem tamamlama kapalı.
9. **/tedavi takip:** karar bekleyen teklif, devam eden kabul edilmiş plan, randevusu olmayan plan; plan bedeli + ilerleme + sonraki randevu.
10. Worker: outbox, yeniden deneme, 60 sn tarama (plan görevleri dahil).

## Kurulum
`README.md` → Kurulum. Kısaca: `pnpm install` → `.env` → `pnpm db:up && pnpm db:roles && pnpm db:migrate && pnpm db:seed` → `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:web`.
**Oturum 2'den gelen yerel veritabanı için:** `pnpm db:migrate` 0003'ü ekler; tedavi demo verisi (katalog, tarife, kabul edilmiş plan, bulgular) için `pnpm db:reset && pnpm db:seed`.

## Sürümler
Node 22, pnpm 10.28, TS 5.9.3, NestJS 11.2.7, Next 15.5.28, React 19.1.10, zod 4.6.7, pg 8.23.1, PostgreSQL 16, Vitest 3.2.7, Playwright 1.64.1 (ADR-002).

## Migration durumu
| Dosya | İçerik | Durum |
|---|---|---|
| `0001_core.sql` | çekirdek tablolar, RLS, grant | uygulandı (dev + test) |
| `0002_agenda_patient_team.sql` | işlem türü, çalışma saati, kapatma, yakınlar, anamnez, davet | uygulandı (dev + test) |
| `0003_treatment.sql` | katalog, tarife, bulgu, tanı, plan/sürüm/kalem/karar, gerçekleşen işlem, değişmezlik tetikleyicileri, `clinical_notes.appointment_id`, plan görev türleri | uygulandı (dev + test) |

## Testler (son koşu, hepsi çalıştırıldı)
contracts 11/11 · web kontrast 14/14 · API entegrasyon **78/78** (gerçek PostgreSQL; `gorev2` 17) · Playwright **18/18** (1366 px + 360 px, temiz seed üzerinde) · typecheck 5 paket temiz · `next build` başarılı · RLS: `tenant_id` taşıyan 29 tablonun tamamında ENABLE+FORCE (otomatik keşif). Ayrıntı: `verification.md`.

## Kararlar
ADR-001…026 (`decisions.md`). Görev 2: FDI + özgün odontogram, bulgu/tanı/plan/gerçekleşen ayrı (021) · katalog + sürümlü tarife, hekim önceliği, snapshot, kesin para (022) · tanı kod sistemi seçilmedi, resmî uyum iddiası yok (023) · plan sürümü/teklif/kabul, DB tetikleyicisiyle donma, kararsız, eşzamanlı kabul (024) · ziyarete bağlı gerçekleşen işlem, son adet kalanı alır (025) · plan görevleri (026). Kaynak envanterde tanı ve teklif davranışı açılmadığı için bunlar **VİADENT tasarımıdır**, rakip özelliği olarak sunulmaz.

## Bilinen hatalar / riskler
- **Gerçekleşen işlem hasta hesabına borç yazmaz** — Görev 3. Şu an hiçbir ekran bunu gelir/tahsilat gibi göstermez.
- Katalog, fiyatlar, bulgu türleri ve semboller DEMO; pilot hekimle doğrulanmadan gerçek klinikte kullanılmamalı. Tanı kodu serbest metin.
- Plan kalemi düzenleme ve gerçekleşen işlem düzeltme arayüzü yok (API var); arayüzde sil+ekle / iptal kullanılıyor.
- Odontogram planlı/gerçekleşen işlemleri yüzey rengiyle değil sembolle (P, ✓) gösterir.
- Telefon görünümünde plan tabloları kendi kabında yatay kayar (bilinçli; 720 px en az genişlik).
- Teklif çıktısı/PDF ve imzalı onam yok (Görev 4); karar kaydı hastanın beyanıdır.
- Önceki riskler sürüyor: bellek içi giriş hız sınırı, şifresiz kimlik no, tsx ile çalışan API/worker, sabit VİA Akış eşikleri, Windows kurulumu denenmedi, performans ölçülmedi, ekran okuyucuyla elle test yapılmadı.

## Açık engeller (dış)
- SMS/WhatsApp, e-Fatura, e-Nabız/DHBS, ödeme sağlayıcısı: erişim/sözleşme yok → Görev 5'te yalnız etiketli mock.
- Klinik içerik (anamnez, bulgu listesi, tanı kod sistemi, onam): klinisyen/hukuk onayı.
- Mali kurallar (KDV, yuvarlama, prim kesinti sırası): mali müşavir — Görev 3 öncesi en azından KDV'nin dahil/hariç gösterimi netleşmeli.

## İzlenebilirlik
`traceability.csv`: 125 kaynak ID'si. Ek A (Görev 2 sonrası): çalışıyor 15 · kısmi 11 · planlandı 39 · ertelendi 10 · engelli 4 · uygulanmayacak 1. Ek B değişmedi. Görev 2'de güncellenen: H04, T01, T02, T03 (çalışıyor); H05, H08, R04 (kısmi).

## Sıradaki tek iş paketi
**Görev 3 — Finans / VİA Net (VD-009)** — ayrıntı `backlog.md`. Prompttaki Görev 3 metniyle başlat.
