# Finans — kasa ve gün sonu (1 sayfa)

**Finans → PİA Net.** Günlük özet (işlem tutarı ≠ tahsilat), hasta bakiyeleri, kasa ve banka, giderler, hekim primi, ayarlar. Her tutar kayıtlı tutardır; KDV gösterimi mali müşavir onayı bekler (ekranda yazılı).
![Finans](img/30-finans-ozet.jpg)

**Hasta hesabı.** Alacaklar, ödemeler, dağıtım, avans, iade. Silme yoktur: hata ters kayıt/iade ile düzeltilir ve gerekçe ister. Açılış bakiyeleri "açılış bakiyesi" kaynağıyla tek satırdır.
![Hasta hesabı](img/31-finans-hasta-hesap.jpg)

**Gün sonu.** Raporlar → Nakit hareketleri / Kasa; toplam = alt satırlar; CSV ile eski sistemle paralel karşılaştırma (pilotta 2 hafta).

**Borç bakiye raporu.** Yaşlandırma (0–30 / 31–60 / 61–90 / 90+), avans ayrı; satırdan hastanın hesabına inilir.
![Borç bakiye](img/33-finans-rapor-borc.jpg)

**Operasyon.** Tedarikçi carisi (fatura/ödeme/ters kayıt), stok (lot/SKT), laboratuvar maliyeti.
![Operasyon](img/32-operasyon.jpg)

**Güvenlik.** Finans rolünde iki adımlı doğrulama zorunlu olabilir: Hesabım → kurulum; 8 kurtarma kodunu saklayın.

**Makbuz ve fatura taslağı (02.11.2026).** Tahsilat/iade makbuzları otomatik numaralanır (TM/IM). Hasta 360 → Finans → **Fatura taslakları → Taslak oluştur**: şahıs (e-Arşiv) / kurum (e-Fatura, VKN zorunlu), satır başına KDV (%0/1/10/20), açık alacaktan satır ekleme. PİA-DENT fatura numarası üretmez: e-belge sağlayıcısı bağlı değilken "Sağlayıcıya gönder" reddedilir ve taslak saklanır; MOCK bağlantıda numara `MOCK…` ile başlar ve resmî değildir. Düzenlenmiş fatura yalnız sağlayıcı üzerinden iptal edilir.
**Raporlar.** Her raporda **CSV** ve **Excel** düğmesi (aynı satır ve toplamlar). **Mali müşavir dönem dökümü**: makbuz no, tür, karşı taraf, yöntem, kasa, tutar — resmî muhasebe fişi değildir.
