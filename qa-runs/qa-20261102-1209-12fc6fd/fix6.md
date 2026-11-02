# Düzeltme 6 — qa-20261102-1209-12fc6fd tur 6 → tester (yeniden sınama)

- **Durum:** QA-110 **FIX_READY**. Kapatma yalnız tester yeniden sınamasıyla.
- **Sınanacak sürüm (ürün kodu):** `095272ba30068ac3357103a82d208ea3ad87a715` (dal `fix/qa-20261102-tur6`, taban `e8f6b95` = dal açılırken yerel `main` ucu; `e8f6b95` ürün kodu = `eb1c1f3` = fix5 `b1b84a4` + 0030). Bu `fix6.md` onun üstünde ayrı bir commit'tir; ürün kodu iki commit'te aynıdır.
- **Taban notu:** worktree `origin/main` (`9ffdb2a`, canlı demo geçmişi; ortak ata yok) üzerinden açılmıştı; çalışma dalı `git checkout -b fix/qa-20261102-tur6 main` ile `e8f6b95`'ten açıldı. Çalışma sırasında `main` tester commit'i `4981c9b` ile ilerledi (yalnız `qa-runs/qa-20261102-1209-12fc6fd/evidence/` dosyaları); ürün yaması üstüne çakışmasız taşınabilir (cherry-pick). `main`, `publish`, `origin/*` değiştirilmedi; push yok.
- **Migration:** yeni `packages/db/migrations/0031_readiness_clinical_output.sql` (0001–0030 değişmedi). **Üretime/canlıya gönderim:** yok.
- **Değiştirilmeyenler:** mevcut test beklentileri (hiçbir mevcut test dosyası değişmedi; `gorev4.test.ts` aynen geçer), `plan.json`, `inventory.md`, `bugs.md`, `handoff.md`, `environment.md`, `results*.json`, `evidence/`, `fix1.md`–`fix5.md`, kapı betikleri (`qa/cezeri/`).

## Seçilen yol (ADR-092): kaynakta red + değerlendirmede yok sayma (role göre süzme değil)
1. `POST /readiness-rules`: belge türü `category = 'clinical_output'` (EPIKRIZ, HASTA-FOYU, RECETE) → **422 `VALIDATION_FAILED`**, `field_errors.documentTypeId` = "Klinik çıktı belgeleri (epikriz, hasta bilgi föyü, reçete yazısı) hazırlık kuralına bağlanamaz; bunlar işlem sonrası hekim çıktısıdır ve sağlık verisidir."; satır ve `readiness_rule.create` denetimi yazılmaz. `POST /readiness-rules/:id/active` böyle bir kuralı `active: true` ile etkinleştirmeyi aynı gerekçeyle 422 reddeder (`field_errors.active`); pasifleştirme 200.
2. `readinessFor` (`packages/db/src/readiness.ts`) etkin kural sorgusuna `dt.category is distinct from 'clinical_output'` ekler: eski/doğrudan yazılmış kural **hiçbir rolde** (sekreter, yönetici, hekim) kalem üretmez. `GET /appointments/:id/readiness` (`ready` dahil), `readiness_missing` görevinin açılması/kendiliğinden kapanması (PİA Akış → Bugün ekranı) ve `POST /appointments/:id/readiness-exceptions` aynı fonksiyondan beslendiği için tutarlı; klinik kalem için istisna = var olmayan kalemle aynı 409 `NOT_MISSING`.
3. Migration 0031 (`app.for_each_tenant`): etkin klinik çıktı kurallarını pasifleştirir (silmez). Etiketinde klinik çıktı türü adı geçen `readiness_missing` görevlerini `clinical` yapar; açıksa "Hazırlık kuralları güncellendi; görev yeniden değerlendirilecek" ile kapatır (PİA Akış randevu hâlâ eksikse klinik kalemsiz temiz görevi yeniden açar); kapalı görevin kapanış nedeni korunur. Yalnız böyle bir kuralın tanımlandığı kiracıda etkili; tekrar güvenli.
4. Web: PİA Hazır kural formu (`apps/web/components/admin/templates.tsx`) "Belge türü" seçeneklerini `readinessRuleDocTypes` (`apps/web/lib/readiness-rules.ts`: etkin **ve** klinik çıktı olmayan) ile listeler; "Etkinleştir" hatası (422) bildirim olarak gösterilir (önceden sessiz reddedilen promise).
- Neden role göre süzme değil: `ready`, görev açma/kapama ve istisna aynı kalem listesinden türüyor; role göre farklı liste ya "sekreter Hazır görüyor ama görev açık" tutarsızlığı ya da görev metninde yeni iz doğururdu. Klinik çıktı işlem **sonrası** üretildiği için ziyaret **öncesi** hazırlık önkoşulu olarak anlamsız.
- Onam/bilgilendirme kuralları, kabul gerektiren türde "hasta kararı kaydedilmedi" ayrımı, anamnez kuralı ve hekim istisnası değişmedi.

## Değişen dosyalar (`git diff --stat e8f6b95 095272b`: 10 dosya, +312/−6)
Ürün:
- `apps/api/src/documents/care.controller.ts` (+10/−1) — `createRule` kategori kontrolü; `toggleRule` etkinleştirme kontrolü; `CLINICAL_OUTPUT_RULE` gerekçe metni.
- `packages/db/src/readiness.ts` (+6/−1) — `readinessFor` kural sorgusu süzgeci.
- `packages/db/migrations/0031_readiness_clinical_output.sql` (yeni, 24 satır).
- `apps/web/components/admin/templates.tsx` (+3/−2), `apps/web/lib/readiness-rules.ts` (yeni, 7 satır).

Belge: `docs/decisions.md` (**ADR-092**; ADR-036 sonuna "→ ADR-092"), `docs/permissions.md` (`template.manage` satırı), `docs/verification.md` (bu turun sonuçları).

Regresyon testleri (yeni):
- `apps/api/test/qa-110-readiness-clinical.test.ts` — 8 test. Kurulum: sentetik hasta (A kliniği), kabul edilmiş planda KAN-01, yarına randevu (seed kuralları: KAN-01 → ENDO-ONAM, anamnez 365 gün).
  1. Üç klinik çıktı türüyle `POST /readiness-rules` → 422 `VALIDATION_FAILED`, `documentTypeId` gerekçeli; kural sayısı ve `readiness_rule.create` denetim sayısı değişmez.
  2. GENEL-ONAM ile kural 201 (hemen silinir); var olmayan tür 422 "Belge türü bulunamadı." (değişmedi).
  3. Eski biçim etkin EPIKRIZ kuralı (doğrudan eklenir): sekreter/yönetici/hekim hazırlık yanıtında tür kimliği/adı yok; kalemler `[anamnesis missing, document(ENDO-ONAM) missing]`, `ready=false`.
  4. PİA Akış taraması: `readiness_missing` görevi açılır, gerekçe ENDO-ONAM'ı içerir; sekreter/yönetici `GET /tasks` (açık/kapalı/hasta süzgeci) yanıtında klinik çıktı tür adı/kimliği yok.
  5. Klinik kalem için hekim istisnası = rastgele tür kimliği yanıtı (409); istisna satırı yazılmaz.
  6. ENDO-ONAM kabulü + anamnez istisnası → `ready=true`, `["excepted","ok"]` (epikriz yokken); hekim epikriz düzenler → sekreter ve yönetici hazırlık yanıtı **bayt bayt aynı**; tarama sonrası görev "Hazırlık tamamlandı…" ile kapanır.
  7. Eski HASTA-FOYU kuralı pasifleştirilir (200), yeniden etkinleştirme 422 ve satır pasif kalır; seed onam kuralı aç/kapa 200/200.
  8. Migration 0031: etkin RECETE kuralı pasif olur, etkin klinik çıktı kuralı 0; diğer kurallar (id, active) aynı; açık sızan görev `done` + `clinical` + yeni kapanış nedeni, kapalı sızan görev `clinical` (kapanış nedeni korunur), normal görev satırı aynı; ikinci çalıştırma değişiklik yapmaz; sekreter/yönetici görev yanıtlarında iz yok, hekim kapalı listede görür; tarama sonrası randevu için tek temiz görev ("…: Güncel ve hekimce onaylı anamnez").
- `apps/web/test/qa-110-readiness-rule-types.test.ts` — 2 test (süzgeç: klinik çıktı ve pasif tür yok, onam türleri var; form bu süzgeci kullanıyor).

## Ortam (tester ortamına dokunulmadı)
- Worktree: `/home/claude/viadent/.claude/worktrees/agent-aa8a12a5689d2c2ce`. `.env` (git dışı) kökten `cp` ile kopyalandı; `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL`, `BACKUP_DATABASE_URL` veritabanı adı `sed` ile `viadent_fix` (API testleri `viadent_fix_test`); `ADMIN_DATABASE_URL` bakım veritabanı `postgres`'te kaldı (fix1–5 ile aynı); `API_PORT=4100`; `VIADENT_DEMO_PASSWORD` satırı kopyadan çıkarıldı. Kök `.env` yalnız anahtar adlarıyla (`cut -d= -f1`), `.demo-credentials` yalnız değeri maskelenmiş yapısıyla incelendi; hiçbir sır değeri araç çıktısına, dosyaya veya commit'e yazılmadı. Kabukta önceden tanımlı `DATABASE_URL` yoktu.
- E2E için izole yığın: `pnpm db:reset` (yalnız `viadent_fix`'i sildi/kurdu; 0001–0031 uygulandı) + `pnpm db:seed` (demo parolası `.demo-credentials`'tan yalnız ortam değişkeniyle, scratchpad'deki bir sarmalayıcı betikle; yeni `.demo-credentials` yazılmadı). API `:4100` (`WEB_ORIGIN=http://localhost:3100`), worker, web `next dev -p 3100` (`API_INTERNAL_URL=http://127.0.0.1:4100`) — iş bitince yalnız bu worktree'de çalışan kendi süreçlerim durduruldu. `:3000`/`:4000` süreçleri ve `viadent`/`viadent_test` kullanılmadı (sonda `:3000`/`:4000` 200 yanıt verdi); küme genelinde bağlantı sonlandırma yok.
- `pnpm install --frozen-lockfile --offline` (worktree `node_modules`, git dışı).

## Çalıştırılan komutlar ve gerçek sonuçlar
Kusurun üretilmesi (ürün kodu = taban `e8f6b95`):
1. `cd apps/api && npx vitest run test/qa-110-readiness-clinical.test.ts` (ilk taslak) → **7 failed | 1 passed (8)**. Gözlenen: EPIKRIZ kuralı **201**; sekreter/yönetici/hekim hazırlığında 2 klinik iz (tür kimliği + ad); klinik kalem için istisna **201** (var olmayan 409); onam kabulü + istisnadan sonra kalemler `['excepted','ok','excepted']`; eski kuralı etkinleştirme **200**; `0031_*.sql` yok. Geçen: onam türüyle kural.
2. Son test dosyası, ürün dosyaları geçici olarak taban sürümüne döndürülüp (`git checkout -- care.controller.ts readiness.ts`, 0031 kaldırıldı; sonra scratchpad yedeğinden geri yüklendi) → **7 failed | 1 passed (8)** (aynı geçen test).
3. Web: `templates.tsx` geçici olarak taban sürümüne döndürülünce `cd apps/web && npx vitest run test/qa-110-readiness-rule-types.test.ts` → **1 failed | 1 passed (2)**; sonra geri yüklendi.

Yama sonrası (`095272b` ile aynı ürün kodu):
4. `cd apps/api && npx vitest run test/qa-110-readiness-clinical.test.ts test/gorev4.test.ts` → **2 dosya, 28/28**. (Önceki iki ara koşu test dosyası hatasıydı, ürün değil: `beforeAll` randevusu gorev4'ün 06:00 dilimiyle çakıştı → 409, saat 22:10/22:50'ye alındı; `scanAllTenants` yanlış paketten içe aktarılmıştı → worker `jobs.js`.)
5. `cd apps/api && npx vitest run` (tam API regresyonu, `viadent_fix_test`) → **Test Files 35 passed (35), Tests 364 passed (364)** (99,8 sn).
6. `pnpm -r typecheck` → contracts, db, web, worker, api: **Done** (hata yok). `apps/web/tsconfig.tsbuildinfo` değişti, `git checkout` ile geri alındı (commit'e girmedi).
7. `cd apps/web && npx vitest run` → **6 dosya, 72/72**.
8. `cd apps/web && E2E_BASE_URL=http://localhost:3100 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test e2e/gorev4.spec.ts` (E2E_PASSWORD ortamdan) — 4 koşu: (a) **5/6**, masaüstü "sekreter: DEMO belge … karantina" girişte "Bugün" başlığı görünmedi (ilk Next dev derlemesi sırasında); (b) **5/6**, aynı test "element(s) not found" (ayrıntı kaydedilmedi); (c) `--project=masaustu` **3/3**; (d) tam dosya **6/6**. "Yönetici şablon ve PİA Hazır kurallarını görür" testi dört koşuda da geçti. Düşen test değişen kodu (yönetim/şablon ekranı) kullanmıyor; kesin neden belirlenmedi → risk 6.
9. Tarayıcı denetimi (scratchpad Playwright betiği, yönetici, masaüstü 1366 px): Yönetim → Belge şablonları → PİA Hazır kuralları "Belge türü" = "Seçin" + 17 tür; **Epikriz / Hasta bilgi föyü (klinik) / Reçete yazısı yok**; onam türleri ve "Hasta bilgi formu" var.

**Çalıştırılmayanlar:** tam E2E paketi (yalnız ilgili `gorev4.spec.ts`); contracts testleri (değişmedi); `gate.cjs` (tester'ın işi); worker'ın ayrı test betiği yok (PİA Akış taraması API paketinde `scanAllTenants` ile koşuldu); `viadent_fix` üzerinde migration 0031'in dolu veride çalışması yalnız test 8'de (`viadent_fix_test`, iki kez) sınandı.

## Yan etkiler
- Yönetici artık klinik çıktı türüyle hazırlık kuralı oluşturamaz/etkinleştiremez (422); form bu türleri göstermez.
- Varsa eski klinik çıktı kuralları 0031 ile pasif; listede "Pasif" görünür; hekim dahil kimsenin hazırlığında bu kalem yok.
- 0031: eşleşen `readiness_missing` görevleri `clinical` olur, açık olanlar kapanır (`updated_at`, `closed_at` yenilenir; denetim olayı yazılmaz — 0030 ile aynı); sonraki PİA Akış taramasında randevu hâlâ eksikse sekretere klinik kalemsiz yeni görev açılır. Bu görevlerin `task.status` olayları sağlık yetkisizde ADR-091 süzgeciyle Geçmiş/access_log/LOG raporundan çıkar.
- Sorgu maliyeti: hazırlık değerlendirmesinde zaten yapılan `document_types` birleştirmesine bir koşul; kural oluşturma/etkinleştirmede tek satır okuma.
- `viadent_fix` (seed'li) ve `viadent_fix_test` bırakıldı; `.next` derleme önbelleği (git dışı) oluştu.

## Bilinen riskler / kapsam dışı (yamalanmadı)
1. **Eski istisna denetim olayı:** 0031 öncesi klinik çıktı kalemi için kaydedilmiş istisnanın `readiness.exception` olayı (`changes` anahtarı `document:<tür kimliği>`, hekim gerekçesi) sağlık yetkisizde hasta geçmişinde, KVKK `access_log` ve LOG raporunda süzülmez. Belge kimliği/içeriği yok; opak tür kimliği `GET /document-types` ile eşleştirilebilir. Yeni istisna artık oluşamaz (409). Gerekirse `notClinicalReadinessExceptionSql` benzeri süzgeç — ayrı karar.
2. **0031 görev eşleşmesi metinle:** `reason` içinde tür adı aranır (`strpos`). Gerekçe 500 karakterde kesildiyse ve tür adı kesik kaldıysa görev sınıflandırılmaz; tersine, klinik olmayan bir görevin metni tesadüfen klinik tür adını içerirse görev gizlenip kapanır ve tarama yenisini açar (zararsız). Seed tür adlarıyla çakışma yok.
3. **Hekim de kalemi görmez:** ürün kararı (ADR-092); klinik çıktı belgesi hekime Belgeler sekmesinde görünür.
4. `GET /readiness-rules` yöneticiye pasif klinik çıktı kuralını tür adıyla listelemeye devam eder (yapılandırma; hasta verisi yok).
5. Klinik geneli dışa aktarım (`export.clinic`) `readiness_rules`/`tasks` satırlarını tam verir (ADR-088 §3, bilinçli; değişmedi).
6. E2E `gorev4.spec.ts` masaüstü ilk testi 4 koşunun 2'sinde düştü (bir kez girişte ilk derleme sırasında, bir kez öğe bulunamadı); son tam koşu 6/6. Bu turun değişikliği o akışta yok; tester yığınında yeniden sınanmalı.
7. `docs/handoff.md` güncellenmedi (görev kapsamı fix6.md; ADR, permissions.md ve verification.md güncellendi).
