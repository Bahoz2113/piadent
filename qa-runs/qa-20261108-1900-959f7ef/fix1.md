# Düzeltme paketi 1 — QA-501, QA-502 (tur 1)

Sürüm 959f7ef (koşu HEAD 66ec0b9; ürün kodu aynı). Tester ürün kodunu değiştirmedi.

## QA-501 (S2 — erişilebilirlik, WCAG 2 AA renk kontrastı), sorumlu: geliştirme
**Gözlem:** N06 (masaüstü + 360 px): asistan, Görünüm → Lacivert + Koyu + Büyüt sonrası `/bugun` sayfasında axe `color-contrast` ciddi/kritik ihlali. Önceki koşuda (f91df0d) aynı adım temizdi; fark yeni "Bugünün randevuları" listesi.
**Kanıt:** evidence/tur1/browser-n.log (N06), evidence/tur1/masaustu-N06-koyu-bugun.jpg (iptal satırında üstü çizili soluk metin).
**Hipotez (doğrulanmadı):** `globals.css` `.today-row.is-cancelled .today-main { opacity: .7 }` ikincil metni (muted) 4,5:1'in altına indiriyor; `.today-time .muted` da etkilenebilir. Düzeltici axe ile hangi düğümlerin ihlal ettiğini kendisi doğrulasın (seed günü iptal randevusu tur betiğinin F vakasında oluşur: hekim "Zz Dt. QA F01 …", hasta "Sınama Gecmis…").
**Beklenen:** Açık/koyu, tüm paletlerde axe ciddi/kritik ihlal yok; iptal satırı yine ayırt edilebilir (üstü çizili + "İptal" rozeti) ama kontrast korunur. Kontrast birim testi (apps/web/test/appearance-contrast* ya da benzeri) gerekiyorsa genişletilir; beklenti gevşetilmez.

## QA-502 (S3 — test kodu), sorumlu: geliştirme
**Gözlem:** R04/R05: `apps/web/e2e/geri-bildirim-0411.spec.ts:26` telefon-360'ta 60 sn zaman aşımı: `getByRole('navigation').first().getByRole('link', { name: 'İş akışı' })` görünür olmayı bekliyor; mobilde menü kapalı (bağlantı çekmecede).
**Kanıt:** evidence/tur1/R04-R05-e2e-temiz-seed.log.
**Beklenen:** Test, mobilde önce "Menüyü aç" düğmesine basarak (geri-bildirim-0811.spec.ts ile aynı yöntem) İş akışı sekmesine gider; doğrulamalar aynı kalır (İş akışı → PİA Akış başlığı, taşma yok).

Değişiklikten sonra: `cd apps/web && npx vitest run`, `pnpm typecheck` (web için `cd apps/web && npx tsc --noEmit -p .`), ilgili E2E (`geri-bildirim-0411.spec.ts`, `geri-bildirim-0811.spec.ts`, `erisilebilirlik.spec.ts`) yerel yığında; tek commit, gelistirme-gecmisi'ne push.
