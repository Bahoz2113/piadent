# Backlog

Durum sözlüğü: **tamamlandı** = kabul kriteri sağlandı ve test edildi · **kısmi** = ilk dikey dilim çalışıyor, kalanı yazılı · **açık** = başlanmadı · **engelli** = dış erişim bekliyor.

| İş | Durum | Kanıt / kalan |
|---|---|---|
| VD-001 Depo ve geliştirme kurulumu | **tamamlandı** | README ile kurulum, `db:roles/migrate/seed`, typecheck, test komutları çalışıyor. CI yapılandırması yok (açık). |
| VD-002 Tenant ve rol temeli | **kısmi** (davet + rol değişikliği eklendi) | UI/API çapraz tenant negatif testleri ✔, RLS testleri ✔, worker kısıtlı rol ✔. Dosya erişimi Görev 4'te (dosya modülü yok). |
| VD-003 Tasarım sistemi ve kabuk | **kısmi** | Tokenlar, kabuk, form/tablo/çekmece/rozet, boş/yükleme/hata/yetkisiz durumları, klavye odağı, kontrast testi ✔. Bileşenler `packages/ui`'ye taşınmadı; Storybook benzeri örnek sayfası yok. |
| VD-004 Hasta kayıt ve arama | **tamamlandı** (ilk kapsam) | Kalıcı kayıt, maskeli arama, mükerrer aday, tarih doğrulama, audit, sürüm kontrolü, yakın/veli ve yasal temsil (Görev 1) — testli. |
| VD-005 Ajanda ve kaynaklar | **tamamlandı** (ilk kapsam) | Çakışma (AT-03), çalışma saatleri, kapatma (eşzamanlılık testli), işlem türü, hekim/koltuk yönetimi, gün+hafta görünümü, mobil liste ✔. Açık: sürükle-bırak taşıma, ay görünümü, bekleme listesi (VİA Denge, P1). |
| VD-006 Anamnez ve klinik not | **kısmi** | Sürümlü anamnez + hekim onayı + kritik uyarı ✔, yalnız-ekleme not + düzeltme ✔, notun ziyarete bağlanması ✔ (Görev 2). Açık: soru setinin klinisyen onayı, taslak otomatik kaydı. |
| VD-007 Plan ve odontogram | **tamamlandı** (ilk kapsam) | Özgün odontogram (FDI, daimi/süt/karma, yüzey seçimi), bulgu + tanı (gerekçeli durum geçmişi), katalog + sürümlü/hekime özel tarife, plan → teklif → karar → yeni sürüm; kabul edilen sürüm API ve DB'de değişmez (AT-05 testli). Açık: tanı kod sistemi (ADR-023), klinik içeriğin hekim onayı, plan PDF/teklif çıktısı (Görev 4), seans → randevu otomatik önerisi. |
| VD-008 Gerçekleşen işlem ve hesap | **tamamlandı** (ilk kapsam) | Ziyarete bağlı gerçekleşen işlem, bedel snapshot'ı, kuruş yuvarlaması, gerekçeli iptal/düzeltme ✔; işlem aynı transaction'da hasta alacağı üretir, iptal/düzeltmede alacak iptal + dağıtım ters kaydı ✔ (Görev 3). |
| VD-009 Ödeme, dağıtım, iade | **tamamlandı** (ilk kapsam, TRY) | Alacak/ödeme/dağıtım/avans/iade/kasa/gider ayrı; idempotency; DB tutar tetikleyicileri; eşzamanlı dağıtım; AT-06..AT-10, AT-19 gerçek DB'de testli. Açık: iade ikinci onay eşiği, banka/POS mutabakatı, makbuz/e-belge (Görev 5), ticari indirim/alacak düzeltmesi kaydı, çoklu para birimi davranışı. |
| VD-010 VİA Akış / Net / İz | **kısmi** | Akış (7 tür: geciken geliş, teyit, eksik iletişim, kapatma çakışması, anamnez onayı, randevusuz kabul edilmiş plan, yanıtsız teklif; dedupe, otomatik kapanış, rol/hassasiyet filtresi) ✔; İz (hasta bazlı, maskeli, rol kontrollü) ✔; Net: hasta hesabı (açılabilir toplamlar, hareket defteri, mutabakat), klinik özeti (işlem ≠ tahsilat), bakiyeler + yaşlandırma, kasa, gider, prim tahakkuku ✔ (Görev 3). |
| VD-011 Dosya ve belge sürümü | **tamamlandı** (ilk kapsam) | Belge türü / şablon sürümü / hasta belgesi / onay isteği / kanıt ayrı; SHA-256; AT-14 ✔. Özel depo, yükleme ≠ seçme, tarama portu (temel + clamd), karantina, erişim izi; AT-11 ✔. Açık: üretimde ClamAV kurulumu, S3 adaptörü, saklama/imha işi, PDF çıktısı, görüntüleyici, uzaktan onay kanalı (Görev 5). |
| VD-012 Outbox ve entegrasyon merkezi | **tamamlandı** (MOCK kapsamı; gerçek sağlayıcılar **engelli**) | Port/adapter, MOCK SMS + online ödeme, dış iş kuyruğu (idempotency, retry/backoff, dead-letter, zaman aşımı → durum sorgusu/mutabakat), imzalı webhook (tekrar, ters sıra, replay, geçersiz imza), dört göz onay kapısı, canlı gönderim kapısı, VİA Köprü ekranı; AT-12/AT-13 testli (Görev 5). Gerçek SMS/WhatsApp/ödeme/e-belge/DHBS adaptörü: yetkili doküman + test erişimi bekliyor. |
| VD-013 Laboratuvar ve prim | **kısmi** | Tahsilat bazlı prim tahakkuku + ters prim + sürümlü kural (Görev 3) ✔. Laboratuvar, tedavi bazlı prim, prim ödemesi Görev 6. |
| VD-014 İçe aktarma ve pilot | açık | Görev 7 |

## Tamamlanan iş paketi: Görev 1 (22.10.2026)
Çalışma saatleri (T05), kapatma (T06), işlem türü (T04), hekim/koltuk yönetimi (T14), yakın/veli (H03), sürümlü anamnez (H07), davet ve rol değişikliği (T20), haftalık ajanda. Testler: API 61, E2E 12 (bkz. `verification.md`).

## Tamamlanan iş paketi: Görev 2 (22.10.2026)
VD-007 tamamlandı (ilk kapsam), VD-008 kısmi (hesap Görev 3). H04, T01, T02, T03 çalışıyor; H05, H08, R04 kısmi. ADR-021…026. Testler: API 78, E2E 18 (bkz. `verification.md`).

## Tamamlanan iş paketi: Görev 3 (22.10.2026)
VD-008 ve VD-009 tamamlandı (ilk kapsam, TRY), VD-013 kısmi (prim tahakkuku). H06, R02, R11, T07 çalışıyor; O03, R01, R20, T08, T09, T12 kısmi. ADR-027…031. Testler: API 99, E2E 22.

## Tamamlanan iş paketi: Görev 4 (23.10.2026)
VD-011 tamamlandı (ilk kapsam). H11, H15 çalışıyor; H10, H13, A02, A03, R14, R22 kısmi; Ek B 43 başlık VİADENT türüne eşlendi (kısmi), B03/B43 uygulanmayacak. VİA Hazır temeli (P1), iletişim tercihi, MOCK mesaj. ADR-032…036. Testler: API 117, E2E 28.

## Tamamlanan iş paketi: Görev 5 (23.10.2026)
VD-012 tamamlandı (MOCK kapsamı). R24 kısmi (online ödeme isteği ≠ tahsilat, MOCK), R14 kısmi sürüyor (gerçek sağlayıcı yok); E01/E02/E03 engelli kalır (gerekçe VİA Köprü ekranında). AT-13 geçti, AT-12 sağlayıcı bildirimiyle genişledi. ADR-037…040. Testler: API 135, E2E 32.

## Sıradaki tek iş paketi
**Görev 6 — Operasyon ve raporlar (VD-013, V08/V09):** laboratuvar iş emri, revizyon, teslim ve maliyet; sürümlü hekim primi ve iade ters primi (tahakkuk var, tedavi bazlı prim ve prim ödemesi açık); filtreli temel raporlar ve kaynağa iniş; stok gerekiyorsa lot/birim/hareket (miktar doğrudan ezilmez); Ek A rapor ve tanımlama ID'leri traceability'de tek tek; rapor toplamları alt kayıtlarla mutabık testli. Prompttaki Görev 6 metniyle başlat.

## Küçük açık işler
- VİA Köprü: gerçek sağlayıcı adaptörleri (seçim + sözleşme + sandbox + webhook dokümanı geldikçe; her biri için sözleşme testi MOCK testleriyle aynı senaryoları geçmeli).
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
- VİA Akış finans görevleri (vadesi geçmiş borç, dağıtılmamış avans) — `via_net.changed` olayı hazır.
- `<input type="date">` başlık biçimi tarayıcı yerel ayarına bağlı (headless Chromium'da aa/gg/yyyy); özel tarih seçici.
- Tanı kod sistemi seçimi (lisans + klinisyen onayı) ve bulgu/katalog içeriğinin pilot hekimle doğrulanması.
- Plan kalemini düzenleme çekmecesi (API'de `PATCH /plan-items/:id` var; arayüz şimdilik sil + yeniden ekle).
- Gerçekleşen işlem düzeltmesi için arayüz (API var; arayüzde yalnız iptal).
- Odontogramda planlı/gerçekleşen yüzeylerin ayrı katman olarak boyanması (şimdilik sembol).
- `plan_decision_pending` eşiğini (3 gün) klinik ayarına taşıma.
- CI (GitHub Actions: PostgreSQL servisiyle `pnpm test`).
- Randevu oluşturmada Idempotency-Key (çift tık zaten arayüzde engelli; ağ tekrarına karşı).
- VİA Akış eşiklerini klinik ayarına taşıma.
- Randevu sürükle-bırak taşıma (sunucu reddederse eski konuma dönüş) ve ay görünümü.
- Anamnez soru setinin pilot hekimle gözden geçirilmesi (klinik içerik onayı).
- Davet e-postası: sağlayıcı seçilince Görev 5 outbox üzerinden.
- Çok bloklu çalışma günü için arayüz (API destekliyor; ekran gün başına tek blok düzenliyor).
- Giriş hız sınırını DB'ye taşıma (ADR-007).
- AT-19 tam senaryosu (rapor) Görev 3/6; gün sınırı birim testi var.
- Tarayıcı yerel ayarında `<input type="date">` biçimi işletim sistemine bağlı; özel tarih seçici değerlendirilecek.
