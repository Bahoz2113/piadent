# Düzeltme 4 — qa-20261102-1209-12fc6fd tur 4 → tester (yeniden sınama)

- **Durum:** QA-108 **FIX_READY**. Kapatma yalnız tester yeniden sınamasıyla.
- **Sınanacak sürüm (ürün kodu):** `2cee06df4ce17841757ee37df1480c0ec49b22dc` (dal `fix/qa-20261102-tur4`, taban `70897cd` = yerel `main` ucu; `70897cd` ürün kodu = `49a151b` = fix3 `215e5f3`, aradaki commit'ler yalnız `qa-runs/` değiştirir).
  Bu `fix4.md` onun üstünde ayrı bir commit'tir; ürün kodu iki commit'te aynıdır.
- **Taban notu:** worktree `origin/main` (`9ffdb2a`, canlı demo geçmişi; ortak ata yok) üzerinden açılmıştı; çalışma dalı `git checkout -b fix/qa-20261102-tur4 main` ile `70897cd`'den açıldı. `main`, `publish`, `origin/*` değiştirilmedi; push yok.
- **Migration:** yok (0001–0029 değişmedi). **Üretime/canlıya gönderim:** yok.
- **Değiştirilmeyenler:** mevcut test beklentileri (hiçbir mevcut test dosyası değişmedi), `plan.json`, `inventory.md`, `bugs.md`, `handoff.md`, `environment.md`, `results*.json`, `evidence/`, `fix1.md`–`fix3.md`, kapı betikleri (`qa/cezeri/`). Web kodu değişmedi.

## Değişen dosyalar (`git diff --stat 70897cd 2cee06d`: 9 dosya, +265/−15)
Ürün:
- `apps/api/src/audit/audit.ts` (+17) — iki yeni yardımcı, ikisi de ADR-089 `nonClinicalFileSql` üzerine:
  - `notHiddenFileEventSql(alias)`: `not (entity_type = 'file' and not exists (select 1 from file_assets hf where hf.id = entity_id and nonClinicalFileSql('hf')))` — dosya denetim olayı yalnız görünür dosyaya aitse geçer (dosya satırı yoksa olay gizlenir).
  - `visibleFileIdSql(expr, health)`: `case when health or expr is null or exists(… nonClinicalFileSql('vf')) then expr end` — görünmeyen dosyanın kimliği NULL.
- `apps/api/src/patients/patients.service.ts` — `history()` (PİA İz, UI Geçmiş): sağlık yetkisi yoksa mevcut süzgece `and notHiddenFileEventSql("e")` eklendi (kabul ölçütü 1).
- `apps/api/src/pilot/export.controller.ts` — hasta dışa aktarımı: `access_log` aynı süzgeç (ölçüt 2); `evidence_events` satırları kalır, `file_id` = `visibleFileIdSql` (görünmezse `null`; sütun kümesi ve sırası korunur, `maskFileId()`), `counts`/`checksums` maskelenmiş içerikten (değişmeyen kod yolu) (ölçüt 3). Sağlık yetkisi yoksa ek not satırı: "…erişim günlüğündeki (access_log) olayları dahil edilmedi ve kanıt olaylarındaki dosya kimliği (evidence_events.file_id) boş bırakıldı; kanıt satırları kalır." `omitted`'a yeni işaret eklenmedi (satır çıkarılmıyor).
- `apps/api/src/documents/documents.controller.ts` — `GET /documents/:id` `evidence[].fileId` = `visibleFileIdSql` (ölçüt 3). `decision` ucu değişmedi (onam taramasına kategori kısıtı **getirilmedi**, ADR-090 §4; hekimin radyografı bağlaması testte 200).
- `apps/api/src/reports/definitions.ts` — denetim (`log`, LOG sorgulama; `audit.clinic`: yönetici, destek) raporu aynı süzgeç (taramada bulunan aynı sınıf iz; QA-102'de de bu yüzey birlikte süzülmüştü).

Belge:
- `docs/decisions.md` — **ADR-090** (kural, uygulandığı yüzeyler, maskeleme biçimi, kategori kısıtı getirilmemesinin gerekçesi, bilinen sınır: karantina görevi).
- `docs/permissions.md` — PİA İz notu (ADR-090).
- `docs/verification.md` — bu turun gerçek test sonuçları.

Regresyon testi (yeni): `apps/api/test/qa-108-file-trace.test.ts` — 7 test. Kurulum (sentetik hasta, A kliniği): hekim EPIKRIZ üretir; sekreter `identity` ve `document_scan` (idari, görünür kalmalı); hekim `radiograph`, epikrize bağlı `document_scan` ve sonradan sildiği ikinci `radiograph` (`file.delete` olayı) — hepsi gerçek bayt + tarama işçisiyle `available`, her biri farklı SHA-256. İki onam belgesi: hekim radyografı taranmış nüsha olarak bağlayıp kabul eder (200), sekreter idari taramayı bağlayıp kabul eder (200).
- Geçmiş: sekreter ve yönetici yanıtında `entityType: file` olayları yalnız iki idari dosyaya ait; gizli üç dosyanın kimliği ve SHA-256'sı **yanıt metninin hiçbir yerinde** yok; `patient.create` ve onam belge olayları var. Hekim beş `file.upload` + `file.delete` olayını ve radyograf özetini görür.
- `GET /documents/:id`: sekreter ve yönetici için radyograf bağlı onamda `scan_attached` satırı var, `fileId` `null`, yanıtta gizli kimlik/özet yok; idari taramalı onamda `fileId` = idari dosya. Hekim radyograf kimliğini görür.
- Dışa aktarım (yönetici): yanıt metninde gizli kimlik/özet yok; `access_log` `file` satırı sayısı = görünür dosyaların denetim olayı sayısı (< tüm dosya olayları); `evidence_events` radyograf satırı var, `file_id` anahtarı var ve `null`; idari satırda `file_id` dolu; `counts` = satır sayısı, `checksums` = bağımsız SHA-256. Sağlık yetkili dışa aktaran (test kancası, qa-104-105/qa-106-107 ile aynı; ürün rol matrisi değişmez): tüm dosya olayları ve radyograf `file_id` var; kanca kalkınca yine gizli.
- LOG raporu (yönetici, `entityType=file`): idari dosyaların kimlik öneki var, gizli dosyalarınki yok.

## Ortam (tester ortamına dokunulmadı)
- Worktree: `/home/claude/viadent/.claude/worktrees/agent-ac679f5df0f706480`. `.env` (git dışı) kökteki `.env`'den kopyalandı; `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL`, `BACKUP_DATABASE_URL` veritabanı adı `viadent_fix` → API testleri `viadent_fix_test` (global-setup her koşuda `drop database if exists … with (force)` + migration + sentetik seed). `ADMIN_DATABASE_URL` bakım veritabanı `postgres`'te bırakıldı (fix1–3 ile aynı). `API_PORT=4100`. `VIADENT_DEMO_PASSWORD` satırı kopyaya alınmadı (seed/E2E koşulmadı). Bağlantı dizgeleri yalnız maskeli gösterildi; parola yazdırılmadı. Kabukta önceden tanımlı `DATABASE_URL` yoktu (maskeli kontrol).
- `:3000`/`:4000` süreçleri ve `viadent`/`viadent_test` kullanılmadı; süreç durdurulmadı; küme genelinde bağlantı sonlandırma yok. Sunucu başlatılmadı (testler süreç içi Nest uygulaması).
- `pnpm install --frozen-lockfile --offline` (worktree `node_modules`, git dışı).

## Çalıştırılan komutlar ve gerçek sonuçlar
Kusurun üretilmesi (yeni test, ürün kodu = taban `70897cd`):
1. `cd apps/api && npx vitest run test/qa-108-file-trace.test.ts` → **5 failed | 2 passed (7)**. Gözlenen: sekreter/yönetici geçmişinde gizli dosyalara ait **4** `file` olayı (3 `file.upload` + 1 `file.delete`); sekreter `GET /documents/:id` kanıtında `fileId` = radyograf kimliği; yönetici dışa aktarımı metninde gizli kimlik/özet var (`evidence_events.file_id`); kanca kalktıktan sonraki dışa aktarımda aynı sızıntı; LOG raporunda (`entityType=file`) gizli radyografın kimlik önekiyle 1 satır (döngüdeki ilk gizli dosyada durdu). Geçen 2: hekim testleri (geçmiş tam, kanıtta radyograf kimliği).

Yama sonrası (`2cee06d` ile aynı ürün kodu):
2. `cd apps/api && npx vitest run test/qa-108-file-trace.test.ts` → **7 passed (7)**.
3. `cd apps/api && npx vitest run` (tam API regresyonu, `viadent_fix_test`) → **Test Files 33 passed (33), Tests 347 passed (347)** (162 sn). Commit sonrası ikinci koşu: **33/33, 347/347** (88 sn).
4. `pnpm -r typecheck` → contracts, db, web, worker, api: **Done** (hata yok). `apps/web/tsconfig.tsbuildinfo` typecheck ile değişti, geri alındı (commit'e girmedi).

**Çalıştırılmayanlar:** web birim testleri ve E2E (web kodu değişmedi; web kanıt listesinde `fileId`'yi göstermiyor, yalnız tür/yöntem/tarih/aktör/özet), contracts testleri (değişmedi), worker testleri, `gate.cjs` (tester'ın işi), tarayıcı ile UI denetimi (Geçmiş sekmesi ve belge ayrıntısı aynı API uçlarını okur).

## Taranan yüzeyler (kod okuması; aynı sınıf: gizli dosyanın kimlik/özet/olay izi)
| Yüzey | Sonuç |
|---|---|
| `GET /patients/:id/history` (PİA İz, UI Geçmiş) | **Düzeltildi** (ölçüt 1) |
| `POST /patients/:id/export` `access_log` | **Düzeltildi** (ölçüt 2) |
| `POST /patients/:id/export` `evidence_events.file_id` | **Düzeltildi** (ölçüt 3) |
| `GET /documents/:id` `evidence[].fileId` | **Düzeltildi** (ölçüt 3) |
| `GET /reports/log` (LOG sorgulama / denetim günlüğü; CSV/XLSX aynı koşucu) | **Düzeltildi** — aynı sınıf, aynı süzgeç bileşimi (QA-102'de de geçmişle birlikte süzülmüştü); yönetici ve destek rolü sağlık yetkisiz |
| `GET /patients/:id/files`, `GET /files/:id` (+ `file_access_events`), `GET/PUT /files/:id/content`, `POST /files/:id/delete`, `POST /documents/:id/decision` | Temiz — ADR-089 (QA-107) ile zaten 404/422 |
| `POST /patients/:id/export` `files`, `patient_documents`, `consent_requests` | Temiz — ADR-088/089 |
| `GET /patients/:id/documents`, `GET /reports/onam` | Temiz — dosya kimliği taşımaz; klinik çıktı süzgeci var |
| `GET /tasks` (PİA Akış görev listesi) | **İz var, kapsam dışı** → risk 1 (karantina görevi) |
| `GET /metrics` (işletim metrikleri) | Yalnız kiracı/küme geneli karantina/imha **sayıları**; kimlik/hasta yok → kapsam dışı, risk 3 |
| Hasta arama (`GET /patients`), `GET /patients/:id`, randevu/ajanda, tedavi/odontogram, finans, lab, stok, iletişim/mesaj (bildirimler), takip, hazırlık kuralları, entegrasyon işleri/webhook | Temiz — dosya tablosuna (`file_assets`, `evidence_events.file_id`, `file_access_events`) atıf yok (grep + okuma) |
| Outbox (`file.scan` yükü `fileId`) | API ile okunmuyor (yalnız worker) → temiz |
| `POST /exports/clinic` | Bilinçli tam (ADR-088 §3) → risk 4 |

## Yan etkiler
- Sağlık yetkisi olmayan rol (sekreter, yönetici, finans, destek) Geçmiş'te, KVKK dışa aktarım `access_log`'unda ve LOG raporunda gizli dosyanın `file.upload`/`file.delete` olaylarını artık görmez; LOG raporu toplamları (olay, kullanıcı sayısı) buna göre küçülebilir.
- Onam belgesi ayrıntısında ve dışa aktarımda gizli dosyayı bağlayan `scan_attached` kanıt satırı kalır, `fileId`/`file_id` `null` döner. Web bu alanı göstermediğinden UI görünümü değişmez.
- Hasta dışa aktarımı (sağlık yetkisiz): `notes` bir satır daha taşır (dosya olsa da olmasa da aynı); `omitted` değişmedi. `evidence_events` checksum'ı maskeli içerikten hesaplanır.
- Sağlık yetkili roller (hekim, asistan) ve sağlık yetkili dışa aktarım: değişiklik yok. Onam kararında dosya bağlama kuralı değişmedi.
- Sorgu maliyeti: süzülen her `file` olayı / dolu `file_id` için `file_assets` birincil anahtarına bir `exists` (+ bağlıysa `patient_documents` birincil anahtarı).
- `viadent_fix_test` yeniden kuruldu ve bırakıldı; `viadent_fix` oluşturulmadı/kullanılmadı.

## Bilinen riskler / kapsam dışı (yeni bulgu adayları — yamalanmadı)
1. **Karantina görevi (`GET /tasks`):** worker (`packages/db/src/files.ts scanFile`) zararlı içerik bulunan dosya için `kind = 'file_quarantined'`, `sensitivity = 'general'`, `source_type = 'file'`, `source_id` = dosya kimliği, `patient_id` ile görev açar; görev listesi `general` görevleri `task.read` olan herkese (sekreter dahil) hasta adı ve `sourceId` ile döner. Gizli (klinik) dosya karantinaya düşerse kimliği ve "bu hastaya yüklenen bir dosya karantinada" bilgisi sağlık yetkisize görünür; atanan yönetici (`clinic_admin`) ise dosya uçlarında 404 aldığı için görevi dosya üzerinden çözemez (silme yalnız hekimde mümkün). Seçenekler: görev hassasiyetini dosyanın görünürlüğüne göre `clinical` seçmek ve atanan rolü `dentist` yapmak, ya da sağlık yetkisizde `sourceId`'yi maskelemek (operasyon/güvenlik kararı; kabul ölçütleri dışında).
2. **`scan_attached` kanıt satırının varlığı:** maskeleme sonrası sağlık yetkisiz rol onam belgesinde "taranmış nüsha bağlandı" satırını kimliksiz görür; aynı onamda idari tarama listesinde karşılığı olmaması, bağlanan dosyanın gizli bir dosya olduğunu dolaylı ima eder (kabul ölçütü satırın kalmasını istiyor). Tamamen önlemek için onam taramasına kategori kısıtı gerekir (ADR-090 §4, ürün kararı).
3. **`GET /metrics`:** karantina/imha sayaçları dosya hassasiyetinden bağımsız sayar (kimlik/hasta yok; işletim izni gerektirir) — iz değil, not olarak.
4. **Klinik geneli dışa aktarım** (`export.clinic`) tüm `audit_events`, `evidence_events`, `file_assets` satırlarını vermeye devam eder (ADR-088 §3, bilinçli; ürün sahibi kararı açık).
5. **Varsayılan rollerde sağlık yetkili dışa aktaran yok:** sağlık yetkili dışa aktarım yalnız test kancasıyla sınandı (fix2/fix3 ile aynı).
6. `docs/handoff.md` güncellenmedi (görev kapsamı fix4.md; ADR, permissions.md ve verification.md güncellendi).
