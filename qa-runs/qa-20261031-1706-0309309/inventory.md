# Kapsam envanteri — qa-20261031-1706-0309309

Kaynak: depo (apps/web/app, apps/api/src/**/*.controller.ts, packages/contracts/src/permissions.ts) × çalışan ürün (:3000, :4000).

## Ekranlar (12 sayfa) → vaka
| Konum | Roller | Vaka |
|---|---|---|
| /giris, /davet/[token] | herkes | P03, R04 |
| /bugun, /ajanda | sekreter, hekim, yönetici | V03, P02, R04/R05 |
| /hastalar, /hastalar/[id] (Özet, Tedavi, Finans, Belgeler, Klinik sekmeleri) | hekim/sekreter/finans/yönetici (sekme izne göre) | V01, V02, V04, V05, R04 |
| /tedavi | hekim | V02, V05 |
| /finans, /raporlar, /operasyon | finans, yönetici | V04, P01, R04 |
| /yonetim (ekip, kaynaklar, katalog, köprü, aktarım, güvenlik) | yönetici | R04, R07 |
| /hesabim | herkes | P03 |

## API (28 controller, 212 uç) → vaka
patients(7) V01/P03 · chart(9) V02/V05 · scheduling(6) V03/P02 · account(7) V04/P01 · finance(14) R01 · files(6)+documents(15)+care(11) V01/R01 · export(2) V01 · auth(8)+mfa(9) P03 · team(8)+security(7)+invitations(2) R01 · bridge(17)+lab(11)+stock(10)+suppliers(8) R01 · reports(3) R01/R04 · import(6) R01/R04 · tasks(3) R01 · ops(1) R01.

## Roller (6): clinic_admin, dentist, secretary, assistant, finance, support (süreli). Tenant: demo-yesil (A), demo-mavi (B).
## Entegrasyonlar: SMS/e-posta/ödeme/e-Nabız/AKIS — yalnız etiketli mock (VIADENT_EXTERNAL_SEND_ENABLED=false). Gerçek sağlayıcı yok → bu koşuda NA, raporda açık.
## Platformlar: http · chromium-desktop · chromium-mobile-emulation · cli (migrate/seed/backup/restore-verify). Fiziksel mobil/iOS/Android/VS Code: ürün web; cihaz yok → NA.
## Keşfedilemeyen/açık: dinamik gizlenen kontroller (rol dışı sekmeler) yalnız API'den sınanır; gerçek sağlayıcı entegrasyonları canlı anahtar olmadan sınanamaz.
