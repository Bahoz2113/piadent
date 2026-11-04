# Düzeltme 2 — cezeri-duzeltici (qa-20261104-1549-65201a2)

- Taban: `main` ucu 6779cb4 (65201a2 + QA kayıtları + düzeltme 1 / 3e78c04 eşdeğeri). Worktree değişiklik yokken `git reset --hard main` ile tabana alındı.
- Dal: `worktree-agent-a8eba19bbf816144f`. Yeni sürüm kimliği: bu dosyayı içeren commit. Push edilmedi, üretime gönderilmedi.
- Migration yok, API/DB değişikliği yok. Test beklentileri, plan, envanter, kapı ve önceki kanıtlar değişmedi. Mevcut iki test olduğu gibi geçiyor.
- Bulgu durumu: **QA-203 FIX_READY, QA-204 FIX_READY**. Bu iki bulgu ana depodaki commit'lenmemiş `bugs.md`'de açıldı; bu dalın `bugs.md`'sinde yoklar. Çakışma olmasın diye durum etiketini burada değiştirmedim; defterde koordinatör/tester günceller. Kapatma yalnız bağımsız tester yeniden sınadıktan sonra yapılır.

## QA-203 (S3) — yeni denetim alanları Türkçe etiketsiz
**Kök neden:** 9d1e89e–65201a2 arasında API'ye yeni `changes` anahtarları eklendi, ama `packages/contracts/src/audit.ts` `AUDIT_FIELD_LABELS` güncellenmedi:
- `backdated`, `backdate_reason`: geriye tarihli randevu, `scheduling.service.ts`
- `procedure_id`: randevu ve randevu türü, `scheduling.service.ts` ve `resources.controller.ts`
- `added`: standart işlem/ürün aktarımı, `catalog.controller.ts` ve `materials.controller.ts`

**Düzeltme:** Dört etiket eklendi:

| Anahtar | Etiket |
|---|---|
| `backdated` | "Geriye dönük kayıt" |
| `backdate_reason` | "Geriye dönük kayıt gerekçesi" |
| `procedure_id` | "Planlanan işlem" |
| `added` | "Eklenen kodlar" |

Değer gösterimi için kod değişikliği gerekmedi, mevcut `auditValueLabel` kuralları yetiyor:
- boolean → "Evet"/"Hayır"
- dizi → virgülle birleşik kodlar
- `*_id` → ad eşlemesi, yoksa `#ilk8`

## QA-204 (S3) — globals.css'te px yazı boyutu
**Kök neden:** ADR-095 Panel grafikleri, SVG metinleri için `px` kullandı (11/11/12 px, dar ekranda 19/18/20 px). Bu yüzden yazı ölçeği ayarı (ADR-082, `html[data-scale]` → kök font-size %) grafik metinlerine uygulanmıyordu.

**Düzeltme:**
- `apps/web/app/globals.css`: aynı değerlerin rem karşılığı (÷16):
  - masaüstü: 0.6875 / 0.6875 / 0.75rem
  - dar ekran (`max-width: 640px`): 1.1875 / 1.125 / 1.25rem

  Varsayılan %100 ölçekte görünüm piksel olarak aynı. SVG içinde rem, kök yazı boyutuna göre çözülüp viewBox kullanıcı biriminde uygulanıyor. Dar ekrandaki viewBox telafi oranı (≈1,7×) korunuyor.
- `apps/web/components/charts.tsx` `Tip`: ipucu kutusunun genişlik, yükseklik ve metin konumu çarpanı artık `k = (dar ? 1.7 : 1) × kökYazıBoyutu/16`. Böylece ölçek büyüyünce kutu metinle birlikte büyüyor ve metin taşmıyor. %100'de k önceki değerle aynı. Tip yalnız imleç veya dokunmadan sonra istemcide çizildiği için SSR/hydration farkı oluşmuyor.

## Değişen dosyalar (taban 6779cb4)
| Dosya | Satır |
|---|---|
| `packages/contracts/src/audit.ts` | +2/−1 |
| `apps/web/app/globals.css` | +6/−6 |
| `apps/web/components/charts.tsx` | +9/−1 |
| `apps/web/test/qa-203-204-labels-chart-rem.test.ts` | yeni, 5 test |
| `qa-runs/qa-20261104-1549-65201a2/fix2.md` | bu dosya |

Yeni test dosyası şunları sınıyor:
- dört etiket ve değerlerin okunurluğu: Evet/Hayır, kod listesi, işlem adı veya kısa kimlik
- grafik kurallarının rem değerleri ve dar ekran oranı
- Tip çarpanının kök ölçeği kullanması (kaynak düzeyi)

## Çalıştırılan komutlar ve sonuçlar
| Komut (cwd) | Sonuç |
|---|---|
| `npx tsc --noEmit -p .` (apps/web) | exit 0 |
| `npx vitest run` (apps/web) | **8 dosya, 86/86 geçti**: mevcut 81 + yeni 5. Önceden kalan `audit-field-labels` ve `appearance-contrast` testleri artık geçiyor. |
| `npx tsc --noEmit -p .` (packages/contracts) | exit 0 |
| `npx vitest run` (packages/contracts) | 1 dosya, 17/17 geçti |
| `npx tsc --noEmit -p .` (apps/api; contracts değişikliği sonrası güvenlik kontrolü) | exit 0 |

**Çalıştırılmayanlar:** Playwright E2E, API/worker testleri, `next build`, `gate.cjs`. Paylaşılan stack'e (3000/4000, viadent DB) dokunulmadı.

## Yan etkiler
- Varsayılan yazı ölçeğinde (%100, tarayıcı 16 px) Panel grafikleri piksel olarak aynı kalıyor. Ölçek 1–5 ya da tarayıcının varsayılan yazı boyutu değişince grafik eksen ve ipucu metinleri de büyüyüp küçülüyor; bu istenen davranış.
- Ölçek 5'te (%112,5) eksen etiketleri ~12,4 kullanıcı birimi oluyor. Sol boşluk (`PAD.l=44`) sabit. "1,2 Mn" gibi uzun etiketler sola daha çok uzayabilir (`overflow: visible`). Tester görünüm ayarıyla Panel'e göz atmalı (masaüstü + telefon-360, ölçek 5).
- `procedure_id` etiketi randevu türü tanımında da "Planlanan işlem" olarak görünüyor (orada anlamı "türe bağlı işlem"). Kabul edilebilir; istenirse bağlama göre ayrım ayrı iş.
- Yeniden koşulması önerilen: R03 (web birim), F-Panel görünüm/ölçek kontrolleri, PİA İz / hasta Geçmiş sekmesinde geriye tarihli randevu ve standart katalog aktarımı kayıtları.
