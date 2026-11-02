# Düzeltme 5 — qa-20261102-1209-12fc6fd tur 5 → tester (yeniden sınama)

- **Durum:** QA-109 **FIX_READY**. Kapatma yalnız tester yeniden sınamasıyla.
- **Sınanacak sürüm (ürün kodu):** `3976826bc63cce1276b2752bc244f65f61b22160` (dal `fix/qa-20261102-tur5`, taban `34d4a52` = dal açılırken yerel `main` ucu; `34d4a52` ürün kodu = `fe98345` = fix4 `81584fa`, aradaki commit'ler yalnız `qa-runs/` değiştirir).
  Bu `fix5.md` onun üstünde ayrı bir commit'tir; ürün kodu iki commit'te aynıdır.
- **Taban notu:** worktree `origin/main` (`9ffdb2a`, canlı demo geçmişi; ortak ata yok) üzerinden açılmıştı; çalışma dalı `git checkout -b fix/qa-20261102-tur5 main` ile `34d4a52`'den açıldı. Çalışma sırasında `main` tester commit'i `83a6693` ile ilerledi (yalnız `qa-runs/.scripts/linked-file-probe.mjs` ve `evidence/tur5/linked-file-probe.json`); ürün yaması üstüne çakışmasız taşınabilir (cherry-pick). `main`, `publish`, `origin/*` değiştirilmedi; push yok.
- **Migration:** yeni `packages/db/migrations/0030_quarantine_task_sensitivity.sql` (0001–0029 değişmedi). **Üretime/canlıya gönderim:** yok.
- **Değiştirilmeyenler:** mevcut test beklentileri (hiçbir mevcut test dosyası değişmedi), `plan.json`, `inventory.md`, `bugs.md`, `handoff.md`, `environment.md`, `results*.json`, `evidence/`, `fix1.md`–`fix4.md`, kapı betikleri (`qa/cezeri/`). Web kodu değişmedi.

## Seçilen yol (ADR-091): yönlendirme, maskeleme değil
Gizli dosya (ADR-089: klinik hassasiyetli **veya** klinik çıktı belgesine bağlı) karantinaya düşünce worker görevi `sensitivity = 'clinical'`, `assignee_role = 'dentist'` ile açar. İdari dosyada bugünkü gibi `general` + `clinic_admin`. Başlık, neden, sonraki adım, dedupe anahtarı değişmedi.
- Mevcut görev kapıları hassasiyete baktığı için sağlık yetkisize `GET /tasks` (açık/kapalı/hasta süzgeci) listede yok, `POST /tasks/:id/status` var olmayan görevle aynı 404 (`NOT_FOUND "Görev bulunamadı."`) ve görev satırı değişmez. Ayrı görev ayrıntısı ucu yok.
- İşlem yolu: hekim görevi `mine: true` ile görür, `GET /files/:id` 200 açar (içerik karantinada 409 — değişmedi), dosyayı gerekçeyle siler → `via_akis.refresh` görevi "Dosya gerekçeyle silindi" ile kapatır; ya da görevi doğrudan kapatır. Asistan (sağlık yetkili, `file.delete` yok) görür ve kapatabilir.
- Neden maskeleme değil: `sourceId` maskelense de "bu hastada karantinada dosya var" bilgisi kalır ve yönetici dosyayı yine açamaz (işlem yolu kopuk).

## Değişen dosyalar (`git diff --stat 34d4a52 3976826`: 10 dosya, +269/−12)
Ürün:
- `packages/db/src/files.ts` (+17/−3) — `hiddenFileSql(alias)` (ADR-089 `nonClinicalFileSql`'in tersi, aynı SQL; worker apps/api'yi içe aktaramadığı için packages/db'de); `scanFile` karantina görevini `insert … select` ile dosya satırından hassasiyet/atananla açar.
- `packages/db/migrations/0030_quarantine_task_sensitivity.sql` (yeni, 15 satır) — `app.for_each_tenant` (ADR-077) ile gizli dosyaya ait `file_quarantined` görevleri `clinical`; açık olanların atananı `dentist`; kapanmışta atanan geçmiş olarak kalır; idari görevler değişmez; yalnız `sensitivity <> 'clinical'` satırlara dokunur (tekrar güvenli).
- `apps/api/src/patients/patients.service.ts` — `GET /patients/:id` `openTaskCount` görev listesiyle aynı hassasiyet süzgeci (önceden tüm açık görevleri sayıyordu); `history()` süzgecine `notHiddenTaskEventSql`.
- `apps/api/src/audit/audit.ts` (+9) — `notHiddenTaskEventSql(alias)`: sağlık yetkisizde `clinical` görevin `task.status` denetim olayı listelenmez (ADR-090 deseni).
- `apps/api/src/pilot/export.controller.ts` — hasta dışa aktarımı `access_log` aynı süzgeç.
- `apps/api/src/reports/definitions.ts` — denetim (`log`) raporu aynı süzgeç.

Belge: `docs/decisions.md` (**ADR-091**; ADR-090 bilinen sınır satırına "→ ADR-091"), `docs/permissions.md` (PİA Akış satırı), `docs/verification.md` (bu turun sonuçları).

Regresyon testi (yeni): `apps/api/test/qa-109-quarantine-task.test.ts` — 9 test. Kurulum (sentetik hasta, A kliniği; zararsız sentetik PDF, yalnız `/JavaScript` anahtar sözcüğü temel tarayıcıyı tetikler): hekim `clinical_document` ×2 ve EPIKRIZ'e bağlı `document_scan`; sekreter idari `document_scan`. Hepsi worker ile `quarantined`.
1. Sekreter + yönetici: `GET /tasks`, `?status=closed`, `?patientId=`, ikisi birlikte — yanıt metninde gizli dosya kimliği ve gizli görev kimliği yok; hastanın karantina görevleri = yalnız idari dosya.
2. Sekreter + yönetici: `POST /tasks/:id/status` (`done`, `in_progress`, `cancelled`+gerekçe) her gizli görevde = rastgele var olmayan kimlik yanıtı (404; `status, code, message, field_errors, details`); görev satırı (durum, hassasiyet, atanan, yükseltme, `updated_at`) önce/sonra aynı.
3. `openTaskCount` = rolün `GET /tasks?patientId` satır sayısı (sekreter, yönetici, hekim); hekim = sekreter + 3.
4. Hekim: üç gizli görev `sensitivity: clinical`, `assigneeRole: dentist`, `mine: true`; `GET /files/:id` 200; sekreter/yönetici aynı dosyada = var olmayan dosya yanıtı.
5. SLA yükseltmesi (`due_at` 72 sa geriye, `POST /via-akis/refresh`): aynı satır `escalated_to_role = clinic_admin`, hassasiyet `clinical`, atanan `dentist`; dosya için tek görev (kopya yok); sekreter/yönetici yanıtlarında iz yok.
6. Hekim dosyayı gerekçeyle siler → refresh sonrası görev `done` / "Dosya gerekçeyle silindi"; diğer gizli görevi `POST /tasks/:id/status done` → 200; kapalı listede hekim ikisini görür, sekreter/yönetici görmez.
7. `task.status` izi: yönetici idari görevi `in_progress` yapar; hekim geçmişinde iki görev olayı; sekreter/yönetici geçmişinde yalnız idari görevinki ve yanıtta gizli kimlik yok; yönetici dışa aktarımında `access_log` `task` satırı 1, gizli kimlik yok; LOG raporu (`entityType=task`) idari görev öneki var, gizlilerinki yok.
8. İdari dosya görevi: `general`, `clinic_admin`; yönetici `mine: true`, sekreter görür; yönetici `GET /files/:id` 200.
9. Migration 0030: bir açık ve bir kapalı gizli görev eski biçime (`general`/`clinic_admin`) çekilir (sekreter görür — eski sızıntı), migration SQL'i çalıştırılır → açık `clinical`/`dentist`, kapalı `clinical`/`clinic_admin`; idari görev satırı (durum, hassasiyet, atanan, yükseltme, kapanış nedeni, `updated_at`) aynı; ikinci çalıştırma hiçbir satırı değiştirmez; sekreter/yönetici yanıtında iz yok.

## Ortam (tester ortamına dokunulmadı)
- Worktree: `/home/claude/viadent/.claude/worktrees/agent-a1eb13333af323b3d`. `.env` (git dışı) kökteki `.env`'den kopyalandı; `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL`, `BACKUP_DATABASE_URL` veritabanı adı `viadent_fix` → API testleri `viadent_fix_test` (global-setup her koşuda `drop database if exists … with (force)` + migration + sentetik seed). `ADMIN_DATABASE_URL` bakım veritabanı `postgres`'te bırakıldı (fix1–4 ile aynı). `API_PORT=4100`. `VIADENT_DEMO_PASSWORD` satırı kopyaya alınmadı (seed/E2E koşulmadı). Kabukta önceden tanımlı `DATABASE_URL` yoktu.
- Not: kök `.env` maskeli incelenirken maskeleme ifadesi bazı yerel geliştirme değerlerini (gizli anahtar öneki, yedek rolü parolası/şifreleme parolası) yalnız düzelticinin araç çıktısında kısmen gösterdi; hiçbir dosyaya, commit'e veya kanıta yazılmadı. Demo parolası gösterilmedi.
- `:3000`/`:4000` süreçleri ve `viadent`/`viadent_test` kullanılmadı; süreç durdurulmadı; küme genelinde bağlantı sonlandırma yok. Sunucu başlatılmadı (testler süreç içi Nest uygulaması).
- `pnpm install --frozen-lockfile --offline` (worktree `node_modules`, git dışı).

## Çalıştırılan komutlar ve gerçek sonuçlar
Kusurun üretilmesi (yeni test, ürün kodu = taban `34d4a52`):
1. İlk taslak (8 test, `task.status` iz testi henüz yok): `cd apps/api && npx vitest run test/qa-109-quarantine-task.test.ts` → **7 failed | 1 passed (8)**. Gözlenen: sekreter/yönetici görev yanıtlarında 6 gizli kimlik (3 dosya + 3 görev); sekreter gizli görevde `POST /tasks/:id/status` → **200** (var olmayan 404; görev kapandı); `openTaskCount` hekimle aynı; hekimde `clinical`/`dentist` görev yok (görev `general`/`clinic_admin`); `0030_*.sql` yok. Geçen 1: idari görev testi.
2. Son dosya (9 test), ürün dosyaları geçici olarak taban sürümüne döndürülüp (`git checkout -- <5 ürün dosyası>`, 0030 kaldırıldı; sonra yedekten geri yüklendi): → **8 failed | 1 passed (9)** (geçen: idari görev testi).
3. `task.status` iz testi ayrıca sınandı: yama uygulanmış, yalnız `notHiddenTaskEventSql` geçici olarak etkisiz (`(true or …)`) → **1 failed | 8 passed (9)**; sekreter geçmişinde gizli görev kimliği. Yardımcı geri alındı (commit'teki hâli `git diff` ile doğrulandı).

Yama sonrası (`3976826` ile aynı ürün kodu):
4. `cd apps/api && npx vitest run test/qa-109-quarantine-task.test.ts` → **9 passed (9)**.
5. `cd apps/api && npx vitest run` (tam API regresyonu, `viadent_fix_test`) → **Test Files 34 passed (34), Tests 356 passed (356)** (106,7 sn). Commit sonrası ikinci koşu: **34/34, 356/356** (100,8 sn). (Yama tamamlanmadan başlamış bir ara koşu da 34/355 geçti; kesin sayılmadı.)
6. `pnpm -r typecheck` → contracts, db, web, worker, api: **Done** (hata yok). `apps/web/tsconfig.tsbuildinfo` typecheck ile değişti, geri alındı (commit'e girmedi).

**Çalıştırılmayanlar:** worker testleri — `apps/worker`'da test betiği/dosyası yok (`scanFile` API paketinde `processOutbox` ile koşulur: gorev4, qa-106-107, qa-108, qa-109); web birim testleri ve E2E (web kodu değişmedi; Bugün ekranı `GET /tasks` okur, "Dosyalara git" bağlantısı hekimde Belgeler sekmesine gider); contracts testleri (değişmedi); `gate.cjs` (tester'ın işi); tarayıcı ile UI denetimi; `pnpm db:migrate` ile `viadent_fix` (test global-setup 0030'u temiz DB'ye uyguladı; migration SQL'i ayrıca test 9'da dolu tabloya iki kez uygulandı).

## Taranan yüzeyler (kod okuması; aynı sınıf: gizli dosyanın/görevin sağlık yetkisize izi)
| Yüzey | Sonuç |
|---|---|
| `GET /tasks` (açık/kapalı/hasta süzgeci) | **Düzeltildi** (görev `clinical`; mevcut kayıtlar 0030) |
| `POST /tasks/:id/status` | **Düzeltildi** — `clinical` görev var olmayanla aynı 404, yan etkisiz. Görev ayrıntısı ucu yok |
| Hasta kartı `openTaskCount` (`GET /patients/:id`, web "Açık takip") | **Düzeltildi** — liste ile aynı süzgeç |
| `task.status` olayı: Geçmiş, KVKK `access_log`, LOG raporu | **Düzeltildi** (`notHiddenTaskEventSql`) |
| `refreshViaAkis` adım 9 SLA yükseltmesi | Kopya yok; aynı satır, hassasiyet korunur (testli). Sınır → risk 1 |
| Bugün ekranı | Ayrı görev sayacı yok; kartlar randevulardan, liste `GET /tasks` → kapsandı |
| Bildirimler | Görev/dosya bildirimi üreten modül yok (grep: yalnız sağlayıcı webhook "bildirim" metinleri) → temiz |
| Dosya karantina otomatik kapanışı (`readiness.ts` `file_quarantined` → `deleted`) | Hassasiyetten bağımsız; hekim silince kapanır (testli) |
| `GET /metrics` | Karantina/reddedilmiş dosya **sayısı** (kiracı/küme; kimlik/hasta yok; işletim izni) → risk 3 |
| Yedek (`backup.ts` nesne listesi) | Yalnız yedek rolü/CLI; klinik rollerine açık yüz yok → temiz |
| Hazırlık (`readiness_missing` görevi, `GET /appointments/:id/readiness`) | Dosya kimliği taşımaz; ayrı sınıf iz → risk 2 |
| `POST /exports/clinic` | `tasks` dahil tam (ADR-088 §3, bilinçli) → risk 4 |

## Yan etkiler
- Gizli dosyanın karantina görevi artık yönetici ve sekreter kuyruğunda yok; hekim (ve asistan) kuyruğunda `clinical` olarak görünür ve hekime atanır. İdari dosya görevi değişmedi.
- Sağlık yetkisizde hasta kartı "Açık takip" sayısı küçülebilir: `clinical` (karantina + **anamnez onayı**) görevler artık sayılmaz; `finance` görevler `finance.read` yoksa sayılmaz (bugün `finance` hassasiyetli görev üreten yer yok). Hekimde `finance` görev sayılmaz (aynı nedenle etkisiz).
- Sağlık yetkisizde Geçmiş, KVKK `access_log` ve LOG raporundan `clinical` görevlerin `task.status` olayları çıkar (anamnez onayı görevleri dahil); LOG toplamları buna göre küçülebilir.
- 0030: mevcut gizli dosya karantina görevlerinin hassasiyeti/atananı değişir, `updated_at` yenilenir. Sorgu maliyeti: görev olayı başına `tasks` birincil anahtarına bir `exists`; karantina görevi açarken dosya satırı + `patient_documents` birincil anahtarı.
- `viadent_fix_test` yeniden kuruldu ve bırakıldı; `viadent_fix` oluşturulmadı/kullanılmadı.

## Bilinen riskler / kapsam dışı (yeni bulgu adayları — yamalanmadı)
1. **`clinical` görevin SLA yükseltmesi yöneticiye görünmez:** adım 9 tüm vadesi geçmiş görevleri `escalated_to_role = 'clinic_admin'` yapar; sağlık yetkisiz yönetici `clinical` görevi listede görmediği için yükseltme etkisizdir (ADR-087'den beri anamnez onayı için de aynı). Sızıntı yok; işlevsel boşluk. Seçenek: `clinical` görevi sağlık yetkili role (ör. hekim) yükseltmek — ürün kararı.
2. **Hazırlık kuralı klinik çıktı belge türüne bağlanırsa:** `readiness_rules.document_type_id` herhangi bir tür olabilir; kural klinik çıktı türü (EPIKRIZ vb.) için tanımlanırsa sekretere `general` `readiness_missing` görevinde ve `GET /appointments/:id/readiness`'te "Epikriz … eksik/Hazır" görünür (belgenin varlık ipucu). Dosya kimliği yok; ayrı sınıf. Seçenek: kural tanımında klinik çıktı türlerini dışlamak ya da görevi `clinical` açmak.
3. **`GET /metrics`:** karantina/reddedilmiş dosya sayaçları hassasiyetten bağımsız (kimlik/hasta yok; işletim izni) — fix4 risk 3 ile aynı, not olarak.
4. **Klinik geneli dışa aktarım** (`export.clinic`) `tasks`, `audit_events`, `file_assets` satırlarını tam verir (ADR-088 §3, bilinçli; ürün sahibi kararı açık).
5. **Atama rol bazlı:** görev `dentist` rolüne düşer (kişiye değil); çok hekimli klinikte tüm hekimler `mine` görür. Yükleyen hekime kişisel atama (`assignee_membership_id`) istenirse ayrı karar.
6. `docs/handoff.md` güncellenmedi (görev kapsamı fix5.md; ADR, permissions.md ve verification.md güncellendi).
