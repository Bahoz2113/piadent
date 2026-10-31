# VİADENT — Ürün Gereksinimleri (PRD)

> Kaynak: `VIADENT_Plan.pdf` (22.10.2026) ve `VIADENT_Claude_Prompt.pdf`. Bu belge planın uygulanabilir özetidir; plan ile çelişki olursa plan esastır ve fark `decisions.md`'ye yazılır.

## Ürün vaadi
“Kliniğin bugün ne yapacağını, hastanın sıradaki adımını ve paranın nerede olduğunu tek bakışta göster.”
Hekimin işini hızlandır, sekreteryanın takibini kolaylaştır, klinik sahibine hesabını açıkla.

## Hedef segment (ilk varsayım)
Türkiye'de tek şubeli, birkaç hekimli özel diş klinikleri. Üç pilot klinikle doğrulanacak (F0). Çok şube aynı temelin üzerine eklenir.

## Beş ürün ilkesi
1. Bugün ne yapılacağı açık olsun (VİA Akış).
2. Hasta yolculuğu kopmasın (randevu → plan → seans → belge → ödeme → kontrol aynı geçmişte).
3. Hesap açıklanabilir olsun (işlem bedeli, alacak, tahsilat, avans, iade, vade ayrı).
4. Kendi imzamız görünsün (VİA Akış, VİA Net, VİA İz; özgün tasarım ve metin).
5. Taşınabilir ve işletilebilir olsun (yedek, geri yükleme, dışa aktarım, açılış baştan tasarımda).

## Gezinme
Bugün · Hastalar · Ajanda · Tedavi · Finans · Operasyon · Raporlar · Yönetim. Alt sayfalar role göre görünür.
Hasta 360: sabit kimlik özeti + Özet / Tedavi / Finans / Sağlık / Belgeler / İletişim / Geçmiş sekmeleri.

## Kapsam katmanları
| Katman | İçerik |
|---|---|
| **P0 satılabilir çekirdek** | V01 temel güvenlik; V02 hasta ve dosya; V03 takvim; V04 plan/işlem; V05 nakit/kart/banka hareket kaydı ve hasta hesabı; V06 temel şablon ve kayıt; V09 temel günlük metrikler; V11 açılış, yedek, dışa aktarım |
| **P1 operasyon olgunluğu** | Laboratuvar, hekim primi, iletişim sağlayıcıları, e-belge, doğrulanmış belge/onay, temel stok ve tedarik, banka mutabakatı, hasta portalı, kullanım raporları |
| **P2 geniş ERP** | Çok şube karşılaştırması, gelişmiş stok/lot/sterilizasyon, cihaz bakımı, onaylı satın alma, bütçe/maliyet, sağlık turizmi |
| **Kapsam dışı (ilk sürüm)** | Bordro, tam genel muhasebe, SGK/MEDULA, PACS/DICOM, otomatik klinik karar |

## İlk çalışan demo (kabul akışı)
Hasta oluştur → randevu ver → geliş kaydet → tedavi planı ve işlem → tahsilat → açık bakiye → kontrol görevi.
Gerçek veritabanında kalıcı; veriler tamamen sentetik. Geçişi ekran sayısı değil akışın kabul testleri belirler.

**Bu oturum sonunda çalışan kısım:** hasta oluştur → randevu ver → geliş kaydet → VİA Akış görevleri → VİA İz geçmişi. Tedavi/tahsilat Görev 2–3.

## İmza özellikleri
| Özellik | Öncelik | Kabul koşulu | Durum |
|---|---|---|---|
| VİA Akış | P0 | Aynı olay aynı görev türünde bir kez; tamamlanan iş kapanır; yetkisiz kişi finans/klinik ayrıntı göremez | **Temel sürüm çalışıyor** (3 görev türü, otomatik kapanış, hassasiyet filtresi) |
| VİA Net | P0 | Alt kayıt toplamı üst toplamı verir; ödeme borçla karışmaz | Görev 3 |
| VİA İz | P0 | Yalnız değişen alanlar; boş değer “Belirtilmedi”; sırlar loga yazılmaz | **Hasta bazlı çalışıyor** |
| VİA Yolculuk | P0/P1 | Plan sürümü, seans, ödeme kaynağa bağlı | Görev 2–3 sonrası |
| VİA Hazır | P1 | Eksik belge nedeni; otomatik tıbbi karar yok | Görev 4 |
| VİA Denge | P1 | Öneri rezervasyon değildir; seçimde çakışma yeniden kontrol | Sonra |
| VİA Köprü | P1 | Sağlayıcı kabulü ≠ nihai başarı; aynı webhook iki kayıt doğurmaz | Görev 5 |
| VİA Asistan | P2, isteğe bağlı | Çıktı taslaktır; onaysız işlem yok | Veri kalitesi ve yetki modeli sonrası |

## Ölçülecek pilot sonuçları
Randevu oluşturma ve tahsilat kaydetme süresi; günlük takiplerin kapanma oranı; açıklanamayan hesap farkları; işe alışma destek ihtiyacı; kritik hata sayısı. Başlangıç değerleri ölçülmeden kazanım yüzdesi yazılmaz.

## Satış kapısı
P0 prototipinin çalışması tüm kliniklere satışa hazır olmak değildir. Hedef kuruluşun sağlık, e-belge, kişisel veri ve entegrasyon gereklilikleri kapanmadan “tam uyumlu”, “Bakanlık onaylı” ifadeleri kullanılmaz.

## Kaynak sınırları
Macrodental kaynak envanteri (Ek A 80 kayıt, Ek B 45 başlık) yalnız ihtiyaç ve gözlem referansıdır; kod, ekran düzeni, logo, renk, metin ve onam içerikleri kopyalanmaz. Kanıt seviyeleri (`Ekran görüldü` / `Kısmi ekran` / `Yalnız menü veya kontrol`) `traceability.csv`'de korunur. Her kaynak ID'si için karar: uygulanacak / yeniden tasarlanacak / ertelenecek / uygulanmayacak.
