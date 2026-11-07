-- Ürün sahibi geri bildirimi 07.11.2026 (ADR-104): belge listesindeki her tür seçildiğinde belge kendiliğinden dolsun.
--  * PİA-DENT standart belge kataloğu (42 tür; özgün DEMO metinler — rakip form içeriği kullanılmadı) eksik türleri kiracıya ekler.
--  * Onaylı sürümü olmayan her türe "PİA-DENT DEMO" şablonu + onaylı 1. sürüm (is_demo; klinik hekim/hukuk incelemesi gerekir).
--  * İlk kurulumun yer tutucu DEMO metni ("SENTETİK DEMO BELGESİ …") yeni onaylı sürümle değişir, eskisi kullanımdan kalkar (silinmez;
--    üretilmiş belgeler kendi metin snapshot'ını korur). Kliniğin kendi yazdığı/onayladığı sürümlere dokunulmaz.
--  * Üretici: scripts/gen-0037-standard-documents.ts (kaynak contracts/document-templates-standard.ts). Yazar: kiracının ilk etkin yöneticisi.
create temp table std_docs (code text, name text, category text, req boolean, issuer text, tname text, body text, clinical boolean) on commit drop;
insert into std_docs values
('GENEL-ONAM', 'Genel tedavi bilgilendirme ve onam', 'consent', true, null, 'Genel tedavi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
GENEL TEDAVİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Bu form; muayene, ağız içi ve röntgen görüntüleme, diş taşı temizliği, lokal anestezi (bölgesel uyuşturma) ve temel diş tedavileri için genel bilgi verir.
Cerrahi, implant, kanal tedavisi gibi daha kapsamlı işlemler için ayrıca işleme özgü bir onam formu istenebilir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Ağız ve diş sağlığınızın bütün olarak değerlendirilmesi
- Çürük, diş eti hastalığı gibi sorunların erken fark edilmesi
- Ağrı ve enfeksiyonun azaltılması, çiğneme ve konuşmanın korunması

OLASI RİSKLER VE YAN ETKİLER
- Uyuşturma sonrası birkaç saat süren his kaybı; enjeksiyon yerinde hassasiyet veya morarma
- Nadiren uyuşturucu maddeye karşı alerjik tepki
- Tedavi edilen dişlerde geçici sıcak-soğuk hassasiyeti
- Ağzın uzun süre açık kalmasına bağlı çene yorgunluğu veya dudak köşesinde çatlama
- Nadiren kullanılan aletlere bağlı dudak, yanak veya dilde küçük yaralanmalar

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Tedaviyi ertelemek, farklı bir tedavi seçeneğini tercih etmek veya başka bir hekimden görüş almak
- Tedavi yapılmazsa çürük ve diş eti hastalığı ilerleyebilir; ağrı, enfeksiyon ve diş kaybı gelişebilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Uyuşukluk geçene kadar yemek yemeyin, sıcak içeceklerden kaçının; dudak ve yanağınızı ısırmamaya dikkat edin
- Size verilen bakım önerilerine ve kontrol randevularına uyun
- Beklenmedik ağrı, şişlik veya kanama olursa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('CERRAHI-ONAM', 'Cerrahi işlem bilgilendirme ve onam', 'consent', true, null, 'Cerrahi işlem bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
CERRAHİ İŞLEM BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Ağız içinde diş eti, kemik veya yumuşak dokuya yapılan cerrahi işlemler bu formun kapsamındadır. İşlem genellikle lokal anestezi altında yapılır.
Hangi bölgede, hangi amaçla işlem yapılacağı aşağıdaki planda ve hekiminizin anlatımında belirtilmiştir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Ağrı, enfeksiyon veya hastalığa yol açan nedenin ortadan kaldırılması
- Sonraki tedaviler (protez, implant vb.) için uygun ortamın hazırlanması

OLASI RİSKLER VE YAN ETKİLER
- İşlem sonrası ağrı, şişlik, morarma ve birkaç gün süren hassasiyet
- Kanama; nadiren tekrar müdahale gerektiren kanama
- Yara yerinde enfeksiyon veya yaranın geç iyileşmesi
- Bölgeye yakın sinirlerin etkilenmesine bağlı dudak, dil veya çenede geçici, çok nadiren kalıcı uyuşukluk
- Ağız açmada geçici kısıtlılık, komşu dişlerde veya dolgularda hasar
- Üst çene arka bölgede ağız ile sinüs arasında bağlantı oluşması

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Uygunsa cerrahi olmayan tedaviler, izleme veya başka bir uzmana yönlendirme
- İşlem yapılmazsa mevcut sorun ilerleyebilir, ağrı ve enfeksiyon tekrarlayabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Hekimin verdiği tampon, soğuk uygulama ve beslenme önerilerine uyun
- İlk gün sert çalkalama yapmayın, sigara ve alkolden uzak durun
- İlaçları yalnızca hekiminizin önerdiği şekilde kullanın
- Kanama durmazsa, şişlik artarsa veya ateş olursa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('ENDO-ONAM', 'Kanal tedavisi bilgilendirme ve onam', 'consent', true, null, 'Kanal tedavisi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
KANAL TEDAVİSİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Kanal tedavisi, dişin içindeki iltihaplı veya canlılığını yitirmiş dokunun (pulpa) temizlenmesi, kanalların şekillendirilip dezenfekte edilmesi ve doldurulmasıdır.
Tedavi bir veya birkaç seansta tamamlanabilir. Tedavi sonrası dişin dolgu veya kaplama ile güçlendirilmesi çoğu zaman gerekir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Dişin ağızda korunması ve çekimin önlenmesi
- Ağrının ve kök ucundaki iltihabın azaltılması

OLASI RİSKLER VE YAN ETKİLER
- Tedavi sonrası birkaç gün çiğnemede hassasiyet veya ağrı
- Seanslar arasında alevlenme ve şişlik görülebilmesi
- Kanal içinde ince bir aletin kırılması, kanal duvarında delinme gibi istenmeyen durumlar
- Eğri, daralmış veya görünmeyen kanallar nedeniyle tedavinin tam yapılamaması
- Kanal tedavili dişin zamanla kırılgan hale gelmesi, renk değiştirmesi
- İyileşme olmazsa kanal yenileme, kök ucu cerrahisi veya çekim gerekebilmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Dişin çekilmesi ve yerine uygun bir protez veya implant planlanması
- Tedavi yapılmazsa ağrı ve iltihap ilerleyebilir, apse oluşabilir, diş kaybedilebilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Geçici dolgu varken o tarafla sert yiyecek çiğnemeyin
- Kalıcı dolgu veya kaplama randevunuzu geciktirmeyin
- Şişlik, ateş veya giderek artan ağrı olursa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('RESTORATIF-ONAM', 'Restoratif ve estetik işlem bilgilendirme ve onam', 'consent', true, null, 'Restoratif ve estetik işlem bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
RESTORATİF VE ESTETİK İŞLEM BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Bu form; kompozit bonding, lamine veneer, inley-onley gibi dişin biçimini, rengini veya bütünlüğünü düzeltmeye yönelik işlemleri kapsar.
Bazı işlemlerde diş yüzeyinden bir miktar doku aşındırılır; bu aşındırma geri alınamaz.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Kırık, aşınmış veya renk değiştirmiş dişlerin görünümünün ve işlevinin düzeltilmesi
- Diş dokusunun daha fazla kaybının önlenmesi

OLASI RİSKLER VE YAN ETKİLER
- Geçici veya uzun süreli sıcak-soğuk hassasiyeti
- Malzemede zamanla renk değişimi, kırılma, ayrılma veya aşınma
- Doğal diş renginin tam olarak eşleşmemesi; renk ve biçim beklentisinin farklı olması
- Aşındırılan dişte nadiren sinir iltihabı ve kanal tedavisi gereksinimi
- Restorasyonların belirli aralıklarla yenilenmesinin gerekmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Beyazlatma, ortodontik tedavi, kaplama veya işlem yapmadan izleme
- Tedavi yapılmazsa kırık ve aşınma ilerleyebilir, estetik sorun sürebilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Tırnak yeme, kalem ısırma ve sert cisimlerle kabuk kırma gibi alışkanlıklardan kaçının
- Gece diş sıkıyorsanız hekiminizin önerdiği koruyucu plağı kullanın
- Çay, kahve ve sigara renklenmeyi artırabilir
- Kırılma veya ayrılma fark ederseniz kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('PROTEZ-ONAM', 'Protez işlemleri bilgilendirme ve onam', 'consent', true, null, 'Protez işlemleri bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
PROTEZ İŞLEMLERİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Protez tedavisi, eksik dişlerin veya ileri derecede hasarlı diş dokusunun sabit (kron, köprü) veya hareketli (tam ya da bölümlü) yapılarla tamamlanmasıdır.
Tedavi genellikle ölçü, prova ve teslim aşamalarından oluşur; dişlerin hazırlanması için aşındırma gerekebilir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Çiğneme ve konuşma işlevinin iyileştirilmesi
- Görünümün düzeltilmesi ve komşu dişlerin kaymasının önlenmesi

OLASI RİSKLER VE YAN ETKİLER
- Aşındırılan dişlerde hassasiyet; nadiren sinir iltihabı ve kanal tedavisi gereksinimi
- Alışma döneminde baskı yarası, konuşmada değişiklik, tükürük artışı
- Protezde kırılma, sökülme, renk değişimi veya zamanla uyumun bozulması
- Ağız hijyeni yetersiz olursa protez altındaki dişlerde çürük ve diş eti hastalığı
- Beklenen renk ve biçimin tam olarak karşılanamaması

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- İmplant destekli protez, farklı protez türleri veya eksik bölgeyi bırakmak
- Tedavi yapılmazsa çiğneme güçlüğü sürebilir, komşu ve karşı dişler kayabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Teslimden sonra size verilen kullanım ve temizlik talimatlarına uyun
- Ağrı veya yara oluşursa kendi başınıza düzeltmeye çalışmadan kliniği arayın
- Düzenli kontrollerle protezin uyumunu kontrol ettirin

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('IMPLANT-ONAM', 'İmplant tedavisi bilgilendirme ve onam', 'consent', true, null, 'İmplant tedavisi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
İMPLANT TEDAVİSİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Dental implant, eksik dişin kökü yerine çene kemiğine yerleştirilen, genellikle titanyumdan yapılmış vida biçiminde bir parçadır. Kemikle kaynaşma süresinden sonra üzerine protez yapılır.
Kemik miktarı yetersizse ek kemik grefti veya sinüs işlemi gerekebilir. Cerrahi aşama genellikle lokal anestezi altında yapılır.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Komşu dişleri aşındırmadan eksik dişin tamamlanması
- Sabit veya daha iyi tutunan protezlerle çiğneme ve konuşmanın iyileşmesi
- Bölgedeki kemiğin korunmasına katkı

OLASI RİSKLER VE YAN ETKİLER
- İşlem sonrası ağrı, şişlik, morarma ve kanama
- Yara enfeksiyonu veya yaranın açılması
- İmplantın kemikle kaynaşmaması veya ileride kaybedilmesi; bu durumda çıkarılması gerekebilir
- Alt çenede sinir yakınlığına bağlı geçici, çok nadiren kalıcı uyuşukluk
- Üst çenede sinüs ile ilişkili sorunlar
- Sigara, kontrolsüz şeker hastalığı ve yetersiz ağız bakımının sorun riskini artırması
- Uzun dönemde implant çevresi iltihabı ve kemik kaybı

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Sabit köprü, hareketli bölümlü veya tam protez ya da boşluğu bırakmak
- Tedavi yapılmazsa komşu dişler kayabilir, bölgedeki kemik zamanla azalabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- İlk gün soğuk uygulayın, yumuşak beslenin, işlem bölgesiyle çiğnemeyin
- Sigaradan mümkün olduğunca uzak durun
- İlaçları yalnızca hekiminizin önerdiği şekilde kullanın
- İyileşme ve protez sonrası kontrol randevularına mutlaka gelin

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('PERIO-ONAM', 'Periodontal tedavi bilgilendirme ve onam', 'consent', true, null, 'Periodontal tedavi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
PERİODONTAL TEDAVİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Periodontal tedavi, dişleri çevreleyen diş eti ve kemikte oluşan iltihabın (diş eti hastalığı) tedavisidir. Diş taşı temizliği, kök yüzeyi düzleştirme ve gerekirse cerrahi işlemleri kapsar.
Tedavinin başarısı büyük ölçüde evde yapılan düzenli ağız bakımına ve kontrol randevularına bağlıdır.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Diş eti kanamasının ve iltihabın azaltılması
- Kemik kaybının ilerlemesinin yavaşlatılması, dişlerin daha uzun süre korunması
- Ağız kokusunun azalması

OLASI RİSKLER VE YAN ETKİLER
- Tedavi sonrası hassasiyet ve hafif ağrı
- İltihap geriledikçe diş etlerinin çekilmesi, diş aralarının belirginleşmesi
- Sıcak-soğuk hassasiyetinin bir süre devam etmesi
- İleri kemik kaybı olan dişlerde sallanmanın sürmesi ve diş kaybı
- Hastalığın düzenli bakım yapılmazsa tekrarlaması

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- İleri vakalarda cerrahi tedavi veya korunamayan dişlerin çekimi
- Tedavi yapılmazsa diş eti hastalığı ilerleyerek kemik kaybına ve dişlerin kaybına yol açabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Size gösterilen fırçalama ve ara yüz temizliği yöntemlerini her gün uygulayın
- Sigara diş eti iyileşmesini olumsuz etkiler; bırakmanız önerilir
- Belirlenen aralıklarla bakım randevularına gelin

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('ORTO-ONAM', 'Ortodontik tedavi bilgilendirme ve onam', 'consent', true, null, 'Ortodontik tedavi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
ORTODONTİK TEDAVİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Ortodontik tedavi, dişlerin ve çenelerin konumunu düzeltmek için sabit braketler, şeffaf plaklar veya hareketli apareylerle yapılan, aylar ya da yıllar süren bir tedavidir.
Tedavi süresi tahminidir; dişlerin yanıtına, hastanın uyumuna ve randevulara düzenli gelinmesine göre değişir. Tedavi sonunda pekiştirme (retansiyon) aşaması gerekir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Dişlerin daha düzgün dizilmesi ve kapanışın iyileşmesi
- Temizliğin kolaylaşması, çiğneme işlevinin desteklenmesi
- Gülüş görünümünün iyileşmesi

OLASI RİSKLER VE YAN ETKİLER
- Aparey takıldıktan ve aktivasyonlardan sonra birkaç gün süren ağrı ve hassasiyet
- Yanak ve dudakta tahriş, küçük yaralar
- Ağız bakımı yetersizse çürük, diş yüzeyinde beyaz lekeler ve diş eti iltihabı
- Kök boyunda kısalma, diş eti çekilmesi
- Çene eklemi rahatsızlıklarının ortaya çıkması veya artması
- Pekiştirme aygıtı kullanılmazsa dişlerin eski konumuna dönmesi
- Büyümenin beklenenden farklı seyretmesi nedeniyle planın uzaması veya cerrahi gerekebilmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Farklı aparey türleri, protetik veya estetik düzeltmeler, ciddi çene bozukluklarında ortognatik cerrahi
- Tedavi yapılmazsa çapraşıklık ve kapanış bozukluğu sürer; temizlik güçlüğü ve aşınma artabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Her yemekten sonra dişlerinizi ve apareyinizi temizleyin
- Sert, yapışkan ve şekerli yiyeceklerden kaçının
- Kopan braket veya batan teli kliniğe bildirin
- Kontrol randevularına düzenli gelin ve pekiştirme aygıtını anlatıldığı gibi kullanın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('PEDO-ONAM', 'Çocuk hasta (veli/vasi) bilgilendirme ve onam', 'consent', true, null, 'Çocuk hasta (veli/vasi) bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
ÇOCUK HASTA (VELİ/VASİ) BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Bu form, aşağıda adı yazılı çocuğun diş tedavisi için anne, baba ya da yasal vasisinin bilgilendirilmesi ve onayının alınması amacıyla hazırlanmıştır.
Çocuklarda muayene, flor ve fissür örtücü gibi koruyucu uygulamalar, süt ve daimi dişlerde dolgu, süt dişi kanal tedavisi (pulpotomi ve benzeri), çekim ve yer tutucu gibi işlemler yapılabilir. Uyuşturma gerekebilir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Ağrı ve enfeksiyonun giderilmesi, çocuğun rahat yemek yiyebilmesi
- Süt dişlerinin doğal düşme zamanına kadar korunması, daimi dişlerin sağlıklı sürmesinin desteklenmesi
- Diş hekimine karşı olumlu bir alışkanlık kazanılması

OLASI RİSKLER VE YAN ETKİLER
- Uyuşukluk sırasında çocuğun dudak, yanak veya dilini ısırması
- Tedavi sonrası geçici hassasiyet ve hafif ağrı
- Dolguların düşmesi veya kırılması, tedavili dişte yeniden sorun çıkması
- Çocuğun ani hareketine bağlı küçük yumuşak doku yaralanmaları; çekim sonrası kanama ve şişlik
- Çocuğun uyumu sağlanamazsa tedavinin seanslara bölünmesi, ertelenmesi veya başka bir merkeze yönlendirme

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Tedavinin ertelenmesi, farklı tedavi seçenekleri veya sedasyon ya da genel anestezi imkânı olan bir merkeze yönlendirme
- Tedavi yapılmazsa çürük ilerleyebilir, apse gelişebilir ve alttaki daimi diş etkilenebilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Uyuşukluk geçene kadar çocuğunuzu yakından izleyin, yemek vermeyin ve dudağını ısırmamasını hatırlatın
- Fırçalamaya yardımcı olun, şekerli yiyecek ve içecekleri sınırlayın
- Ateş, şişlik veya geçmeyen ağrı olursa kliniği arayın

HASTANIN BEYANI
- Çocuğumun planlanan tedavisinin amacı, yararları, olası riskleri ve alternatifleri bana sözlü olarak anlatıldı; bu metni okudum.
- Sorularımı sorma fırsatı buldum ve yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum.
- Çocuğumun sağlık durumu, kullandığı ilaçlar ve alerjileri hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Çocuğun velisi veya yasal vasisi olduğumu beyan ederim.
- Tedavi sonucunun çocuktan çocuğa değişebileceğini ve kesin sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında çocuğumun planlanan tedavisine onay veriyorum.

Çocuğun adı soyadı: {{hasta.ad_soyad}} (Dosya no: {{hasta.dosya_no}})
Veli / vasi adı soyadı: ______________________   İmza: __________
Yakınlığı: [ ] Anne  [ ] Baba  [ ] Vasi  [ ] Diğer: ______________
Veli / vasi telefon: ______________________
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('TRAVMA-ONAM', 'Acil / travma tedavisi bilgilendirme ve onam', 'consent', true, null, 'Acil / travma tedavisi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
ACİL / TRAVMA TEDAVİSİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Bu form, ani ağrı, şişlik veya düşme, çarpma gibi bir travma sonrası yapılan acil diş tedavileri için hazırlanmıştır.
Amaç ağrıyı ve enfeksiyonu kontrol altına almak, kırık veya yerinden oynamış dişleri mümkün olduğunca korumaktır. Kırık parça yapıştırma, dişin yerine konup sabitlenmesi, geçici dolgu veya apse boşaltma gibi işlemler yapılabilir. Kalıcı tedavi çoğu zaman sonra planlanır.

OLAYIN KISA ÖYKÜSÜ (hekim tarafından doldurulur)
Olay tarihi / saati: __________   Nasıl oldu: ____________________
Etkilenen dişler: ____________________

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Ağrının ve enfeksiyonun hızla azaltılması
- Kırık veya yerinden çıkmış dişin korunma şansının artırılması

OLASI RİSKLER VE YAN ETKİLER
- Travmalı dişin zamanla canlılığını yitirmesi, renk değiştirmesi, kanal tedavisi gerektirmesi
- Kökte emilme veya dişin kemikle kaynaşması gibi geç dönemde ortaya çıkabilen sorunlar
- Yerine yerleştirilen dişin tutunmaması ve kaybedilmesi
- Acil koşullarda tam değerlendirme yapılamaması nedeniyle planın sonradan değişmesi; işlem sonrası ağrı ve şişlik

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Yalnızca ağrı kontrolü yapıp kapsamlı tedaviyi ertelemek, çekim veya başka merkeze yönlendirme
- Tedavi yapılmazsa ağrı ve enfeksiyon artabilir, dişin korunma şansı azalabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Hekiminizin önerdiği süre boyunca yumuşak beslenin, travmalı dişle ısırmayın
- Sabitleme varsa bölgeyi nazikçe temizleyin
- Renk değişimi, şişlik veya ağrı fark ederseniz kliniği arayın
- Travmalı dişlerin uzun süre izlenmesi gerekir; kontrol randevularına gelin

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('OZEL-ISLEM-ONAM', 'İşleme özgü bilgilendirme ve onam (diğer)', 'consent', true, null, 'İşleme özgü bilgilendirme ve onam (diğer) — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
İŞLEME ÖZGÜ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Bu form, diğer formlarda ayrıca yer almayan bir işlem için kullanılır. İşlemin adı, amacı, riskleri ve alternatifleri aşağıda sorumlu hekim tarafından hastaya anlatılarak yazılır.

İŞLEMİN ADI VE AÇIKLAMASI (hekim tarafından doldurulur)
İşlemin adı: ______________________________________________
Uygulanacak bölge / dişler: ______________________________
İşlemin nasıl yapılacağı: ______________________________________________
______________________________________________

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- ______________________________________________
- ______________________________________________

OLASI RİSKLER VE YAN ETKİLER
- Lokal anestezi kullanılırsa geçici uyuşukluk, enjeksiyon yerinde hassasiyet; nadiren alerjik tepki
- İşlem sonrası ağrı, şişlik veya hassasiyet
- İşleme özgü riskler: ______________________________________________
- ______________________________________________

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Alternatif tedaviler: ______________________________________________
- Tedavi yapılmazsa olası sonuçlar: ______________________________

İŞLEM SONRASI DİKKAT EDİLECEKLER
- ______________________________________________
- Beklenmedik ağrı, şişlik, kanama veya ateş olursa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('ISLEM-SONRASI', 'İşlem sonrası bakım ve kullanım bilgilendirmesi', 'information', false, null, 'İşlem sonrası bakım ve kullanım bilgilendirmesi — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
İŞLEM SONRASI BAKIM VE KULLANIM BİLGİLENDİRMESİ
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

YAPILAN İŞLEM
{{plan.kalemler}}
Ek açıklama: ______________________________________________

İLK SAATLERDE
- Uyuşukluk geçene kadar yemek yemeyin, sıcak içecek içmeyin; dudak, yanak ve dilinizi ısırmamaya dikkat edin
- Çocuklarda uyuşukluk süresince yakından gözetim gerekir
- Tampon verildiyse hekiminizin söylediği süre boyunca ısırarak tutun

SONRAKİ GÜNLERDE
- Birkaç gün süren hafif hassasiyet ve sıcak-soğuk duyarlılığı olağandır
- Dişlerinizi her zamanki gibi fırçalayın; işlem bölgesinde nazik olun
- İlaçları yalnızca hekiminizin önerdiği şekilde kullanın, kendi başınıza ilaç eklemeyin
- Geçici dolgu veya kaplama varsa o tarafla sert ve yapışkan yiyecek çiğnemeyin
- Isırmada yükseklik veya takılma hissi varsa kısa bir düzeltme randevusu alın

KLİNİĞİ NE ZAMAN ARAMALISINIZ
- Kanama, baskı uygulamanıza rağmen durmuyorsa
- Şişlik veya ağrı günler geçtikçe azalmak yerine artıyorsa
- Ateş, halsizlik ya da ağızda kötü tat ve koku oluşursa
- Yutma veya nefes almada güçlük hissederseniz (bu durumda en yakın acil servise de başvurun)
- Geçici dolgu, kaplama veya protez düşerse ya da kırılırsa

SONRAKİ RANDEVU
Kontrol / devam randevusu: ____ . ____ . ________   Saat: ______

Bu bilgilendirme {{belge.tarih}} tarihinde hastaya verilmiştir.

Bilgilendirmeyi aldım. Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
Bilgilendiren hekim: {{hekim.ad}}   İmza: __________
', false),
('KVKK-AYDINLATMA', 'Kişisel verilerin işlenmesine ilişkin aydınlatma', 'privacy', false, null, 'Kişisel verilerin işlenmesine ilişkin aydınlatma — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
KİŞİSEL VERİLERİN İŞLENMESİNE İLİŞKİN AYDINLATMA METNİ
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Tarih: {{belge.tarih}}

VERİ SORUMLUSU
Kişisel verileriniz, veri sorumlusu sıfatıyla {{klinik.ad}} tarafından aşağıda açıklanan çerçevede işlenmektedir.
Adres: ______________________________________________
İletişim (telefon / e-posta): ______________________________

İŞLENEN KİŞİSEL VERİ KATEGORİLERİ
- Kimlik bilgileri: ad soyad, doğum tarihi, kimlik numarası
- İletişim bilgileri: telefon, e-posta, adres, acil durumda aranacak kişi
- Sağlık verileri: sağlık öyküsü, kullanılan ilaçlar, alerjiler, muayene bulguları, röntgen ve ağız içi fotoğraflar, tedavi ve reçete kayıtları
- Finansal bilgiler: ödeme, fatura ve varsa özel sigorta bilgileri

İŞLEME AMAÇLARI
- Muayene, teşhis ve tedavi hizmetlerinin planlanması ve yürütülmesi
- Hasta dosyasının ve tedavi kayıtlarının tutulması
- Randevu planlaması ve hatırlatma
- Faturalama, ödeme ve sigorta süreçlerinin yürütülmesi
- Mevzuattan doğan kayıt tutma ve bildirim yükümlülüklerinin yerine getirilmesi

HUKUKİ SEBEPLER
Kişisel verileriniz genel olarak; kanunlarda açıkça öngörülmesi, sizinle kurulan hizmet ilişkisinin kurulması ve yürütülmesi, kliniğin hukuki yükümlülüklerini yerine getirmesi, bir hakkın kurulması veya korunması ve meşru menfaat sebeplerine dayanılarak işlenir. Sağlık verileriniz; tıbbi teşhis ve tedavi hizmetlerinin yürütülmesi amacıyla sır saklama yükümlülüğü altındaki kişilerce, ilgili mevzuatın öngördüğü hâllerde veya açık rızanızın bulunduğu durumlarda işlenir.

VERİLERİN AKTARILABİLECEĞİ TARAFLAR
- Mevzuat gereği bilgi istemeye yetkili kamu kurumları
- Tedaviniz için çalışılan dental laboratuvarlar ve radyoloji veya patoloji merkezleri (yalnızca gerekli ölçüde)
- Talebiniz veya onayınız bulunması hâlinde özel sağlık sigortası şirketiniz
- Klinik yazılımı, kayıt ve barındırma gibi hizmetleri sağlayan iş ortakları (gizlilik yükümlülüğü altında)

SAKLAMA SÜRESİ
Verileriniz, işleme amacının gerektirdiği ve ilgili mevzuatın öngördüğü süre boyunca saklanır; sürenin bitiminde silinir, yok edilir veya anonim hâle getirilir.

HAKLARINIZ
- Verilerinizin işlenip işlenmediğini, hangi amaçla işlendiğini öğrenme ve bilgi talep etme
- Aktarıldığı üçüncü kişileri bilme
- Eksik veya yanlış işlenmişse düzeltilmesini, şartları oluştuğunda silinmesini isteme
- Otomatik sistemlerle analiz sonucu aleyhinize bir sonuç çıkmasına itiraz etme
- Hukuka aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme

BAŞVURU YÖNTEMİ
Taleplerinizi kimliğinizi doğrulayan bilgilerle birlikte yazılı olarak klinik adresine veya yukarıdaki iletişim kanalına iletebilirsiniz.

Bu metin bilgilendirme amaçlıdır; açık rıza yerine geçmez.

Okudum, bilgilendirildim.
Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
Tarih: {{belge.tarih}}
', false),
('GORSEL-IZIN', 'Görsel kayıt ve kullanım izni', 'privacy', true, null, 'Görsel kayıt ve kullanım izni — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
GÖRSEL KAYIT VE KULLANIM İZNİ
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

AÇIKLAMA
Tedaviniz sırasında ağız içi ve yüz fotoğrafları, video kayıtları, röntgen ve dijital tarama görüntüleri alınabilir. Teşhis ve tedavi için gerekli görüntüler hasta dosyanızın parçasıdır. Aşağıdaki seçenekler, bu görüntülerin tedavi dışındaki kullanımları için ayrı ayrı izninizi sormaktadır.
İzin vermemeniz tedavinizi hiçbir şekilde etkilemez.

İZİN SEÇENEKLERİ (her satır için birini işaretleyiniz)
1. Görüntülerimin yalnızca tedavi kaydı olarak hasta dosyamda saklanması ve tedavimle ilgili hekimler ve laboratuvarla paylaşılması
   [ ] Evet   [ ] Hayır
2. Kimliğim gizlenerek meslek içi eğitim, vaka tartışması ve bilimsel sunumlarda kullanılması
   [ ] Evet   [ ] Hayır
3. Yüzümün ve kimliğimin tanınamayacağı şekilde (yalnızca diş ve ağız içi görüntüler) kliniğin web sitesi, sosyal medya hesapları veya tanıtım materyallerinde anonim olarak yayımlanması
   [ ] Evet   [ ] Hayır
4. Yüzümün tanınabildiği fotoğraf veya videoların kliniğin tanıtımında kullanılması
   [ ] Evet   [ ] Hayır

KOŞULLAR
- Görüntüler adınız, dosya numaranız veya sizi tanıtabilecek başka bir bilgiyle birlikte yayımlanmaz (4. madde dışında)
- Verdiğiniz izni dilediğiniz zaman yazılı olarak geri alabilirsiniz
- Geri alma, geri alma tarihinden önce yapılmış basılı yayınları veya sunumları etkilemeyebilir; klinik tarafından yönetilen dijital yayınlardaki görüntüler makul sürede kaldırılır
- Görüntüler için size herhangi bir ücret ödenmez
- 18 yaşından küçük hastalar için izin veli veya yasal vasi tarafından verilir

Yukarıdaki açıklamayı okudum; işaretlediğim seçenekler kendi isteğimdir.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('HASTA-BILGI', 'Hasta bilgi formu', 'administrative', false, null, 'Hasta bilgi formu — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
HASTA BİLGİ FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Form tarihi: {{belge.tarih}}

KİŞİSEL BİLGİLER
Cinsiyet: [ ] Kadın  [ ] Erkek  [ ] Belirtmek istemiyorum
Meslek: ______________________________

İLETİŞİM BİLGİLERİ
Cep telefonu: ______________________   Diğer telefon: ______________________
E-posta: ______________________________
Adres: ______________________________________________
İl / ilçe: ______________________
Tercih ettiğiniz iletişim yolu: [ ] Telefon  [ ] SMS  [ ] E-posta  [ ] Mesajlaşma uygulaması

ACİL DURUMDA ARANACAK KİŞİ
Adı soyadı: ______________________   Yakınlığı: ______________
Telefon: ______________________

VELİ / YASAL TEMSİLCİ (18 yaş altı veya temsil edilen hastalar için)
Adı soyadı: ______________________   Yakınlığı: ______________
Telefon: ______________________

SAĞLIKLA İLGİLİ KISA BİLGİ
Ayrıntılı sağlık öyküsü hekiminiz tarafından ayrıca alınacaktır.
Kronik hastalık: ______________________________________________
Sürekli kullanılan ilaçlar: ______________________________________________
Alerji (ilaç, lateks, besin vb.): ______________________________________________

KLİNİĞİMİZİ NEREDEN DUYDUNUZ
[ ] Tavsiye (kimden: ______________)  [ ] İnternet arama  [ ] Sosyal medya  [ ] Tabela / yakın çevre  [ ] Diğer: ______________

RANDEVU HATIRLATMA
Randevu hatırlatmalarının yukarıdaki iletişim bilgilerime gönderilmesini istiyorum: [ ] Evet  [ ] Hayır

BEYAN
Bu formda verdiğim bilgilerin doğru olduğunu, değişiklik olması hâlinde kliniğe bildireceğimi beyan ederim.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
Tarih: {{belge.tarih}}
Formu teslim alan personel: ______________________
', false),
('ISTIRAHAT', 'İstirahat / durum belgesi', 'administrative', false, 'dentist', 'İstirahat / durum belgesi — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
İSTİRAHAT / DURUM BELGESİ
Belge tarihi: {{belge.tarih}}

HASTA BİLGİLERİ
Adı soyadı: {{hasta.ad_soyad}}
Dosya no: {{hasta.dosya_no}}
Doğum tarihi: {{hasta.dogum_tarihi}}

DURUM
Yukarıda bilgileri yazılı hasta, {{belge.tarih}} tarihinde kliniğimizde ağız ve diş sağlığı kapsamında muayene edilmiş ve/veya tedavi görmüştür.
Klinikte bulunduğu saat aralığı: ______ - ______
Yapılan muayene / işlem: ______________________________________________
Gerekçe (hekim değerlendirmesi): ______________________________________________

ÖNERİ (uygun olanı işaretleyiniz)
[ ] Hekim değerlendirmesine göre ____ gün (____ - ____ tarihleri arasında) istirahat önerilmiştir.
[ ] İstirahat önerilmemiştir; hasta yalnızca belirtilen saat aralığında klinikte bulunmuştur.
[ ] Diğer: ______________________________________________

AÇIKLAMA
Bu belge, hastanın isteği üzerine, ilgili kişi veya kuruma sunulmak üzere düzenlenmiştir. Belgede yalnızca yukarıdaki tarihte yapılan muayene ve tedaviye ilişkin hekim değerlendirmesi yer alır; hastanın başka sağlık bilgileri paylaşılmamıştır.
Belgenin üzerinde silinti veya kazıntı bulunması hâlinde doğrulama için kliniğe başvurulabilir.

Hekim: {{hekim.ad}}
Diploma / tescil no: ______________________
İmza: __________   Kaşe: __________

Klinik iletişim: ______________________________
', false),
('SIGORTA-BILGI', 'Özel sağlık sigortası bilgi formu', 'insurance', false, null, 'Özel sağlık sigortası bilgi formu — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
ÖZEL SAĞLIK SİGORTASI BİLGİ FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

SİGORTA BİLGİLERİ
Sigorta şirketi: ______________________________
Poliçe numarası: ______________________   Poliçe türü / planı: ______________
Poliçe başlangıç - bitiş tarihi: ____ . ____ . ________  -  ____ . ____ . ________
Sigortalının adı soyadı: ______________________
Hastanın sigortalıya yakınlığı: [ ] Kendisi  [ ] Eşi  [ ] Çocuğu  [ ] Diğer: ______________
Çalıştığı kurum (grup poliçesi ise): ______________________

PLANLANAN TEDAVİLER
{{plan.kalemler}}
Ek açıklama: ______________________________________________

PROVİZYON BİLGİLERİ (klinik tarafından doldurulur)
Provizyon talep tarihi: ____ . ____ . ________   Talep eden personel: ______________
Provizyon / onay numarası: ______________________
Onaylanan işlemler ve tutar: ______________________________________________
Hastanın ödeyeceği katılım payı / fark: ______________________
Reddedilen veya kapsam dışı işlemler: ______________________________

BİLGİLENDİRME
- Sigorta kapsamı, limitler ve katılım payı poliçe koşullarınıza göre sigorta şirketinizce belirlenir
- Sigorta şirketince karşılanmayan veya onaylanmayan tutarlar hastaya aittir; bu tutarlar tedavi öncesinde sizinle paylaşılır
- Provizyon sonucu çıkmadan başlanan tedavilerde ödeme sorumluluğu konusunda ayrıca bilgilendirilirsiniz

HASTANIN ONAYI
Provizyon ve ödeme işlemlerinin yürütülebilmesi için; kimlik, poliçe ve tedavimle ilgili gerekli bilgilerin (teşhis, planlanan ve yapılan işlemler, gerekirse röntgen görüntüleri ve fatura bilgileri) {{klinik.ad}} tarafından yukarıda adı yazılı sigorta şirketiyle paylaşılmasına onay veriyorum. Bu onayı yazılı olarak geri alabileceğimi biliyorum; geri almam hâlinde sigorta işlemlerinin yürütülemeyebileceğini anladım.

Hasta / sigortalı / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Formu düzenleyen personel: ______________________   İmza: __________
Tarih: {{belge.tarih}}
', false),
('CEKIM-ONAM', 'Diş çekimi bilgilendirme ve onam', 'consent', true, null, 'Diş çekimi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
DİŞ ÇEKİMİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Diş çekimi, tedavi ile korunamayan, ağrı veya enfeksiyon kaynağı olan ya da tedavi planı gereği alınması gereken bir dişin lokal anestezi altında yuvasından çıkarılmasıdır.
Kökleri eğri veya kırılgan dişlerde dişin parçalara ayrılarak çıkarılması ve yaranın dikişle kapatılması gerekebilir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Ağrı ve enfeksiyon kaynağının ortadan kaldırılması
- Çevre dişlerin ve kemiğin daha fazla zarar görmesinin önlenmesi
- Protez, implant veya ortodontik tedavi için yer açılması

OLASI RİSKLER VE YAN ETKİLER
- Birkaç gün süren ağrı, şişlik ve morarma
- Kanama; kan sulandırıcı ilaç kullananlarda kanama eğilimi artabilir
- Çekim boşluğunda pıhtının erken kaybı ve buna bağlı şiddetli ağrı (kuru soket)
- Kök ucunun kırılması ve bazen bırakılması veya ek işlemle alınması
- Komşu diş veya dolgu ve kaplamalarda hasar
- Alt çenede sinire yakın dişlerde geçici, çok nadiren kalıcı uyuşukluk
- Üst çene arka dişlerinde ağız ile sinüs arasında bağlantı oluşması

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Uygunsa kanal tedavisi, dolgu, kaplama veya diş eti tedavisi ile dişin korunmaya çalışılması
- Çekim yapılmazsa ağrı ve enfeksiyon sürebilir, iltihap çevre dokulara yayılabilir
- Çekilen dişin yerinin uygun zamanda doldurulmaması komşu dişlerin kaymasına yol açabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Tamponu hekiminizin söylediği süre boyunca ısırarak tutun
- İlk gün tükürmeyin, sert çalkalama yapmayın, pipetle içmeyin
- Sigaradan uzak durun; ılık veya soğuk, yumuşak yiyecekler tercih edin
- Kanama durmazsa, ağrı birkaç gün sonra artarsa veya ateş olursa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('GOMULU-CEKIM-ONAM', 'Gömülü diş cerrahisi bilgilendirme ve onam', 'consent', true, null, 'Gömülü diş cerrahisi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
GÖMÜLÜ DİŞ CERRAHİSİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Gömülü diş, ağızda tam olarak çıkamamış, kemik veya diş eti içinde kalmış dişlerdir; en sık yirmi yaş dişlerinde görülür.
İşlemde diş eti açılır, gerekirse kemik ve diş küçük parçalara ayrılarak çıkarılır, yara dikişle kapatılır.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Tekrarlayan iltihap, ağrı ve şişliğin önlenmesi
- Komşu dişte çürük veya kök hasarı oluşmasının önlenmesi
- Kist ve benzeri oluşum riskinin azaltılması; ortodontik planın desteklenmesi

OLASI RİSKLER VE YAN ETKİLER
- Normal çekime göre daha belirgin şişlik, morarma ve ağrı; ağız açmada birkaç gün kısıtlılık
- Alt çenede dişin sinire yakın olması durumunda dudak, çene ucu veya dilde geçici, çok nadiren kalıcı uyuşukluk ya da his değişikliği
- Kuru soket, yara enfeksiyonu veya geç iyileşme
- Komşu dişin veya dolgusunun zarar görmesi
- Üst çenede sinüs ile bağlantı oluşması
- Çok nadiren, derin gömülü dişlerde çene kemiğinde kırık

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Belirti vermeyen dişlerde düzenli röntgen kontrolü ile izleme
- İşlem yapılmazsa iltihap tekrarlayabilir, komşu diş zarar görebilir veya kist gelişebilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- İlk gün yüzünüze aralıklı soğuk uygulayın, başınızı yüksekte tutarak dinlenin
- Yumuşak ve ılık besinler tüketin, işlem tarafıyla çiğnemeyin
- Dikiş alınacaksa kontrol randevusunu kaçırmayın
- Uyuşukluk birkaç gün içinde geçmezse, şişlik artarsa veya ateş olursa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('DOLGU-ONAM', 'Dolgu tedavisi bilgilendirme ve onam', 'consent', true, null, 'Dolgu tedavisi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
DOLGU TEDAVİSİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Dolgu tedavisi, çürük veya kırık nedeniyle kaybedilen diş dokusunun temizlenip uygun bir dolgu maddesiyle yeniden yapılmasıdır. Gerekirse lokal anestezi uygulanır.
Kullanılacak dolgu maddesi (kompozit, cam iyonomer vb.) dişin durumuna göre hekiminizle birlikte belirlenir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Çürüğün durdurulması ve dişin korunması
- Çiğneme işlevinin ve görünümün düzeltilmesi

OLASI RİSKLER VE YAN ETKİLER
- Dolgu sonrası birkaç gün veya hafta süren sıcak-soğuk hassasiyeti
- Derin çürüklerde sinirin etkilenmesi ve ileride kanal tedavisi gerekebilmesi
- Dolguda kırılma, düşme, renk değişimi veya kenarlarda yeni çürük oluşması
- Dolgunun yüksek kalmasına bağlı ısırmada rahatsızlık; düzeltme için kısa bir randevu gerekebilir

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Çok küçük çürüklerde koruyucu uygulamalar ve izleme; geniş kayıplarda inley-onley veya kaplama
- Tedavi yapılmazsa çürük ilerleyerek ağrıya, sinir iltihabına ve diş kaybına yol açabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Uyuşukluk geçene kadar yemek yemeyin
- Isırmada yükseklik hissederseniz kliniğe bildirin
- Düzenli fırçalama, diş ipi ve kontrol randevuları dolgunun ömrünü uzatır

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('ENDO-TEKRAR-ONAM', 'Kanal tedavisi yenileme bilgilendirme ve onam', 'consent', true, null, 'Kanal tedavisi yenileme bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
KANAL TEDAVİSİ YENİLEME BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Kanal tedavisi yenileme, daha önce kanal tedavisi yapılmış ancak iltihabı süren veya yeniden sorun çıkaran bir dişte, eski kanal dolgusunun çıkarılıp kanalların yeniden temizlenmesi ve doldurulmasıdır.
Dişteki eski dolgu, kaplama veya kanal içi pivo gibi yapıların sökülmesi gerekebilir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Dişin ağızda korunmasına yeni bir şans verilmesi
- Kök ucundaki iltihabın ve ağrının azaltılması

OLASI RİSKLER VE YAN ETKİLER
- İlk kanal tedavisine göre daha uzun ve karmaşık bir süreç; birden fazla seans gerekebilmesi
- Eski dolgu ve pivo sökülürken dişte kırık veya çatlak oluşması
- Eski dolgu maddesinin tamamen çıkarılamaması, kanal içinde alet kırılması veya delinme
- Seanslar arasında alevlenme, şişlik ve hassasiyet
- Mevcut kaplamanın yenilenmesinin gerekmesi
- İyileşme olmazsa kök ucu cerrahisi veya çekim gerekebilmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Kök ucu cerrahisi (apikal rezeksiyon) veya dişin çekilip yerinin protez ya da implantla tamamlanması
- Tedavi yapılmazsa iltihap ilerleyebilir, kemik kaybı ve diş kaybı gelişebilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Geçici dolgu varken o taraftan sert yiyecek çiğnemeyin
- Kalıcı üst yapının (dolgu veya kaplama) zamanında yapılmasını sağlayın
- Hekiminizin önereceği kontrol röntgenlerine gelin
- Şişlik, ateş veya artan ağrı olursa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('BEYAZLATMA-ONAM', 'Diş beyazlatma bilgilendirme ve onam', 'consent', true, null, 'Diş beyazlatma bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
DİŞ BEYAZLATMA BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Diş beyazlatma, diş yüzeyindeki ve içindeki renklenmelerin beyazlatıcı bir jel yardımıyla açılmasıdır. Klinikte uygulama, evde hekim kontrolünde plakla uygulama veya ikisi birlikte planlanabilir.
Beyazlatma yalnızca doğal dişlere etki eder; dolgu, kaplama ve protezlerin rengi değişmez.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Dişlerin renginin açılması ve daha aydınlık bir görünüm
- Diş dokusunun aşındırılmasına gerek kalmadan estetik iyileşme

OLASI RİSKLER VE YAN ETKİLER
- Uygulama sırasında ve sonrasında geçici diş hassasiyeti
- Jelin diş etine temasıyla geçici tahriş veya beyazlaşma
- Renk açılmasının kişiden kişiye farklı olması, bazı renklenmelerde sınırlı kalması
- Mevcut dolgu ve kaplamaların yeni diş rengine uymaması ve yenilenmesinin istenebilmesi
- Sonucun zamanla, özellikle renkli içecekler ve sigara ile azalması

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Profesyonel temizlik ve cila, kompozit bonding, lamine veneer veya işlem yapmamak
- Beyazlatma yapılmaması sağlık açısından bir sorun oluşturmaz

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Uygulamadan sonraki ilk günlerde çay, kahve, kola ve sigaradan uzak durun
- Ev plağını yalnızca hekiminizin anlattığı şekilde ve sürede kullanın
- Belirgin hassasiyet veya diş eti tahrişi olursa uygulamaya ara verip kliniği arayın
- Gebelik veya emzirme dönemindeyseniz uygulama öncesi hekiminize bildirin

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('KRON-KOPRU-ONAM', 'Kron ve köprü bilgilendirme ve onam', 'consent', true, null, 'Kron ve köprü bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
KRON VE KÖPRÜ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Kron (kaplama), dişin tamamını saran sabit bir yapıdır. Köprü ise eksik dişin iki yanındaki dişlerden destek alarak boşluğu kapatan sabit bir protezdir.
Dişler belirli ölçüde aşındırılır, ölçü alınır, gerekirse geçici kaplama takılır ve son yapı dişlere yapıştırılır. Aşındırma geri alınamaz.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Zayıflamış dişin güçlendirilmesi ve kırılmaya karşı korunması
- Eksik dişin sabit olarak tamamlanması; çiğneme ve görünümün iyileşmesi

OLASI RİSKLER VE YAN ETKİLER
- Aşındırma sonrası hassasiyet; nadiren sinir iltihabı ve kanal tedavisi gereksinimi
- Geçici kaplamanın düşmesi veya kırılması
- Seramik veya kaplama malzemesinde kırılma, çatlama, yapıştırıcının çözülmesi
- Kaplama kenarında çürük veya diş eti çekilmesi; köprü altında yemek birikmesi
- Destek dişlerden birinde sorun olursa köprünün tamamının yenilenmesinin gerekebilmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Büyük dolgu veya inley-onley, implant destekli kron, hareketli bölümlü protez
- Tedavi yapılmazsa zayıf diş kırılabilir, boşluğa komşu dişler kayabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Geçici kaplama ile yapışkan ve sert yiyeceklerden kaçının
- Köprü altını diş ipi geçirici veya ara yüz fırçasıyla temizleyin
- Isırmada yükseklik, ağrı veya sallanma fark ederseniz kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('TAM-PROTEZ-ONAM', 'Tam ve bölümlü hareketli protez bilgilendirme ve onam', 'consent', true, null, 'Tam ve bölümlü hareketli protez bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
TAM VE BÖLÜMLÜ HAREKETLİ PROTEZ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Hareketli protez, hastanın takıp çıkarabildiği bir yapıdır. Tam protez çenede hiç diş olmadığında, bölümlü protez ise bazı dişler mevcutken kullanılır.
Tedavi birkaç ölçü, kayıt ve prova seansı ile teslim ve teslim sonrası düzeltme randevularını içerir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Çiğneme ve konuşmanın iyileştirilmesi
- Yüz ve dudak desteğinin, görünümün düzeltilmesi

OLASI RİSKLER VE YAN ETKİLER
- Alışma döneminde baskı yaraları, bulantı hissi, tükürük artışı ve konuşmada geçici değişiklik
- Özellikle alt tam protezde tutuculuğun sınırlı olması
- Zamanla kemik erimesine bağlı uyumun bozulması ve besleme ya da yenileme gereksinimi
- Protezin kırılması veya bölümlü protezde kroşelerin zamanla gevşemesi
- Temizlik yetersiz olursa ağız mantarı, kötü koku, destek dişlerde çürük

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- İmplant destekli hareketli veya sabit protez, uygunsa sabit köprü
- Tedavi yapılmazsa çiğneme ve konuşma güçlüğü sürebilir, kalan dişler kayabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Protezi her yemekten sonra çıkarıp yumuşak fırça ve uygun temizleyiciyle temizleyin
- Hekiminiz başka bir öneride bulunmadıkça geceleri protezi çıkararak dokuların dinlenmesini sağlayın
- Yara oluşursa protezi kendiniz törpülemeyin; kliniği arayın
- Düzenli kontrollere gelin

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('IMPLANT-USTU-ONAM', 'İmplant üstü protez bilgilendirme ve onam', 'consent', true, null, 'İmplant üstü protez bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
İMPLANT ÜSTÜ PROTEZ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
İmplant üstü protez, kemikle kaynaşmış implantların üzerine yapılan kron, köprü veya hareketli protezdir. Vidalı ya da yapıştırmalı olarak sabitlenebilir; hareketli türleri implantlara tutunur.
Tedavi ölçü, prova ve teslim aşamalarını içerir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Eksik dişlerin implant desteğiyle sabit veya iyi tutunan biçimde tamamlanması
- Çiğneme gücünün ve konuşmanın iyileşmesi

OLASI RİSKLER VE YAN ETKİLER
- Vidanın gevşemesi, protezin sökülmesi veya seramikte kırılma
- Hareketli türlerde tutucu parçaların zamanla aşınıp değiştirilmesinin gerekmesi
- Protez altında yemek birikmesi; temizlik yetersizse implant çevresi iltihabı
- Görünüm ve diş eti seviyesinin doğal dişten farklı olabilmesi
- Diş sıkma ve gıcırdatmanın protez ve implantlara aşırı yük bindirmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Farklı protez türleri (vidalı, yapıştırmalı, hareketli) arasında hekiminizle seçim yapılabilir
- Protez yapılmazsa implant işlev görmez ve bölgede çiğneme yapılamaz

İŞLEM SONRASI DİKKAT EDİLECEKLER
- İmplant çevresini ara yüz fırçası, diş ipi veya ağız duşuyla her gün temizleyin
- Gece diş sıkıyorsanız koruyucu plak kullanın
- Sallanma, ses veya ağrı fark ederseniz kliniği arayın
- Yılda en az bir kez kontrol ve profesyonel temizlik yaptırın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('SINUS-LIFT-ONAM', 'Sinüs tabanı yükseltme ve kemik grefti bilgilendirme ve onam', 'consent', true, null, 'Sinüs tabanı yükseltme ve kemik grefti bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
SİNÜS TABANI YÜKSELTME VE KEMİK GREFTİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Üst çene arka bölgede kemik yüksekliği implant için yetersizse, sinüs boşluğunun tabanındaki zar dikkatle kaldırılır ve altına kemik grefti yerleştirilir. Bu işleme sinüs tabanı yükseltme denir.
Diğer bölgelerde de kemik eksikliği kemik grefti ve gerekirse zar (membran) ile tamamlanabilir. Greft, hastanın kendi kemiği veya hazır greft malzemesi olabilir. İmplant aynı seansta veya iyileşmeden sonra yerleştirilebilir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- İmplant yerleştirmek için yeterli kemik hacmi oluşturulması
- Daha uzun dönemde implant desteği sağlanmasına katkı

OLASI RİSKLER VE YAN ETKİLER
- Şişlik, morarma, ağrı ve burun kanaması
- Sinüs zarının yırtılması; işlemin ertelenmesi veya farklı yöntem gerekmesi
- Sinüs iltihabı, burun tıkanıklığı veya akıntı
- Greftin tutmaması, enfeksiyonu veya bir kısmının kaybı
- Ek kemik alınan bölgede ağrı ve şişlik
- Gereken kemik oluşmazsa işlemin tekrarı veya planın değişmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Daha kısa implantlar, farklı açılı implant yöntemleri, sabit köprü veya hareketli protez
- İşlem yapılmazsa bölgeye standart implant yerleştirilemeyebilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Hekiminiz izin verene kadar sert burun sümkürmeyin, hapşırırken ağzınızı açık tutun
- Pipet kullanmayın, sigara içmeyin, ağır egzersizden kaçının
- Uçak yolculuğu ve dalış için hekiminize danışın
- Burundan greft parçacığı gelmesi, ateş veya artan ağrı olursa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('PERIO-BASLANGIC-ONAM', 'Diş taşı temizliği ve kök yüzeyi düzleştirme bilgilendirme ve onam', 'consent', true, null, 'Diş taşı temizliği ve kök yüzeyi düzleştirme bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
DİŞ TAŞI TEMİZLİĞİ VE KÖK YÜZEYİ DÜZLEŞTİRME BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Diş taşı temizliği, diş yüzeyinde ve diş eti kenarında biriken sertleşmiş plağın el aletleri veya ultrasonik cihazlarla temizlenmesidir.
Kök yüzeyi düzleştirme ise diş eti cebinin derinlerindeki taş ve bakteri birikintilerinin temizlenip kök yüzeyinin pürüzsüz hale getirilmesidir. Gerekirse lokal anestezi uygulanır ve tedavi bölgelere ayrılarak birkaç seansta yapılabilir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Diş eti iltihabının ve kanamanın azalması
- Diş eti ceplerinin sığlaşmasına katkı
- Ağız kokusunun azalması ve daha kolay ağız bakımı

OLASI RİSKLER VE YAN ETKİLER
- Birkaç gün süren diş eti hassasiyeti ve hafif kanama
- Sıcak-soğuk hassasiyeti
- İltihap azaldıkça diş eti seviyesinin bir miktar çekilmesi ve diş aralarında boşluk görünümü
- Taşın daha önce bir arada tuttuğu sallantılı dişlerde hareketin belirginleşmesi
- Mevcut dolgu ve kaplama kenarlarının daha görünür hale gelmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Yalnızca evde bakımın güçlendirilmesi (iltihap varsa yeterli olmayabilir), ileri vakalarda cerrahi tedavi
- Tedavi yapılmazsa diş eti hastalığı ilerleyebilir, kemik kaybı ve diş kaybı gelişebilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- İlk günlerde yumuşak fırçayla nazikçe fırçalayın, ara yüz temizliğini bırakmayın
- Hassasiyet için hekiminizin önerdiği ürünleri kullanın
- Yeniden değerlendirme randevusuna mutlaka gelin

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('PERIO-CERRAHI-ONAM', 'Periodontal cerrahi (flep) bilgilendirme ve onam', 'consent', true, null, 'Periodontal cerrahi (flep) bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
PERİODONTAL CERRAHİ (FLEP) BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Flep operasyonu, temizlikle yeterince iyileşmeyen derin diş eti ceplerinde, diş etinin lokal anestezi altında kaldırılarak kök yüzeylerinin ve kemiğin doğrudan görülerek temizlenmesidir.
Gerekirse kemik düzeltmesi yapılır veya kemik grefti ve zar uygulanır; diş eti dikişle yerine kapatılır.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Derin ceplerdeki birikintilerin daha etkili temizlenmesi
- Cep derinliğinin azaltılması ve evde temizliğin kolaylaşması
- Hastalığın ilerlemesinin yavaşlatılması

OLASI RİSKLER VE YAN ETKİLER
- Ağrı, şişlik, morarma ve kanama
- Diş eti çekilmesi; diş boylarının uzun görünmesi, ön bölgede estetik değişiklik
- Sıcak-soğuk hassasiyetinin artması
- Yara enfeksiyonu, dikişlerin açılması veya geç iyileşme
- Greft uygulandıysa greftin tutmaması
- Hastalığın düzenli bakım yapılmazsa tekrarlaması

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Cerrahi olmayan tedavinin tekrarı ve yakın izleme; korunamayan dişlerin çekimi
- İşlem yapılmazsa derin ceplerde iltihap sürebilir, kemik kaybı ilerleyebilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- İlk gün soğuk uygulayın, işlem bölgesini fırçalamayın; hekimin önerdiği gargarayı anlatıldığı gibi kullanın
- Yumuşak ve ılık besinler tercih edin, sigara içmeyin
- Dikiş alma ve kontrol randevularına gelin
- Kanama durmazsa veya şişlik artarsa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('DISETI-GREFT-ONAM', 'Diş eti grefti bilgilendirme ve onam', 'consent', true, null, 'Diş eti grefti bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
DİŞ ETİ GREFTİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Diş eti grefti, çekilmiş veya incelmiş diş eti bölgelerini güçlendirmek ya da açıkta kalan kök yüzeyini örtmek amacıyla yapılan bir cerrahi işlemdir.
Doku çoğunlukla damaktan alınır; bazı durumlarda hazır doku malzemeleri kullanılabilir. İşlem lokal anestezi altında yapılır ve dikişle tamamlanır.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Diş eti çekilmesinin ilerlemesinin yavaşlatılması
- Açıkta kalan kök yüzeyinin örtülmesi ve hassasiyetin azalması
- Diş eti görünümünün iyileştirilmesi

OLASI RİSKLER VE YAN ETKİLER
- Doku alınan damak bölgesinde birkaç gün süren ağrı ve kanama
- Şişlik, morarma ve hassasiyet
- Greftin kısmen veya tamamen tutmaması
- Kök yüzeyinin beklenen ölçüde örtülememesi; diş eti renk ve kalınlığının çevreden farklı olması
- Enfeksiyon veya geç iyileşme

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Fırçalama alışkanlığının düzeltilmesi ve düzenli izleme, hassasiyet giderici uygulamalar, dolgu ile kök yüzeyinin kapatılması
- İşlem yapılmazsa çekilme ilerleyebilir, hassasiyet ve kök çürüğü riski artabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- İşlem bölgesini hekiminiz izin verene kadar fırçalamayın ve dudağınızı çekerek bakmayın
- Varsa damak koruyucu plağı anlatıldığı gibi kullanın
- Sıcak, sert ve baharatlı yiyeceklerden kaçının, sigara içmeyin
- Kanama durmazsa veya şişlik artarsa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('KRON-BOYU-ONAM', 'Kron boyu uzatma bilgilendirme ve onam', 'consent', true, null, 'Kron boyu uzatma bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
KRON BOYU UZATMA BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Kron boyu uzatma, dişin diş eti üzerinde kalan kısmını artırmak için diş eti ve gerekirse çevre kemiğin bir miktar düzenlenmesidir.
Çoğunlukla diş eti seviyesinin altına uzanan çürük veya kırıklarda dolgu ya da kaplamanın sağlıklı yapılabilmesi için ya da estetik amaçla uygulanır. İşlem lokal anestezi altında yapılır.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Yapılacak dolgu veya kaplamanın sağlam bir diş yüzeyine oturması
- Diş eti sağlığının korunmasına katkı; estetik vakalarda diş eti çizgisinin düzenlenmesi

OLASI RİSKLER VE YAN ETKİLER
- Ağrı, şişlik ve hassasiyet
- Diş boyunun uzun görünmesi, diş aralarında boşluk oluşması
- Kök yüzeyi açığa çıktığı için sıcak-soğuk hassasiyeti
- Komşu dişlerde de diş eti seviyesinin değişebilmesi
- İyileşme sürecinde diş eti seviyesinin bir miktar değişmesi; nihai kaplama için bekleme gerekmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Ortodontik yolla dişin yukarı çekilmesi, dişin çekilip implant veya köprü yapılması
- İşlem yapılmazsa yapılacak restorasyonun uyumu ve ömrü olumsuz etkilenebilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- İşlem bölgesini ilk günlerde nazikçe temizleyin, hekimin önerdiği gargarayı kullanın
- Yumuşak besinler tercih edin, sigara içmeyin
- Kalıcı kaplama için önerilen iyileşme süresini bekleyin

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('FRENEKTOMI-ONAM', 'Frenektomi bilgilendirme ve onam', 'consent', true, null, 'Frenektomi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
FRENEKTOMİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Frenulum, dudağı veya dili ağız içine bağlayan ince doku bandıdır. Frenektomi, bu bandın kısa ya da kalın olduğu ve sorun yarattığı durumlarda gevşetilmesi veya çıkarılmasıdır.
İşlem lokal anestezi altında, bisturi veya lazer ile yapılabilir; gerekirse dikiş atılır.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Dil veya dudak hareketinin rahatlaması
- Diş eti çekilmesine yol açan çekmenin azaltılması
- Ortodontik tedavide diş arası boşluğun kapanmasının desteklenmesi; protez uyumunun iyileşmesi

OLASI RİSKLER VE YAN ETKİLER
- Hafif ağrı, şişlik ve kanama
- İyileşme döneminde yemek ve konuşmada geçici rahatsızlık
- Yara yerinde skar dokusu oluşması veya bandın yeniden oluşması
- Enfeksiyon veya geç iyileşme
- Dil frenulumu işlemlerinde konuşma güçlüğü varsa, ek konuşma terapisi gerekebilmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- İzleme, ortodontik veya konuşma terapisi gibi cerrahi olmayan yaklaşımlar
- İşlem yapılmazsa mevcut çekme, hareket kısıtlılığı veya boşluk sorunu sürebilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Hekiminizin önerdiği dil ve dudak egzersizlerini düzenli yapın
- İlk günlerde sıcak, sert ve baharatlı yiyeceklerden kaçının
- Kanama durmazsa veya şişlik artarsa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('APIKAL-REZ-ONAM', 'Apikal rezeksiyon bilgilendirme ve onam', 'consent', true, null, 'Apikal rezeksiyon bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
APİKAL REZEKSİYON BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Apikal rezeksiyon (kök ucu cerrahisi), kanal tedavisine rağmen kök ucunda iltihabı süren dişlerde, diş eti açılarak kök ucunun ve çevresindeki iltihaplı dokunun temizlenmesi ve kök ucunun kapatılmasıdır.
İşlem lokal anestezi altında yapılır, yara dikişle kapatılır. Çıkarılan doku gerekirse patolojik incelemeye gönderilir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Dişin çekilmeden korunmasına yönelik bir seçenek sunması
- Kök ucundaki iltihabın ve tekrarlayan şişliğin azaltılması

OLASI RİSKLER VE YAN ETKİLER
- Ağrı, şişlik, morarma ve kanama
- Diş eti çekilmesi veya ön bölgede yara izi
- Komşu sinir, sinüs veya dişlerin etkilenmesi; geçici uyuşukluk
- Kök boyunun kısalmasına bağlı dişte sallanma artışı
- İyileşmenin gerçekleşmemesi ve dişin ileride çekilmesinin gerekebilmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Kanal tedavisinin yenilenmesi, dişin çekilip yerine implant veya köprü yapılması
- İşlem yapılmazsa iltihap sürebilir, kemik kaybı artabilir ve diş kaybedilebilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- İlk gün soğuk uygulayın, işlem bölgesiyle çiğnemeyin
- Dudağınızı çekip yarayı kontrol etmeyin
- Dikiş alma ve kontrol röntgeni randevularına gelin
- Şişlik artarsa veya ateş olursa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('KIST-ONAM', 'Kist ve lezyon cerrahisi bilgilendirme ve onam', 'consent', true, null, 'Kist ve lezyon cerrahisi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
KİST VE LEZYON CERRAHİSİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Çene kemiğinde veya ağız içi yumuşak dokularda bulunan kist ya da başka bir oluşumun (lezyon) cerrahi olarak çıkarılmasıdır.
Çıkarılan doku, kesin tanı için patoloji laboratuvarına gönderilir. Büyük kistlerde önce boşaltma işlemi ve ardından ikinci bir operasyon planlanabilir. Kist ile ilişkili dişlerin tedavisi veya çekimi gerekebilir.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Oluşumun büyümesinin ve çevre dokulara zarar vermesinin önlenmesi
- Kesin tanının konulması
- Enfeksiyon ve ağrı kaynağının ortadan kaldırılması

OLASI RİSKLER VE YAN ETKİLER
- Ağrı, şişlik, morarma ve kanama
- Komşu dişlerin canlılığını yitirmesi ve kanal tedavisi gerekmesi
- Sinire yakın lezyonlarda dudak, çene veya dilde geçici, çok nadiren kalıcı uyuşukluk
- Üst çenede sinüs veya burun boşluğu ile bağlantı oluşması
- Kistin tekrarlaması; çok nadiren geniş kistlerde çene kırığı
- Patoloji sonucuna göre ek tedavi veya ileri merkeze yönlendirme gerekebilmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Küçük ve belirti vermeyen bazı oluşumlarda düzenli görüntüleme ile izleme
- İşlem yapılmazsa oluşum büyüyebilir, enfekte olabilir veya kemiği zayıflatabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Hekimin verdiği yara bakımı ve beslenme önerilerine uyun
- Patoloji sonucu için kontrol randevusuna mutlaka gelin
- Ateş, artan şişlik veya kanama olursa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('BIYOPSI-ONAM', 'Biyopsi ve patoloji incelemesi bilgilendirme ve onam', 'consent', true, null, 'Biyopsi ve patoloji incelemesi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
BİYOPSİ VE PATOLOJİ İNCELEMESİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Biyopsi, ağız içinde veya çevresinde görülen bir değişikliğin ne olduğunu anlamak için o bölgeden küçük bir doku parçası alınmasıdır. Lezyonun bir kısmı ya da tamamı alınabilir.
İşlem lokal anestezi altında yapılır. Alınan doku, uzman bir patolog tarafından incelenmek üzere laboratuvara gönderilir; sonucun çıkması belirli bir süre alır.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Doğru tanının konulması ve uygun tedavinin planlanması
- Ciddi bir hastalık varsa erken fark edilmesi

OLASI RİSKLER VE YAN ETKİLER
- Hafif ağrı, şişlik ve kanama
- Yara yerinde geçici rahatsızlık, nadiren enfeksiyon
- Bölgede küçük bir yara izi kalması
- Sinire yakın bölgelerde geçici uyuşukluk
- Alınan dokunun tanı için yeterli olmaması ve biyopsinin tekrarlanmasının gerekebilmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Kısa süreli izleme ve yeniden değerlendirme veya başka bir merkeze yönlendirme
- Biyopsi yapılmazsa kesin tanı konulamaz; tedavinin gecikmesi söz konusu olabilir

İŞLEM SONRASI DİKKAT EDİLECEKLER
- İşlem bölgesini ilk gün rahatsız etmeyin, sıcak ve baharatlı yiyeceklerden kaçının
- Sonucu öğrenmek ve sonraki adımı planlamak için kontrol randevusuna mutlaka gelin
- Patoloji sonucunun size ve gerektiğinde yönlendirildiğiniz hekime iletileceğini biliniz
- Kanama durmazsa veya şişlik artarsa kliniği arayın

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('SEFFAF-PLAK-ONAM', 'Şeffaf plak tedavisi bilgilendirme ve onam', 'consent', true, null, 'Şeffaf plak tedavisi bilgilendirme ve onam — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
ŞEFFAF PLAK TEDAVİSİ BİLGİLENDİRME VE ONAM FORMU
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İŞLEMİN TANIMI VE AMACI
Şeffaf plak tedavisi, dijital planlama ile üretilen ve belirli aralıklarla değiştirilen şeffaf plaklarla dişlerin adım adım hareket ettirilmesidir.
Dişlere küçük dolgu çıkıntıları (ataşman) yapıştırılabilir ve dişler arasında hafif aşındırma gerekebilir. Plakların günün büyük bölümünde takılı kalması tedavinin işlemesi için esastır.

PLANLANAN İŞLEMLER
{{plan.kalemler}}
Plan bağlanmadıysa hekim tarafından aşağıya yazılır: ____
______________________________________________

BEKLENEN YARARLAR
- Dişlerin daha düzgün dizilmesi ve kapanışın iyileşmesi
- Görünürlüğü az ve çıkarılabilir bir aparey
- Fırçalama ve diş ipi kullanımının kolay olması

OLASI RİSKLER VE YAN ETKİLER
- Yeni plak takıldığında birkaç gün süren baskı ve hassasiyet
- Plakların yeterli süre takılmaması halinde dişlerin planlanan hareketi yapmaması ve sürenin uzaması
- Ek plak (düzeltme) aşamaları veya ek aparey gerekebilmesi
- Plak takılıyken şekerli içecek tüketilmesine bağlı çürük riski
- Ataşmanların düşmesi; konuşmada geçici değişiklik
- Kök kısalması, diş eti çekilmesi, çene eklemi rahatsızlığı
- Pekiştirme aygıtı kullanılmazsa dişlerin eski konumuna dönmesi

ALTERNATİFLER VE TEDAVİ YAPILMAZSA
- Sabit braket tedavisi, hareketli aparey, protetik veya estetik düzeltmeler
- Tedavi yapılmazsa çapraşıklık ve kapanış bozukluğu sürer

İŞLEM SONRASI DİKKAT EDİLECEKLER
- Plakları yemek ve su dışındaki içeceklerden önce çıkarın, dişlerinizi fırçalayıp yeniden takın
- Plakları soğuk veya ılık suyla temizleyin; sıcak su ile yıkamayın
- Plak değiştirme takvimine ve kontrol randevularına uyun
- Kırılan veya kaybolan plağı kliniğe bildirin

HASTANIN BEYANI
- Planlanan işlemin amacı, beklenen yararları, olası riskleri ve alternatifleri hekimim tarafından bana sözlü olarak anlatıldı; bu yazılı metni okudum.
- Sorularımı sorma fırsatı buldum ve sorularım anlayabileceğim biçimde yanıtlandı.
- İşleme başlanmadan önce onamımı geri alabileceğimi biliyorum. Başlamış bir işlemin yarıda bırakılmasının ek sorunlara yol açabileceği bana açıklandı.
- Sağlık durumum, kullandığım ilaçlar, alerjilerim ve varsa gebelik durumum hakkında verdiğim bilgilerin doğru ve eksiksiz olduğunu beyan ederim.
- Tedavi sonucunun kişiden kişiye değişebileceğini ve bana kesin bir sonuç sözü verilmediğini anladım.
- Bu bilgiler ışığında planlanan işlemin yapılmasına kendi isteğimle onay veriyorum.

Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
(Yasal temsilci ise yakınlığı: ______________)
Hekim: {{hekim.ad}}   İmza: __________
Tarih: {{belge.tarih}}
', false),
('ORTO-SONU-BILGI', 'Ortodontik tedavi sonu ve pekiştirme bilgilendirmesi', 'information', false, null, 'Ortodontik tedavi sonu ve pekiştirme bilgilendirmesi — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
ORTODONTİK TEDAVİ SONU VE PEKİŞTİRME BİLGİLENDİRMESİ
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

PEKİŞTİRME (RETANSİYON) NEDİR
Aktif ortodontik tedavi bittikten sonra dişler ve çevre dokular yeni konuma uyum sağlamak için zamana ihtiyaç duyar. Bu dönemde dişler eski konumlarına dönme eğilimindedir.
Pekiştirme aygıtları, dişlerin yeni konumunda kalmasına yardımcı olur. Dişler yaşam boyu hafifçe hareket edebildiği için pekiştirme uzun süreli bir sorumluluktur.

SİZE UYGULANAN PEKİŞTİRME
[ ] Sabit (dişlerin arka yüzüne yapıştırılan) tel   Bölge: ______________
[ ] Hareketli şeffaf pekiştirme plağı
[ ] Hareketli telli pekiştirme apareyi
Kullanım süresi ve şekli (hekim tarafından doldurulur): ______________________________

BAKIM VE KULLANIM
- Hareketli aygıtı hekiminizin belirlediği süre boyunca takın; kullanmadığınızda kutusunda saklayın
- Aygıtı soğuk veya ılık suyla, yumuşak bir fırçayla temizleyin; sıcak suyla yıkamayın
- Sabit tel varsa çevresini diş ipi geçirici veya ara yüz fırçasıyla her gün temizleyin
- Sert yiyecekleri ön dişlerle ısırmaktan kaçının

KLİNİĞİ NE ZAMAN ARAMALISINIZ
- Sabit tel kopar, ayrılır veya batarsa
- Hareketli aygıt kırılır, kaybolur ya da artık oturmazsa
- Dişlerde aralanma veya kayma fark ederseniz

KONTROL
Pekiştirme kontrol randevusu: ____ . ____ . ________

Bu bilgilendirme {{belge.tarih}} tarihinde hastaya verilmiştir.

Bilgilendirmeyi aldım. Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
Bilgilendiren hekim: {{hekim.ad}}   İmza: __________
', false),
('IMPLANT-SONRASI-BILGI', 'İmplant sonrası bakım bilgilendirmesi', 'information', false, null, 'İmplant sonrası bakım bilgilendirmesi — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
İMPLANT SONRASI BAKIM BİLGİLENDİRMESİ
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

CERRAHİ SONRASI İLK GÜNLER
- İlk gün yüzünüze aralıklı soğuk uygulayın, başınızı yüksekte tutarak dinlenin
- Tükürmeyin, sert çalkalamayın, pipet kullanmayın
- Yumuşak ve ılık besinler tüketin; implant bölgesiyle çiğnemeyin
- Sigara ve alkolden uzak durun; sigara iyileşmeyi ve kemikle kaynaşmayı olumsuz etkileyebilir
- İlaçları yalnızca hekiminizin önerdiği şekilde kullanın
- Hareketli protez kullanıyorsanız hekiminiz izin verene kadar takmayın veya düzeltilmeden kullanmayın

İYİLEŞME DÖNEMİ
- İmplantın kemikle kaynaşması zaman alır; bu süre kişiye göre değişir ve hekiminiz tarafından belirlenir
- İyileşme başlığı varsa yumuşak fırçayla nazikçe temizleyin
- Kontrol ve dikiş alma randevularına mutlaka gelin

PROTEZ YAPILDIKTAN SONRA
- İmplant çevresini her gün ara yüz fırçası, implant için uygun diş ipi veya ağız duşu ile temizleyin
- Gece diş sıkıyorsanız hekiminizin önereceği koruyucu plağı kullanın
- Yılda en az bir kez kontrol ve profesyonel temizlik yaptırın

KLİNİĞİ NE ZAMAN ARAMALISINIZ
- Kanama, baskı uygulamanıza rağmen durmuyorsa
- Şişlik veya ağrı günler geçtikçe azalmak yerine artıyorsa
- Ateş, halsizlik ya da ağızda kötü tat ve koku oluşursa
- Yutma veya nefes almada güçlük hissederseniz (bu durumda en yakın acil servise de başvurun)
- İmplant veya üstündeki parçada sallanma, ses ya da kırılma fark ederseniz
- İmplant çevresinde diş eti kanaması, akıntı veya şişlik olursa

Bu bilgilendirme {{belge.tarih}} tarihinde hastaya verilmiştir.

Bilgilendirmeyi aldım. Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
Bilgilendiren hekim: {{hekim.ad}}   İmza: __________
', false),
('PROTEZ-TESLIM-BILGI', 'Protez teslimi ve yapıştırma bilgilendirmesi', 'information', false, null, 'Protez teslimi ve yapıştırma bilgilendirmesi — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
PROTEZ TESLİMİ VE YAPIŞTIRMA BİLGİLENDİRMESİ
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

TESLİM EDİLEN PROTEZ
{{plan.kalemler}}
Protez türü / bölge: ______________________________

SABİT PROTEZ (KRON, KÖPRÜ) İÇİN
- Yapıştırma sonrası hekiminizin söylediği süre boyunca yemek yemeyin
- İlk günlerde sert ve yapışkan yiyeceklerden kaçının
- Köprü altını ve kaplama kenarlarını diş ipi geçirici, ara yüz fırçası veya ağız duşu ile temizleyin
- Geçici sıcak-soğuk hassasiyeti olabilir; birkaç hafta içinde geçmezse bildirin

HAREKETLİ PROTEZ İÇİN
- Alışma döneminde konuşma ve çiğnemede zorluk, tükürük artışı olağandır; yumuşak ve küçük lokmalarla başlayın
- Protezi her yemekten sonra çıkarıp yumuşak fırça ve uygun temizleyiciyle temizleyin; diş macunu yüzeyi çizebilir
- Hekiminiz başka bir öneride bulunmadıkça geceleri çıkarıp temiz bir kapta saklayın
- Yara veya baskı noktası oluşursa protezi kendiniz törpülemeyin; düzeltme için randevu alın
- Protezi sıcak suda yıkamayın, yere düşürmemek için lavabonun üstünde suyla dolu bir kapla temizleyin

KLİNİĞİ NE ZAMAN ARAMALISINIZ
- Kaplama veya köprü sallanır, düşer ya da kırılırsa
- Isırmada yükseklik veya ağrı varsa
- Hareketli protez yara yapar veya kırılırsa
- Diş etinde şişlik, akıntı veya geçmeyen ağrı olursa

KONTROL
Teslim sonrası kontrol randevusu: ____ . ____ . ________   Saat: ______

Bu bilgilendirme {{belge.tarih}} tarihinde hastaya verilmiştir.

Bilgilendirmeyi aldım. Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
Bilgilendiren hekim: {{hekim.ad}}   İmza: __________
', false),
('CEKIM-SONRASI-BILGI', 'Çekim ve cerrahi sonrası bakım bilgilendirmesi', 'information', false, null, 'Çekim ve cerrahi sonrası bakım bilgilendirmesi — PİA-DENT DEMO', 'PİA-DENT ÖRNEK METİN (DEMO) — Kliniğinizin sorumlu hekimi ve hukuk danışmanı gözden geçirip onaylamadan kullanmayın.

{{klinik.ad}}
ÇEKİM VE CERRAHİ SONRASI BAKIM BİLGİLENDİRMESİ
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}}
Sorumlu hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

İLK GÜN
- Tamponu hekiminizin söylediği süre boyunca ısırarak tutun, sonra nazikçe çıkarın
- Tükürmeyin, ağzınızı sert çalkalamayın, pipetle içmeyin; oluşan pıhtı iyileşme için önemlidir
- Yüzünüze aralıklı olarak soğuk uygulayın
- Ilık veya soğuk, yumuşak besinler tüketin; işlem tarafıyla çiğnemeyin
- Sigara ve alkol kullanmayın; ağır egzersizden kaçının
- Başınızı biraz yüksekte tutarak dinlenin

SONRAKİ GÜNLER
- Dişlerinizi fırçalamaya devam edin, işlem bölgesine fırçayı değdirmeyin
- Hekiminiz önerdiyse ılık tuzlu su veya önerilen gargarayı nazikçe kullanın
- İlaçları yalnızca hekiminizin önerdiği şekilde kullanın
- Hafif şişlik ve morarma ilk günlerde artıp sonra azalabilir; bu olağandır
- Dikiş varsa alma randevusuna gelin; eriyen dikişler kendiliğinden düşebilir

KLİNİĞİ NE ZAMAN ARAMALISINIZ
- Kanama, baskı uygulamanıza rağmen durmuyorsa
- Şişlik veya ağrı günler geçtikçe azalmak yerine artıyorsa
- Ateş, halsizlik ya da ağızda kötü tat ve koku oluşursa
- Yutma veya nefes almada güçlük hissederseniz (bu durumda en yakın acil servise de başvurun)
- Ağrı birkaç gün sonra azalmak yerine belirgin şekilde artarsa
- Dudak, çene veya dilde uyuşukluk işlem gününden sonra da sürerse
- Üst çene işlemlerinden sonra burundan sıvı gelmesi veya ağız ile burun arasında hava geçişi hissederseniz

KONTROL RANDEVUSU
Kontrol / dikiş alma: ____ . ____ . ________   Saat: ______

Bu bilgilendirme {{belge.tarih}} tarihinde hastaya verilmiştir.

Bilgilendirmeyi aldım. Hasta / yasal temsilci adı soyadı: ______________________   İmza: __________
Bilgilendiren hekim: {{hekim.ad}}   İmza: __________
', false),
('EPIKRIZ', 'Epikriz / tedavi özeti', 'clinical_output', false, 'dentist', 'Epikriz — DEMO şablon', 'SENTETİK DEMO ŞABLON — klinik metin değildir.

{{klinik.ad}}
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}} ({{hasta.yas}} yaş)
Hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

EPİKRİZ / TEDAVİ ÖZETİ

Anamnez kritik işaretleri:
{{anamnez.kritik}}

Tanılar:
{{tani.liste}}

Uygulanan işlemler:
{{islem.liste}}

Hekim değerlendirmesi ve öneriler:
{{serbest.metin}}
', true),
('HASTA-FOYU', 'Hasta bilgi föyü (klinik)', 'clinical_output', false, 'dentist', 'Hasta bilgi föyü — DEMO şablon', 'SENTETİK DEMO ŞABLON — klinik metin değildir.

{{klinik.ad}}
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}} ({{hasta.yas}} yaş)
Hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

HASTA BİLGİ FÖYÜ

Anamnez kritik işaretleri:
{{anamnez.kritik}}

Tanılar:
{{tani.liste}}

Planlanan işlemler:
{{plan.kalemler}}

Notlar:
{{serbest.metin}}
', true),
('RECETE', 'Reçete yazısı (e-reçete değildir)', 'clinical_output', false, 'dentist', 'Reçete yazısı — DEMO şablon', 'SENTETİK DEMO ŞABLON — klinik metin değildir.

{{klinik.ad}}
Hasta: {{hasta.ad_soyad}} · Dosya no: {{hasta.dosya_no}} · Doğum tarihi: {{hasta.dogum_tarihi}} ({{hasta.yas}} yaş)
Hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}

REÇETE YAZISI (yazılı; e-reçete değildir)

Tanı:
{{tani.liste}}

İlaçlar ve kullanım:
{{serbest.metin}}

Hekim imza/kaşe: ________________
', true);

select app.for_each_tenant($q$
  insert into document_types(tenant_id, code, name, category, requires_acceptance, issuer_role)
  select app.tenant_id(), s.code, s.name, s.category, s.req, s.issuer from std_docs s
   where not exists (select 1 from document_types d where d.code = s.code)
$q$);

select app.for_each_tenant($q$
  with author as (select m.user_id from memberships m where m.role = 'clinic_admin' and m.status = 'active' order by m.created_at limit 1),
  need as (
    select d.id as type_id, s.tname, s.body from document_types d join std_docs s on s.code = d.code
     where d.active and not exists (select 1 from templates tp join template_versions v on v.template_id = tp.id and v.status = 'approved' where tp.document_type_id = d.id)),
  tp as (
    insert into templates(tenant_id, document_type_id, name, created_by)
    select app.tenant_id(), n.type_id, n.tname, a.user_id from need n cross join author a returning id, document_type_id)
  insert into template_versions(tenant_id, template_id, version, status, body, body_hash, is_demo, change_note, created_by, approved_by, approved_at)
  select app.tenant_id(), tp.id, 1, 'approved', n.body, encode(sha256(convert_to(n.body, 'UTF8')), 'hex'), true,
         'PİA-DENT standart DEMO şablonu (ADR-104)', a.user_id, a.user_id, now()
    from tp join need n on n.type_id = tp.document_type_id cross join author a
$q$);

select app.for_each_tenant($q$
  insert into template_versions(tenant_id, template_id, version, status, body, body_hash, is_demo, change_note, created_by, approved_by, approved_at)
  select app.tenant_id(), v.template_id, v.version + 1, 'approved', s.body, encode(sha256(convert_to(s.body, 'UTF8')), 'hex'), true,
         'PİA-DENT standart DEMO metni (ADR-104): ilk kurulum yer tutucusunun yerine', v.created_by, v.created_by, now()
    from template_versions v join templates tp on tp.id = v.template_id join document_types d on d.id = tp.document_type_id join std_docs s on s.code = d.code
   where v.status = 'approved' and not s.clinical and v.body like 'SENTETİK DEMO BELGESİ%'
     and v.version = (select max(x.version) from template_versions x where x.template_id = v.template_id)
     and not exists (select 1 from template_versions dr where dr.template_id = v.template_id and dr.status = 'draft')
$q$);

select app.for_each_tenant($q$
  update template_versions v set status = 'retired'
   where v.status = 'approved' and v.body like 'SENTETİK DEMO BELGESİ%'
     and exists (select 1 from template_versions n where n.template_id = v.template_id and n.status = 'approved' and n.version > v.version)
$q$);
