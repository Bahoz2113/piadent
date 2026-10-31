# Devir notu (handoff)

**Son güncelleme:** 22.10.2026 · Oturum 1 (ilk kurulum) · Dal: `main` · Son commit: `git log -1`

## Durum özeti
Boş depodan çalışan, kalıcı ve güvenli bir VİADENT çekirdeği kuruldu: tenant/rol/oturum → hasta → hekim/koltuk/randevu → VİA Akış → VİA İz. Tüm veriler gerçek PostgreSQL'de; demo verisi tamamen sentetik.

## Gerçekten çalışan akışlar
1. Giriş / çıkış, çok klinikli kullanıcıda klinik değiştirme, eski sekme koruması.
2. Yönetici: ekip listesi, erişim kaldırma (açık oturum anında etkisiz).
3. Hasta: oluşturma (gelecek doğum tarihi reddi, ortak telefon serbest, mükerrer aday onayı, kimlik no tekilliği), Türkçe-duyarsız arama, düzenleme (sürüm kontrolü), Hasta 360 (Özet / Sağlık / Geçmiş çalışır; Tedavi / Finans / Belgeler / İletişim dürüstçe “geliştirilmedi”).
4. Ajanda: gün görünümü (hekime/koltuğa göre), mobil gün listesi, randevu oluşturma (eşzamanlı çakışma DB'de engelli), durum değişikliği (durum makinesi), iletişim sonucu (ayrı alan), gerekçeli iptal.
5. Bugün: günün sayaçları, VİA Akış görevleri (geciken geliş, yarınki teyit, eksik iletişim) ve tek tıkla Geldi/Gelmedi/Bilgi verildi/Ulaşılamadı; görev kaynak çözülünce kendiliğinden kapanır.
6. Klinik not (hekim): yalnız ekleme + gerekçeli düzeltme; sekreter/yönetici erişemez.
7. Worker: outbox tüketimi, geri çekilmeli yeniden deneme, 60 sn'de bir zaman tabanlı tarama — kısıtlı `viadent_worker` rolüyle.

## Kurulum
`README.md` → Kurulum. Kısaca: `pnpm install` → `.env` → `pnpm db:up && pnpm db:roles && pnpm db:migrate && pnpm db:seed` → `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:web`.

## Sürümler
Node 22, pnpm 10.28, TS 5.9.3, NestJS 11.2.7, Next 15.5.28, React 19.1.10, zod 4.6.7, pg 8.23.1, PostgreSQL 16, Vitest 3.2.7, Playwright 1.64.1 (ADR-002).

## Migration durumu
| Dosya | İçerik | Durum |
|---|---|---|
| `0001_core.sql` | extensions, app şeması, kimlik, tenant, hasta, klinik not, ajanda (exclusion), görev, audit, outbox, RLS, grant | uygulandı (dev + test) |

## Testler (son koşu, hepsi çalıştırıldı)
contracts 11/11 · web kontrast 14/14 · API entegrasyon 42/42 (gerçek PostgreSQL) · Playwright 4/4 (1366 px + 360 px) · typecheck 5 paket temiz · `next build` başarılı. Ayrıntı: `verification.md`.

## Kararlar
ADR-001…014 (`decisions.md`). Öne çıkanlar: RLS + üç DB rolü, sunucu oturumu + CSRF başlığı, eski sekme için bağlam başlığı, mükerrer hasta politikası, olgun sürüm hatları.

## Bilinen hatalar / riskler
- Windows üzerinde kurulum denenmedi (geliştirme Linux'ta). İlk denemede `pnpm db:roles` için Docker PostgreSQL'in ayakta olması gerekir.
- `<input type="date">` gösterim biçimi işletim sistemi yerel ayarına bağlı (Türkçe Windows'ta gg.aa.yyyy görünür).
- Giriş hız sınırı bellek içi (ADR-007); kimlik no şifreli değil (ADR-008).
- API/worker üretim derlemesi yok (tsx ile çalışıyor).
- VİA Akış eşikleri sabit (10 dk, yarın, 7 gün).
- Performans ölçülmedi.

## Açık engeller (dış)
- SMS/WhatsApp, e-Fatura, e-Nabız/DHBS, ödeme sağlayıcısı: erişim/sözleşme yok → Görev 5'te yalnız etiketli mock.
- Klinik içerik (anamnez soruları, onam metinleri, tanı kodları): klinisyen/hukuk onayı gerekli.
- Mali kurallar (vergi, yuvarlama, prim kesinti sırası): mali müşavir.

## İzlenebilirlik
`traceability.csv`: Ek A 80 + Ek B 45 = 125 kaynak ID'si; her biri modül, faz, karar ve durumla eşli. Dağılım (Ek A): çalışıyor 6 · kısmi 10 · planlandı 49 · ertelendi 10 · engelli 4 · uygulanmayacak 1. (Ek B): planlandı 43 · ertelendi 1 · uygulanmayacak 1.

## Sıradaki tek iş paketi
**Görev 1 — Hasta ve ajanda dilimini tamamla** (ayrıntı `backlog.md`): çalışma saatleri/kapatma, varsayılan işlem süresi, veli/yakın ilişkisi, sürümlü anamnez + kritik uyarı, hekim/koltuk yönetimi, kullanıcı daveti/rol değişikliği, hafta görünümü; AT-01..04, AT-15, AT-18, AT-20 genişletilmiş testleri.
