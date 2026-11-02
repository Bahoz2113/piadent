# Düzeltme 1 — qa-20261102-1209-12fc6fd → tester (yeniden sınama)

- **Durum:** QA-101 **FIX_READY**, QA-102 **FIX_READY**, QA-103 **FIX_READY**. Kapatma yalnız tester yeniden sınamasıyla.
- **Sınanacak sürüm (ürün kodu):** `573f12caef8ccd5723a8dcfaba184742e68cd6c6` (dal `fix/qa-20261102-tur1`, taban `12fc6fd47406e3e3142248490550298abf27af03`).
  Bu `fix1.md` dosyası onun üstünde ayrı bir commit'tir; ürün kodu iki commit'te aynıdır.
- **Migration:** yok (0001–0029 değişmedi; yeni migration eklenmedi). **Üretime/canlıya gönderim:** yok.
- **Değiştirilmeyenler:** mevcut test beklentileri, `plan.json`, `inventory.md`, `bugs.md`, `handoff.md`, `evidence/` (bu klasördeki geçmiş kanıtlar), kapı betikleri.

## Değişen dosyalar (`git diff --stat 12fc6fd 573f12c`)
Ürün:
- `apps/api/src/documents/documents.controller.ts` — `assertDocVisible(c, ctx, docId)` yardımcısı; `print`, `decision`, `revoke` ilk adımda çağırır. Klinik çıktı + `patient.health.read` yok → `Errors.notFound("Belge")` (var olmayan belgeyle birebir aynı gövde). Kapı, `decision`daki 409 `NO_DECISION_REQUIRED` kahininden ve dosya/kanıt yazımından önce çalışır.
- `apps/api/src/documents/files.controller.ts` — `POST /files` `patientDocumentId` doğrulaması: sağlık yetkisi yoksa klinik çıktı belgesi "bulunamadı" sayılır → var olmayan belgeyle aynı 422 (`Belge bu hastaya ait değil.`).
- `apps/api/src/audit/audit.ts` — `notClinicalOutputDocSql(alias)` ortak SQL süzgeci (entity_type `patient_document` ve belge kategorisi `clinical_output`).
- `apps/api/src/patients/patients.service.ts` — `history()` (PİA İz; UI Geçmiş sekmesi bu ucu okur) sağlık yetkisi yoksa süzgeci uygular.
- `apps/api/src/pilot/export.controller.ts` — KVKK hasta dışa aktarımı `access_log` aynı süzgeç (QA-001 ile aynı yüzey).
- `apps/api/src/reports/definitions.ts` — denetim (`log`) raporu aynı süzgeç (QA-001 ile aynı yüzey).
- `apps/web/lib/invoice-view.ts` (yeni) — `invoiceView()` / `invoicePrintHtml()`: durumdan uyarı metni/türü, düğme etiketi, filigran, başlık ve numara satırı.
- `apps/web/components/finance/invoices.tsx` — fatura ayrıntı çekmecesi uyarı, alt düğme ve yazdırma çıktısını bu yardımcıdan üretir.

Davranış (QA-103): `draft`/`rejected` → mevcut TASLAK uyarısı (+ yalnız bağlı değilken "e-Belge sağlayıcısı bağlı değil; gönderim denemesi reddedilir…"), "Taslağı yazdır", TASLAK filigranı — değişmedi. `pending_provider` → "…sağlayıcıya iletildi; numara yalnız sağlayıcı yanıtıyla oluşur" (MOCK ise "MOCK — resmî değil"). `issued` → MOCK: "MOCK sağlayıcı tarafından düzenlendi (<no>). MOCK — resmî değil…", gerçek: "Sağlayıcı belgesi: <no> · <sağlayıcı>". `cancelled` → numaralıysa sağlayıcıda iptal (MOCK ibaresiyle), numarasızsa "Taslak, sağlayıcıya gönderilmeden iptal edildi…". Düzenlenmiş/iptal/bekleyen faturada düğme "Yazdır", çıktıda TASLAK yok; filigran iptalde "İPTAL", MOCK düzenlemede "MOCK", gerçek düzenlemede yok. "bağlı değil" cümlesi taslak dışı durumlarda hiç gösterilmez.

Regresyon testleri (yeni):
- `apps/api/test/qa-101-102-clinical-output-gate.test.ts` — 10 test. QA-101: sekreter print → 404 ve gövde var olmayan id ile aynı, kanıt sayısı değişmez; sekreter decision → 404 (409 değil), aynı gövde; yönetici revoke → 404, aynı gövde, durum `issued` kalır, `revoked` kanıtı yok; sekreter dosya bağlama → var olmayan belgeyle aynı 422, dosya kaydı açılmaz; asistan ayrıntı 200 + print 200 (kanıt +1), hekim dosya bağlar 201; onam belgesinde sekreter print 200. QA-102: hekim `document.issue`/`document.revoke` görür; sekreter/yönetici/finans klinik çıktı belgesinin hiçbir olayını görmez, onam `document.issue` ve `patient.create` görünür; hekim revoke 200; KVKK `access_log` ve denetim raporu klinik çıktı olayı taşımaz, onam olayını taşır.
- `apps/web/test/qa-103-invoice-view.test.ts` — 12 test (durum matrisi: draft bağlı/değil, rejected, pending MOCK, issued MOCK bağlı/pasif, issued gerçek, cancelled MOCK/gerçek/taslakken; + bileşenin sabit TASLAK filigranı/"Taslağı yazdır"/koşulsuz "bağlı değil" metni içermediğini doğrulayan kaynak koruması).
- `apps/web/e2e/qa-103-fatura-durum.spec.ts` — 1 E2E: yönetici MOCK e-belge bağlantısı (kabul) → finans taslak → gönder → worker → `issued` → çekmece: "MOCK — resmî değil" uyarısı, TASLAK/“gönderim reddedilir” yok, "Taslağı yazdır" yok, "Yazdır" çıktısında numara + MOCK ibaresi, TASLAK yok → iptal → worker → `cancelled` → bağlantı pasif (kanıttaki durum) → aynı denetimler. `finally` içinde bağlantıyı pasife döndürür (fatura-taslagi senaryosunun "bağlı değil" başlangıcını bozmaz). Gerektirdiği: API + web + **worker** + `E2E_PASSWORD`.

## Ortam (tester ortamına dokunulmadı)
- İzole worktree: `/home/claude/viadent/.claude/worktrees/agent-a743c50945221e712`. Worktree `.env` (git dışı) ana `.env`'den türetildi; `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL`, `BACKUP_DATABASE_URL` veritabanı adı `viadent_fix`; API testleri `viadent_fix_test` kullanır (`apps/api/test/env.ts` çözümlemesi çalıştırılarak doğrulandı: TEST_DB=`viadent_fix_test`). `ADMIN_DATABASE_URL` bakım veritabanı `postgres`'te bırakıldı (global-setup `create/drop database viadent_fix_test` bu bağlantıdan yapar; var olmayan `viadent_fix`'e bağlanamazdı). `API_PORT=4100`.
- `pnpm --filter @viadent/db roles` **çalıştırılmadı**: paylaşılan rollerde `ALTER ROLE … PASSWORD` yapıyor. Yerine yalnız `create database viadent_fix owner viadent_owner` + `applyDbTuning` (veritabanı kapsamlı) çalıştıran geçici betik kullanıldı (scratchpad'de, depoda değil).
- Kendi E2E yığınım: API `:4100`, web `:3100` (`API_INTERNAL_URL=http://127.0.0.1:4100` ile `next build`), worker — üçü de worktree dizininden ve `viadent_fix` üzerinde; iş bitince yalnız bu süreçler (çalışma dizini worktree olanlar) durduruldu. `:3000`/`:4000` süreçleri ve `viadent`/`viadent_test` veritabanları kullanılmadı; küme genelinde bağlantı sonlandırma yapılmadı (yalnız global-setup'ın kendi `drop database if exists viadent_fix_test with (force)` adımı).
- Demo parolası: `viadent_fix` seed'i parola verilmeden çalıştırıldı → rastgele parola worktree kökündeki `.demo-credentials` (git dışı) dosyasına yazıldı; E2E bunu ortam değişkeniyle okudu. Ana depodaki `.demo-credentials` okunmadı/değişmedi. Hiçbir parola dosyaya/çıktıya yazılmadı.

## Çalıştırılan komutlar ve gerçek sonuçlar
Kusurun üretilmesi (yama öncesi, `12fc6fd` ürün kodu + yeni testler):
1. `cd apps/api && npx vitest run test/qa-101-102-clinical-output-gate.test.ts` → **9 failed | 1 passed (10)**. Gözlenen: sekreter print 200 (beklenen 404), sekreter decision 409 (beklenen 404), yönetici revoke 200 (beklenen 404), sekreter dosya bağlama 201 (beklenen 422), sekreter/yönetici/finans geçmişinde klinik çıktı olayı 2 adet, KVKK access_log 3 patient_document olayı (beklenen 1), denetim raporunda 2 satır (beklenen 0). Asistan/hekim adımları, yöneticinin belgeyi iptal edebilmiş olmasından zincirleme kırmızı.
2. Web kaynak koruması eski bileşenle (`invoices.tsx` 12fc6fd sürümü geçici yerleştirildi): `npx vitest run test/qa-103-invoice-view.test.ts` → **1 failed | 11 passed (12)** (bileşen sabit TASLAK filigranı/"Taslağı yazdır"/koşulsuz "bağlı değil" içeriyor).
3. E2E eski bileşen derlemesiyle (`:3100`): `playwright test e2e/qa-103-fatura-durum.spec.ts --project=masaustu` → **1 failed** (düzenlenmiş MOCK faturada "MOCK — resmî değil" uyarısı yok; TASLAK uyarısı görünüyor). Ardından yamalı bileşen geri konup yeniden derlendi.

Yama sonrası (`573f12c` ile aynı ürün kodu):
4. `cd apps/api && npx vitest run test/qa-101-102-clinical-output-gate.test.ts` → **10 passed (10)**.
5. `cd apps/api && npx vitest run` (tam API regresyonu, `viadent_fix_test`) → **Test Files 30 passed (30), Tests 325 passed (325)**.
6. `cd apps/web && npx vitest run` → **Test Files 5 passed (5), Tests 70 passed (70)** (yeni 12 dahil).
7. `cd packages/contracts && npx vitest run` → **15 passed (15)**.
8. `pnpm -r run typecheck` → contracts, db, web, worker, api: **Done** (hata yok).
9. E2E (yamalı derleme, API :4100 + web :3100 + worker, `viadent_fix` taze seed): `playwright test e2e/fatura-taslagi.spec.ts e2e/qa-103-fatura-durum.spec.ts e2e/klinik-cikti.spec.ts`
   - `--project=masaustu` → **3 passed** (art arda 3 koşu yeşil; mevcut taslak akışı `fatura-taslagi` değişmeden geçiyor).
   - `--project=telefon-360` → **3 passed**.
   - Not: ara koşulardan biri, yarıda kalan QA-103 koşusunun MOCK bağlantıyı aktif bırakması yüzünden `fatura-taslagi`'yi kırdı (test durumu kirliliği); spec'e `finally` ile pasife döndürme eklendi, sonraki koşular yeşil.

**Çalıştırılmayanlar:** tam E2E paketi (`e2e/*` diğer 25 spec), worker paketi testleri (test betiği yok), `gate.cjs` (tester'ın işi), erişilebilirlik (axe) taraması.

## Yan etkiler
- Yeni veritabanları: `viadent_fix` (migrate + sentetik seed + bir MOCK e-belge bağlantısı, şu an `disabled`; birkaç sentetik hasta/fatura) ve `viadent_fix_test` (API test global-setup'ı her koşuda yeniden kurar). İkisi de bırakıldı; gerekirse `drop database viadent_fix_test; drop database viadent_fix;` ile silinebilir.
- `applyDbTuning` her iki fix veritabanında `alter function pg_catalog.textlike(text,text) leakproof` uyguladı (veritabanı kapsamlı; üretimle aynı ayar, ADR-047).
- Worktree'de git dışı dosyalar: `.env`, `.demo-credentials`, `apps/web/.next`, `apps/web/test-results`, `node_modules`.
- Davranış değişikliği: sağlık yetkisi olmayan rol klinik çıktı belgesinde print/decision/revoke'ta artık 404 alır (önceki 200/409); asistan print davranışı korunur. Geçmiş/KVKK access_log/denetim raporu klinik çıktı belge olaylarını sağlık yetkisi yoksa göstermez. Fatura çekmecesinde taslak dışı durumlarda düğme etiketi "Yazdır".
- API `GET /invoices/:id` yanıtındaki `notice` alanı değişmedi (hâlâ sabit TASLAK metni); UI taslak dışı durumlarda bu alanı kullanmıyor.

## Kapsam dışında gözlenen, yamalanmayan riskler (karar/yeni bulgu için)
1. **KVKK hasta dışa aktarımı içerik bölümleri:** `export.controller.ts` `HEALTH` kümesi `patient_documents`, `consent_requests`, `evidence_events` içermiyor; `export.patient` yetkili yönetici (sağlık yetkisiz) dışa aktarımda klinik çıktı belgesinin **metnini** (`content`) alıyor gibi görünüyor. Kodla gözlendi, sınanmadı. QA-101/102 kabul ölçütlerinin dışında; veri sahibi talebinde kapsam kararı gerektiriyor.
2. **Onam raporu (`reports/onam`):** `report.clinical` yetkili yönetici, klinik çıktı belgelerinin başlık/tür satırlarını görüyor olabilir (`ONAM_CTE` kategori süzmüyor). Kodla gözlendi, sınanmadı.
3. **Dosya listesi `patientDocumentId`:** sağlık yetkili bir rol idari kategorideki bir dosyayı klinik çıktı belgesine bağlarsa, sekreter dosya listesinde o belge id'sini görür (varlık ipucu). Düşük etki; yamalanmadı.
4. Proje kuralındaki oturum sonu `docs/handoff.md` / `docs/verification.md` güncellemesi bu yamada yapılmadı (görev kapsamı fix1.md ile sınırlı).
