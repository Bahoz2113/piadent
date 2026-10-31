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

## Son koşu sonuçları (22.10.2026)
| Paket | Test | Sonuç |
|---|---|---|
| `@viadent/contracts` | Türkçe normalize, telefon, TCKN biçimi, saat dilimi (gece yarısı, DST), durum makinesi, rol matrisi | **11/11 geçti** |
| `@viadent/web` (vitest) | WCAG kontrast — 11 metin/zemin çifti ≥ 4.5:1, beyaz/birincil, turuncu vurgu kısıtı, odak ≥ 3:1 | **14/14 geçti** |
| `@viadent/api` | `tenant-isolation` 12 · `permissions-session` 12 · `scheduling-patients` 18 | **42/42 geçti** |
| `@viadent/web` (Playwright) | kritik akış + klavye/taşma × {1366 px, 360 px} | **4/4 geçti** |
| Typecheck | contracts, db, api, worker, web | **temiz** |
| `next build` | üretim derlemesi | **başarılı** |

## Kabul testleri eşlemesi
| Test | Durum | Kanıt |
|---|---|---|
| AT-01 çapraz tenant (hasta ID, geçmiş, randevu, not, arama, randevu bağlama; erişim reddi audit'i) | **geçti** | tenant-isolation.test.ts. Dosya ve export uçları henüz yok → Görev 4/6'da genişletilecek |
| AT-02 sekreter API ile klinik not | **geçti** | permissions-session.test.ts. İade ucu henüz yok → Görev 3 |
| AT-03 eşzamanlı randevu | **geçti** | 6 eşzamanlı istek → 1 × 201, 5 × 409; koltuk çakışması; `[)` sınırı; iptal kapasite bırakır |
| AT-04 gelecek doğum tarihi / ortak telefon | **geçti** | API + DB tetikleyicisi + E2E (arayüz mesajı) |
| AT-05..AT-14, AT-16, AT-17 | açık | İlgili modüller yok (Görev 2–7) |
| AT-15 klinik değiştirme, eski sekme | **geçti** | eski bağlamla okuma/yazma 409; yeni bağlamda yalnız yeni kliniğin verisi; rol yeni kliniğe göre |
| AT-18 360 px, klavye, ekran okuyucu | **kısmi** | E2E: 360 px'de yatay taşma yok, “İçeriğe geç” bağlantısı, dialog erişilebilir adı, durumlar metin+renk. Ekran okuyucuyla elle test ve renk körlüğü simülasyonu **yapılmadı** |
| AT-19 gece yarısı raporu | **kısmi** | Gün sınırı birim testi geçti; rapor modülü yok |
| AT-20 erişimi kaldırılan kullanıcı | **geçti** (API) | açık oturumla sonraki istek 403 `MEMBERSHIP_REVOKED`; çıkış sonrası 401. Worker kullanıcı adına iş yürütmüyor; dosya erişimi Görev 4 |

## RLS / güvenlik kontrolleri (geçti)
Uygulama rolü superuser/BYPASSRLS/tablo sahibi değil · 12 tabloda RLS + FORCE · bağlamsız sorgu 0 satır · havuzda bağlam sızmıyor · yanlış tenant_id ile INSERT reddediliyor · audit UPDATE/DELETE reddediliyor · istemci gövdesindeki `tenantId` yok sayılıyor · CSRF başlığı zorunlu · token DB'de düz değil · 5 hatalı girişte kilit.

## Elle yapılan görsel kontrol
Playwright ekran görüntüleriyle (1366 px ve 360 px) Giriş, Bugün, Hastalar, Hasta 360, Geçmiş, Ajanda, Yeni hasta çekmecesi incelendi. Bulunan ve düzeltilen hatalar: masaüstünde mobil menü düğmesi görünmesi, 360 px'de aramanın daralması, çekmecenin erişilebilir adının olmaması (E2E yakaladı), telefonun biçimsiz gösterimi.

## Çalıştırılmayan / yapılamayan
- Performans hedefi (100.000 hasta, p95 500 ms) **ölçülmedi**.
- Windows üzerinde kurulum bu oturumda **denenmedi** (geliştirme Linux konteynerde yapıldı); README adımları Docker Desktop + Node 22 + pnpm varsayar.
- Ekran okuyucu (NVDA/VoiceOver) testi yapılmadı.
