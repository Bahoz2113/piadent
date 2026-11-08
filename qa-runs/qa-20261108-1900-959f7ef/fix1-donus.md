# Düzeltme dönüşü 1 — 6d31dbd (959f7ef + 1 commit)
- QA-501: `globals.css` iptal satırındaki `opacity: .7` kaldırıldı (üstü çizili + "İptal" rozeti kalır). Düzeltici axe ile doğruladı: ihlal düğümü `.is-cancelled > .today-main > .muted.small` önce 24/24 şema×palet birleşiminde, sonra 0/24; N06 adımı masaüstü ve 360 px ciddi/kritik 0. Regresyon testi `apps/web/test/qa-501-cancelled-row-contrast.test.ts`.
- QA-502: `geri-bildirim-0411.spec.ts` mobilde önce "Menüyü aç".
- Düzeltici sonuçları: web birim 122/122, typecheck temiz, E2E (0411, 0811, erişilebilirlik, görünüm; iki proje) temiz seed 29 geçti + 1 bilinçli atlama. Not: temiz olmayan yerel DB'de 0811 "Randevu ver" masaüstü bir kez başarısız, yeniden koşuda geçti (ayrıntı kaydedilmedi) — tester tur 2'de izler; tekrar ederse FLAKY kaydedilir.
- Durum: FIX_READY; tester tur 2'de yeniden sınar.
