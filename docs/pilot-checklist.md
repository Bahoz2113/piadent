# Pilot kontrol listesi (F5 — kontrollü pilot, tek klinik)

Plan F5: “Seçilmiş klinikte eğitim, paralel kontrol, veri mutabakatı.” Her madde **isimli bir sorumlu** ve tarihle işaretlenir. ☐ açık · ☑ tamam (kanıt bağlantısıyla) · ✖ uygulanmayacak (gerekçeyle). Durum 23.10.2026 itibarıyla yazılım tarafında doğrulananlar ☑ olarak işaretlidir; geri kalan her şey açıktır.

## 1. Hukuk ve sözleşme (gerçek veriden ÖNCE)
- ☐ Veri işleme sözleşmesi (klinik veri sorumlusu, VİADENT veri işleyen); alt işleyenler listesi (barındırma, yedek konumu, e-posta)
- ☐ KVKK: veri envanteri, aydınlatma metni, sağlık verisi işleme şartı değerlendirmesi, yurt dışı aktarım durumu
- ☐ Saklama/imha süreleri (kayıt türü bazında, danışmanla); içe aktarma satır verisinin silinme zamanı
- ☐ Veri sahibi başvuru süreci (kimlik doğrulama, kapsam, yasal saklama gerekçesi) — teknik araç ☑ (Hasta 360 → Veriyi indir, gerekçeli, denetimli)
- ☐ Hizmet sözleşmesi: destek saatleri, kesinti bildirimi, pilot süresi, çıkışta veri iadesi (açık JSON ☑) ve silme
- ☐ Güncel resmî kapsam teyidi (DHBS/SBYS 13.08.2026 değişikliği) — pilot klinikte hangi resmî gönderimin eski sistemde/elle devam edeceği yazılı

## 2. Altyapı ve güvenlik
- ☐ Üretim barındırma: TLS, ayrı DB sunucusu, şifreli disk, secret manager, ≥2 API süreci
- ☐ `VIADENT_REQUIRE_MFA_ROLES=clinic_admin,finance` (yazılım ☑ testli), `VIADENT_EXTERNAL_SEND_ENABLED=false`
- ☐ ClamAV (`CLAMD_HOST`) ve imza güncellemesi
- ☐ Saatlik şifreli yedek + günlük izole geri yükleme doğrulaması zamanlandı; ikinci konuma kopya (araç ☑ `db:backup`, `db:restore-verify`)
- ☐ İzleme ve alarm: sağlık, 5xx, p95, disk, yedek yaşı, dead-letter
- ☐ Bağımsız sızma testi; yüksek bulgular kapandı
- ☐ Paylaşılan hız sınırlayıcı (çok süreç) veya ters vekilde sınır
- ☑ Bağımlılık taraması 0 bilinen açık (23.10.2026) — her sürümde tekrar

## 3. Klinik içerik ve kurallar
- ☐ Anamnez soruları, kritik uyarılar — pilot hekim onayı (şu an DEMO)
- ☐ Bulgu/tanı listesi ve tanı kod sistemi kararı (ADR-023)
- ☐ İşlem kataloğu + tarife (kliniğin gerçek fiyatları) — Yönetim → Katalog ve tarife
- ☐ Belge/onam metinleri: klinik + hukuk onayı; onaylanmayan şablon kullanılmaz
- ☐ Finans: KDV gösterimi, yuvarlama, prim kuralı ve kesinti sırası, iade belgesi — mali müşavir onayı
- ☐ VİA Akış eşikleri (teyit süresi, gecikme) kliniğe göre gözden geçirildi

## 4. Veri taşıma (runbook §3)
- ☐ Kliniğin kaynak dışa aktarım dosyası (şifreli kanal) ve alan eşleme tablosu
- ☐ İzole ortamda prova: satır mutabakatı + açılış bakiyesi toplamı kaynak raporuyla aynı (araç ☑ AT-16)
- ☐ Hatalı satırlar kliniğe döndü, düzeltildi
- ☐ Üretim aktarımı öncesi yedek (G1) ve doğrulaması
- ☐ 20 hastalık örneklem karşılaştırması imzalandı
- ☐ Randevu/tedavi/ödeme geçmişi aktarımı kapsam kararı (bu sürümde yok; eski sistem salt okunur referans olarak kalır mı?)

## 5. Kullanıcılar ve eğitim
- ☐ Kullanıcı listesi ve roller (yönetici, hekim, asistan, sekreter, finans); davetler gönderildi
- ☐ Yönetici ve finans MFA kurdu (Hesabım)
- ☐ Rol bazlı eğitim (≈ 1 sa sekreter: Bugün/ajanda/hasta/tahsilat; hekim: Tedavi/anamnez/not; finans: kasa/gün sonu/prim; yönetici: ekip/katalog/belge/veri aktarımı)
- ☐ Kısa başvuru kartı: “sistem çalışmazsa ne yapılır” (kâğıt randevu listesi, sonra giriş)

## 6. Kabul ve ölçüm
- ☐ Klinik kullanıcı kabul senaryoları (rol başına 5–8 gerçekçi akış) imzalandı
- ☐ Tablet ve ekran okuyucuyla elle erişilebilirlik kontrolü (AT-18 kalanı)
- ☐ Paralel dönem (öneri 2 hafta): her gün sonu tahsilat/kasa toplamı iki sistemde karşılaştırıldı, fark yok veya açıklandı
- ☐ Pilot ölçümleri için başlangıç değerleri (Plan: kazanım yüzdesi ölçülmeden iddia edilmez)
- ☑ Performans hedefi sentetik veride ölçüldü (`performance.md`) — üretim topolojisinde tekrar ☐

## 7. İşletim ve geri dönüş
- ☐ Yayın sahibi, rollback kararı verici, teknik uygulayıcı, destek/nöbet — isimli
- ☐ Rollback provası (uygulama geri dönüşü + G0 geri yükleme) süreli yapıldı (araç ☑ `restore-verify --keep`)
- ☐ Destek kanalı ve yanıt süresi; destek personelinin müşteri verisine erişim kuralı (şimdilik yalnız ekran paylaşımı)
- ☐ Olay müdahale ve KVKK ihlal değerlendirme akışı (hukukla)

**Pilot başlatma kararı:** §1 tamamı, §2 ilk 6 madde, §3 kullanılacak içerik, §4, §5 ilk 3 madde ve §7 ilk 2 madde ☑ olmadan pilot **başlamaz**.
