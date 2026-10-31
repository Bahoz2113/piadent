# Karar kayıtları (ADR)

Biçim: bağlam → karar → sonuç. “VİADENT tasarım kararı” olarak işaretlenen her şey rakipte gözlenmiş davranış değildir.

## ADR-001 Modüler monolit, TypeScript yığını (22.10.2026)
Boş depo; plan Next.js + NestJS + PostgreSQL + worker öneriyor. **Karar:** pnpm workspace monorepo; `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`, `packages/db`. Mikroservis yok. **Sonuç:** iş kuralları tek API'de; worker aynı `packages/db` kodunu kullanır.

## ADR-002 Sürüm sabitleme: olgun majör hatlar
22.10.2026'da npm'de Next 16.4, NestJS 12.2, TypeScript 7.0 en yeni. Nest dekoratör/DI ekosistemi ve TS 7 (yerel derleyici) uyumu bu oturumda doğrulanamadı. **Karar:** desteklenen ve güncel yama alan hatlar sabitlendi: Next 15.5.28, NestJS 11.2.7, TS 5.9.3, React 19.1.10, Vitest 3.2.7. Lockfile commit'te. **Sonuç:** yükseltme ayrı ADR + tam test koşusuyla yapılır.

## ADR-003 Ham SQL migration + `pg`, ORM yok
RLS, exclusion constraint, kısmi tekil indeks ve transaction-local bağlam doğrudan SQL ile daha denetlenebilir. **Karar:** `packages/db/migrations/NNNN_*.sql`, checksum'lı çalıştırıcı; uygulanmış migration değiştirilemez (değişirse çalıştırıcı durur). **Sonuç:** tip güvenliği servis katmanında; ileride Kysely benzeri sorgu oluşturucu değerlendirilebilir.

## ADR-004 Tenant bağlamı ve RLS
**Karar:** tenant, oturumdaki aktif üyelikten çözülür; her istek transaction'ında `set_config('app.tenant_id', $1, true)`. RLS `ENABLE + FORCE`; üç ayrı DB rolü (owner/app/worker). Kimlik tabloları (`users`, `sessions`) RLS dışı ama hasta verisi içermez. **Sonuç:** bağlam olmadan sorgu 0 satır döner (testli); havuzda bağlam sızmaz (testli).

## ADR-005 Oturum: sunucu tarafı oturum + HttpOnly çerez + CSRF başlığı
JWT yerine iptal edilebilir sunucu oturumu (AT-20 için gerekli). Token 32 bayt rastgele, DB'de yalnız SHA-256. Çerez `HttpOnly; SameSite=Lax; Secure (üretim)`. Değiştiren isteklerde `x-viadent-request: 1`. Web ve API aynı origin (Next rewrite). MFA (yönetici/destek) Görev 7 öncesi.

## ADR-006 Eski sekme koruması (AT-15)
**Karar:** istemci sayfa yüklendiğindeki üyelik kimliğini `x-viadent-context` ile gönderir; sunucu aktif üyelikle uyuşmazsa 409 `CONTEXT_CHANGED`. Klinik değişince istemci tam sayfa yeniden yüklenir (bellek önbelleği temizlenir). **VİADENT tasarım kararı.**

## ADR-007 Giriş hız sınırı bellek içi
Tek süreç için 15 dk'da 5 hatalı deneme / e-posta+IP. Çok örnekli dağıtımda paylaşılan depoya (PostgreSQL tablosu) taşınacak — Görev 7 öncesi açık iş.

## ADR-008 Kimlik numarası saklama
TCKN/pasaport düz metin sütunda; API'de role göre maskeli; audit'e maskeli yazılır; RLS ile izole. TCKN için yalnız algoritmik biçim kontrolü (resmî doğrulama değil). **Açık:** sütun düzeyinde şifreleme + arama için HMAC — pilot öncesi güvenlik incelemesinde karar verilecek.

## ADR-009 Mükerrer hasta politikası
Telefon benzersiz anahtar değildir (aile ortak numara → yalnız bilgi uyarısı). Engelleyen durumlar: aynı kimlik no (409 `DUPLICATE_IDENTITY`). Onay isteyen durumlar: benzer ad (trigram ≥ 0.6) + aynı doğum tarihi veya aynı ad + aynı telefon (409 `DUPLICATE_CANDIDATES`, `acknowledgeDuplicates: true` ile bilinçli kayıt). **VİADENT tasarım kararı**; eşikler pilot hekim/sekreterle sınanacak (Ek C).

## ADR-010 VİA Akış ilk görev türleri
Kaynak envanterde görev listesi yok; tasarım bizim. İlk türler: geciken geliş (10 dk), yarınki teyit, eksik iletişim. Başlıkta hasta adı saklanmaz (okuma anında birleştirilir). Eşikler klinik ayarına taşınacak (Görev 1).

## ADR-011 Klinik not ilk dilimi
AT-02 ve VD-006 başlangıcı için yalnız-ekleme klinik not + gerekçeli düzeltme bağı. Ziyaret bağı, taslak otomatik kaydı, anamnez sürümleri Görev 1. Demo içerik sentetik.

## ADR-012 Arayüz yazı tipi ve ikonlar
Lisans doğrulanmadan web fontu gömülmedi; sistem yazı tipi yığını (Segoe UI / system-ui / Roboto / Noto Sans) Türkçe glifleri destekliyor. İkonlar `lucide-react` (ISC). Lisansı doğrulanmış bir font (ör. OFL) yerel olarak barındırılarak eklenebilir.

## ADR-013 Henüz geliştirilmemiş modüllerin gösterimi
Operasyon/Raporlar menüde “Plan” etiketiyle (Tedavi Görev 2, Finans Görev 3 ile etiketten çıktı); sayfada gerçek durum ve planlanan kapsam yazılı. Sahte rakamlı “hazır” ekran gösterilmez (Plan §09).

## ADR-014 Seed parolası
Parola koda/seed'e gömülmez. `VIADENT_DEMO_PASSWORD` yoksa rastgele üretilir ve git dışı `.demo-credentials` dosyasına (0600) yazılır. Test veritabanı ayrı (`viadent_test`) ve yalnız testte kullanılan sentetik parolayla kurulur.

## ADR-015 Çalışma saati politikası (Görev 1)
Hekimin haftalık blokları (ISO haftagünü, dakika). Randevu bir bloğa tam sığmıyorsa 422 `OUTSIDE_WORKING_HOURS` + o günün blokları döner; kullanıcı **bilinçli onayla** (`allowOutsideHours`) kaydedebilir, audit'e `outside_working_hours` yazılır. Hiç blok tanımlanmamış hekimde kısıt yoktur (yönetim ekranında “Tanımsız” görünür). Gece yarısını aşan randevu çalışma saati dışıdır. **VİADENT tasarım kararı** (kaynakta yalnız menü görüldü).

## ADR-016 Kapatma ve eşzamanlılık
Kapatma (klinik/hekim/koltuk, gerekçe zorunlu) **aşılamaz**: 422 `RESOURCE_CLOSED`. Mevcut randevuları silmez/taşımaz; çakışanlar yanıt olarak döner ve VİA Akış'a `closure_conflict` görevi düşer, kapatma iptal edilince veya randevu taşınınca görev kendiliğinden kapanır. Kapatma ile randevu oluşturma aynı tenant için `pg_advisory_xact_lock` ile sıralanır: aynı anda yapılan iki işlemde randevu ya reddedilir ya da çakışan listesinde görünür (testli).

## ADR-017 Yakın / veli / yasal temsil
Yakınlık kaydı yetki vermez. `is_legal_representative` yalnız dayanak açıklaması ile işaretlenebilir; işaretleyen kullanıcı ve zaman doğrulayan olarak saklanır (DB check). İlişki silinmez, gerekçeyle sonlandırılır. 18 yaş altı hastada doğrulanmış temsilci yoksa başlıkta uyarı. Belge yükleme Görev 4. Portal erişimi (hasta/yakın rolü) P1.

## ADR-018 Sürümlü anamnez
Her kayıt yeni sürüm (`anamnesis_versions`, uygulama rolüne UPDATE yetkisi yok). Yanıt: yanıtsız (kayıt yok) / hayır / evet (+ayrıntı) / bilmiyor. Kritik işaretler sunucuda hesaplanır (istemci gönderemez) ve **yalnız sağlık yetkili rollere** döner — sekreter/yönetici varlığını da görmez. Hekim kaydı otomatik onaylı; asistan kaydı `anamnesis_review` klinik görevi açar. Eski temelle kayıt 409. Yanıt içerikleri audit'e yazılmaz. **Soru seti DEMO'dur** (`demo-2026.10`); rakip formu kopyalanmadı; klinisyen onayı açık iş.

## ADR-019 Ekip daveti
E-posta sağlayıcısı yok → mesaj gönderilmez. Davet 32 bayt rastgele token, DB'de yalnız SHA-256; 72 saat, tek kullanımlık, açık davet e-posta başına tekil. Bağlantı yalnız oluşturma yanıtında bir kez gösterilir; yönetici güvenli kanaldan iletir. Oturumsuz kabul için dar bir `SECURITY DEFINER` fonksiyonu (`app.invitation_tenant`) yalnız token→tenant eşlemesi yapar; gerisi RLS altında. Mevcut hesap kendi parolasıyla kabul eder (hesap sahipliği kanıtı); kaldırılmış üyelik yeniden etkinleşir. Rol değişikliği kendine uygulanamaz.

## ADR-020 Mobil hesap ve klinik seçici
Telefonda üst çubuktaki kullanıcı/rol/klinik seçici gizliydi; çok klinikli kullanıcı telefonda klinik değiştiremiyordu. Gezinme çekmecesine hesap bloğu ve klinik seçici eklendi.

## ADR-021 Diş modeli ve özgün odontogram (Görev 2)
Numaralama **FDI / ISO 3950** (iki haneli; uluslararası standart, lisans gerektirmez). Daimi (11–48) ve süt (51–85) dişler; yüzeyler M, D, O (arka) / I (ön), B, L — dişe göre geçerli yüzey kümesi sunucuda doğrulanır. Konum türleri: `tooth` (+yüzey), `quadrant`, `arch`, `mouth`; işlemin `tooth_scope` alanı hangi konumun zorunlu olduğunu belirler (dişsiz işlemler: temizlik tüm ağız, flor çene vb.). Bulgu (mevcut durum), tanı, planlı kalem ve gerçekleşen işlem **ayrı tablolardır**; biri diğerini ezmez. Odontogram çizimi VİADENT'e özgü SVG'dir (kare + 5 bölge, üst çenede vestibül üstte, meziyal orta hatta doğru); bilgi renk + desen + kısa sembol + erişilebilir ad (`aria-label`) ile verilir. Kaynak envanterde odontogram **ekranı görüldü**; çizimi, renkleri ve sembolleri kopyalanmadı. Bulgu türleri ve semboller **DEMO** listedir; pilot hekimle doğrulanacak.

## ADR-022 İşlem kataloğu ve sürümlü tarife
Katalogda kod ve konum kapsamı oluşturulduktan sonra değişmez (geçmiş planlar bu tanıma dayanır; değişiklik = yeni işlem). Tarife sürümü: taslak → yayında → yürürlükten kalktı. Yayınlanan tarifenin kalemleri ve başlığı DB tetikleyicisiyle donar; fiyat değişikliği kopyala → yeni geçerlilik tarihi → yayınla ile yapılır. Fiyat arama: yalnız yayında olan, `valid_from ≤ tarih` olan en yeni sürüm; **hekime özel tarife aynı tarihteki genel tarifeden önceliklidir**. Plan kalemine fiyat **snapshot** olarak yazılır (tarife sürümü kimliğiyle); tarifede olmayan işlem için elle fiyat + zorunlu açıklama. Para DB'de `numeric(14,2)`, API'de "1250.00" metni, istemcide kuruş cinsinden `bigint` — kayan nokta yok. Kaynakta tarife ekranları yalnız **menü** olarak görüldü; bu davranış VİADENT tasarımıdır. Katalog ve fiyatlar sentetik DEMO'dur.

## ADR-023 Tanı kaydı: kod sistemi seçilmedi
Tanı = konum + serbest açıklama + isteğe bağlı kısa kod. **Resmî kod listesi (ICD-10, SNOMED CT vb.) eklenmedi ve böyle bir uyum iddia edilmez** — lisans/kaynak ve klinisyen onayı açık iş. Tanı ve bulgu silinmez; durum `active → resolved | entered_in_error` (bulguda `current → historic | entered_in_error`), gerekçe zorunlu, eden ve zaman saklanır. Audit tanı metnini taşımaz. Tanı ve odontogram yalnız `patient.health.read` rollerine görünür; sekreter plan ve teklifi görür, klinik haritayı görmez. Kaynak envanterde tanı ekranı **açılmadı** (yalnız menü); bu davranış rakip özelliği olarak sunulamaz, VİADENT tasarımıdır.

## ADR-024 Plan sürümü, teklif ve kabul (AT-05)
Plan → sürümler. Durumlar: taslak → teklif sunuldu → kabul / ret; ayrıca “yeni sürümle değişti” ve iptal. Yalnız taslak düzenlenir; teklif sunulan ve sonrası sürümlerin kalemleri ve fiyatları **DB tetikleyicisiyle** değiştirilemez (API atlatılsa bile). İzinli geçişler tetikleyicide tanımlı. Değişiklik isteği = mevcut sürümden snapshot'larla kopyalanan **yeni taslak sürüm**; eski kabul, yeni sürüm kabul edilene kadar geçerli kalır, sonra “yeni sürümle değişti” olur. Plan başına en fazla bir taslak ve bir kabul (kısmi tekil indeks). Karar kaydı (kabul / ret / kararsız) ayrı, yalnız eklenen tablodur; “kararsız” teklifi açık bırakır. Eşzamanlı iki kabul isteğinden biri 409 alır (plan satır kilidi; testli). Karar kaydı **hastanın beyanıdır, imzalı onam değildir** — onam/imza Görev 4. Kaynakta teklif/kabul akışı **görülmedi**; bu VİADENT tasarımıdır, rakip özelliği olarak sunulmaz.

## ADR-025 Gerçekleşen işlem ve yuvarlama
Gerçekleşen işlem **geliş kaydı yapılmış bir ziyarete** (checked_in / in_progress / completed randevu) bağlanmak zorundadır. Planlı kalem yalnız **kabul edilmiş** sürümden gerçekleştirilebilir; kalan adet aşılamaz. Bedel snapshot: kısmi gerçekleşmede `round(kalem_tutarı × adet / toplam_adet, 2)`, **son adet kalanı alır** — toplam her zaman kalem tutarına kuruşu kuruşuna eşittir (ör. 2999.99 = 1000.00 + 1000.00 + 999.99; testli). Plansız işlem tarifeden fiyatlanır. Kayıt silinmez: iptal (gerekçeli, kalan adet serbest kalır) veya düzeltme (eski kayıt `corrected`, yeni kayıt `corrects_id` ile bağlı). Hasta hesabına borç kaydı **Görev 3 (VİA Net)**; burada planlanan bedel gelir sayılmaz.

## ADR-026 Tedavi kaynaklı VİA Akış görevleri
İki yeni tür: `plan_unscheduled` (kabul edilmiş planda tamamlanmamış işlem var ve ileri tarihli randevu yok) ve `plan_decision_pending` (teklif 3 günden uzun yanıtsız). Kaynak koşul çözülünce görev kendiliğinden kapanır (randevu verildi / karar kaydedildi / plan tamamlandı). Eşik (3 gün) şimdilik sabit; klinik ayarına taşınacak. Tedavi takibi ekranı (`/tedavi`) bu listeleri gösterir; bedeller plan bedelidir, tahsilat değildir.

## ADR-027 VİA Net hesap modeli (Görev 3)
Alacak (`receivables`), ödeme (`payments`), dağıtım (`allocations`), iade (`refunds`), kasa hareketi (`cash_movements`) ve gider (`expenses`) **ayrı tablolardır**; bakiye saklanmaz, hareketlerden hesaplanır. **Açık borç = etkin alacaklar − dağıtımlar; avans = ödemeler − iadeler − dağıtımlar** — ikisi ayrı gösterilir, avans eksi borç olarak yazılmaz. Ödeme alacağa **yalnız açık dağıtımla** bağlanır (Plan §03 “ödeme borçla otomatik karıştırılmaz”); arayüz vadesi eski olandan başlayan bir dağıtım önerisi sunar ama kullanıcı onaylar. Hareketler silinmez/güncellenmez (uygulama rolünde UPDATE/DELETE yetkisi yok); düzeltme **ters kayıtla** yapılır: dağıtım ters kaydı negatif satır + `reverses_id`, gider ters kaydı negatif gider. Alacak tutarı değişmez; yalnız gerekçeli iptal (önce dağıtımlar otomatik ters kayda alınır, para avansa döner). Gerçekleşen işlem aynı transaction'da alacak üretir; işlem iptali/düzeltmesi bağlı alacağı iptal eder. Hasta hesabındaki her finans komutu `pg_advisory_xact_lock` ile sıralanır. Tutar sınırları (dağıtım ≤ ödemenin kullanılabilir tutarı, dağıtım ≤ alacağın açık bakiyesi, iade ≤ ödeme) **DB tetikleyicisinde satır kilidiyle** de denetlenir; API atlatılsa da aşılamaz. Satır kilidi UPDATE yetkisi istediği için kilit alan iki tetikleyici dar `SECURITY DEFINER` (sabit `search_path`) çalışır; sahip rol de FORCE RLS'e tabidir. **Tam yasal genel muhasebe iddiası yoktur**; denetlenebilir alt defterdir. Kaynakta ödeme ekranı görüldü ama kayıt/dağıtım/iade davranışı test edilmedi; bu kurallar VİADENT tasarımıdır.

## ADR-028 Para birimi: ilk kapsam TRY
Tüm tutarlar `numeric(14,2)`, API'de metin, istemcide kuruş `bigint`. Alacak ve ödemede özgün tutar/para birimi, kur, kur zamanı ve kaynak alanları **hazır ama boş**; `currency = 'TRY'` ve `original_currency is null` DB check kısıtıdır, API şeması da yalnız TRY kabul eder. Çoklu para birimi açıldığında yeni migration ile kısıt gevşetilir; geriye dönük kur değişimi önceki işlemi yeniden fiyatlamaz (snapshot).

## ADR-029 Idempotency ve iade algoritması
Finans komutları (ödeme, dağıtım, dağıtım ters kaydı, iade, elle alacak, gider, gider ters kaydı) `Idempotency-Key` başlığı ister (yoksa 428). Anahtar tenant + işlem türü + anahtar ile tekildir; ilk istek işlendikten sonra yanıtı **aynı transaction'da** saklanır. Aynı anahtar + aynı içerik → aynı yanıt (`Idempotent-Replayed: true`), yeni kayıt yok; aynı anahtar + farklı içerik → 409. Eşzamanlı aynı istekte ikinci istek birincinin commit'ini bekler ve saklı yanıtı döner (5 eşzamanlı istek → 1 kayıt, testli). İstemci anahtarı form açılınca bir kez üretir; ağ hatasında “sonuç bilinmiyor, tekrar gönderin — çift kayıt oluşmaz” der. **İade:** önce ödemenin dağıtılmamış kısmı; yetmezse en yeni dağıtımdan başlayarak ters kayıt (alacak yeniden açık borca döner). İade ticari indirim değildir; alacak tutarı değişmez. İkinci onay eşiği henüz yok (açık iş).

## ADR-030 Kart ödemesi: manuel kayıt, sanal POS yok
“Kart (manuel kayıt · POS bağlantısı yok)” yöntemi ve “POS (manuel kayıt)” hesap türü yalnız kartla alınmış bir ödemenin kaydıdır. VİADENT karttan çekim yapmaz, sonucu doğrulamaz, kart verisi tutmaz; arayüz bunu ödeme formunda açıkça söyler. Gerçek ödeme sağlayıcısı (sayfa/token, callback, iade, mutabakat) Görev 5'te etiketli mock ile, sözleşme sonrası gerçek adaptörle.

## ADR-031 Metrik ayrımı, gün sınırı ve hekim primi
**İşlem tutarı** (tamamlanan işlemlerin snapshot bedeli, iptal/düzeltme ayrı satır), **tahsilat**, **iade**, **net tahsilat** (tahsilat − iade; kâr değildir) ve **gider** ayrı hesaplanır; her toplam kaynak satırlarına açılır ve satır toplamı üst toplama eşittir (testli). Gün sınırı klinik saat dilimindedir: [gün 00:00, ertesi gün 00:00) klinik saati → UTC (AT-19: 23:59:30 ve 00:00:30 doğru güne düşer; iki günün toplamı aralık toplamına eşit). Ödeme/gider zamanı gelecekte olamaz, ekrandan en fazla 30 gün geriye girilebilir; rapor aralığı en fazla 92 gün. Vergi dahil/hariç ayrımı yapılmadı (mali müşavir). **Prim:** tahsilat dağıtımı bazlı; dağıtım anında klinik gününde geçerli kural sürümü (hekime özel > genel) seçilir ve oran **snapshot**lanır. Ters dağıtım orijinal oranla ters prim doğurur (DB kontrolü). Kural sürümü silinmez, geriye dönük başlatılamaz (AT-10: oran değişince önceki tahakkuk ve ters kaydı eski oranda kalır). Prim ödemesi ve kesinti sırası Görev 6. Seed'deki %10 kural DEMO'dur.
