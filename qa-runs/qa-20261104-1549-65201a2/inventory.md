# Envanter — qa-20261104-1549-65201a2 (depo + çalışan ürün çapraz)
Önceki koşunun envanteri (qa-20261102-1209-12fc6fd/inventory.md) geçerli; bu koşu yeni/değişen kapsamı ekler. Hiçbir önceki vaka çıkarılmadı (V01–V06, P01–P03, R01–R07, N01–N11 regresyon olarak yeniden koşulur).

## Kaynak: ürün sahibi geri bildirimi 04.11.2026 (12 madde + Panel) → vaka eşlemesi
| Madde | Kabul kaynağı | Yüzeyler (depo) | Vaka |
|---|---|---|---|
| 1 Geçmişe randevu | "geçmiş saat ve tarihe oluşturulabiliyor" | POST /appointments (APPOINTMENT_IN_PAST, backdateReason, schedule.manage), ajanda `.agenda-slot.is-past`, DateField min | F01 |
| 5 Geçmiş randevu başlığı | "tamamlandı onaylanmadan… geçmiş randevu başlığı altında" | hasta kartı Yaklaşan/Geçmiş, PastPendingBadge, Geldi/Gelmedi | F02 |
| 2, 11 Telefon | "tamamen görünmesi", "0 ile 11, 0 olmadan 10" | patient.phone.read; limitPhoneInput / normalizePhone; patients, relations, import | F03 |
| 3 Satır tıklama | "tüm satır tıklanabilir" | hastalar tr.row-click | F04 |
| 4 Diş şeması | "hangi dişe hangi işlem… seçilmiş" | ToothSummaryCard, toothStates, has-done/has-planned | F05 |
| 6 + Panel | "Ajanda→Randevular, Bugün→Panel", "kalabalık görünmesin", referans | shell NAV, GET /dashboard, charts.tsx | F06 |
| 7 Raporlar | "çalışmıyor" (belirti bildirilmedi) | raporlar/page.tsx menü dönüşü, varsayılan aralık; 20 rapor | F07 |
| 8 Hekimler | "çalışma saatleri, prim hakediş, maaş" | /hekimler, 0033, /practitioners/overview, /practitioners/:id/compensation, /salary-payments(+reverse), ledger salary-only | F08 |
| 9 Ürün/fiyat + gider | "ürün listesi, tedarikçi fiyat listesi… gideri" | Yönetim→Ürün ve fiyat listesi, 0034, /stock/catalog, /supplier-prices, /stock/items/standard-import | F09 |
| 9 Randevu malzemesi | "randevu onaylandığında… ürün miktarı" | /appointments/:id/materials GET/POST, AppointmentMaterialsCard, birim maliyet snapshot | F10 |
| 10 Kapatma modalı | "tarayıcının yerel pop-up'ı… sisteme uygun modal" | Drawer tryClose → confirmDialog; dialogs.tsx; native confirm/prompt/alert kaldırıldı | F11 |
| 12 İşlem listesi + fiyat | "işlem listesi… ne kadar ödemesi var" | STANDARD_PROCEDURES, /procedures/standard-import, 0032, randevu formu money-strip | F12 |

## Roller
yönetici (clinic_admin), hekim, sekreter, asistan, finans; B kiracısı yönetici/hekim. `support` rolünün sentetik demo hesabı yok → telefon görünürlüğünde support NA (birim testi permissions-session.test.ts kapsar).

## Platform
http, chromium-desktop (1366), chromium-mobile-emulation (360, Pixel 5), cli (pnpm komutları). Fiziksel cihaz / APK / iOS / VS Code: ürün kapsamı dışı (önceki koşuyla aynı, NA).

## Keşfedilemeyen / açık
- Madde 7'nin kullanıcıdaki gerçek belirtisi bildirilmedi; F07 bulunan iki kusurun düzeltmesini ve 20 raporun açıldığını doğrular, kullanıcıdaki belirtinin bu olduğunu kanıtlamaz (kayıtlı risk).
- `beforeunload` (sayfa yenileme/kapatma) tarayıcı yerel uyarısıdır, uygulama modalıyla değiştirilemez (tarayıcı kısıtı); F11 kapsamı uygulama içi kapatmadır.
