# Dağıtım paketi (Görev 8)

Pilot için teknik dağıtım parçaları. **Hiçbiri gerçek sunucuda çalıştırılmadı**; doğrulama durumu her başlıkta yazılı. Uygulama sırası ve onay noktaları: `runbook-deploy-rollback.md`.

## 1. Derleme
```
pnpm build:server
NEXT_OUTPUT=standalone pnpm --filter @viadent/web exec next build
```
| Çıktı | Çalıştırma |
|---|---|
| `apps/api/dist/main.js` | `NODE_ENV=production node --enable-source-maps dist/main.js` |
| `apps/worker/dist/main.js` | `node dist/main.js` |
| `packages/db/dist/{migrate,roles,backup-cli,rotate-keys}.js` | `node dist/migrate.js` · `node dist/roles.js` · `node dist/backup-cli.js backup` / `restore-verify [--keep --target ad]` · `node dist/rotate-keys.js [--apply]` |
| `apps/web/.next/standalone` + `.next/static` | `node apps/web/server.js` (PORT, HOSTNAME) |

**Doğrulandı (23.10.2026):** `pnpm deploy --legacy --prod` ile yalnız üretim bağımlılıkları ayrı dizinlere kuruldu, `.env` dosyası olmadan yalnız ortam değişkenleriyle: boş veritabanına migration + roller, API (giriş, arama, rapor, finans, sağlık, metrik), worker, yedek → izole geri yükleme (0 fark), anahtar döndürme önizlemesi, bağımsız web (sayfa, nonce'lu CSP, statik dosyalar, API vekili). Tam E2E paketi derlenmiş API + worker'a karşı (üretim kipi): 49/49.

## 2. Konteyner imajları — `infra/docker/Dockerfile`
Hedefler: `api`, `worker`, `web` (`--build-arg API_INTERNAL_URL=http://api:4000` — Next yönlendirmesi derleme anında sabitlenir), `ops` (PostgreSQL 16 istemcisi; varsayılan komut migration). Root olmayan kullanıcı (`node`), `tini`, sağlık kontrolü, `.dockerignore` ile `.env`/`.demo-credentials`/yedek/depo dışarıda.
**Doğrulanmadı:** bu çalışma ortamından imaj depolarına (Docker Hub, ECR, GCR aynası) erişim yok → imaj derlenemedi. Dockerfile'daki her komut yukarıdaki yerel adımların birebir karşılığıdır; ilk derleme CI'da (`image` işi) veya geliştirici makinesinde yapılmalı ve imaj içinde duman testi koşulmalı.

## 3. Tek sunuculu pilot — `infra/compose.prod.yml` + `infra/Caddyfile`
Servisler: `db` (yalnız iç ağ), `migrate` (tek seferlik roller + migration), `api` ×2, `worker`, `web`, `clamav`, `proxy` (Caddy, otomatik TLS, sorgu dizesi/çerez/Authorization günlükten ayıklanır), `backup` (saatlik yedek + günlük 00 UTC izole doğrulama; `YEDEK-OK` / `YEDEK-HATA` satırları alarm içindir). Sırlar `./secrets/postgres.env` ve `./secrets/viadent.env` (git dışı, 0600). Zorunlu: `VIADENT_VERSION`, `VIADENT_DOMAIN`.
**Doğrulandı:** `docker compose config` sözdizimi; yedek döngüsü bir tur gerçekten çalıştırıldı (başarı ve kısa parola hatası). **Doğrulanmadı:** imajlarla ayağa kaldırma (imaj yok), Caddy yapılandırması (`caddy validate` için imaj yok), ClamAV.
**Bilinen sınır:** `backup` servisinin geri yükleme doğrulaması aynı veritabanı kümesinde yeni bir veritabanına yapılır; gerçek izolasyon için doğrulamayı ayrı bir sunucuda (systemd birimleri) çalıştırın. Yedek birimi sunucu dışına kopyalanmalı (3-2-1) — kopyalama hedefi barındırma kararı.

## 4. Docker'sız kurulum — `infra/systemd/`
`viadent-backup.{service,timer}` (saatlik), `viadent-restore-verify.{service,timer}` (her gün 03:30 TSİ, mümkünse ayrı DB sunucusunda), `viadent-alert@.service` (başarısız birim → izleme webhook'u). `systemd-analyze verify` ile denetlendi (yalnız bu ortamda `/usr/bin/node` yok uyarısı).

## 5. CI — `.github/workflows/ci.yml`
`test` işi: PostgreSQL 16 servisi, `pnpm audit` (açık varsa başarısız), koşu başına rastgele sırlar (`scripts/ci-env.sh`), roller/migration/seed, typecheck, tüm testler, üretim derlemesi, **derlenmiş** API/worker + web ile Playwright, yedek → izole geri yükleme; hata durumunda günlükler ve izler. `image` işi: dört imaj + imajda sır olmadığı kontrolü.
**Doğrulanmadı:** depo GitHub'a bağlı değil, iş akışı hiç koşmadı. YAML sözdizimi ve `ci-env.sh` çıktısı (CHANGE_ME kalmıyor) yerelde denetlendi; adımlar bu oturumda elle koşulan komutların aynısıdır.

## 6. Üretim ortam değişkenleri
| Değişken | Not |
|---|---|
| `DATABASE_URL`, `WORKER_DATABASE_URL`, `MIGRATION_DATABASE_URL`, `ADMIN_DATABASE_URL`, `BACKUP_DATABASE_URL` | Ayrı roller (ADR-003, 048); yönetici yalnız `roles` adımında, sonra parolası döndürülür |
| `VIADENT_SECRET_KEY`, `VIADENT_SECRET_KEYS_OLD` | ADR-052; secret manager |
| `BACKUP_ENCRYPTION_PASSPHRASE` | ≥16 karakter; yedekle aynı yerde değil |
| `NODE_ENV=production` | Secure çerez, HSTS, `roles` test veritabanı açmaz |
| `TRUST_PROXY` | Tek ters vekil: `1` |
| `VIADENT_REQUIRE_MFA_ROLES=clinic_admin,finance` | Yayın kapısı |
| `VIADENT_EXTERNAL_SEND_ENABLED=false` | Sözleşme + test kanıtı olmadan açılmaz |
| `METRICS_TOKEN` | Boşsa `/metrics` kapalı |
| `IMPORT_ROW_RETENTION_DAYS` | Varsayılan 30; danışmanla kesinleştirilecek |
| `STORAGE_DIR`, `CLAMD_HOST` | Şifreli disk; ClamAV zorunlu |
| `VIADENT_VERSION` | İmaj etiketi; `/health` yanıtında |

## 7. Sağlık ve izleme
`GET /api/v1/health` → `{status:"ok",version}` (canlılık) · `GET /api/v1/health/ready` → DB'ye 2 sn içinde ulaşılamazsa 503 · `GET /api/v1/metrics` (Bearer `METRICS_TOKEN`): `viadent_http_requests_total{method,status}`, `viadent_http_request_duration_seconds` (histogram), `viadent_db_pool_connections{state}`, `viadent_uptime_seconds`, `viadent_build_info`. Önerilen alarmlar: 5xx oranı > %1 (5 dk), p95 > 1 sn, havuzda bekleyen > 0 (5 dk), `YEDEK-HATA`, yedek yaşı > 2 sa, ready 503.

**İşletim uyarı metrikleri (Görev 12, ADR-068)** — aynı uçta, `app.ops_metrics()` ile (kiracı/kimlik içermez):
| Metrik | Anlam | Önerilen eşik / alarm |
|---|---|---|
| `viadent_outbox_oldest_pending_seconds` | en eski bekleyen iç işin yaşı | > 300 sn (5 dk) → worker durmuş olabilir (kritik) |
| `viadent_outbox_events{state="dead"}` | dead-letter iç iş | artış → inceleme (yüksek) |
| `viadent_integration_jobs{state="dead"\|"unknown"}` | sağlayıcıya gidemeyen / sonucu belirsiz dış iş | > 0 ve 15 dk sürüyor → sağlayıcı/ağ (yüksek) |
| `viadent_integration_jobs_pending_approval` | dört göz onayı bekleyen dış iş | > 0 ve 24 sa → yöneticiye hatırlatma (bilgi) |
| `viadent_webhook_rejections_1h{state=…}` | son 1 saatte reddedilen webhook (imza/zaman/bozuk) | ≥ 20 → yanlış sır ya da saldırı denemesi (yüksek) |
| `viadent_auth_locked_keys` | etkin giriş kilidi sayısı | ≥ 10 → parola deneme dalgası (yüksek); tek hesap sürekli kilitte → kullanıcıyla iletişim |
| `viadent_file_assets{state="quarantined"}` | karantinada, imha edilmemiş dosya | artış → kaynak kullanıcı/klinik incelemesi (orta) |
| `viadent_file_assets_purge_due` | imha süresi 15 günden fazla geçmiş silinmiş dosya | > 0 → imha işi çalışmıyor (orta) |
| `viadent_import_batches_pending` | 7 günden eski onaylanmamış ön kontrol | > 0 → yöneticiye hatırlatma (bilgi) |
| `viadent_memberships_support_active` | etkin destek erişimi | > 0 iken bilgi; beklenmeyen artış → güvenlik incelemesi |
Prometheus kural örneği: `viadent_outbox_oldest_pending_seconds > 300` for 5m → `severity=critical`.

## 8. Dışa açık demo ortamı — Vercel + yönetilen PostgreSQL (Görev 15, ADR-078)
Tek Vercel projesinde web + API: `/api/v1/*` istekleri `apps/web/pages/api/v1/[[...path]].ts` köprüsüyle aynı fonksiyon içindeki gömülü Nest/Express uygulamasına (`apps/web/vendor/viadent-api.cjs`, `scripts/build-serverless.mjs` ile derlenir, TÜM bağımlılıklar gömülü) gider. Worker ayrı süreç olmadığından **satır içi tik**: her yazma isteğinden sonra kuyruk işlenir (Vercel'de `waitUntil` ile canlı tutulur), tarama ≥120 sn'de bir. Dosya deposu geçici disk (`STORAGE_DIR=/tmp/...`): yüklenen dosyalar fonksiyon örneğiyle sınırlıdır — demo kabulü; üretimde nesne depolama adaptörü gerekir. Bu mod `VIADENT_SERVERLESS=1` ile açılır; klasik kurulumda köprü 404 döner ve `next.config` yeniden yazmaları ayrı API sürecine gider. **Yerelde doğrulandı:** tam E2E (74 senaryo) tek süreçli serverless modda geçti.

Adımlar (bir kez):
1. **Veritabanı** (Supabase, Frankfurt): proje aç; SQL editöründe `scratchpad/supabase-roles.sql` içeriği (uzantılar + `viadent_owner/app/worker/backup` rolleri, parolalar) — ya da MCP `execute_sql`. LEAKPROOF ayarı (`db-tuning`) yönetilen PostgreSQL'de yapılamaz: hasta araması dizinsiz çalışır (demo hacminde sorun değil, `performance.md`).
2. **Vercel projesi** `viadent-demo` (oluşturuldu: `prj_Vp3XdAXXUWnUi5dAsnjg2bjffU38`; rootDirectory `apps/web`, install `pnpm install --frozen-lockfile --prod=false`, build `cd ../.. && node scripts/build-serverless.mjs && cd apps/web && next build`, Node 22.x, fra1). **Deployment Protection → Vercel Authentication kapatılmalı** (panelden; API ile değiştirme izni verilmedi) — aksi halde bağlantı yalnız Vercel'e giriş yapmış ekip üyelerine açılır.
3. **Ortam değişkenleri** (Production + Preview): `VIADENT_SERVERLESS=1`, `TRUST_PROXY=1`, `STORAGE_DIR=/tmp/viadent-storage`, `VIADENT_EXTERNAL_SEND_ENABLED=false`, `VIADENT_VERSION`, `SESSION_IDLE_MINUTES=90` (girildi) + gizliler: `VIADENT_SECRET_KEY` (32 bayt base64), `OPS_TOKEN`, `METRICS_TOKEN`, `VIADENT_DEMO_PASSWORD`, `VIADENT_DEMO_BOOTSTRAP=1`, `DATABASE_URL` (viadent_app, pooler 6543, `?sslmode=no-verify`), `WORKER_DATABASE_URL` (viadent_worker, 6543), `MIGRATION_DATABASE_URL` (viadent_owner, **oturum modu 5432** — seed `set_config(...,false)` kullanır), `WEB_ORIGIN=https://<alan adı>`.
4. **Kaynak**: GitHub deposu (`Bahoz2113/viadent`) → Vercel Git bağlantısı; ya da `vercel deploy` (CLI) ile depo kökünden. Bu ortamdan dosya yükleme (1,6 MB kaynak) araç çağrısıyla yapılamadı.
5. **Bootstrap**: `curl -X POST https://<alan adı>/api/v1/ops/bootstrap -H "x-ops-token: $OPS_TOKEN" -H "x-viadent-request: 1"` → migration + sentetik seed (boş DB'de bir kez; sonraki çağrılar yalnız yeni migration uygular). Demo hesapları: `yonetici@demo-yesil.test`, `sekreter@…`, `elif.aras@…`, `finans@…`, parola `VIADENT_DEMO_PASSWORD`.
6. Kapanış: bootstrap sonrası `VIADENT_DEMO_BOOTSTRAP` kaldırılır (uç 404 olur); demo sıfırlama için DB'yi boşaltıp yeniden bootstrap.

## 9. Canlı demo kurulumu (01.11.2026) — gerçekleşen
Adres: `https://viadent-demo.vercel.app` (Vercel projesi `viadent-demo`, bölge fra1) · Veritabanı: Supabase `piadent-demo` (eu-central-1, PostgreSQL 17) · Depo: `Bahoz2113/piadent` (`main` = yayın anlık görüntüsü, `gelistirme-gecmisi` = tam geçmiş).

Kurulumda çıkan ve düzeltilen üç engel:
1. **Supabase pooler host'u** `aws-1-eu-central-1.pooler.supabase.com` (varsayılan olarak `aws-0` varsayılmıştı) — bağlantı dizgilerinde düzeltildi. Kullanıcı adı biçimi `rol.<proje-ref>`; uygulama/worker 6543 (transaction), migration 5432 (session), `?sslmode=no-verify`.
2. **Vercel "etkilenmeyen projeyi atla"** ayarı, kök dizin (`apps/web`) dışındaki değişikliklerde derlemeyi iptal ediyordu (`CANCELED`, errorLink monorepos#skipping-unaffected-projects) → proje ayarı `enableAffectedProjectsDeployments: false`.
3. **Migration `.sql` dosyaları serverless fonksiyonuna girmiyordu** (`ENOENT /var/task/apps/web/vendor/migrations`; `outputFileTracingIncludes` globu çalışmadı) → `build-serverless.mjs` artık SQL içeriklerini bundle'a gömüyor ve `setMigrationSource()` ile kaydediyor; disk kopyası yalnız yedek. Ayrıca `migrate()` gömülü kaynağı diske tercih eder.
4. Supabase'de `viadent_backup` rolü yoksa `0020` başarısız olur (grant hedefi). Demoda `create role viadent_backup nologin;` yeterlidir (BYPASSRLS yalnız gerçek yedek alımı için gerekir, Supabase'de superuser ister).

Kurulum sırası: ① Supabase projesi + `create extension btree_gist, pg_trgm, pgcrypto` ② roller (`viadent_owner/app/worker/backup`; owner'a `grant create on database`, `grant all on schema public`) ③ Vercel ortam değişkenleri (gizliler Secret tipinde) ④ Deployment Protection kapalı ⑤ GitHub bağlantısı ⑥ `POST /api/v1/ops/bootstrap` (`x-ops-token`) → migration + seed ⑦ **`VIADENT_DEMO_BOOTSTRAP=0`** ve yeniden dağıtım (kurulum kapısı kapanır).

Doğrulama (01.11.2026): `/api/v1/health` ok · `/api/v1/health/ready` ready, db ok · bootstrap 20/20 migration + seed · yönetici girişi 200, klinik "Yeşilvadi Ağız ve Diş Sağlığı (Demo)", 3 hekim / 3 koltuk, hasta listesi dolu.

Sınırlar: Supabase'de superuser olmadığı için `textlike` LEAKPROOF ayarı (ADR-047) uygulanamaz — büyük hasta hacminde arama dizini devre dışı kalır; pilot barındırmasında kendi PostgreSQL'imizde açıktır. Dosya deposu `/tmp` (kalıcı değil); worker satır içi tik ile çalışır.

## 10. Canlı demo güncellemesi (02.11.2026) — Faz 0–4 + CEZERİ qa-20261102 (TESLİME ADAY)
- Ürün sahibi onayıyla yayınlandı. Kaynak `gelistirme-gecmisi` @ `3f63cfc` (ürün = CEZERİ tur 7 sınanan `95ac8de`); yayın commit'i `origin/main` @ `010dafa` (commit-tree, tek anlık görüntü; force-push yok).
- Migration 0021–0031 Supabase `piadent-demo`'ya uygulandı: her dosya tek transaction'da, `set local role viadent_owner` ile (tablo sahipliği önceki migration'larla aynı), `schema_migrations`'a yerel dosyanın SHA-256 sağlaması yazıldı (31 kayıt; uygulama migratörü bir sonraki çalışmada "değişmiş migration" görmez). Sıra: önce veritabanı (geriye uyumlu ekler), sonra kod.
- Doğrulama: Vercel üretim dağıtımı `dpl_8pizuZyfc3QXeK24zw7MvR6HiiPn` READY, `viadent-demo.vercel.app` takma adı bu dağıtımda (SHA 010dafa); `/api/v1/health/ready` ready + db ok; yeni 6 tablo `viadent_owner` sahipli ve FORCE RLS; FORCE RLS'siz kiracı tablosu 0; 2 kiracıda 3'er klinik çıktı belge türü; geriye dönük makbuz numaralandırması (her kiracıda 2 tahsilat → TM-2026-000001…2). Supabase güvenlik danışmanı: RLS uyarısı yok; mevcut desen uyarıları (tetikleyici fonksiyonlarda search_path, public şemada eklenti) — yeni değil.
- Sınır: bu ortamdan canlıya giriş yapılarak uçtan uca tıklama doğrulaması yapılamadı (kabuk ağ izni yok; canlı demo parolası ortam değişkeninde). Ürün sahibinin girişte Görünüm, makbuz, fatura taslağı ve epikriz ekranlarına bakması önerilir. Pilot öncesi anahtar/parola döndürme açık.
- 02.11.2026 17:30: ürün sahibinin isteğiyle canlı demo hesaplarının (demo-yesil 6, demo-mavi 2) ortak parolası yenilendi (scrypt özeti doğrudan `users.password_hash`; değer hiçbir dosyada yok, yalnız ürün sahibine iletildi). Vercel'deki `VIADENT_DEMO_PASSWORD` yalnız boş DB'ye seed için kullanılır; artık güncel parolayla eşleşmeyebilir.

## 11. Canlı demo güncellemesi (04.11.2026) — ürün sahibi geri bildirimi + CEZERİ qa-20261104 (TESLİME ADAY)
- Ürün sahibi onayıyla yayınlandı. Ürün = CEZERİ tur 2 sınanan `bef63fe`; kaynak `gelistirme-gecmisi` @ `b39ebbb`; yayın commit'i `origin/main` @ `58eb36c` (commit-tree, tek anlık görüntü; force-push yok).
- Migration 0032–0034 Supabase `piadent-demo`'ya uygulandı: her dosya tek transaction'da `set local role viadent_owner`, `schema_migrations`'a yerel SHA-256 (0032 `e36ed104…`, 0033 `1cf3d719…`, 0034 `5c400356…`); yorum satırları gönderilmedi (anlamca aynı). Yeni tablolar `viadent_owner` sahipli, FORCE RLS, uygulama rolünde yalnız SELECT/INSERT.
- Demo veri (iki kiracı, sentetik): standart işlem listesinin eksik kodları (9 → 55), yeni yayınlanmış tarife "2026 Genel Tarife v2 — standart liste (sentetik)" geçerlilik 04.11.2026 (mevcut 9 işlemin fiyatı korunarak 55 kalem), işlem türü → işlem bağları (Kontrol→MUA-02, Dolgu→DOL-01, Diş taşı temizliği→TEM-01, Kanal→KAN-01, Çekim→CEK-01), medikal tedarikçiye 3 sentetik fiyat (implant 1.500, kartuş 45, eldiven 120). Eski tarife ve planlar değişmedi.
- Doğrulama (oturumsuz duman): `/api/v1/health/ready` ready + db ok; yeni uçlar `/dashboard`, `/practitioners/overview`, `/stock/catalog` 401 (önceki sürümde 404); `/hekimler` 200. Supabase güvenlik danışmanı: RLS uyarısı yok; yalnız bilinen desen uyarıları (tetikleyici fonksiyonlarda search_path — yeni `app.salary_due`/`salary_payments_guard` dahil —, public şemada eklenti).
- Sınır: canlı demo parolası bu ortamda yok; girişli uçtan uca tıklama ürün sahibine kaldı (Panel, Hekimler, Yönetim → Ürün ve fiyat listesi, randevu malzemesi). Vercel API bu oturumda dağıtım listesine 403 verdi; yayın, yeni uçların 404→401 değişimiyle doğrulandı.

## 11b. Canlı demo güncellemesi (07.11.2026) — ürün sahibi geri bildirimi 07.11 + CEZERİ qa-20261107 (TESLİME ADAY)
- Ürün sahibi onayıyla yayınlandı ("hepsi bitince canlıya al ve test et"). Ürün = CEZERİ tur 4'te sınanan `1a6ba06`; kaynak `gelistirme-gecmisi` @ `b54519a`; yayın commit'i `origin/main` @ `2fa1cb9` (commit-tree, tek anlık görüntü; force-push yok).
- Migration 0035–0036 Supabase `piadent-demo`'ya uygulandı: her dosya tek transaction'da `set local role viadent_owner`, `schema_migrations`'a yerel SHA-256 (0035 `721d44b7…`, 0036 `b0ab23be…`); yorum satırları gönderilmedi (anlamca aynı). Yeni tablolar (`patient_health_notes`, `message_schedules`, `message_rules`, `message_rule_runs`) `viadent_owner` sahipli, FORCE RLS; uygulama rolünde DELETE yok. Anamnez hazırlık kuralı iki kiracıda pasif. Demo veriye ek satır yazılmadı (kurallar ilk açılışta varsayılan şablonla gelir).
- Doğrulama (oturumsuz duman): `/mesajlar` 404→200 ile yeni derlemenin yayında olduğu görüldü; yeni uçlar `/availability`, `/messaging/status`, `/messaging/rules`, `/patients/:id/health-notes` 401 (olmayan yol 404); 8 sayfa 200; Playwright masaüstü 1366 + Pixel 5: korumalı sayfalar girişe yönleniyor, yatay taşma 0, konsolda yalnız beklenen oturum 401'i. Supabase postgres günlüğünde yayından sonra ERROR/FATAL yok. Sahip rolüyle salt okunur sorgu (geri alınan transaction): yeni tablolar okunuyor, `payments.appointment_id` ve `closures.kind` mevcut.
- 07.11.2026 11:50: ürün sahibinin isteğiyle 8 canlı demo hesabının ortak parolası yeniden yenilendi (scrypt özeti `users.password_hash`, `password_changed_at`; değer hiçbir dosyada yok, yalnız ürün sahibine iletildi).
- Sınır: canlı demo parolası bu ortamda yok; girişli uçtan uca tıklama ürün sahibine kaldı (Randevu ver sayfası + ödeme planı, hasta kartı sağlık özeti ve hesap kutuları, Raporlar sekmeleri, Mesajlar, Hekimler → izin/rapor/resmî tatil, Yönetim → Entegrasyonlar, dışa aktarım indirmesi). Vercel API bu oturumda dağıtım listesine 403 verdi. Netgsm gerçek gönderimi kapalı: kimlik bilgileri ve canlı gönderim kapısı ürün sahibinde (§12).

## 11c. Canlı demo güncellemesi (07.11.2026, 2. paket) — ADR-103…106 + CEZERİ qa-20261107-1245 (TESLİME ADAY)
- Ürün sahibi onayıyla yayınlandı ("Evet, geçince canlıya al"). Ürün = CEZERİ tur 11'de sınanan `f91df0d` (df0ea1d + ADR-104 eki 6fe082d + QA-403 düzeltmesi); yayın commit'i `origin/main` @ `6449cac` (commit-tree, tek anlık görüntü; force-push yok).
- Supabase `piadent-demo`: **0038** (görüntüleme sütunları, DICOM, kategori kısıtları) ve **0039** (cinsiyet yalnız female/male/unspecified; canlıda `other` kayıt 0) tek transaction'da `set local role viadent_owner`, `schema_migrations`'a yerel SHA-256 (0038 `799e14ca…`, 0039 `e42d9470…`).
- **0037 canlıya uygulanmadı ve kaydedilmedi** (120 KB SQL, bu araçla gönderilemedi). Yerine uygulama içi kurulum (`apps/api/src/documents/standard-catalog.ts`): her kiracıda ilk `GET /document-types` çağrısı eksik türleri, şablonsuz türlere DEMO şablonu ve yer tutucu metinlerin yenisini yazar (kiracı kilidi, tek `document_catalog.install` denetim olayı; kurulu kiracıda yalnız sayım). Sonuç 0037 ile aynıdır (H04/H10). Yerel/kalıcı kurulumda 0037 migration olarak çalışmaya devam eder; canlıda `schema_migrations`'ta 0037 yok — ileride migratör canlıda çalıştırılırsa 0037 idempotent olarak (yalnız eksikleri) çalışır.
- Doğrulama (oturumsuz duman, 15:45): `/giris` `theme-color` `#123C34`→`#1E3A8A` ile yeni derleme yayında; `:root --brand-primary:#1d4ed8`, `--bg:#eef2f7` (varsayılan mavi palet). `/giris`, `/ajanda`, `/hastalar` 200; `/api/v1/health/ready` ready + db ok; `GET /document-types`, `GET /patients/:id/files`, `POST /files`, `POST /patients/:id/performed` 401 (oturumsuz). DB: `patients_gender_check` 3 değer; `file_assets` yeni 4 sütun + 3 kısıt; FORCE RLS'siz kiracı tablosu 0; görünüm seçmemiş 6 kullanıcı (`{}`) varsayılan maviyi alır, açık seçimi olan 3 kullanıcı seçimini korur. Supabase postgres günlüğünde yayın penceresinde ERROR/FATAL yok. `document_catalog.install` henüz 0 (ilk "Belge hazırla"/belge türü açılışında çalışır).
- Sınırlar: Vercel istek gövdesi ~4,5 MB — canlı demoda bundan büyük görüntüleme dosyası (ör. DICOM seri) yüklenemez; kalıcı sunucu kurulumunda 20 MB sınırı geçerli. Girişli uçtan uca tıklama ürün sahibine kaldı (odontogram üzerine gelme/tıklama, randevudan dişe işlem, belge şablonları, Görüntülemeler sekmesi, takvim ay/yıl, cinsiyet seçenekleri, palet).

## 11d. Canlı demo güncellemesi (09.11.2026) — ADR-107 + ADR-108 + CEZERİ qa-20261109-0040 (TESLİME ADAY)
- Ürün sahibi onayı: "yaptıklarını yayına al" (09.11.2026 00:21). Ürün = CEZERİ tur 2'de sınanan `db5c4ff` (ADR-107 çoklu/isteğe bağlı işlem, ziyarete çoklu tanı, Ünite, Panel + İş akışı; ADR-108 Laboratuvar menüsü; QA-501…503 ve QA-601 düzeltmeleri). Yayın commit'i `origin/main` @ `8ea34c0` (commit-tree, tek anlık görüntü; force-push yok).
- Supabase `piadent-demo`: **0040** (appointment_procedures, eski tek işlemli 4 randevu taşındı; demo üniteleri "Koltuk 1–3"/"Ünit A–C" → "Ünite A/B/C") ve **0041** (lab_orders ölçü/malzeme sütunları; purchase_orders/lines/receipts FORCE RLS, sütun düzeyi yetki, teslim tetikleyicisi; supplier_entries kaynağı `purchase_receipt`; tasks `purchase_overdue`) — her biri tek transaction'da `set local role viadent_owner`, `schema_migrations`'a yerel SHA-256 (0040 `e7048bae…`, 0041 `3df1a7bb…`).
- Doğrulama (oturumsuz duman, ~01:10): yeni derleme `/laboratuvar` 404 → 200 ile yayında (2 dk); `/giris`, `/bugun`, `/is-akisi`, `/laboratuvar`, `/operasyon`, `/ajanda`, `/hastalar` 200; `/api/v1/health/ready` ready + db ok; `purchase-orders`, `purchase-orders-summary`, `lab-orders`, `POST purchase-orders`, `POST appointments` 401 (oturumsuz). DB: dört yeni tablo FORCE RLS, lab_orders yeni 3 sütun, migration kaydı 0038–0041. Supabase postgres günlüğünde yayın penceresinde ERROR/FATAL yok.
- Canlı demoda malzeme siparişi örneği yok (seed yalnız yerelde); ilk sipariş Laboratuvar → Malzeme siparişleri'nden açılır. Girişli uçtan uca tıklama ürün sahibine kaldı.

## 11e. Canlı demo güncellemesi (13.11.2026) — 12.11 geri bildirimleri + ADR-110 + CEZERİ qa-20261112-1610 (TESLİME ADAY)
- Ürün sahibi onayı: "Evet, hepsini canlıya al" (12.11 → 13.11.2026). Ürün = CEZERİ tur 3'te sınanan ağaç (ürün kodu `0d3a235`; HEAD `87bd224` yalnız qa/docs ekler): Randevu ver → ödeme planı "Tamamı" fiyat tanımsızken elle tutar; Anasayfa (Panel adı, para kartları, Bekleyen hasta ve Aylık gelir kaldırıldı); ADR-110 Hekimler → aylık çalışma listesi. Yayın commit'i `origin/main` @ `fa8d68c` (commit-tree, tek anlık görüntü; force-push yok).
- Supabase `piadent-demo`: **0042** (`work_rosters`, FORCE RLS, ünite çakışma exclusion, app select/insert/update/delete, worker select) tek transaction'da `set local role viadent_owner`; `schema_migrations` SHA-256 `a50f35fa…`. Doğrulama: RLS+FORCE açık, sahip viadent_owner, exclusion kısıtı var, yetkiler beklenen.
- Doğrulama (oturumsuz duman, 13.11): yeni derleme `/api/v1/work-roster` 404 → 401 ile ~2 dk'da yayında; `/giris`, `/bugun` (sekme başlığı "Anasayfa · PİA-DENT"), `/hekimler`, `/hekimler?sekme=calisma`, `/ajanda`, `/finans`, `/laboratuvar` 200; `/api/v1/health/ready` ready + db ok; `GET /work-roster`, `GET /dashboard`, `POST /work-roster` 401 (oturumsuz). Supabase postgres günlüğünde 13.11 ERROR/FATAL yok. Girişli tıklama testi ürün sahibine kaldı (canlıda çalışma listesi boş başlar; kayıt girilmeyen günlerde haftalık saatler geçerli).
## 12. Netgsm SMS'i açma (07.11.2026, ADR-102)
Kod hazır; gerçek SMS ancak aşağıdakiler tamamlanınca gider. Değerleri **ürün sahibi** girer; sohbete, depoya veya loga yazılmaz.
1. Netgsm panelinde API alt kullanıcısı (kullanıcı kodu + API parolası) ve **onaylı gönderen adı (mesaj başlığı)**; gerekiyorsa API IP kısıtını Vercel çıkışına göre açın ya da kapatın.
2. Vercel → `viadent-demo` → Settings → Environment Variables (Production, tür **Sensitive**): `NETGSM_USERCODE`, `NETGSM_PASSWORD`, `NETGSM_MSGHEADER`; `VIADENT_EXTERNAL_SEND_ENABLED=true`. Yeniden dağıtım.
3. PİA-DENT → Yönetim → Entegrasyonlar → **Netgsm bağlantısı ekle** (kimlik bilgisi sorulmaz). "Gerçek gönderime hazır" rozeti görünmeli; Mesajlar sekmesindeki sarı DENEME uyarısı yeşil "Netgsm bağlı"ya döner.
4. İlk deneme: kendi telefonunuza (SMS izni kaydedilmiş sentetik hasta) tek mesaj; Mesajlar → Gönderilen mesajlar'da "Sağlayıcıya iletildi" → teslim raporu gelince "Teslim edildi".
Sınırlar: kampanya/ticari ileti gönderilmez (İYS kapsamı dışında, `iysfilter=0`); Netgsm anahtarla durum sorgusu sunmadığından yanıtı alınamayan gönderim "sonuç bilinmiyor" kalır (yeniden gönderilmez). Vercel'de zamanlanmış/otomatik mesajlar sistem kullanıldıkça en çok dakikada bir işlenir.
