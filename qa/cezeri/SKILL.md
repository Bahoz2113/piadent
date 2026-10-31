---
name: cezeri-teslim-testi
description: Teslim adayını gerçek oturumlarla sına, düzelttir ve yeniden sına.
disable-model-invocation: false
---
Hedef: $ARGUMENTS. Türkçe raporla. Tester ürün kodunu değiştirmez.
Her teslim adayı için bu süreci başından sonuna yürüt.

1. Sürümü, kirli dosyaları, ortamı ve bağımlılıkları kaydet.
Test ortamını, veri deposunu ve dış servislerin test kipini doğrula.
Gerçek hesap yerine sentetik yetkili/standart kullanıcılar kullan.
Kimlik bilgilerini güvenli ortamdan al; kayda veya trace'e koyma.
Hedef doğrulanamıyorsa salt okunur keşfi sürdür; dinamikleri engelle.

2. Menü, ekran, form alanı, filtre, ayar, API parametresi, CLI
bayrağı, görev, rol ve entegrasyonları depodan ve çalışan üründen
çapraz envanterle. Platform, parametre, rol, koşul ve kabul kaynağı
için sabit kimlik ver. NA için gerekçe yaz. Keşfedilemeyen parçayı
açık tut. Zorunlu vaka ID'leri ve profilleri plan.json'da kilitle.
Yeni bulunan kapsamı ekle; önceki vakayı sessizce çıkarma.

3. Form ve API alanlarında geçerli, eksik, boş, sınır, sınır dışı,
hatalı tip/biçim, Unicode ve rol ihlallerini dene. Bağımlı alanlar
ve durum geçişlerini birleştir. Sonlu kritik değerleri tek tek,
büyük kombinasyonları risk temelli ikili kapsama ile seç. Atlanan
değer ve kombinasyonları yaz. Belirsiz beklentiyi BEKLET olarak aç.
4. İzole kullanıcı oturumuyla gerçek giriş yap. Yetkili ve yetkisiz
rolü ayrı oturumlarda kullan. Başarısız giriş, çıkış ve oturum
süresini de dene. Tarayıcıda tıkla, yaz, kaydet, yeniden aç.
Kullanıcının gördüğünü API/veritabanı sonucu ile karşılaştır.
Telefonu uzaktan kumanda, mobil emülasyon ve fiziksel cihaz olarak
ayrı kaydet. CLI ürününde komut, stderr, çıktı ve çıkış kodunu sına.
VS Code ürünü varsa gerçek uzantı ortamını doğrula.

5. Mevcut derleme ve testleri çalıştır. Veri geçişi, geri yükleme,
eşzamanlı çift işlem, yeniden deneme, ağ kesintisi, erişilebilirlik,
performans ve platform uyumunu kapsama göre sına. Yan etkiyi test
kopyasıyla sınırla. Hızı tanımlı yük ve eşikle ölç. Zorunlu kabul
eşiği eksikse ölçümü raporla ve kararı beklet. Klinik/cihaz doğrulama
için gerçek cihaz ve yetkili insan gerektiren adımları açık tut.

6. Her vaka durumunu PASS, FAIL, FLAKY, BLOCKED, NOT_RUN veya NA
kaydet. Komut, sürüm, zaman, rol, girdi, beklenen, gözlenen, çıkış
kodu ve maskeli kanıtı ilişkilendir. Sıfır test geçiş değildir.
İlk başarısızlığı koru, temiz veride tekrar et. Aralıklı başarısızlık
FLAKY'dir. Tekrarda geçmesi kusuru kapatmaz. Test ortamı arızasını
ürün kusurundan ayır. Gizlilik ihlalinde tekrarı bekleme.

7. Bulguda sabit ID, etki ve sorumlu tut. S0 veri sızıntısı/kaybı,
güvensiz kullanım; S1 kritik iş akışı; S2 diğer işlev veya ölçülmüş
performans kusuru; S3 düşük etkili kusur. Her doğrulanmış bulguyu
kodlamaya devret. Hipotezi ve ölçülmemiş yavaşlığı ayrı kaydet.
8. qa-runs/<benzersiz-id>/ altında plan.json, results.json, bugs.md,
handoff.md, release.md ve maskeli evidence/ üret. Alt ajan
cezeri-duzeltici'yi handoff.md ile çağır; revizyon ve değişiklik
kanıtını geri al. Alt ajan yoksa ayrı kodlama oturumuna aynı paketi
devret, BEKLET kaydet ve yeni revizyon gelince buradan devam et.
Ürün yamasını tester yazmaz. Üretime gönderme ve canlı işlem yok.

9. Yeni kodu test ortamında derle/yükle. Gerçek sürümü doğrula.
Eski başarısız vaka, komşu akış, tam regresyon ve hedef platformları
yeniden koş. Test beklentisinin, kanıtın veya planın gevşetilmediğini
kontrol et. Düzeltme tekrarlandıysa REOPENED olarak geri gönder.
Yeni kusuru yeni ID ile aynı döngüye al. Eski koşuyu değiştirme.
Aynı bulguda iki ardışık turda ilerleme yoksa tanı ve sorumlu ile
BEKLET; yeni girdi/değişiklik geldiğinde aynı kayıtlarla sürdür.

10. gate.cjs ile results.json denetle. JSON alanları PDF'deki örnekle
eşleşsin. requiredIds ve profilleri kilitli planla karşılaştır.
Eksikse BEKLET. Açık S0/S1 için DURDUR; başka açık bulgu, eksik
kanıt, zorunlu test dışarıda, FLAKY veya engel varsa BEKLET.
Yalnız tüm zorunlu vakalar ve tam regresyon geçtiğinde, tanımlı
kapsamda her seviyede açık doğrulanmış bulgu sıfırsa TESLİME ADAY.
Kapsam, denenmeyen kombinasyonlar ve nihai insan onayını kaydet.
Özet araç programı kullanılamazsa bunu engel olarak raporla.
