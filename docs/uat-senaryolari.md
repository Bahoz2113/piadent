# Kullanıcı kabul senaryoları (UAT) — pilot klinik (Görev 13)

`pilot-checklist.md` §6 “Klinik kullanıcı kabul senaryoları (rol başına 5–8 gerçekçi akış) imzalandı” maddesinin çalışma belgesi. Her senaryo **gerçek klinik kullanıcısı** tarafından, **sentetik demo verisiyle** (gerçek hasta verisi veri işleme sözleşmesinden önce girilmez) koşulur; sonuç sütunu **Geçti / Geçmedi / Yorum** olarak doldurulur ve sayfa altı imzalanır. Her senaryonun otomatik karşılığı (E2E/API testi) referans olarak yazıldı: otomatik test **geçmiş olsa bile** klinik kullanıcı kabulü ayrıdır — amaç “işe uygun mu” sorusudur, “çalışıyor mu” değil.

Kabul ölçütü: bir rolün senaryolarının **tamamı** Geçti ya da gerekçeli Yorum (ürün sahibi kararıyla kabul) olmadan o rol için pilot açılmaz. Geçmedi → backlog'a madde, yeniden koşu.

Ortam: üretim benzeri kurulum (`deployment.md`), sentetik seed (`pnpm db:seed`), `VIADENT_EXTERNAL_SEND_ENABLED=false`, hesaplar `.demo-credentials`. Tarihler gg.aa.yyyy, saatler 24 sa, klinik saat dilimi.

| Sütun | Anlam |
|---|---|
| Adım | Kullanıcının yaptığı |
| Beklenen | Ekranda görülmesi gereken sonuç (hangi ekran, hangi yazı) |
| Otomatik karşılık | Aynı davranışı doğrulayan test dosyası |
| Sonuç / imza | Kullanıcı doldurur |

## S — Sekreter (sekreter@demo-yesil.test)
| # | Senaryo | Adım | Beklenen | Otomatik karşılık | Sonuç / imza |
|---|---|---|---|---|---|
| S1 | Yeni hasta kaydı ve mükerrer uyarısı | Hastalar → Yeni hasta: ad, soyad, doğum tarihi (gg.aa.yyyy yazarak), telefon → Hastayı kaydet. Aynı ad + doğum tarihiyle ikinci kez dene | İlk kayıt Hasta 360'a açılır; ikinci denemede “Mükerrer aday … Farklı kişi, yine de kaydet” görünür, kaydetmek bilinçli ikinci tıklama ister | `critical-flow.spec.ts`, `scheduling-patients.test.ts` | |
| S2 | Hasta arama (Türkçe karakter, telefon, dosya no) | Arama kutusuna “ayse yilmaz”, sonra telefonun son 4 hanesi, sonra dosya no | Türkçe karaktersiz yazım aynı sonucu verir; telefon/dosya no ile tek satır | `gorev1.spec.ts`, `security.test.ts` (maskeli telefon) | |
| S3 | Randevu verme ve çakışma | Hasta 360 → Randevu ver → hekim, tarih (takvimden), saat → Kaydet. Aynı hekime aynı saate ikinci randevu dene | İkinci randevu “çakışma” uyarısıyla reddedilir; çalışma saati dışı saat için ayrı uyarı | `gorev1.test.ts` (AT-03), `gorev11.spec.ts` (DateField) | |
| S4 | Günün akışı: Bugün ekranı ve PİA Akış görevleri | Bugün → “Geciken randevu” görevi (randevu saati ≥ eşik dk geçmişse) → hastayı Geldi işaretle | Görev kapanır; ajandada durum “Geldi”; yönetici eşiği değiştirince (Yönetim → Güvenlik → PİA Akış eşikleri) görev zamanı değişir | `gorev13.test.ts` (ADR-073), `gorev1.test.ts` | |
| S5 | Yarınki randevu teyidi | Bugün → “Yarınki randevu teyidi” görevi → iletişim sonucu “Bilgilendirildi” | Görev kapanır; randevu kartında iletişim sonucu görünür; **gerçek SMS gitmez** (MOCK etiketi) | `gorev1.test.ts`, `gorev5.spec.ts` | |
| S6 | Tahsilat ve makbuz yerine kayıt | Hasta 360 → Finans → Ödeme al (nakit, tutar) → kaydet; iki kez tıkla | Tek ödeme kaydı (idempotency); bakiye düşer; “makbuz/e-belge” olmadığı ekranda açık | `gorev3.test.ts` (AT-06…AT-10) | |
| S7 | Kontrol (follow-up) ve hatırlatma | Hasta 360 → Kontrol ekle (tarih gelecekte) | Kontrol listede; vadesi gelince Bugün'de görev | `gorev4.test.ts`, `gorev4.spec.ts` | |
| S8 | Geçmiş randevu aktarımı sonrası geçmiş görünümü | Hasta 360 → Randevular: önceki sistemden aktarılan “Tamamlandı” randevular | Tarih/saat/hekim doğru; iptal olanlar “İptal” ve aktarım gerekçesiyle | `gorev13.spec.ts`, `gorev13.test.ts` (ADR-072) | |

## H — Hekim (elif.aras@demo-yesil.test)
| # | Senaryo | Adım | Beklenen | Otomatik karşılık | Sonuç / imza |
|---|---|---|---|---|---|
| H1 | Anamnez alma ve sürüm | Hasta 360 → Anamnez → doldur → kaydet → bir yanıtı değiştir → kaydet | İki sürüm; eski sürüm salt okunur; kritik uyarı (alerji vb.) kartta görünür | `gorev1.test.ts` | |
| H2 | Odontogram bulgu ve tanı | Tedavi → diş seç (FDI) → bulgu → tanı serbest metin | Bulgu dişte sembolle; tanı kaydı; kod sistemi olmadığı (ADR-023) ekranda | `gorev2.test.ts`, `gorev2.spec.ts` | |
| H3 | Tedavi planı → teklif → kabul (AT-05) | Plan oluştur, kalem ekle → Teklif sun → sekreter/hasta kabul → yeni sürüm dene | Kabul edilmiş sürüm değişmez; değişiklik yeni sürüm açar | `gorev2.test.ts` (AT-05) | |
| H4 | Gerçekleşen işlem ve alacak | Ziyarette işlem “tamamlandı” → Finans sekmesi | Alacak otomatik oluşur (snapshot fiyat); tahsilat ayrı | `gorev3.test.ts` | |
| H5 | Klinik not ve dosya (röntgen) | Not yaz; PNG yükle → tarama sonrası indir | Not yalnız sağlık yetkili rollere görünür; dosya taranmadan indirilemez; “silindi” dosya 30 gün sonra içerik imhası | `gorev4.test.ts` (AT-11), `gorev12.test.ts` | |
| H6 | Laboratuvar iş emri | Hasta 360 → Laboratuvar → iş emri → gönder → teslim → kabul/revizyon | Aşamalar sırayla; iş föyü yazdırılır; maliyet yalnız yönetici/finansta | `gorev6.test.ts`, `gorev6.spec.ts` | |
| H7 | Kendi raporları | Raporlar → Tedavi | Yalnız kendi işlemleri; başka hekim süzgeci yok | `gorev6.test.ts` (rapor izinleri) | |

## F — Finans (finans@demo-yesil.test)
| # | Senaryo | Adım | Beklenen | Otomatik karşılık | Sonuç / imza |
|---|---|---|---|---|---|
| F1 | Gün sonu kasa | Finans → Kasa raporu (bugün) | Toplam = alt satırlar toplamı; eski sistemle paralel karşılaştırma için CSV | `gorev3.test.ts` (AT-19), `gorev6.test.ts` (rapor toplamı) | |
| F2 | İade (ters kayıt) | Bir ödemeye iade → tutar → gerekçe | Ödeme silinmez, iade satırı; bakiye güncel; denetimde iz | `gorev3.test.ts` (AT-09) | |
| F3 | Açılış bakiyesi aktarımı mutabakatı | Yönetim → Veri aktarımı → açılış bakiyesi CSV → ön kontrol → toplam kutuları | Kaynak toplam = geçerli + hatalı + mükerrer + daha önce; onay sonrası DB toplamı aynı | `gorev7.test.ts` (AT-16) | |
| F4 | Hekim primi | Finans → Prim → dönem → Prim öde | Tahakkuk/ters/net; ödeme bakiyeyi aşamaz | `gorev6.test.ts` | |
| F5 | Tedarikçi carisi | Operasyon → Tedarikçiler → fatura + ödeme | Bakiye; ters kayıt; döküm | `gorev6.test.ts` | |
| F6 | MFA zorunluluğu | Hesabım → iki adımlı doğrulama kur; kurtarma kodlarını sakla; bir kodla giriş | Kurtarma kodu tek kullanımlık; Hesabım'da kalan kod uyarısı | `gorev10.spec.ts`, `gorev10.test.ts` | |

## Y — Klinik yöneticisi (yonetici@demo-yesil.test)
| # | Senaryo | Adım | Beklenen | Otomatik karşılık | Sonuç / imza |
|---|---|---|---|---|---|
| Y1 | Ekip daveti ve rol | Yönetim → Ekip → davet (sekreter) → davet bağlantısıyla kabul | Yeni üye yalnız rolünün izinleriyle; erişim kaldırınca anında düşer (AT-20) | `permissions-session.test.ts`, `gorev1.spec.ts` | |
| Y2 | Katalog ve tarife | Yönetim → Katalog → yeni tarife sürümü (geçerlilik tarihi takvimden) | Eski planlar eski fiyatla kalır (snapshot) | `gorev2.test.ts` | |
| Y3 | Hasta kartı aktarımı (prova) | Veri aktarımı → hasta CSV → sütun eşlemesi (tanınmayan başlık elle) → ön kontrol → hatalı satır CSV → düzelt → onay → geri al | Hiçbir şey ön kontrolde yazılmaz; aynı dosya tekrar yüklenince yeni kayıt açılmaz; geri alma işlem görmüş kaydı reddeder | `gorev7.spec.ts`, `gorev12.spec.ts`, `gorev13.spec.ts` | |
| Y4 | Güvenlik politikası ve destek erişimi | Güvenlik → finans için MFA zorunlu; destek erişimi ver (ikinci yönetici onaylar) | Finans MFA kurmadan klinik verisine giremez; destek hesabı salt okunur ve süresi dolunca düşer | `gorev10.test.ts`, `gorev11.test.ts` | |
| Y5 | PİA Akış eşikleri | Güvenlik → eşikleri kliniğe göre ayarla (örn. geciken geliş 15 dk) | Denetim kaydı; görevler yeni eşikle | `gorev13.spec.ts` | |
| Y6 | Klinik dışa aktarım ve veri sahibi talebi | Dışa aktarım → gerekçe → JSON; Hasta 360 → Veriyi indir | Dosyada sır yok; sağlık yetkisi yoksa sağlık bölümleri atlanır; denetimde iz | `gorev7.test.ts` | |
| Y7 | Raporlar ve kaynağa iniş | Raporlar → İşletme özeti → bir metrikten kaynak rapora | Toplamlar alt satırlarla tutar; CSV yalnız yönetici/finans | `gorev6.test.ts`, `scripts/perf/reports.mjs` (süre) | |
| Y8 | Denetim izi | Yönetim → Denetim: kimlik no açma, parola sıfırlama, destek verme kayıtları | Kim/ne zaman/gerekçe; kişisel veri maskeli | `gorev9.test.ts`, `gorev11.test.ts` | |

## Ortak (tüm roller)
| # | Senaryo | Beklenen | Otomatik karşılık | Sonuç / imza |
|---|---|---|---|---|
| O1 | Telefon (360 px) ve klavye ile ana akışlar | Yatay kaydırma yok; her düğmeye klavyeyle ulaşılır; takvim ok tuşlarıyla | `*.spec.ts` telefon-360 projesi, `erisilebilirlik.spec.ts` (axe) | |
| O2 | Oturum: boşta 90 dk sonra düşer; “diğer oturumları kapat” | Yeniden giriş istenir; diğer cihaz düşer | `gorev9.test.ts` | |
| O3 | Yanlış parola 5+ kez | Yavaşlama, sonra 15 dk kilit; doğru parola kilidi beklemez (hesap kilidi 20) | `gorev11.test.ts` (ADR-065), `security.test.ts` | |
| O4 | Ekran okuyucu ile (NVDA/VoiceOver) giriş, hasta arama, randevu verme | Her alanın adı okunur; hata mesajları duyurulur | **Elle** (AT-18 kalanı; otomatik karşılığı yok) | |

## İmza
| Rol | Ad Soyad | Tarih | Geçti/Toplam | İmza |
|---|---|---|---|---|
| Sekreter | | | /8 | |
| Hekim | | | /7 | |
| Finans | | | /6 | |
| Yönetici | | | /8 | |
| Ürün sahibi (onay) | | | | |
