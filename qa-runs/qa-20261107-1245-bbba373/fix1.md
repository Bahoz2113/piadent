# Düzeltme 1 — QA-401 (S3) → FIX_READY

Koşu: qa-20261107-1245-bbba373. Taban: bbba373 + tester commit cebbd9f (yalnız qa-runs). Düzeltici: cezeri-duzeltici.
Yeni sürüm kimliği: bu dosyayı içeren commit (`git log -1 --format=%H -- qa-runs/qa-20261107-1245-bbba373/fix1.md`).
Durum: FIX_READY. Kapatma yalnız bağımsız tester yeniden sınamasıyla (VERIFIED). Üretime dağıtılmadı, push yok.

## Değişiklik özeti (yalnız sıra; içerik aynı)
`apps/web/components/treatment/tooth-model.ts` → `visualLabels(v)`: çürük (yüzeysiz/yüzeyli) ve kırık satırları
dolgu sonrasından, çekildi/eksik satırının hemen arkasına taşındı. Yeni sıra:
1) Çekildi / Eksik diş, 2) Çürük, 3) Kırık, 4) İmplant, Köprü gövdesi, Kron, Kanal tedavisi, Post / kor,
Laminate / veneer, İnley / onley, Fissür örtücü, Dolgu (göreli sıra değişmedi). Etiket metinleri, koşullar ve
`data-state` üretimi değişmedi. Aynı fonksiyonu kullanan erişilebilir ad (odontogram.tsx), ipucu rozetleri ve
Özet kartı ayrıntı rozetleri (tooth-summary.tsx) yeni sırayı kendiliğinden alır; bu dosyalar değişmedi.

## Değişen dosyalar
- `apps/web/components/treatment/tooth-model.ts` (ürün; +4/−3, yer değiştirme + 1 yorum satırı)
- `apps/web/test/odontogram-0711.test.ts` — yalnız diş 17 beklentisi sırası: `["Dolgu (O)", "Çürük (D)"]` → `["Çürük (D)", "Dolgu (O)"]` (handoff kabulündeki örnek). Başka beklenti değişmedi.
- `apps/web/test/qa-401-visual-label-order.test.ts` (yeni regresyon; 4 test: kanal+çürükte ilk etiket "Çürük", çürük dolgudan önce, çürük→kırık→kron, tam sıra + çekildi ilk)
- `qa-runs/qa-20261107-1245-bbba373/bugs.md` — yalnız QA-401 başlığı OPEN → FIX_READY
- Bu dosya.
Dokunulmayan: E2E spec'ler (`gorev2.spec.ts`, `odontogram-0711.spec.ts`), plan.json, inventory.md, kapı (`qa/cezeri/`), `qa-runs/.scripts`, evidence/, handoff.md, bugs.json. `apps/web/tsconfig.tsbuildinfo` geri alındı.

## Komutlar ve sonuçlar
1. Kusurun yeniden üretimi (yama öncesi, bbba373 `tooth-model.ts`): `cd apps/web && npx vitest run test/qa-401-visual-label-order.test.ts` → 4/4 FAIL (ör. `expected 'Kanal tedavisi' to be 'Çürük'`).
2. Yama sonrası: `cd apps/web && npx tsc --noEmit -p .` → 0 hata; `npx vitest run` → 11 dosya, 108/108 geçti (önceki 104 + 4 yeni).
3. Yerel yığın: `bash /tmp/claude-0/restart.sh build` → çıkış 0, `api 200 web 200`.
4. Temiz seed: `pnpm db:reset && pnpm --filter @viadent/db migrate && pnpm db:seed` → çıkış 0 (demo-yesil, demo-mavi).
5. E2E (aynı seed, masaustu sonra telefon-360): `cd apps/web && E2E_PASSWORD=… PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/gorev2.spec.ts e2e/odontogram-0711.spec.ts` → 10/10 geçti (gorev2 ×3, odontogram-0711 ×2, her iki projede). R04 senaryosu (telefon-360 `^Diş 16; Çürük`) geçti; `^Diş 36; Çekildi` değişmeden geçti.
Parola hiçbir dosyaya/loga yazılmadı (çıktılar tarandı).

## Yan etkiler
- Ekran okuyucu adı, ipucu ve Özet kartı rozetlerinde okuma sırası değişti (bulgu önce). Görsel çizim, veri, API, migration yok.
- `pnpm db:seed` yerel `.demo-credentials` (git dışı) parolasını yeniden üretir; yalnız yerel ortam.

## Tester için yeniden sınama
1. Bu commit'te temiz seed: `pnpm db:reset && pnpm --filter @viadent/db migrate && pnpm db:seed`; yığını `restart.sh build` ile yeniden derle.
2. Tam E2E temiz seed, iki proje (R04/R05 vakaları): R04 `gorev2.spec.ts` telefon-360 dahil geçmeli; toplam hata 0.
3. Web birim: `cd apps/web && npx tsc --noEmit -p . && npx vitest run` → 108/108.
4. Kabul: QA-401 → VERIFIED yalnız tester kararıyla; kapı `node qa/cezeri/gate.cjs …` tester tarafından.
