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
