# Düzeltme 1 — cezeri-duzeltici (qa-20261104-1549-65201a2)

- Test edilen sürüm: 65201a2 (QA kaydı a92c0cf; ürün kodu 65201a2 ile aynı).
- Düzeltme dalı: `worktree-agent-a8eba19bbf816144f` (taban a92c0cf). Yeni sürüm kimliği: bu dosyayı içeren commit (`git log -1 worktree-agent-a8eba19bbf816144f`). Push edilmedi, üretime gönderilmedi.
- Migration yok. API/DB/sözleşme değişikliği yok. Test beklentisi, plan, envanter, kapı ve önceki kanıt dosyalarına dokunulmadı.
- Bulgu durumu: **QA-201 FIX_READY, QA-202 FIX_READY**. Kapatma yalnız bağımsız tester yeniden sınadıktan sonra yapılır.

## QA-201 (S2) — Kirli çekmece Esc ile uyarısız kapanıyor

**Kök neden:** `components/ui.tsx` Drawer klavye dinleyicisi `useEffect(..., [])` içinde ilk render'ın `tryClose` kapanışını yakalıyordu. Bu kapanış, açılış anındaki `dirty=false` değerini görüyordu. Kullanıcı yazınca `dirty` true oluyordu ama Esc yine eski kapanışı çağırıp `onClose()`'u doğrudan çalıştırıyordu. X ve arka plan tıklamaları her render'da yeni kapanışı kullandığı için doğru çalışıyordu.

**Düzeltme:**
- Yeni `apps/web/components/drawer-close.ts`:
  - `createDrawerCloser(latest, confirm)`: tek bir kapatıcı üretir. Her çağrıda `dirty`/`onClose` değerini `latest.current`'tan okur. Kirliyse `confirmDialog`'u ("Kaydedilmemiş değişiklikler", "Kapat" / "Forma dön") açar. Pencere açıkken gelen ikinci isteği yok sayar (eski `asking` korumasıyla aynı, şimdi `try/finally` içinde).
  - `handleDrawerEscape(e, close)`: Esc gelince ve `e.defaultPrevented` false ise `preventDefault` + kapatıcıyı çağırır. İç açılır pencere (takvim) Esc'i tükettiyse hiçbir şey yapmaz (eski davranış korundu).
- `Drawer`: `latest = useRef({dirty, onClose})` her render'da güncellenir. `tryClose` `useState(() => createDrawerCloser(latest, confirmDialog))` ile kararlı tutulur. Effect yine bir kez kurulur (boş bağımlılık), yani odak tuzağı, ilk alana odak, `body` kaydırma kilidi ve kapanınca önceki odağa dönüş değişmedi. Esc, X ve arka plan aynı `tryClose`'u kullanır. Uyarı metinleri aynı (Türkçe, değişmedi).
- Bu çözüm `dialogs.tsx` içindeki `handlers` ref deseniyle tutarlı. Modal açıkken basılan Esc, `DialogHost`'un yakalama aşamasındaki dinleyicisinde kalır ("Forma dön"), çekmeceye ulaşmaz.

## QA-202 (S3) — Randevu formunda "kirli" tanımı eksik

**Kök neden:** `app/(app)/ajanda/page.tsx` `NewAppointment` içinde `dirty={!!patient || !!f.reason}` vardı. Hasta ve Açıklama dışındaki alanlar hesaba katılmıyordu.

**Düzeltme:** Açılış değerleri (`initialF`) `useState` ile bir kez hesaplanıp saklanır. Slot, hekim, koltuk, tarih ve saat ön doldurması bunlara dahildir. `f` bu değerle başlar. Formun kirli sayılma koşulu:
- `f` içindeki herhangi bir alan (tarih, saat, süre, işlem türü, planlanan işlem, hekim, koltuk, açıklama, not) açılış değerinden farklıysa, ya da
- seçili hasta, ön doldurulan hastadan farklıysa (taban `pre.data?.id ?? null`: hasta parametresiyle gelen ve yüklenen hasta kirli sayılmaz), ya da
- hasta arama kutusuna metin yazılmışsa (`q.trim() !== ""`).

Değeri açılıştakine geri döndürülen alan temiz sayılır.

## Değişen dosyalar (taban a92c0cf)
| Dosya | Tür | Özet |
|---|---|---|
| `apps/web/components/drawer-close.ts` | yeni (ürün) | ref tabanlı kapatıcı + Esc işleyicisi, onay metni sabiti |
| `apps/web/components/ui.tsx` | ürün | Drawer: güncel dirty/onClose ref'te, tek kapatıcı; +6/−12 satır |
| `apps/web/app/(app)/ajanda/page.tsx` | ürün | NewAppointment: `initialF` + kapsamlı `dirty`; +7/−3 satır |
| `apps/web/test/qa-201-drawer-esc.test.ts` | yeni (birim testi) | 9 test, ayrıntısı aşağıda |
| `apps/web/e2e/geri-bildirim-0411.spec.ts` | E2E (yeni test eklendi, mevcutlar değişmedi) | QA-201/202 senaryosu + başlık yorumuna bir satır; `Locator` tip içe aktarımı |
| `qa-runs/qa-20261104-1549-65201a2/bugs.md` | bulgu defteri | yalnız QA-201/QA-202 durum etiketi OPEN → FIX_READY (gözlem/kanıt metni değişmedi) |
| `qa-runs/qa-20261104-1549-65201a2/fix1.md` | devir | bu dosya |

## Eklenen testler
- **Birim** (`test/qa-201-drawer-esc.test.ts`, vitest, DOM gerektirmez):
  - temizken kurulan kapatıcı, sonradan kirli olunca Esc'te onayı açar; "Forma dön" kapatmaz
  - kirli + "Kapat" güncel `onClose`'u çağırır
  - kirliyken temize dönen form Esc ile uyarısız kapanır
  - temiz form doğrudan kapanır
  - `defaultPrevented` olan Esc'te kapanmaz ve onay açılmaz
  - Esc dışındaki tuşlar etkisizdir
  - onay açıkken gelen çift istek ikinci pencere açmaz
  - kaynak düzeyi bağlantı kontrolleri: Drawer ref kapatıcısını Esc, X ve arka planda kullanıyor; NewAppointment eski `!!patient || !!f.reason` tanımına dönmedi

  Not: depoda jsdom veya testing-library yok, bağımlılık eklenmedi. Bu yüzden Drawer bileşeni birim testinde render edilmiyor. Bileşen düzeyi doğrulama aşağıdaki E2E testiyle yapılıyor.
- **E2E** (`e2e/geri-bildirim-0411.spec.ts`, test adı "Kaydedilmemiş form: Esc de X gibi uyarır, …(QA-201, QA-202)", sekreter):
  - temiz formda Esc ve X modalsız kapatır
  - Açıklama → Esc → alertdialog; "Forma dön" metni korur
  - modal açıkken Esc yalnız modalı kapatır
  - takvim açıkken Esc yalnız takvimi kapatır
  - Esc → "Kapat" ile çekmece kapanır
  - yalnız Not doldurulunca X ve Esc modal açar
  - yalnız Süre değişince modal açılır; açılış değerine dönülünce modalsız kapanır
  - hasta kartından "Randevu ver" ile gelen ön doldurulmuş hasta X'te modalsız kapanır
  - Yeni hasta çekmecesinde Ad → Esc → modal; "Forma dön" veriyi korur, ardından Esc → "Kapat"

  **ÇALIŞTIRILMADI** (talimat gereği; tester koşacak).

## Çalıştırılan komutlar ve sonuçlar
| Komut (cwd) | Sonuç |
|---|---|
| `pnpm install --frozen-lockfile --offline` (worktree kökü) | başarılı; lockfile değişmedi, yalnız yerel `node_modules` kuruldu |
| `npx tsc --noEmit -p .` (apps/web) | **0 hata** (exit 0) |
| `npx tsc --noEmit --strict --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --types node e2e/geri-bildirim-0411.spec.ts` (apps/web) | exit 0 (yalnız tip denetimi; E2E koşulmadı) |
| `npx vitest run test/qa-201-drawer-esc.test.ts` (apps/web) | **9/9 geçti** |
| `pnpm --filter @viadent/web test` / `npx vitest run` (apps/web) | 7 dosya, 81 testten 79 geçti, **2 kaldı**. İkisi de bu düzeltmeden **önce de vardı**, aşağıya bakın |
| Aynı `npx vitest run`, değiştirilmemiş taban a92c0cf (65201a2 ürün kodu) üzerinde | 6 dosya, 72 testten 70 geçti; **aynı 2 test kalıyor**. Bu yama yeni hata getirmedi |

Tabanda zaten kalan iki test (bu yamanın kapsamı dışında, beklentileri gevşetilmedi, dokunulmadı):
1. `test/appearance-contrast.test.ts` → "globals.css'te px yazı boyutu kalmadı (rem)…": `app/globals.css` içinde `font-size: …px` bulunuyor.
2. `test/audit-field-labels.test.ts` → "API kaynağındaki her changes anahtarı Türkçe etiketli": API kaynağında Türkçe etiketi olmayan `changes` anahtarları var: `added`, `backdate_reason`, `backdated`, `procedure_id` (randevu malzemesi / geriye tarihli kayıt işleri, 9d1e89e–65201a2).

Bunlar ayrı bulgu adayı. Tester'ın değerlendirmesine bırakıldı.

**Çalıştırılmayanlar:** Playwright E2E (hiçbiri), API/worker testleri, `next build`, kapı (`gate.cjs`). Paylaşılan yerel stack'e (3000/4000, viadent DB) dokunulmadı.

## Yan etkiler ve komşu akışlar (yeniden koşulmalı)
- Tüm `Drawer` kullanan formlarda Esc artık X ve arka planla aynı davranıyor: kirliyse onay modalı açılıyor. Etkilenen formlar: hasta, randevu, ödeme, iade, ücret modeli, fiyat, malzeme, ekip daveti, lab, fatura, tedavi. Bu bilinçli bir davranış değişikliği.
- Kirli bir çekmeceyi Esc ile kapatıp sonra devam eden mevcut E2E adımı, artık açılan modal yüzünden takılabilir. Taramada yalnız `e2e/gorev11.spec.ts:53` bulundu: dolu Yeni hasta formunda Esc. Test bu satırla bitiyor ve ardından doğrulama yok, bu yüzden başarısız olması beklenmiyor. `gorev5.spec.ts:76/109` ve `gorev6.spec.ts:94` Esc'leri ayrıntı/hareket çekmecelerinde (dirty tanımsız), davranış değişmez.
- `critical-flow.spec.ts` kapatma modalı adımı: ap2'de hasta seçildiği için form önceden de kirliydi, akış değişmez.
- Randevu formunda artık yalnız hasta araması yazmak, tarih/saat/süre/hekim/koltuk/işlem değiştirmek de kirli sayılıyor. Bu yüzden X, Esc ve arka planda modal açılıyor. Footer'daki "Vazgeç" düğmesi önceden olduğu gibi doğrudan kapatıyor (bulgu kapsamında değildi).
- Bilinen, değişmeyen davranış: hasta parametresiyle açılan formda "Değiştir"e basılınca ön doldurma etkisi hastayı yeniden yüklüyor (önceden de böyleydi).
- Tester için önerilen yeniden koşu: F11 (iki profil), `e2e/geri-bildirim-0411.spec.ts`, `e2e/critical-flow.spec.ts`, `e2e/gorev11.spec.ts`, `e2e/erisilebilirlik.spec.ts` ve Drawer kullanan formların kapatma kontrolü.
