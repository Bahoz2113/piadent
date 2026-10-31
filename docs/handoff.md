# Devir notu (handoff)

**Son güncelleme:** 22.10.2026 · Oturum 2 (Görev 1 tamamlandı) · Dal: `main` · Son commit: `git log -1`

## Durum özeti
Oturum 1: tenant/rol/oturum → hasta → hekim/koltuk/randevu → VİA Akış → VİA İz çekirdeği.
Oturum 2 (Görev 1): çalışma saatleri, kapatmalar, işlem türleri, hekim/koltuk yönetimi, yakın/veli ve yasal temsil, sürümlü anamnez + hekim onayı, ekip daveti ve rol değişikliği, haftalık ajanda. Tüm veriler gerçek PostgreSQL'de; demo verisi tamamen sentetik.

## Gerçekten çalışan akışlar
1. Giriş / çıkış, çok klinikli kullanıcıda klinik değiştirme, eski sekme koruması.
2. Yönetici: ekip listesi, erişim kaldırma (açık oturum anında etkisiz).
3. Hasta: oluşturma (gelecek doğum tarihi reddi, ortak telefon serbest, mükerrer aday onayı, kimlik no tekilliği), Türkçe-duyarsız arama, düzenleme (sürüm kontrolü), Hasta 360 (Özet / Sağlık / Geçmiş çalışır; Tedavi / Finans / Belgeler / İletişim dürüstçe “geliştirilmedi”).
4. Ajanda: gün görünümü (hekime/koltuğa göre), mobil gün listesi, randevu oluşturma (eşzamanlı çakışma DB'de engelli), durum değişikliği (durum makinesi), iletişim sonucu (ayrı alan), gerekçeli iptal.
5. Bugün: günün sayaçları, VİA Akış görevleri (geciken geliş, yarınki teyit, eksik iletişim) ve tek tıkla Geldi/Gelmedi/Bilgi verildi/Ulaşılamadı; görev kaynak çözülünce kendiliğinden kapanır.
6. Klinik not (hekim): yalnız ekleme + gerekçeli düzeltme; sekreter/yönetici erişemez.
7. Worker: outbox tüketimi, geri çekilmeli yeniden deneme, 60 sn'de bir zaman tabanlı tarama — kısıtlı `viadent_worker` rolüyle.
8. Ajanda: gün/hafta görünümü, çalışma saati dışı gölge, kapatma blokları; randevu formunda işlem türü (süre varsayılanı), çalışma saati dışı uyarısı + bilinçli onay, kapalı aralık reddi.
9. Yönetim: ekip (rol değiştir, erişim kaldır), davet (tek kullanımlık bağlantı, `/davet/<token>` kabul sayfası), hekim/koltuk, çalışma saatleri, işlem türleri, kapatmalar (çakışan randevular listelenir, VİA Akış'a görev).
10. Hasta 360: kritik anamnez uyarıları (yalnız sağlık rolleri), 18 yaş altı/temsilci uyarısı, yakınlar kartı, Sağlık sekmesinde sürümlü anamnez + geçmiş + hekim onayı.
11. VİA Akış: 5 görev türü (geciken geliş, yarınki teyit, eksik iletişim, kapatma çakışması, anamnez onayı).

## Kurulum
`README.md` → Kurulum. Kısaca: `pnpm install` → `.env` → `pnpm db:up && pnpm db:roles && pnpm db:migrate && pnpm db:seed` → `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:web`.

## Sürümler
Node 22, pnpm 10.28, TS 5.9.3, NestJS 11.2.7, Next 15.5.28, React 19.1.10, zod 4.6.7, pg 8.23.1, PostgreSQL 16, Vitest 3.2.7, Playwright 1.64.1 (ADR-002).

## Migration durumu
| Dosya | İçerik | Durum |
|---|---|---|
| `0001_core.sql` | extensions, app şeması, kimlik, tenant, hasta, klinik not, ajanda (exclusion), görev, audit, outbox, RLS, grant | uygulandı (dev + test) |
| `0002_agenda_patient_team.sql` | işlem türü, çalışma saati, kapatma, hasta yakınları, anamnez sürüm/onay, davet + `app.invitation_tenant`, görev türleri | uygulandı (dev + test) |

**Not:** Oturum 1'de kurduğun yerel veritabanında `pnpm db:migrate` 0002'yi ekler; seed eski verinin üzerine yazmaz. Yeni demo verisi (çalışma saatleri, işlem türleri, demo anamnez) için `pnpm db:reset && pnpm db:seed`.

## Testler (son koşu, hepsi çalıştırıldı)
contracts 11/11 · web kontrast 14/14 · API entegrasyon 61/61 (gerçek PostgreSQL) · Playwright 12/12 (1366 px + 360 px) · typecheck 5 paket temiz · `next build` başarılı. Ayrıntı: `verification.md`.

## Kararlar
ADR-001…020 (`decisions.md`). Görev 1 kararları: çalışma saati uyarı+onay (015), kapatma aşılamaz + advisory lock (016), yasal temsil dayanağı (017), sürümlü anamnez + demo soru seti (018), manuel davet bağlantısı + dar SECURITY DEFINER (019), mobil hesap/klinik seçici (020).

## Bilinen hatalar / riskler
- Windows üzerinde kurulum denenmedi (geliştirme Linux'ta). İlk denemede `pnpm db:roles` için Docker PostgreSQL'in ayakta olması gerekir.
- `<input type="date">` gösterim biçimi işletim sistemi yerel ayarına bağlı (Türkçe Windows'ta gg.aa.yyyy görünür).
- Giriş hız sınırı bellek içi (ADR-007); kimlik no şifreli değil (ADR-008).
- API/worker üretim derlemesi yok (tsx ile çalışıyor).
- VİA Akış eşikleri sabit (10 dk, yarın, 7 gün).
- Anamnez soru seti DEMO; klinisyen onayı olmadan gerçek klinikte kullanılmamalı.
- Davet e-postası gönderilmez (sağlayıcı yok); bağlantı elle iletilir.
- Çalışma saati ekranı gün başına tek blok düzenler (API çoklu bloğu destekler).
- Randevu sürükle-bırak ve ay görünümü yok.
- Performans ölçülmedi.

## Açık engeller (dış)
- SMS/WhatsApp, e-Fatura, e-Nabız/DHBS, ödeme sağlayıcısı: erişim/sözleşme yok → Görev 5'te yalnız etiketli mock.
- Klinik içerik (anamnez soruları, onam metinleri, tanı kodları): klinisyen/hukuk onayı gerekli.
- Mali kurallar (vergi, yuvarlama, prim kesinti sırası): mali müşavir.

## İzlenebilirlik
`traceability.csv`: Ek A 80 + Ek B 45 = 125 kaynak ID'si. Ek A dağılımı (Görev 1 sonrası): çalışıyor 11 · kısmi 9 · planlandı 45 · ertelendi 10 · engelli 4 · uygulanmayacak 1. Ek B: planlandı 43 · ertelendi 1 · uygulanmayacak 1. Görev 1'de güncellenen ID'ler: G06, H02, H03, H07, O01, T04, T05, T06, T14, T20.

## Sıradaki tek iş paketi
**Görev 2 — Tedavi planı ve odontogram (VD-007/008)** — ayrıntı `backlog.md`. Prompttaki Görev 2 metniyle başlat.
