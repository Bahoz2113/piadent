# Backlog

Durum sözlüğü: **tamamlandı** = kabul kriteri sağlandı ve test edildi · **kısmi** = ilk dikey dilim çalışıyor, kalanı yazılı · **açık** = başlanmadı · **engelli** = dış erişim bekliyor.

| İş | Durum | Kanıt / kalan |
|---|---|---|
| VD-001 Depo ve geliştirme kurulumu | **tamamlandı** | README ile kurulum, `db:roles/migrate/seed`, typecheck, test komutları çalışıyor. CI yapılandırması yok (açık). |
| VD-002 Tenant ve rol temeli | **kısmi** (davet + rol değişikliği eklendi) | UI/API çapraz tenant negatif testleri ✔, RLS testleri ✔, worker kısıtlı rol ✔. Dosya erişimi Görev 4'te (dosya modülü yok). |
| VD-003 Tasarım sistemi ve kabuk | **kısmi** | Tokenlar, kabuk, form/tablo/çekmece/rozet, boş/yükleme/hata/yetkisiz durumları, klavye odağı, kontrast testi ✔. Bileşenler `packages/ui`'ye taşınmadı; Storybook benzeri örnek sayfası yok. |
| VD-004 Hasta kayıt ve arama | **tamamlandı** (ilk kapsam) | Kalıcı kayıt, maskeli arama, mükerrer aday, tarih doğrulama, audit, sürüm kontrolü, yakın/veli ve yasal temsil (Görev 1) — testli. |
| VD-005 Ajanda ve kaynaklar | **tamamlandı** (ilk kapsam) | Çakışma (AT-03), çalışma saatleri, kapatma (eşzamanlılık testli), işlem türü, hekim/koltuk yönetimi, gün+hafta görünümü, mobil liste ✔. Açık: sürükle-bırak taşıma, ay görünümü, bekleme listesi (PİA Denge, P1). |
| VD-006 Anamnez ve klinik not | **kısmi** | Sürümlü anamnez + hekim onayı + kritik uyarı ✔, yalnız-ekleme not + düzeltme ✔, notun ziyarete bağlanması ✔ (Görev 2). Açık: soru setinin klinisyen onayı, taslak otomatik kaydı. |
| VD-007 Plan ve odontogram | **tamamlandı** (ilk kapsam) | Özgün odontogram (FDI, daimi/süt/karma, yüzey seçimi), bulgu + tanı (gerekçeli durum geçmişi), katalog + sürümlü/hekime özel tarife, plan → teklif → karar → yeni sürüm; kabul edilen sürüm API ve DB'de değişmez (AT-05 testli). Açık: tanı kod sistemi (ADR-023), klinik içeriğin hekim onayı, plan PDF/teklif çıktısı (Görev 4), seans → randevu otomatik önerisi. |
| VD-008 Gerçekleşen işlem ve hesap | **tamamlandı** (ilk kapsam) | Ziyarete bağlı gerçekleşen işlem, bedel snapshot'ı, kuruş yuvarlaması, gerekçeli iptal/düzeltme ✔; işlem aynı transaction'da hasta alacağı üretir, iptal/düzeltmede alacak iptal + dağıtım ters kaydı ✔ (Görev 3). |
| VD-009 Ödeme, dağıtım, iade | **tamamlandı** (ilk kapsam, TRY) | Alacak/ödeme/dağıtım/avans/iade/kasa/gider ayrı; idempotency; DB tutar tetikleyicileri; eşzamanlı dağıtım; AT-06..AT-10, AT-19 gerçek DB'de testli. Açık: iade ikinci onay eşiği, banka/POS mutabakatı, makbuz/e-belge (Görev 5), ticari indirim/alacak düzeltmesi kaydı, çoklu para birimi davranışı. |
| VD-010 PİA Akış / Net / İz | **kısmi** | Görev 6: laboratuvar (gecikme/kabul/hazırlık) ve stok (en az seviye/SKT) görevleri, klinik geneli LOG sorgusu. Akış (7 tür: geciken geliş, teyit, eksik iletişim, kapatma çakışması, anamnez onayı, randevusuz kabul edilmiş plan, yanıtsız teklif; dedupe, otomatik kapanış, rol/hassasiyet filtresi) ✔; İz (hasta bazlı, maskeli, rol kontrollü) ✔; Net: hasta hesabı (açılabilir toplamlar, hareket defteri, mutabakat), klinik özeti (işlem ≠ tahsilat), bakiyeler + yaşlandırma, kasa, gider, prim tahakkuku ✔ (Görev 3). |
| VD-011 Dosya ve belge sürümü | **tamamlandı** (ilk kapsam) | Belge türü / şablon sürümü / hasta belgesi / onay isteği / kanıt ayrı; SHA-256; AT-14 ✔. Özel depo, yükleme ≠ seçme, tarama portu (temel + clamd), karantina, erişim izi; AT-11 ✔. Açık: üretimde ClamAV kurulumu, S3 adaptörü, saklama/imha işi, PDF çıktısı, görüntüleyici, uzaktan onay kanalı (Görev 5). |
| VD-012 Outbox ve entegrasyon merkezi | **tamamlandı** (MOCK kapsamı; gerçek sağlayıcılar **engelli**) | Port/adapter, MOCK SMS + online ödeme, dış iş kuyruğu (idempotency, retry/backoff, dead-letter, zaman aşımı → durum sorgusu/mutabakat), imzalı webhook (tekrar, ters sıra, replay, geçersiz imza), dört göz onay kapısı, canlı gönderim kapısı, PİA Köprü ekranı; AT-12/AT-13 testli (Görev 5). Gerçek SMS/WhatsApp/ödeme/e-belge/DHBS adaptörü: yetkili doküman + test erişimi bekliyor. |
| VD-013 Laboratuvar ve prim | **tamamlandı** (ilk kapsam) | Laboratuvar iş emri (aşama/revizyon/maliyet, iş föyü en az veri, PİA Akış), tedarikçi carisi, tedavi bazlı prim + ters prim + prim ödemesi (tahakkuku aşamaz), temel stok (lot/SKT, hareket tabanlı, sayım farkı), 19 rapor (toplam = alt kayıtlar testli) + CSV (Görev 6). Açık: dış laboratuvar portalı, satın alma siparişi, lab maliyetinin primden düşülmesi kuralı, kurum carisi (F6). |
| VD-014 İçe aktarma ve pilot | **kısmi** (yazılım tarafı tamamlandı; pilot kapıları açık) | Görev 7: hasta + açılış bakiyesi dry-run içe aktarma (AT-16), açık JSON klinik/hasta dışa aktarımı, şifreli yedek + izole geri yükleme doğrulaması (AT-17), TOTP MFA, güvenlik başlıkları/sınırlayıcı, performans ölçümü (100k/1M/50), yayın kapıları, runbook, pilot kontrol listesi. Açık: hukuk/KVKK/sözleşme, barındırma, sızma testi, klinik kabul, randevu/tedavi/ödeme geçmişi aktarımı (kaynak biçim gerekli) — `release-gates.md` |
| VD-015 Pilot altyapısı | **kısmi** (yazılım tamamlandı; imaj ve CI ilk koşusu bekliyor) | Görev 8 — `deployment.md`. Açık: imajların ilk derlemesi (imaj deposu erişimi), CI ilk koşusu (GitHub deposu), barındırma kurulumu |
| VD-016 Güvenlik derinleştirme | **kısmi** (Görev 9 + 10 tamamlandı; sızma testi ve kademeli gecikme açık) | ADR-056…061; `security-review.md` |

## Tamamlanan iş paketi: Görev 1 (22.10.2026)
Çalışma saatleri (T05), kapatma (T06), işlem türü (T04), hekim/koltuk yönetimi (T14), yakın/veli (H03), sürümlü anamnez (H07), davet ve rol değişikliği (T20), haftalık ajanda. Testler: API 61, E2E 12 (bkz. `verification.md`).

## Tamamlanan iş paketi: Görev 2 (22.10.2026)
VD-007 tamamlandı (ilk kapsam), VD-008 kısmi (hesap Görev 3). H04, T01, T02, T03 çalışıyor; H05, H08, R04 kısmi. ADR-021…026. Testler: API 78, E2E 18 (bkz. `verification.md`).

## Tamamlanan iş paketi: Görev 3 (22.10.2026)
VD-008 ve VD-009 tamamlandı (ilk kapsam, TRY), VD-013 kısmi (prim tahakkuku). H06, R02, R11, T07 çalışıyor; O03, R01, R20, T08, T09, T12 kısmi. ADR-027…031. Testler: API 99, E2E 22.

## Tamamlanan iş paketi: Görev 4 (23.10.2026)
VD-011 tamamlandı (ilk kapsam). H11, H15 çalışıyor; H10, H13, A02, A03, R14, R22 kısmi; Ek B 43 başlık PİA-DENT türüne eşlendi (kısmi), B03/B43 uygulanmayacak. PİA Hazır temeli (P1), iletişim tercihi, MOCK mesaj. ADR-032…036. Testler: API 117, E2E 28.

## Tamamlanan iş paketi: Görev 5 (23.10.2026)
VD-012 tamamlandı (MOCK kapsamı). R24 kısmi (online ödeme isteği ≠ tahsilat, MOCK), R14 kısmi sürüyor (gerçek sağlayıcı yok); E01/E02/E03 engelli kalır (gerekçe PİA Köprü ekranında). AT-13 geçti, AT-12 sağlayıcı bildirimiyle genişledi. ADR-037…040. Testler: API 135, E2E 32.

## Tamamlanan iş paketi: Görev 6 (23.10.2026)
VD-013 tamamlandı (ilk kapsam). Ek A rapor ve tanımlama ID'leri tek tek karşılandı: çalışıyor R01, R03, R04, R05, R08, R09, R12, R13, R15, R19, R20, R22, R23, T15, T16, T18, H12; kısmi R14, R18, R24, T19, O03, G05; engelli R16; ertelendi (gerekçeli) R06, R07, R10, R17, R21, T10, T11, T17. ADR-041…045. Testler: API 157, E2E 40.

## Tamamlanan iş paketi: Görev 7 (23.10.2026)
VD-014 yazılım tarafı: içe aktarma (ADR-046), RLS altında arama performansı (ADR-047), yedek/geri yükleme (ADR-048), MFA (ADR-049), güvenlik başlıkları ve bağımlılık hijyeni (ADR-050), yayın kapıları — satışa hazır beyanı yok (ADR-051). AT-16 ve AT-17 testli. Ek C satırları (C01–C07) izlenebilirliğe eklendi. Testler: API 192, E2E 47 (+1 bilinçli atlama). Belgeler: `release-gates.md`, `runbook-deploy-rollback.md`, `pilot-checklist.md`, `import-contract.md`, `backup-restore.md`, `performance.md`, `security-review.md`.

## Tamamlanan iş paketi: Görev 8 (23.10.2026) — VD-015 pilot altyapısı
Derlenmiş üretim çıktısı (esbuild; paket başına dış bağımlılık; kendini çalıştırma kontrolü düzeltildi), konteyner tanımları (api/worker/web/ops — **imaj deposuna erişim yok, derlenmedi**), tek sunuculu compose + Caddy (TLS) + yedek döngüsü, systemd zamanlayıcıları, CI iş akışı (**GitHub'da koşmadı**), PostgreSQL'de paylaşılan giriş sınırlayıcısı (ADR-053), sürümlü sır anahtarı + döndürme (ADR-052), nonce'lu CSP, içe aktarma satır verisi saklama (ADR-054), `/health/ready` + `/metrics` + `TRUST_PROXY` (ADR-055), Türkçe doğrulama mesajları. Testler: API 200, E2E 49 (derlenmiş API/worker'a karşı). Belge: `deployment.md`.

## Tamamlanan iş paketi: Görev 9 (23.10.2026) — iç güvenlik denetimi (VD-016 kısmi)
Kod incelemesi + negatif doğrulama testleri; 9 bulgu kapandı (parola değiştirme/sıfırlama yoktu, NUL → 500, görünmez karakterler, boşta kalma süresi, parola politikası, MFA kod deneme sınırı, takvimsel tarih, oturum listesi/kapatma, derleme hatası). ADR-056, 057. Testler: API 221, E2E 50 (+2 bilinçli atlama). `security-review.md` “Görev 9 iç güvenlik denetimi”. **Bağımsız sızma testi hâlâ açık.**

## Tamamlanan iş paketi: Görev 10 (23.10.2026) — VD-016 güvenlik derinleştirme
MFA kurtarma kodları (ADR-058), T.C. kimlik no alan şifrelemesi + HMAC arama + geçiş/döndürme (ADR-059), klinik MFA politikası (ADR-060), süreli salt okunur destek erişimi (ADR-061), Hesabım oturum listesi. Testler: API 234, E2E 53 (+3 bilinçli atlama). Kademeli gecikme ertelendi (kabul edilen risk A11).

## Sıradaki tek iş paketi
**Görev 11 — tamamlandı (26.10.2026):** düz metin `national_id` kaldırıldı (0013, ADR-062) · kimlik no gerekçeli gösterim (ADR-063) · destek erişiminde dört göz (0014, ADR-064) · sınırlı kademeli giriş gecikmesi (ADR-065) · `DateField` gg.aa.yyyy + takvim, 18 kullanım (ADR-066) · multer override.

**Görev 12 — tamamlandı (27.10.2026):** dosya içeriği imhası (0015, ADR-067) · işletim uyarı metrikleri + eşikler (0016, ADR-068) · içe aktarmada açık sütun eşleme ekranı (ADR-069) · axe erişilebilirlik taraması E2E'de, 2 bulgu düzeltildi (ADR-070) · WAL arşivleme + PITR tatbikatı gerçek kümede (ADR-071).

**Görev 13 — tamamlandı (27.10.2026):** geçmiş randevu içe aktarımı (0017, ADR-072; sentetik sözleşme + örnek) · UAT senaryoları `uat-senaryolari.md` · 19 rapor + haftalık ajanda 100k/1M ölçümü, hekim-hasta 18× hızlandı, arka plan ertelendi (ADR-074) · PİA Akış eşikleri klinik ayarı (0018, ADR-073).

**Görev 14 — tamamlandı (27.10.2026):** tedavi geçmişi aktarımı, alacak üretmez (0019, ADR-075) · perf DB'ye 300k işlem/alacak + 240k ödeme; borç bakiye 10,3 s → 0,33 s (0020, ADR-076) · migration/FORCE RLS bulgusu (ADR-077) · pilot provası tek akış E2E · rol kılavuzları + ekran turu. İmaj derleme + CI: depo/registry olmadığı için hâlâ açık.

**Görev 15 — kısmen (27.10.2026):** serverless tek proje modu (ADR-078) yazıldı ve yerelde tam E2E ile doğrulandı; Vercel projesi açıldı. **Bekleyen dış adımlar (izin/erişim):** Supabase projesi, GitHub deposu (kaynağı Vercel'e taşımak için), Vercel Deployment Protection kapatma, gizli ortam değişkenleri — `deployment.md` §8. Sonra: nesne depolama adaptörü, CI ilk koşu, demo sıfırlama zamanlayıcısı.

## Görev 7'den kalan açık işler
- Dosya/röntgen ve belge aktarımı (kaynak örneği gelince); ödeme geçmişi bilinçli aktarılmaz (ADR-075); randevu (Görev 13) ve tedavi (Görev 14) geçmişi sentetik sözleşmeyle var.
- Büyük raporların arka plana alınması — yalnız ölçüm tetiklerse (Görev 13: tüm raporlar p95 ≤ 300 ms, ADR-074); finans hacimli perf verisi henüz yok.
- Üretimde `archive_command` hedefi (ikinci konum) ve WAL arşivi için alarm (`pg_stat_archiver.failed_count`) — barındırma kararıyla (tatbikat Görev 12'de).
- Destek erişiminde platform tarafı talep **başlatma** akışı (klinik tarafı onay/dört göz Görev 10–11'de tamam).

## Küçük açık işler
- Laboratuvar: dış laboratuvar kullanıcısı (yalnız atanmış iş), iş emrine dosya/fotoğraf ekleme, laboratuvar maliyetinin hekim priminden düşülmesi kuralı (mali müşavir + klinik sahibi kararı).
- Stok: satın alma siparişi, birden çok depo/şube, maliyet yöntemi (FIFO/ortalama) ve stok değerleme raporu; resmî ürün takip bildirimi yükümlülüğünün doğrulanması.
- Raporlar: koltuk doluluğu (kullanılabilir süre modeli), kaydedilmiş rapor süzgeçleri, büyük raporların arka plana alınması, ana panelde haftalık karşılaştırma kartı (G05), dışa aktarımda XLSX.
- Prim: hekimin kendi prim dökümünü görmesi (ayrı izin), prim ödemesinin bordro/stopaj ile ilişkisi (kapsam dışı; yalnız kayıt).
- PİA Köprü: gerçek sağlayıcı adaptörleri (seçim + sözleşme + sandbox + webhook dokümanı geldikçe; her biri için sözleşme testi MOCK testleriyle aynı senaryoları geçmeli).
- Sağlayıcı iadesinde zaman aşımı/bilinmiyor durumunda sağlayıcıdan iade durumu sorgusu (MOCK `query` var; gerçek API'ye göre).
- Online ödeme bağlantısının süresi dolma işi (`expires_at` alanı var, iş yok) ve hastaya bağlantı gönderimi (SMS kanalıyla, izin + onay kapısıyla).
- Webhook ret sayısı için hız sınırı/uyarı eşiği; webhook olay kaydı saklama süresi.
- Sır anahtarı (`VIADENT_SECRET_KEY`) döndürme prosedürü ve KMS/secret manager.
- Klinik geneli mesaj sorgu ekranı (R14) ve online ödeme raporu (R24) — Görev 6.
- Üretimde clamd (ClamAV) kurulumu ve imza güncellemesi; tarama kuyruğu gecikme izleme.
- Dosya saklama süresi ve “silindi” dosyaların imha işi; S3 uyumlu özel bucket adaptörü (sunucu tarafı şifreleme).
- Belge PDF çıktısı (şu an tarayıcı yazdırması) ve taranmış nüshanın belgeye yüklemeden bağlanması akışı.
- Klinik geneli belge/mesaj sorgu ekranları (R14, R22) — Görev 6.
- Kontrol görevinden doğrudan randevu verme kısayolu.
- İade için ikinci onay eşiği (Plan §05), makbuz çıktısı, banka/POS ekstre mutabakatı.
- Ticari indirim / alacak düzeltmesi kaydı (iade ile karıştırılmadan).
- PİA Akış finans görevleri (vadesi geçmiş borç, dağıtılmamış avans) — `via_net.changed` olayı hazır.
- `<input type="date">` başlık biçimi tarayıcı yerel ayarına bağlı (headless Chromium'da aa/gg/yyyy); özel tarih seçici.
- Tanı kod sistemi seçimi (lisans + klinisyen onayı) ve bulgu/katalog içeriğinin pilot hekimle doğrulanması.
- Plan kalemini düzenleme çekmecesi (API'de `PATCH /plan-items/:id` var; arayüz şimdilik sil + yeniden ekle).
- Gerçekleşen işlem düzeltmesi için arayüz (API var; arayüzde yalnız iptal).
- Odontogramda planlı/gerçekleşen yüzeylerin ayrı katman olarak boyanması (şimdilik sembol).
- `plan_decision_pending` eşiğini (3 gün) klinik ayarına taşıma.
- CI iş akışı Görev 8'de yazıldı (`.github/workflows/ci.yml`); depo GitHub'a bağlanınca ilk koşu ve imaj derlemesi doğrulanmalı.
- Randevu oluşturmada Idempotency-Key (çift tık zaten arayüzde engelli; ağ tekrarına karşı).
- PİA Akış eşiklerini klinik ayarına taşıma.
- Randevu sürükle-bırak taşıma (sunucu reddederse eski konuma dönüş) ve ay görünümü.
- Anamnez soru setinin pilot hekimle gözden geçirilmesi (klinik içerik onayı).
- Davet e-postası: sağlayıcı seçilince Görev 5 outbox üzerinden.
- Çok bloklu çalışma günü için arayüz (API destekliyor; ekran gün başına tek blok düzenliyor).
- ~~Giriş hız sınırını DB'ye taşıma~~ — Görev 8'de yapıldı (ADR-053).
- AT-19 tam senaryosu (rapor) Görev 3/6; gün sınırı birim testi var.
- Tarayıcı yerel ayarında `<input type="date">` biçimi işletim sistemine bağlı; özel tarih seçici değerlendirilecek.

## Teslim testinden gelen öneriler (31.10.2026)
- **VD-030** E2E test verisi tekrarlı koşuya dayanıklı olsun (koşu-benzersiz tutar/hasta; `gorev3` 150 ₺ `.first()` bağımlılığı). Öncelik: düşük.
- **VD-031** `GET /patients` sıralamasına kararlı kuyruk anahtarı (`file_no`); `tr-TR` collation değerlendirmesi (Ç/Ö/Ş/İ/Ü soyadları listenin sonuna düşüyor). Sayfalama eklenmeden önce.
- **VD-032** Denetim raporunda `action` sütununu `auditActionLabel` ile Türkçeleştir (önek süzgeci korunarak).
- **VD-033** İstemci tarafında 503 `SERVICE_UNAVAILABLE` için tek seferlik otomatik yeniden deneme (idempotent GET'ler) ve kullanıcıya Türkçe "bağlantı yenileniyor" bildirimi.
