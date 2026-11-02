# Düzeltme 2 — qa-20261102-1209-12fc6fd tur 2 → tester (yeniden sınama)

- **Durum:** QA-104 **FIX_READY**, QA-105 **FIX_READY**. Kapatma yalnız tester yeniden sınamasıyla.
- **Sınanacak sürüm (ürün kodu):** `9327d9e4583a4a0c42dad657da516387d61d94c8` (dal `fix/qa-20261102-tur2`, taban `de7aa62` = `main`; ürün kodu tabanı `08438cf` ile aynıdır, `08438cf..de7aa62` yalnız `qa-runs/` değiştirir).
  Bu `fix2.md` dosyası onun üstünde ayrı bir commit'tir; ürün kodu iki commit'te aynıdır.
- **Not (taban):** izole worktree `publish` / `origin/main` geçmişinden (`9ffdb2a`, canlı demo anlık görüntüsü; `main` ile ortak atası yok) açılmıştı. Düzeltme sınanan sürümün üstüne kurulsun diye worktree içinde `de7aa62`'den yeni dal açıldı. `publish`, `origin/*` ve `main` değiştirilmedi; push yok.
- **Migration:** yok (0001–0029 değişmedi; yeni migration gerekmedi). **Üretime/canlıya gönderim:** yok.
- **Değiştirilmeyenler:** mevcut test beklentileri, `plan.json`, `inventory.md`, `bugs.md`, `handoff.md`, `results*.json`, `evidence/`, `fix1.md`, kapı betikleri.

## Değişen dosyalar (`git diff --stat de7aa62 9327d9e`)
Ürün:
- `apps/api/src/audit/audit.ts` (+8) — `notClinicalOutputDocIdSql(docIdExpr)`: belge kimliği taşıyan satırlar için QA-102 süzgecinin (`notClinicalOutputDocSql`) eşi; `docIdExpr` NULL ise koşul doğru (belgeye bağlı olmayan dosya kalır).
- `apps/api/src/pilot/export.controller.ts` (+18/−6) — QA-104: `POST /patients/:id/export` içinde `patient_documents`, `consent_requests`, `evidence_events`, `files` sorguları `($2::boolean or notClinicalOutputDocIdSql(...))` ile süzülür (`$2` = `patient.health.read`). Sağlık yetkisi yoksa `omitted`'a her zaman `patient_documents:clinical_output`, `consent_requests:clinical_output`, `evidence_events:clinical_output`, `files:clinical_output` eklenir ve ayrı not yazılır; `counts`/`checksums` süzülmüş bölümlerden hesaplanır (değişmeyen kod yolu); `patient.export` denetim kaydının `omitted` alanı bu işaretleri içerir. Dışlanan satır sayısı yanıta/denetime yazılmaz (varlık ipucu olmasın). Klinik geneli dışa aktarıma (`exports/clinic`) yalnız karar yorumu eklendi, davranış değişmedi (ADR-088 §3).
- `apps/api/src/reports/definitions.ts` (+3/−2) — QA-105: `ONAM_CTE` içine `($4::boolean or dt.category <> 'clinical_output')`; `$4` = `patient.health.read`. Satırlar ve toplamlar aynı CTE'den geldiği için ikisi birlikte süzülür; CSV/XLSX aynı koşucuyu kullanır.

Belge:
- `docs/decisions.md` — **ADR-088**: (1) hasta dışa aktarımı kuralı, (2) onam raporunda seçilen davranış: klinik çıktılar **yalnız sağlık yetkiliye görünür** (varsayılan rollerde `report.operations` + `patient.health.read` birlikte yok → bugün hiçbir kullanıcıya listelenmez; hekim 403), (3) klinik geneli dışa aktarım bilinçli olarak tam + açık ürün sahibi kararı.
- `docs/permissions.md` — `export.patient` satırına klinik çıktı belgesi kuralı (ADR-088).

Regresyon testi (yeni):
- `apps/api/test/qa-104-105-export-onam.test.ts` — 8 test. Kurulum: hekim EPIKRIZ üretir (serbest metinde benzersiz işaret), yazdırır (kanıt), belgeye dosya bağlar; sekreter onam belgesi üretir, yazdırır, dosya bağlar.
  - QA-104: yönetici dışa aktarımı JSON metninde epikriz id'si, işaret metni ve bağlı dosya id'si **yok**; `patient_documents` = [onam], `consent_requests` = [onam], `evidence_events` yalnız onam, `files` yalnız onam · `omitted` dört `*:clinical_output` işaretini + sağlık bölümlerini içerir, not var, her bölümde `counts` = satır sayısı ve `checksums` = SHA-256 (bağımsız hesap) · `patient.export` denetiminin `omitted` alanı işaretleri içerir · sağlık yetkili dışa aktaran (test için yalnız o üyeliğin bağlamına `patient.health.read` eklenmiş yönetici): epikriz, işaret, kanıt ve dosya **var**, `omitted` = []; kanca kalkınca yine yok.
  - QA-105: sekreter onam raporunda hastanın tek satırı (onam), hiçbir klinik çıktı türü yok; `totals.count` = DB'deki o günkü klinik olmayan belge sayısı (bağımsız sorgu) = satır sayısı · yönetici CSV ve XLSX'te klinik çıktı türü adları yok, hasta adı var, `TOPLAM · Belge` = klinik olmayan belge sayısı · sağlık yetkili (test için yetki verilmiş sekreter): epikriz satırı var, hastanın 2 satırı, toplam = tüm belgeler; kanca kalkınca 1 satır · hekim `GET /reports/onam` → 403, belgeyi `GET /documents/:id` ile 200 görür.
  - Test kancası: `vi.spyOn(app.get(AuthService), "buildContext")` yalnız verilen üyelik kimliği için izin kümesine `patient.health.read` ekler ve her testte geri alınır; ürün rol matrisi değişmez.

## Ortam (tester ortamına dokunulmadı)
- İzole worktree: `/home/claude/viadent/.claude/worktrees/agent-a8c9a7e3eb0d7e0f2`. Worktree `.env` (git dışı) kökteki `.env`'den kopyalandı; `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL`, `BACKUP_DATABASE_URL` veritabanı adı `viadent_fix` → API testleri `viadent_fix_test` (global-setup her koşuda `drop database if exists viadent_fix_test with (force)` + yeniden kurar). `ADMIN_DATABASE_URL` bakım veritabanı `postgres`'te bırakıldı (fix1 ile aynı). `API_PORT=4100`. Worktree `.env`'den `VIADENT_DEMO_PASSWORD` satırı çıkarıldı (kullanılmadı; seed/E2E koşulmadı).
- `:3000`/`:4000` süreçleri ve `viadent`/`viadent_test` veritabanları kullanılmadı; süreç durdurulmadı; küme genelinde bağlantı sonlandırma yapılmadı. Sunucu (API/web/worker) başlatılmadı; API testleri süreç içi Nest uygulamasıyla koşar.
- Hiçbir parola dosyaya/çıktıya yazılmadı (bağlantı dizgeleri yalnız maskeli gösterildi).

## Çalıştırılan komutlar ve gerçek sonuçlar
Kusurun üretilmesi (yeni test + taban `de7aa62` ürün kodu; ürün dosyaları geçici olarak `git checkout HEAD --` ile tabana alınıp sonra yamalı hale geri konuldu):
1. `cd apps/api && npx vitest run test/qa-104-105-export-onam.test.ts` → **7 failed | 1 passed (8)**. Gözlenen: yönetici dışa aktarımı epikriz id'sini içeriyor; `omitted` yalnız 4 sağlık bölümü (`anamnesis_versions`, …), `*:clinical_output` yok; denetimde de yok; sekreter onam raporunda hastanın 2 satırı (epikriz dahil; beklenen 1); yönetici CSV'si "Epikriz / tedavi özeti" içeriyor. Sağlık yetkili testleri yalnız son "kanca kalkınca görünmez" adımında kırmızı (aynı sızıntı). Geçen 1: hekim 403 (mevcut matris).

Yama sonrası (`9327d9e` ile aynı ürün kodu):
2. `cd apps/api && npx vitest run test/qa-104-105-export-onam.test.ts` → **8 passed (8)**.
3. `cd apps/api && npx vitest run` (tam API regresyonu, `viadent_fix_test`) → **Test Files 31 passed (31), Tests 333 passed (333)**, 0 başarısız (iki kez koşuldu, ikisi de aynı; son koşu 84 sn).
4. `pnpm -r typecheck` → contracts, db, web, worker, api: **Done** (hata yok). (İlk denemede yeni test dosyasında `noUncheckedIndexedAccess` tip hatası vardı; test tipi düzeltildi, sonra yeşil.)

**Çalıştırılmayanlar:** web birim testleri ve E2E (web kodu değişmedi), contracts testleri (değişmedi), worker, `gate.cjs` (tester'ın işi), tarayıcı ile UI denetimi (Hasta 360 → "Veriyi indir" ve Raporlar → Onam ekranı aynı API uçlarını kullanır; ekran kodu değişmedi).

## Yan etkiler
- Davranış değişikliği: sağlık yetkisi olmayan yöneticinin KVKK hasta dışa aktarımı artık klinik çıktı belgelerini ve bağlı onay/kanıt/dosya satırlarını içermez; `omitted` her zaman dört `*:clinical_output` işaretini taşır (klinik çıktı belgesi olmasa da) ve bir not satırı daha vardır. Mevcut `gorev7` testi (`arrayContaining`) etkilenmedi.
- Onam/belge raporunda (ekran, CSV, XLSX) sekreter/yönetici/destek klinik çıktı satırı görmez; toplamlar küçülür (yalnız klinik çıktı varsa).
- `viadent_fix_test` veritabanı yeniden kuruldu ve bırakıldı. `viadent_fix` bu turda oluşturulmadı/kullanılmadı (önceki turdan varsa dokunulmadı).
- Worktree'de git dışı dosyalar: `.env`, `node_modules`. `apps/web/tsconfig.tsbuildinfo` typecheck ile değişti, commit'e alınmadı (geri alındı).

## Bilinen riskler / kapsam dışı
1. **Klinik geneli dışa aktarım (`export.clinic`)** sağlık yetkisi olmayan yöneticiye klinik çıktı belgeleri dahil tüm sağlık tablolarını (anamnez, klinik not, odontogram, tanı) vermeye devam eder. Bu Görev 7'den beri bilinçli tasarım (veri sorumlusu taşınabilirliği) olarak ADR-088 §3'te yazıldı; Plan §05 ilkesiyle gerilimi ürün sahibi kararına bırakıldı. Tester bunu kusur sayarsa ayrı bulgu/karar gerekir.
2. **Yeni bulgu adayı — klinik hassasiyetli dosya metaverisi (yamalanmadı, tester'ın açması önerilir):** `FILE_SENSITIVITY` ile `clinical` sayılan kategoriler (`radiograph`, `clinical_photo`, `clinical_document`) dosya listesinde/ayrıntısında sağlık yetkisizden gizlenir (`files.controller.ts`, "varlığını da göremez"), ama hasta dışa aktarımının `files` bölümü `sensitivity` süzmez. Geçici sonda testiyle doğrulandı (commit'e girmedi, silindi): hekim hastaya `radiograph` "panoramik-sonda.jpg" yükledi → yönetici `GET /patients/:id/files` listesinde **yok**, yönetici `POST /patients/:id/export` `sections.files` içinde **var** (`radiograph:panoramik-sonda.jpg`, ad + SHA-256 + kategori; içerik yok). Görev 7'den beri var; QA-104 kabul ölçütü (`patient_document_id` ile klinik çıktıya bağlı dosyalar) dışında olduğu için bu yamaya alınmadı. Önerilen düzeltme: `files` koşuluna `($2::boolean or (f.sensitivity = 'administrative' and …))` + `omitted` işareti (ör. `files:clinical_sensitivity`).
3. **Varsayılan rollerde sağlık yetkili dışa aktaran/rapor kullanıcısı yok:** sağlık yetkili davranış yalnız test kancasıyla (bağlama izin ekleyerek) sınanabildi; gerçek bir rolle uçtan uca sınanmadı.
4. fix1 risk listesindeki 3. madde (sekreter dosya listesinde klinik çıktı belge id'si ipucu) bu turda yamalanmadı.
5. Proje kuralındaki oturum sonu `docs/handoff.md` / `docs/verification.md` güncellemesi yapılmadı (görev kapsamı fix2.md ile sınırlı; ADR ve permissions.md güncellendi).
