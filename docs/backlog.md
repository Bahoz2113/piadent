# Backlog

Durum sözlüğü: **tamamlandı** = kabul kriteri sağlandı ve test edildi · **kısmi** = ilk dikey dilim çalışıyor, kalanı yazılı · **açık** = başlanmadı · **engelli** = dış erişim bekliyor.

| İş | Durum | Kanıt / kalan |
|---|---|---|
| VD-001 Depo ve geliştirme kurulumu | **tamamlandı** | README ile kurulum, `db:roles/migrate/seed`, typecheck, test komutları çalışıyor. CI yapılandırması yok (açık). |
| VD-002 Tenant ve rol temeli | **kısmi** (davet + rol değişikliği eklendi) | UI/API çapraz tenant negatif testleri ✔, RLS testleri ✔, worker kısıtlı rol ✔. Dosya erişimi Görev 4'te (dosya modülü yok). |
| VD-003 Tasarım sistemi ve kabuk | **kısmi** | Tokenlar, kabuk, form/tablo/çekmece/rozet, boş/yükleme/hata/yetkisiz durumları, klavye odağı, kontrast testi ✔. Bileşenler `packages/ui`'ye taşınmadı; Storybook benzeri örnek sayfası yok. |
| VD-004 Hasta kayıt ve arama | **tamamlandı** (ilk kapsam) | Kalıcı kayıt, maskeli arama, mükerrer aday, tarih doğrulama, audit, sürüm kontrolü, yakın/veli ve yasal temsil (Görev 1) — testli. |
| VD-005 Ajanda ve kaynaklar | **tamamlandı** (ilk kapsam) | Çakışma (AT-03), çalışma saatleri, kapatma (eşzamanlılık testli), işlem türü, hekim/koltuk yönetimi, gün+hafta görünümü, mobil liste ✔. Açık: sürükle-bırak taşıma, ay görünümü, bekleme listesi (VİA Denge, P1). |
| VD-006 Anamnez ve klinik not | **kısmi** | Sürümlü anamnez + hekim onayı + kritik uyarı ✔, yalnız-ekleme not + düzeltme ✔. Açık: notun ziyarete bağlanması (Görev 2 ile), soru setinin klinisyen onayı. |
| VD-007 Plan ve odontogram | açık | Görev 2 |
| VD-008 Gerçekleşen işlem ve hesap | açık | Görev 2 |
| VD-009 Ödeme, dağıtım, iade | açık | Görev 3 |
| VD-010 VİA Akış / Net / İz | **kısmi** | Akış (5 tür: geciken geliş, teyit, eksik iletişim, kapatma çakışması, anamnez onayı; dedupe, otomatik kapanış, rol/hassasiyet filtresi) ✔; İz (hasta bazlı, maskeli, rol kontrollü) ✔; Net Görev 3. |
| VD-011 Dosya ve belge sürümü | açık | Görev 4 |
| VD-012 Outbox ve entegrasyon merkezi | **kısmi** | Outbox + retry/backoff + dead durumu (iç olaylar) ✔. Dış sağlayıcı adaptörleri, webhook, idempotency Görev 5. |
| VD-013 Laboratuvar ve prim | açık | Görev 6 |
| VD-014 İçe aktarma ve pilot | açık | Görev 7 |

## Tamamlanan iş paketi: Görev 1 (22.10.2026)
Çalışma saatleri (T05), kapatma (T06), işlem türü (T04), hekim/koltuk yönetimi (T14), yakın/veli (H03), sürümlü anamnez (H07), davet ve rol değişikliği (T20), haftalık ajanda. Testler: API 61, E2E 12 (bkz. `verification.md`).

## Sıradaki tek iş paketi
**Görev 2 — Tedavi planı ve odontogram (VD-007/008):** özgün odontogram (FDI numaralama, süt/daimi, diş/yüzey/dişsiz işlem modeli), tanı kaydı, sürümlü işlem kataloğu ve tarife (T01/T02/T03), plan → teklif → kabul (kabul edilen sürüm değişmez, AT-05), seans ve gerçekleşen işlem (ziyarete bağlı), klinik notun ziyarete bağlanması. Klinik kod listeleri uydurulmaz; demo olarak işaretlenir.

## Küçük açık işler
- CI (GitHub Actions: PostgreSQL servisiyle `pnpm test`).
- Randevu oluşturmada Idempotency-Key (çift tık zaten arayüzde engelli; ağ tekrarına karşı).
- VİA Akış eşiklerini klinik ayarına taşıma.
- Randevu sürükle-bırak taşıma (sunucu reddederse eski konuma dönüş) ve ay görünümü.
- Anamnez soru setinin pilot hekimle gözden geçirilmesi (klinik içerik onayı).
- Davet e-postası: sağlayıcı seçilince Görev 5 outbox üzerinden.
- Çok bloklu çalışma günü için arayüz (API destekliyor; ekran gün başına tek blok düzenliyor).
- Giriş hız sınırını DB'ye taşıma (ADR-007).
- AT-19 tam senaryosu (rapor) Görev 3/6; gün sınırı birim testi var.
- Tarayıcı yerel ayarında `<input type="date">` biçimi işletim sistemine bağlı; özel tarih seçici değerlendirilecek.
