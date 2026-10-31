# fix5 — QA-006 (S1, ürün) + QA-007 (S3, test kodu) → FIX_READY

**Bulgular:** QA-006 — eşzamanlı trafik altında PostgreSQL `viadent-api` bağlantıları kesilince (`pg_terminate_backend`; yeniden başlatma/failover/pooler eşdeğeri) derlenmiş API süreci `Unhandled 'error' event … terminating connection due to administrator command` ile çöküyor. QA-007 — `gorev4` dayanıklılık testi `pg_terminate_backend` sorgusunda `datname` süzgeci olmadan kümedeki tüm `viadent-api` bağlantılarını kesiyor.
**Sınanan sürüm:** 6079d5816defa6e1b702734703cad6b192dfe811
**Yeni sürüm:** `01b4c00f9bcfc45a1f5b11864c472872d412cc5a`
**Worktree / branch:** `/home/claude/viadent/.claude/worktrees/agent-ae0bf2f17b98b7f87`, branch `worktree-agent-ae0bf2f17b98b7f87` (6079d58 üzerine 1 commit). Ana depoya merge edilmedi; üretime dağıtım yok. Test beklentisi, gate, envanter, geçmiş kanıt değişmedi; Playwright koşulmadı.

## 1. Tanı (kök neden) — kanıtlı

- `pg-pool@3.14.0` `_acquireClient` (`index.js:344`): istemci havuzdan alınırken (`pool.connect()`) havuzun `idleListener`'ı istemciden **kaldırılır**; yalnız `release()` sırasında (`_release`, `:385`) geri eklenir. Yani checked-out istemcide 'error' dinleyicisi yok.
- `pg@8.23.1` `client.js:_handleErrorMessage` (`:433`): sunucudan 57P01 (FATAL, `pg_terminate_backend`) gelince **aktif sorgu yoksa** `_handleErrorEvent` → `this.emit('error', msg)` (`:422`). `withContext` (`packages/db/src/context.ts`) BEGIN → set_config → iş → COMMIT adımları arasında istemci alınmış ama sorgusuz; yük altında bu pencere sık yakalanır. pg_stat'ta bu bağlantılar "idle" göründüğü için tester'ın `state='idle'` süzgeçli senaryosu da tam bu pencereyi vuruyor. Ayrıca soket kapanışında `Connection terminated unexpectedly` da aynı yoldan yayılıyor.
- Dinleyicisiz 'error' → `uncaughtException` → Node süreci çöker. Mevcut tek koruma `pool.on("error")` yalnız havuzda **bekleyen** istemcileri kapsıyor (`db.service.ts:18`).

**Yeniden üretim (yama ÖNCESİ, bu worktree'de, yeni regresyon testi):**
```
cd apps/api && npx vitest run test/gorev4.test.ts -t "dayanıklılık"
→ × QA-006: eşzamanlı trafik sürerken idle ve aktif bağlantılar kesilince …  (1 failed)
  AssertionError: expected [ …(9) ] to deeply equal []     ← uncaughtException sayacı
  + "terminating connection due to administrator command" ×4
  + "Connection terminated unexpectedly" ×5
```
(Test süreci içinde `process.on("uncaughtException")` ile yakalanıp sayıldığı için vitest koşucusu düşmedi; derlenmiş API'de aynı olay süreci öldürüyor — tester kanıtı `evidence/tur4/QA-006-api-crash.log`.)

## 2. Yama (en küçük ürün değişikliği)

| Dosya | Değişiklik |
|---|---|
| `packages/db/src/pool-guard.ts` (yeni) | `guardPool(pool, label)`: `pool.on("error")` (boşta) + `pool.on("acquire")` ile havuzdan alınan **her istemciye tek seferlik** `client.on("error")` (Symbol işaretli; çift dinleyici eklenmez). Sayaçlar (`clientErrors`, `idleErrors`, `lastErrorAt`) döner. `isConnectionError(e)` yardımcısı (57P01/57P0x, 08xxx, ECONNRESET/EPIPE/ECONNREFUSED, "Connection terminated", "not queryable"). Mesajlar 120 karaktere kırpılır; parametre/kişisel veri loglanmaz. |
| `packages/db/src/index.ts` | `pool-guard` dışa aktarımı. |
| `apps/api/src/infra/db.service.ts` | `pool.on("error")` yerine `guardPool(pool, "api")`; `guard` sayaçları alanı; `application_name` → `config.dbApplicationName`. |
| `apps/api/src/config.ts` | `dbApplicationName` (`DB_APPLICATION_NAME`, varsayılan **`viadent-api`** — davranış değişmez). Aynı kümede ikinci API örneğini pg_stat'ta ayırt etmek için (bu doğrulamada :4000'i etkilememek amacıyla kullanıldı). |
| `apps/api/src/infra/errors.ts` | `isConnectionError` → **503 `SERVICE_UNAVAILABLE`** ("Veritabanı bağlantısı geçici olarak kesildi…"); önceden 500 INTERNAL. Sahte başarı yok. |
| `apps/api/src/auth/auth.controller.ts` | `/health/ready` gövdesine `pool: { total, idle, waiting, clientErrors, idleErrors, lastErrorAt }` eklendi (200/503 kararı aynı: `select 1` + 2 sn). |
| `apps/api/src/main.ts` | `process.on("unhandledRejection")` → kırpılmış log; `process.on("uncaughtException")` → kırpılmış log + kontrollü kapanış (`app.close()`; 10 sn üst sınır; exit 1 → süreç yöneticisi yeniden başlatır). Bağlantı hataları artık havuzda yakalandığı için buraya düşmez. |
| `apps/api/src/serverless.ts` | Satır içi worker havuzuna `guardPool`. |
| `apps/worker/src/main.ts` | `pool.on("error")` yerine `guardPool(pool, "worker")`; `unhandledRejection`/`uncaughtException` → log (döngü sürer). |
| `.env.example` | `DB_APPLICATION_NAME` yorum satırı. |
| `apps/api/test/gorev4.test.ts` | QA-007: mevcut testin `pg_terminate_backend` sorgusuna `and datname = current_database()` (beklenti aynı). QA-006: yeni test (aşağıda). |

Neden `release(err)` dinleyici içinde çağrılmadı: pg, 'error' sonrası `_queryable=false` yapıp bekleyen sorguları reddeder; `withContext`'in `finally { client.release() }` dalı çalışır ve pg-pool `_release` sorgulanamaz istemciyi havuzdan **zaten düşürür** (`index.js:392`). Dinleyiciden ikinci bir `release(err)` çağrısı `throwOnDoubleRelease` ile yeni bir istisna üretirdi.

Gözden geçirilen `pool.connect()` yolları: `packages/db/src/context.ts` (withContext — API `Db.tx/userTx`, worker), `apps/worker/src/jobs.ts:12` (processOutbox), `packages/db/src/seed.ts:33` (CLI, tek seferlik; süreç korumasına gerek yok), `apps/api/src/serverless.ts` inline worker. Hepsi `guardPool` uygulanan bir havuzdan geçer; `pool.query()` yolları da (`acquire` olayı) kapsanır.

## 3. Yeni regresyon testi

`apps/api/test/gorev4.test.ts` › `dayanıklılık` › **"QA-006: eşzamanlı trafik sürerken idle ve aktif bağlantılar kesilince süreç yaşar, istekler 200/5xx döner, sonrası 200"** (60 sn zaman aşımı):
- 24 eşzamanlı `GET /patients?q=a` (Promise.all ile başlatılıp bitmeden), 3 dalga `pg_terminate_backend` — `application_name='viadent-api' and datname = current_database()`, **idle + aktif** (state süzgeci yok); `killed > 0` doğrulanır.
- `process.on("uncaughtException")` geçici dinleyici ile sayım → `[]` beklenir.
- Her yanıt 200 ya da 5xx (yanıtsız/-1 yok); ardından yeni istek 200 ve `/health/ready` 200.
- Yama sonrası ölçüm (debug çıktısı, commit'te yok): `killed=19`, durumlar 17×200 + 7×503, `guard.clientErrors=18`, `idleErrors=11`, uncaught 0.

## 4. Komutlar ve gerçek sonuçlar (worktree)

```
pnpm install --offline --frozen-lockfile                      → Done
pnpm typecheck                                                → 5/5 paket Done (contracts, db, web, api, worker)
cd apps/api && npx vitest run test/gorev4.test.ts -t "dayanıklılık"   (yama öncesi) → 1 failed (9 uncaughtException)
cd apps/api && npx vitest run test/gorev4.test.ts -t "dayanıklılık"   (yama sonrası) → 2 passed
cd apps/api && npx vitest run test/gorev4.test.ts             → Test Files 1 passed, Tests 20 passed (20)
pnpm build:server                                             → apps/api/dist, apps/worker/dist, packages/db/dist derlendi
API_PORT=4300 NODE_ENV=production DB_APPLICATION_NAME=viadent-api-qa6 node apps/api/dist/main.js   (pid 17879; .env ana depodan kopya, commit dışı)
node .qa6/run.mjs  (KILL_STATE=idle)  — sekreter oturumu, 400 eşzamanlı GET /api/v1/patients?q=a&limit=20 (8'erli dalgalar) + 12× pg_terminate_backend(application_name='viadent-api-qa6' and datname='viadent' and state='idle')
  → {"requests":400,"codes":{"200":377,"503":23},"killed":34,"afterCodes":[200,200,200],"ready":200,
     "pool":{"total":10,"idle":10,"waiting":0,"clientErrors":24,"idleErrors":0}}  süreç ayakta; log: 24× "kullanımdaki bağlantı kesildi", 0× "yakalanmamış istisna"
node .qa6/run.mjs  (KILL_STATE=all)   — aynı, state süzgeci yok (idle + aktif)
  → {"requests":400,"codes":{"200":338,"503":62},"killed":71,"afterCodes":[200,200,200],"ready":200,
     "pool":{"total":10,"idle":10,"waiting":0,"clientErrors":83,"idleErrors":0}}  süreç ayakta; toplam 83× kesildi, 0× yakalanmamış
curl :4000/api/v1/health/ready → 200 (ana depodaki API etkilenmedi: terminate yalnız viadent-api-qa6)
kill 17879 → :4300 kapalı (curl 000)
```
Kıyas: tester kanıtı (`QA-006-http-codes.txt`) 5×200 + 395×000 ve çöküş; şimdi 400/400 yanıt (200 ya da 503), çöküş yok.

## 5. Yan etkiler / notlar

- `ApiExceptionFilter`: bağlantı kesilme hataları 500 → **503** `SERVICE_UNAVAILABLE`. Sözleşme (`ApiError`) değişmedi; yalnız yeni `code` değeri. Web'de 5xx genel işleme devam eder.
- `/health/ready` gövdesine `pool` nesnesi eklendi (ek alan; mevcut `status/db/version` aynı). `gorev8` health testleri yalnız durum kodu/alan varlığına bakıyor — koşmadım (paylaşılan DB kuralı), tester koşacak.
- `DB_APPLICATION_NAME` varsayılanı `viadent-api`; metrik/test literal'leri etkilenmez.
- Yeni test 24 eşzamanlı supertest isteği nedeniyle `MaxListenersExceededWarning` (Server, 11 listener) uyarısı basar; zararsız, testi etkilemez.
- Yeni test aynı `viadent_test` DB'sindeki **aktif** `viadent-api` bağlantılarını da keser; `fileParallelism: false` olduğu için başka test dosyasını etkilemez. Küme genelindeki başka DB'ler (canlı demo) etkilenmez (QA-007 süzgeci).
- `uncaughtException` yolunda kontrollü kapanış (exit 1) seçildi: bağlantı hataları artık oraya düşmez; başka beklenmedik istisnada süreç durumu tanımsız olduğu için yeniden başlatma güvenli davranıştır. Worker'da yalnız log (döngü zaten try/catch'li).
- Commit dışı: `.env` (kopya), `.qa6/` (run.mjs betiği, api-4300.log, commit-msg.txt, bu belge).

## 6. Tester için koşulacak komutlar (ana depoda, sürüm 01b4c00 alındıktan sonra)

```
pnpm install --frozen-lockfile && pnpm typecheck
cd apps/api && npx vitest run                     # tam API paketi (gorev4 dayanıklılık ×2, gorev8 health dahil)
pnpm build:server && API_PORT=4000 NODE_ENV=production node apps/api/dist/main.js
# handoff senaryosu: 400 eşzamanlı GET /api/v1/patients?q=a&limit=20 (sekreter) + 12× pg_terminate_backend(... application_name='viadent-api' and datname='viadent' and state='idle')
#   beklenen: süreç ayakta, kodlar yalnız 200/503, ardından 200, /health/ready 200 (pool.clientErrors > 0, lastErrorAt dolu)
# ek: aynı senaryo state süzgeci olmadan (idle+aktif) → aynı beklenti
# isteğe bağlı: worktree'deki .qa6/run.mjs (BASE=http://127.0.0.1:4000/api/v1 APPNAME=viadent-api KILL_STATE=idle|all) ile aynı ölçüm
```

**Durum: FIX_READY** (QA-006, QA-007). Kapanış yalnız bağımsız tester'ın yeniden sınamasıyla.
