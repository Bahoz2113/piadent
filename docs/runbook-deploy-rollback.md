# Canlıya alma ve geri dönüş (rollback) runbook'u

> **Bu bir plandır; hiçbir adım uygulanmadı.** Gerçek veriyle veya üretim ortamında çalışmak, `release-gates.md` §6'daki pilot öncesi kapılar kapanıp aşağıdaki **onay noktaları** isimli sorumlularca imzalanmadan başlamaz. Bu depoda üretim sunucusu, gerçek veri ve gerçek sağlayıcı yoktur.

## 0. Roller (pilot öncesi isimlendirilecek)
| Rol | Sorumluluk |
|---|---|
| Yayın sahibi | Başla/dur kararı, onay noktalarını imzalar |
| Teknik uygulayıcı | Komutları çalıştırır, kayıt tutar |
| Rollback kararı verici | §5 eşiklerinde geri dönüşe karar verir (yayın sahibiyle aynı kişi olabilir; uygulayıcıyla aynı kişi olmamalı) |
| Klinik sorumlusu | Kabul kontrollerini yapar, kliniği bilgilendirir |
| Veri sorumlusu (klinik) | Kaynak veri dosyasını verir, içe aktarma sonucunu onaylar |

Teknik parçalar (imajlar, compose, systemd, CI, ortam değişkenleri, izleme): `deployment.md`.

## 1. Ortam ön koşulları (bir kez)
1. Ayrı sunucular: PostgreSQL 16 (yalnız özel ağ), API + worker (≥2 API süreci), web; ters vekil TLS 1.2+ ile.
2. Sırlar secret manager'da: `VIADENT_APP/OWNER/WORKER/BACKUP_DB_PASSWORD`, `VIADENT_SECRET_KEY` (32 bayt), `BACKUP_ENCRYPTION_PASSPHRASE` (yedekten ayrı yerde). `.env` dosyası sunucuda tutulmaz.
3. Üretim ayarları: `NODE_ENV=production`, `VIADENT_REQUIRE_MFA_ROLES=clinic_admin,finance`, `VIADENT_EXTERNAL_SEND_ENABLED=false`, `CLAMD_HOST`, `STORAGE_DIR` (şifreli disk), `WEB_ORIGIN=https://…`.
4. `pnpm db:roles` (yönetici bağlantısı yalnız bu adımda; sonra yönetici parolası döndürülür) → `pnpm db:migrate` (sahip rolüyle).
5. Yedek: saatlik `pnpm db:backup` (systemd timer/cron) + günlük `pnpm db:restore-verify` ayrı izole sunucuda; çıkış kodu ≠ 0 → alarm. RPO ≤ 1 sa için WAL arşivleme değerlendirilir. Yedek kopyası ikinci konuma.
6. İzleme: `/api/v1/session` (401 beklenir) sağlık kontrolü, 5xx oranı, p95, DB bağlantı, disk, yedek yaşı, outbox/dead-letter sayısı.

**Onay noktası O1 — ortam hazır:** TLS doğrulandı (`curl -I https://…` → HSTS + Secure çerez), MFA zorunlu rolde giriş denendi, boş veritabanına `restore-verify` geçti, sızma testi yüksek bulgusu yok.

## 2. Sürüm yayınlama (her sürüm)
Kural: **migration'lar yalnız ileri ve geriye uyumlu** (genişlet → kullan → daralt). Bir sürüm, bir önceki uygulama sürümünün yeni şemada çalışmasını bozmamalı; böylece uygulama geri dönüşü veritabanı geri yüklemesi gerektirmez. Sütun/tablo silme ayrı ve sonraki bir sürümde yapılır.

1. **T-1 gün:** sürüm notu; `pnpm typecheck && pnpm test` + E2E yeşil; migration'lar kopya veritabanında (`restore-verify --keep` ile açılan son yedek) denenir ve süresi ölçülür.
2. **T-0, bakım penceresi (klinik kapalıyken):**
   1. Duyuru (uygulama içi + telefon).
   2. `pnpm db:backup` → çıktıdaki dizin adı kaydedilir (**geri dönüş noktası G0**). `restore-verify G0` geçmeden devam edilmez.
   3. Worker durdurulur (yeni dış iş başlamasın), API okuma kipine alınır veya kapatılır.
   4. `pnpm db:migrate`.
   5. Yeni API/worker/web dağıtılır (önceki imaj saklanır).
   6. `GET /api/v1/health/ready` → 200 ve `version` yeni imaj etiketi (her API örneği için).
   7. **Duman testi (10 dk):** giriş + MFA; hasta ara/aç; randevu oluştur/iptal; tahsilat al (test hastasında, sonra ters kayıt); dosya yükle (taranıyor → kullanılabilir); rapor aç; Yönetim → VİA Köprü'de canlı gönderim KAPALI; `pnpm audit` raporu ekli.
   8. Worker başlatılır; outbox birikmesi izlenir (5 dk).
3. **Onay noktası O2:** klinik sorumlusu duman testini imzalar → pencere kapanır.

## 3. Pilot kliniğe ilk veri taşıma (gerçek veri — yalnız O1 + veri işleme sözleşmesi sonrası)
1. Klinik, kendi sisteminden dışa aktarım dosyasını **şifreli kanaldan** verir (e-posta eki değil). VİADENT rakip sisteme bağlanmaz.
2. Dosya `docs/import-contract.md` biçimine dönüştürülür; dönüştürme betiği ve eşleme tablosu kayda girer (kişisel veri içermeden).
3. **Prova:** üretim dışı izole ortamda (son yedekten açılmış, erişimi kısıtlı) Yönetim → Veri aktarımı → ön kontrol. Mutabakat: kaynak satır = geçerli + hatalı + mükerrer + önceden aktarılmış; açılış bakiyesi toplamı kaynak sistemin raporuyla aynı. Hatalı satır CSV'si kliniğe döner, düzeltilir. Prova ortamı sonra silinir.
4. **Onay noktası O3:** veri sorumlusu prova mutabakatını imzalar (satır sayıları + tutar toplamı).
5. Üretimde: `pnpm db:backup` (G1) → hasta kartları ön kontrol → mutabakat O3 ile aynı mı → onay → açılış bakiyeleri aynı sıra.
6. Örnekleme: rastgele 20 hasta kaynak sistemle karşılaştırılır (ad, doğum tarihi, telefon, bakiye).
7. **Onay noktası O4:** veri sorumlusu + klinik sorumlusu.
8. Paralel dönem (öneri 2 hafta): klinik eski sistemi salt okunur tutar; her gün sonu tahsilat/kasa toplamı iki sistemde karşılaştırılır, fark kayda girer.

## 4. Geri dönüş seçenekleri
| Durum | Yol | Veri kaybı |
|---|---|---|
| Yeni uygulama sürümü hatalı, migration geriye uyumlu | **Uygulama geri dönüşü:** önceki imaj yeniden dağıtılır; şema kalır | Yok |
| Migration veya veri bozulması, kullanım başlamadan | **DB geri yükleme G0'a:** API/worker durdur → `restore-verify G0 --keep` ile yeni DB → bağlantı dizesini yeni DB'ye çevir → önceki imaj → duman testi | G0 sonrası yazılanlar (pencere içinde yoksa sıfır) |
| İçe aktarma hatalı, kayıtlar henüz kullanılmadı | **Uygulama içi geri alma:** Yönetim → Veri aktarımı → Geri al (gerekçeli; arşivler/iptal eder, silmez) | Yok |
| İçe aktarma hatalı ve kayıtlar kullanılmaya başladı | Geri alma engellenir (`IMPORT_HAS_ACTIVITY`) → kayıt kayıt düzeltme; ağır durumda G1'e geri yükleme + G1 sonrası işlemlerin elle yeniden girişi (paralel dönem kayıtlarından) | Karar verici değerlendirir |
| Pilot sonlandırılır | Klinik verisi açık JSON olarak dışa aktarılır ve teslim edilir; sözleşmeye göre silme + imha kaydı | — |

Komut örneği (G0'a dönüş):
```
pnpm db:restore-verify .backups/<G0-dizini> --keep --target viadent_g0   # geri yükle + doğrula (fark = 0), DB'yi bırak
# DATABASE_URL / WORKER_DATABASE_URL'i viadent_g0'a çevir → önceki imajı başlat → duman testi
```
`--keep` olmadan hedef her zaman silinir (düzenli doğrulama).

## 5. Geri dönüş eşikleri (pencere içinde)
Aşağıdakilerden biri 15 dakikada çözülemezse **rollback**: duman testinde giriş/hasta açma/tahsilat başarısız · 5xx oranı > %1 (5 dk) · p95 > 1 sn (5 dk, normal yükte) · içe aktarma mutabakatı O3'ten farklı · çapraz klinik veri görünmesi şüphesi (bu durumda **anında** servis durdurulur, olay müdahalesi başlar).

## 6. Sır anahtarı döndürme (planlı, yılda en az bir kez veya sızıntı şüphesinde hemen)
1. Yeni anahtar üret (secret manager'da), `VIADENT_SECRET_KEY` = yeni, `VIADENT_SECRET_KEYS_OLD` = eski → API/worker yeniden başlat.
2. `node dist/rotate-keys.js` (önizleme: kaç sır yeniden yazılacak, `failed` = 0 olmalı) → `node dist/rotate-keys.js --apply`.
3. Tekrar önizleme → tüm sayılar 0. MFA'lı bir test hesabıyla giriş + bir MOCK webhook simülasyonu.
4. `VIADENT_SECRET_KEYS_OLD` boşaltılır → yeniden başlat. Eski anahtar secret manager'da imha edilir. (Testli: `gorev8.test.ts`.)

## 7a. Zaman noktasına geri dönüş (PITR) — yanlışlıkla silme / bozuk toplu işlem
Ön koşul: WAL arşivleme açık (`backup-restore.md` PITR bölümü). Adımlar: (1) olay zamanını denetim kaydından belirle (`audit_events.created_at`), hedef = olaydan hemen önce; (2) uygulamayı bakım moduna al (API/worker durdur); (3) `scripts/pitr-drill.sh`'teki 5. adımı **ayrı bir dizin/porta** uygula: temel yedeği aç, `restore_command` + `recovery_target_time=<hedef>` + `recovery_target_action=promote`, başlat, `pg_is_in_recovery()` false olana kadar bekle; (4) geri yüklenen kümede sayım/finans mutabakatı (`db:restore-verify` mantığı: `backup.ts` manifest karşılaştırması) ve olaya konu kayıtların durumu; (5) karar: ya tüm kümeyi bu kümeyle değiştir (olay sonrası tüm işlemler kaybolur — klinik bilgilendirilir) ya da yalnız etkilenen satırları geri yüklenen kümeden kopyala (tercih edilen; `pg_dump -t` ile tablo/satır bazında, ters kayıt ilkesine uygun); (6) denetim kaydına işletim notu, `handoff.md`'ye olay özeti. Tatbikat süresi (143 MB): temel yedek 13 sn, geri yükleme 9 sn; 100k hasta / 1M randevu ölçeğinde `pg_dump` geri yüklemesi 93 sn ölçülmüştü, PITR benzer mertebede beklenir (ölçülmedi).

## 7. Olay sonrası
Kayıt: zaman çizelgesi, karar, etkilenen kayıt sayısı (kişisel veri olmadan), kök neden, önleyici iş. Kişisel veri ihlali şüphesinde hukukla birlikte KVKK bildirim değerlendirmesi (süreler danışmanla).
