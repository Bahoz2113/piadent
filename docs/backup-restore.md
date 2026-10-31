# Yedekleme ve geri yükleme (AT-17)

Plan §08: “Yedek almak yeterli sayılmaz; düzenli izole geri yükleme ve kayıt sayısı/finans mutabakatı testi gerekir.” Hedefler (kanıtlanmış SLA değil): **RPO ≤ 1 saat, RTO ≤ 4 saat, aylık %99,5**.

## Bileşenler
| Parça | Ne | Nerede |
|---|---|---|
| `viadent_backup` rolü | `NOSUPERUSER NOCREATEROLE NOCREATEDB BYPASSRLS NOINHERIT`, yalnız `SELECT` (şema + varsayılan yetkiler) | `pnpm db:roles` (`VIADENT_BACKUP_DB_PASSWORD` tanımlıysa); yetkiler `0008_pilot.sql` |
| `pnpm db:backup` | Tek tutarlı anlık görüntü: `pg_export_snapshot()` → `pg_dump --snapshot` (özel biçim, GRANT'lar dahil) + aynı snapshot'tan manifest; özel dosya deposu `tar` | `packages/db/src/backup.ts` |
| Şifreleme | Her parça **AES-256-GCM**, anahtar `scrypt(N=2^15, r=8)` ile parola + rastgele tuzdan; biçim `VDBK1 | tuz | IV | veri | etiket`. Değiştirilmiş dosya veya yanlış parola çözülemez | `BACKUP_ENCRYPTION_PASSPHRASE` (≥16 karakter; **yedekle aynı yerde tutulmaz**, secret manager) |
| Manifest | Tablo satır sayıları; klinik bazında hasta/etkin hasta, alacak, ödeme, iade, dağıtım, kasa net, cari borç/ödeme, prim net, stok hareketi; dosya: referans/mevcut/eksik + özet; şifreli parçaların SHA-256'sı. **Kişisel veri içermez** (testli) | `manifest.json` (0600) |
| `pnpm db:restore-verify [dizin]` | Parça özetleri → çöz → **yeni izole veritabanı** → `pg_restore --exit-on-error` → katalog ayarı (ADR-047) → depo ayrı dizine → manifest yeniden hesaplanır ve karşılaştırılır → uygulama rolü yetkileri ve FORCE RLS denetlenir → süreler + yedek yaşı → hedef silinir | aynı modül |
| Saklama | `BACKUP_KEEP` (varsayılan 14) en yeni yedek tutulur | `pruneBackups` |

Neden tablo sahibi değil de ayrı rol? Tablo sahibi (`viadent_owner`) bile **FORCE RLS** nedeniyle döküm alamaz (`query would be affected by row-level security policy`) — testli. Yedek için RLS'i aşan, yazamayan ayrı rol gerekir; uygulama rolü hâlâ BYPASSRLS değildir.

## Ölçümler (23.10.2026, gerçek koşu)
Donanım: 2 vCPU Intel Xeon @ 2,80 GHz, 7,8 GiB RAM, yerel SSD, PostgreSQL 16.15, Node 22.22 — veritabanı, uygulama ve yedek aynı makinede.

| Veri | Yedek süresi | Şifreli boyut | Çözme | Geri yükleme (pg_restore + dizinler) | Mutabakat | Toplam geri yükleme | Fark |
|---|---|---|---|---|---|---|---|
| Demo seed (2 klinik, 32 hasta) | 0,8 sn | 0,4 MB | 0,3 sn | 1,4 sn | 0,1 sn | **2,0 sn** | 0 |
| Perf (100.024 hasta, 1.000.009 randevu, 2 klinik) | 10,8 sn | 64 MB | 0,9 sn | 91,0 sn | 0,3 sn | **93,3 sn** | 0 |
| Test (gorev7.test.ts, gerçek dosya + kurcalama) | — | — | — | — | — | ~3,5 sn | 0; kurcalanmış parça reddedildi |

**RTO ölçümü:** pilot hacminde teknik geri yükleme ≈ 1,5 dk. Gerçek RTO = karar + yeni sunucu/DB hazırlığı + geri yükleme + doğrulama + DNS/uygulama yönlendirmesi; teknik kısım 4 saat hedefinin çok altında, **uçtan uca tatbikat (insan adımlarıyla) yapılmadı** → pilot öncesi kapı.
**RPO:** yalnız gece/saatlik `pg_dump` ile RPO = yedek aralığıdır. Saatlik zamanlayıcı (Görev 8) ve WAL arşivleme/PITR tatbikatı (Görev 12, yukarıda) hazır; üretimde `archive_command` hedefi (ikinci konum) barındırma kararıyla belirlenir → kapı **kısmen** kapalı.

## WAL arşivleme ve zaman noktasına geri yükleme — PITR (Görev 12, ADR-071)
`pg_dump` tabanlı yedek RPO'yu yedek aralığına bağlar. RPO ≤ 1 sa (hedef) için **WAL arşivleme** değerlendirildi ve `scripts/pitr-drill.sh` ile **gerçek kümede tatbik edildi** (26.10.2026, yerel PostgreSQL 16, 143 MB veri dizini):

| Adım | Sonuç |
|---|---|
| Arşiv ayarı | `archive_mode=on`, `archive_command='test ! -f <arşiv>/%f && cp %p <arşiv>/%f'`, `archive_timeout=300` (en geç 5 dk'da bir parça → RPO ≤ 5 dk + kopya gecikmesi) |
| Temel yedek (`pg_basebackup -Ft -z -Xnone -c fast`) | 143 MB → 13 sn |
| İşaret satırı → hedef zaman → "hatalı" satır → `pg_switch_wal()` | arşivde WAL parçası görüldü |
| Ayrı kümeye geri yükleme (`restore_command`, `recovery_target_time`, `recovery_target_action=promote`) | 8–9 sn; işaret satırı **var**, hatalı satır **yok** → **BAŞARILI**; toplam 26–27 sn |

Betik üretim verisine dokunmaz (kendi `ops.pitr_drill` tablosu), geri yüklemeyi ayrı dizin/porta yapar, Debian/Ubuntu'da veri dizini dışındaki yapılandırma dosyalarını kopyalar ve **üretim kümesini gösteren mutlak yolları etkisizleştirir** (ilk denemede `data_directory` satırı üretim kümesinin kilidine çarptı — betik bunu kalıcı olarak düzeltir). Önerilen üretim düzeni: `archive_command` WAL parçasını **ikinci konuma** (ayrı disk/nesne deposu) kopyalar ve başarısızlıkta ≠0 döner (PostgreSQL yeniden dener; arşiv birikirse `pg_stat_archiver.failed_count` alarmı); günlük temel yedek + sürekli WAL; şifreli `pg_dump` snapshot'ı (bu depodaki `db:backup`) **ayrıca** sürer (taşınabilir, izole doğrulanabilir). Yönetilen PostgreSQL'de (bulut) sağlayıcının PITR'ı kullanılır; betik yalnız kendi kümesi için. Tatbikat çıktısı `verification.md`'de; pilot öncesi insanlı tatbikat `pilot-checklist.md`'de.

## Bilinen sınırlar
- Roller küme düzeyindedir, dökümde yoktur: hedef sunucuda önce `pnpm db:roles`. `textlike LEAKPROOF` katalog ayarı da taşınmaz; `restore-verify` ve `db:roles` uygular.
- Dosya deposu tar ile alınır (yerel disk). S3 adaptörü yok; S3'e geçilirse nesne sürümleme + ayrı mutabakat gerekir.
- Snapshot ile depo arşivi arasında yeni dosya gelirse arşivde fazladan dosya olabilir (zararsız; manifest yalnız referanslı dosyaları sayar). DB'de “kullanılabilir” görünüp diskte olmayan dosya `missing` sayılır ve doğrulamada fark olarak görünür.
- Yedeğin ikinci bölgeye/kopya hedefe taşınması (3-2-1) yapılmadı.

## Komutlar
```
pnpm db:backup
pnpm db:restore-verify
pnpm db:restore-verify .backups/viadent-viadent-2026-10-23T07-30-58-151Z
```
Çıkış kodu: fark varsa `2`. Zamanlanmış görevde fark veya hata → nöbetçiye alarm (izleme altyapısı açık).
