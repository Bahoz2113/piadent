# Düzeltme 3 — qa-20261102-1209-12fc6fd tur 3 → tester (yeniden sınama)

- **Durum:** QA-106 **FIX_READY**, QA-107 **FIX_READY**. Kapatma yalnız tester yeniden sınamasıyla.
- **Sınanacak sürüm (ürün kodu):** `215e5f377fcd15688460c01d4d25074f6443257e` (dal `fix/qa-20261102-tur3`, taban `8f72bc7` = yerel `main` ucu; `8f72bc7` ürün kodu = `bb49098` = fix2 `9327d9e`, aradaki commit'ler yalnız `qa-runs/` değiştirir).
  Bu `fix3.md` onun üstünde ayrı bir commit'tir; ürün kodu iki commit'te aynıdır.
- **Taban notu:** worktree `origin/main` (`9ffdb2a`, canlı demo geçmişi; ortak ata yok) üzerinden açılmıştı; çalışma dalı `git checkout -b fix/qa-20261102-tur3 main` ile `8f72bc7`'den açıldı. `main`, `publish`, `origin/*` değiştirilmedi; push yok.
- **Migration:** yok (0001–0029 değişmedi; ADR-089 sorguda birleştirmeyi seçti). **Üretime/canlıya gönderim:** yok.
- **Değiştirilmeyenler:** mevcut test beklentileri, `plan.json`, `inventory.md`, `bugs.md`, `handoff.md`, `environment.md`, `results*.json`, `evidence/`, `fix1.md`, `fix2.md`, kapı betikleri (`qa/cezeri/`).

## Değişen dosyalar (`git diff --stat 8f72bc7 215e5f3`: 8 dosya, +295/−18)
Ürün:
- `apps/api/src/audit/audit.ts` (+8) — `nonClinicalFileSql(alias)`: `(alias.sensitivity = 'administrative' and notClinicalOutputDocIdSql(alias.patient_document_id))`. Sağlık yetkisizde görünür dosyanın tek tanımı (ADR-089).
- `apps/api/src/documents/files.controller.ts` (+18/−10) — QA-107: `VISIBLE = ($2::boolean or nonClinicalFileSql("f"))`, `$2` = `patient.health.read`. `GET /patients/:id/files`, `GET /files/:id`, `GET /files/:id/content`, `PUT /files/:id/content`, `POST /files/:id/delete` kaydı bu koşulla okur; satır gelmezse `404 NOT_FOUND "Dosya bulunamadı."` (var olmayanla aynı) ve hiçbir yazma (erişim olayı, `upload_failures`, `status`, denetim, kuyruk) yapılmadan döner. `POST /files` (başlatma) değişmedi: kategori hassasiyeti (kayıt yok) + QA-101'deki klinik çıktı bağlantı kapısı.
- `apps/api/src/documents/documents.controller.ts` (+4/−2) — `POST /documents/:id/decision` `fileId`: aynı koşul; görünmeyen dosya var olmayanla aynı `422 VALIDATION_FAILED {fileId}`; transaction geri alınır, onay durumu/kanıt değişmez.
- `apps/api/src/pilot/export.controller.ts` (+8/−4) — QA-106: hasta dışa aktarımında `files` sorgusu `($2::boolean or nonClinicalFileSql("f"))`; sağlık yetkisi yoksa `omitted` her zaman `files:clinical` içerir (ADR-088'in dört `*:clinical_output` işaretine ek) ve ayrı not satırı ("… metaverileri … dahil edilmedi (omitted: files:clinical)"). `counts`/`checksums` süzülmüş bölümlerden (değişmeyen kod yolu); `patient.export` denetiminin `omitted` alanı işareti içerir. Dışlanan satır sayısı yazılmaz. Klinik geneli dışa aktarım değişmedi (ADR-088 §3).

Belge:
- `docs/decisions.md` — **ADR-089**: tek görünürlük kuralı; **yaklaşım: sorguda birleştirme** (hassasiyet yükseltme değil) ve gerekçesi; uygulandığı uçlar; dışa aktarım işareti; bilinen sınır (aşağıdaki risk 1–2).
- `docs/permissions.md` — `file.read` ve `export.patient` satırları (ADR-089).
- `docs/verification.md` — bu turun gerçek test sonuçları.

Regresyon testi (yeni): `apps/api/test/qa-106-107-file-sensitivity.test.ts` — 7 test. Kurulum (sentetik hasta, A kliniği): hekim EPIKRIZ üretir; sekreter `identity` (idari, görünür kalmalı); hekim `radiograph` (klinik hassasiyet) ve epikrize bağlı `document_scan` — her biri hem `available` (tarama işçisiyle) hem `initiated`; ayrıca hekim silme sınaması için bağlı bir dosya daha.
- Liste: sekreter ve yönetici yanıtında gizli dosya kimlikleri, dosya adları ve epikriz kimliği (`patientDocumentId`) **yok**, idari dosya **var**; hekim hepsini ve `patientDocumentId`'yi görür.
- `GET /files/:id`, `GET /files/:id/content`: sekreter/yönetici, 4 gizli dosyanın her biri için yanıt (`status, code, message, field_errors, details`) = rastgele var olmayan kimlik yanıtı (404); `file_assets` satırı, `file_access_events` sayısı, denetim ve kanıt sayıları önce/sonra aynı. İdari dosya 200 (içerik bayt bayt aynı).
- `PUT /files/:id/content` (eksik bayt ve tam bayt) ve `POST /files/:id/delete`: aynı eşitlik + yan etkisizlik (sekreterde silme, yöneticide yükleme rol kapısıyla zaten 403 = var olmayanla aynı).
- `POST /documents/:id/decision` `fileId`: sekreter radyograf/bağlı tarama ile = var olmayan dosya (422), onay `issued` kalır ve kanıt sayısı değişmez; idari dosya ile karar 200.
- Hekim: ayrıntı, içerik (iki gizli tür), yükleme tamamlama (iki `initiated`), gizli dosyayla karar ve silme → 200.
- Dışa aktarım (yönetici): `files` bölümünde yalnız idari ve klinik çıktıya bağlı olmayan dosyalar; dosya adları yanıtın hiçbir yerinde yok; `omitted` ⊇ {`files:clinical`, `files:clinical_output`}; not var; tüm bölümlerde `counts` = satır sayısı, `checksums` = SHA-256 (bağımsız hesap); `patient.export` denetimi `files:clinical` taşır. Sağlık yetkili dışa aktaran (test kancası: yalnız o üyeliğin bağlamına `patient.health.read`; ürün rol matrisi değişmez, qa-104-105 ile aynı kanca): tüm dosyalar var, `omitted` = []; kanca kalkınca radyograf yine yok.

## Ortam (tester ortamına dokunulmadı)
- Worktree: `/home/claude/viadent/.claude/worktrees/agent-a036f06185024372f`. `.env` (git dışı) kökteki `.env`'den kopyalandı; `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL`, `BACKUP_DATABASE_URL` veritabanı adı `viadent_fix` → API testleri `viadent_fix_test` (global-setup her koşuda `drop database if exists … with (force)` + migration + sentetik seed). `ADMIN_DATABASE_URL` bakım veritabanı `postgres`'te bırakıldı (fix1/fix2 ile aynı). `API_PORT=4100`. `VIADENT_DEMO_PASSWORD` satırı kopyaya alınmadı (seed/E2E koşulmadı). Bağlantı dizgeleri yalnız maskeli gösterildi; parola yazdırılmadı.
- `:3000`/`:4000` süreçleri ve `viadent`/`viadent_test` kullanılmadı; süreç durdurulmadı; küme genelinde bağlantı sonlandırma yok. Sunucu başlatılmadı (testler süreç içi Nest uygulaması).
- `pnpm install --frozen-lockfile --offline` (worktree `node_modules`, git dışı).

## Çalıştırılan komutlar ve gerçek sonuçlar
Kusurun üretilmesi (yeni test, ürün kodu = taban `8f72bc7`):
1. `cd apps/api && npx vitest run test/qa-106-107-file-sensitivity.test.ts` → **6 failed | 1 passed (7)**. Gözlenen: sekreter listesinde epikrize bağlı tarama var; sekreter `GET /files/:id` bağlı taramada **200** (var olmayan 404); sekreter eksik bayt `PUT` → **409** (var olmayan 404); sekreter radyografı onam kanıtı olarak bağlayınca karar **200** (var olmayan 422; onay kapandı); yönetici dışa aktarımında `files` içinde `sensitivity: clinical` satırlar (`panoramik-QA106-….png`), `files:clinical` yok. Geçen 1: hekim 200 testi.
   (Aynı dosyanın ilk taslağıyla bir önceki koşu da 6/1'di; taslakta dışa aktarım iddiası tüm JSON metninde dosya kimliği arıyordu, bu da hekimin onam kanıtına bağladığı dosya kimliğine takılacaktı → iddia `files` bölümüne ve dosya adlarına daraltıldı, ayrıntı risk 2.)

Yama sonrası (`215e5f3` ile aynı ürün kodu):
2. `cd apps/api && npx vitest run test/qa-106-107-file-sensitivity.test.ts` → **7 passed (7)**.
3. `cd apps/api && npx vitest run` (tam API regresyonu, `viadent_fix_test`) → **Test Files 32 passed (32), Tests 340 passed (340)** (92 sn). Commit sonrası ikinci koşu: **32/32, 340/340** (88 sn).
4. `pnpm -r typecheck` → contracts, db, web, worker, api: **Done** (hata yok). `apps/web/tsconfig.tsbuildinfo` typecheck ile değişti, geri alındı (commit'e girmedi).

Komşu risk sondası (geçici test, commit'e girmedi, silindi): hekim hastaya `radiograph` yükler ve içeriği gönderir → sekreter `GET /patients/:id/history` yanıtında radyograf kimliği **var** (`file.upload:file` olayı). Bkz. risk 1.

**Çalıştırılmayanlar:** web birim testleri ve E2E (web kodu değişmedi; web `patientDocumentId`'yi kullanmıyor), contracts testleri (değişmedi), worker testleri, `gate.cjs` (tester'ın işi), tarayıcı ile UI denetimi (Hasta 360 → Dosyalar ve "Veriyi indir" aynı API uçlarını kullanır).

## Yan etkiler
- Sağlık yetkisi olmayan rol (sekreter, yönetici, finans, destek) klinik çıktı belgesine bağlı dosyaları artık listede görmez ve hiçbir dosya ucunda erişemez (404); bu dosyaları onam kanıtı olarak bağlayamaz (422).
- Daha önce klinik hassasiyetli dosyada sekreterin `PUT /files/:id/content` ile aldığı yanıt zaten 404'tü; değişmedi. Bağlı idari dosyada eskiden 409/422 + `upload_failed` olayı yazılıyordu; artık 404 ve olay yok.
- Hasta dışa aktarımı (sağlık yetkisiz): `files` bölümü küçülür (klinik hassasiyetli dosya varsa), `omitted` bir işaret (`files:clinical`) ve `notes` bir satır daha taşır — dosya olsa da olmasa da aynı. Mevcut `gorev7` ve `qa-104-105` testleri (`arrayContaining`) etkilenmedi.
- Sorgu maliyeti: dosya okumalarında `patient_documents` birincil anahtarına bir `exists` alt sorgusu.
- `viadent_fix_test` yeniden kuruldu ve bırakıldı; `viadent_fix` oluşturulmadı/kullanılmadı.

## Bilinen riskler / kapsam dışı (yeni bulgu adayları — yamalanmadı)
1. **Hasta geçmişi ve dışa aktarım `access_log`'unda dosya denetim olayları (QA-106 ile aynı sınıf, önceden var):** `file.upload`/`file.delete` denetim olayları `entity_type = 'file'`; `CLINICAL_ENTITY_TYPES` ve `notClinicalOutputDocSql` bunları süzmez. Sonda: sekreter `GET /patients/:id/history` radyografın `file.upload` olayını `entityId` (dosya kimliği) ve `changes.sha256` ile görür. Dışa aktarım `access_log`'u `entity_id` vermez ama gizli dosya sayısı kadar `file.upload` satırı içerir (varlık/sayı ipucu). Önerilen düzeltme: QA-102 tarzı süzgeç — `not (e.entity_type = 'file' and not exists (select 1 from file_assets hf where hf.id = e.entity_id and nonClinicalFileSql('hf')))` geçmiş, `access_log` ve varsa denetim raporunda.
2. **Onam kanıtındaki `file_id`:** sağlık yetkili kullanıcı (hekim) klinik hassasiyetli ya da klinik çıktıya bağlı bir dosyayı **klinik olmayan** (onam) belgenin taranmış nüshası olarak bağlarsa (`decision` `fileId`), `evidence_events.file_id` bu dosyanın kimliğini taşır; sekreter `GET /documents/:id` kanıt listesinde ve yönetici dışa aktarımının `evidence_events` bölümünde bu kimliği görür (ad/özet/içerik değil; dosya uçları 404). Seçenekler: sağlık yetkisizde bu alanı maskelemek veya klinik dosyanın klinik olmayan belgeye kanıt olarak bağlanmasını herkes için reddetmek (hekim davranışını değiştirir → ürün kararı).
3. **Varsayılan rollerde sağlık yetkili dışa aktaran yok:** sağlık yetkili dışa aktarım yalnız test kancasıyla sınandı (fix2 risk 3 ile aynı).
4. **Klinik geneli dışa aktarım** (`export.clinic`) tüm `file_assets` satırlarını vermeye devam eder (ADR-088 §3, bilinçli; ürün sahibi kararı açık).
5. `docs/handoff.md` güncellenmedi (görev kapsamı fix3.md; ADR, permissions.md ve verification.md güncellendi).
