# Bulgu defteri — qa-20261104-1549-65201a2
Sürüm: 65201a2 (tur 1). Tester ürün kodunu değiştirmez; düzeltme cezeri-duzeltici ile ayrı dalda.

## QA-201 — Kirli çekmece Esc ile uyarısız kapanıyor; girilen bilgi kayboluyor (S2, OPEN)
- **Vaka:** F11 (madde 10). Profil: chromium-desktop + chromium-mobile-emulation. Rol: sekreter, yönetici.
- **Adımlar:** Randevular → "Randevu ver" → Açıklama alanına metin yaz → Esc.
- **Beklenen:** "Kaydedilmemiş değişiklikler" uygulama modalı açılır (X ve arka plan tıklamasında olduğu gibi); "Forma dön" veriyi korur.
- **Gözlenen:** Modal açılmaz (alertdialog 0), çekmece kapanır; yeniden açınca Açıklama boş (`{"afterEsc":{"modal":0,"formOpen":false,"native":0}}`, reopened reason ""). Yeni hasta çekmecesinde de aynı (modal 0, form kapandı). X ve arka plan tıklamasında modal doğru açılıyor.
- **Tanı (hipotez):** `components/ui.tsx` Drawer klavye dinleyicisi boş bağımlılıklı `useEffect` içinde ilk render'daki `tryClose`'u yakalıyor; o anda `dirty=false` olduğundan Esc kirli formu doğrudan kapatıyor (bayat kapanış).
- **Etki:** Kaydedilmemiş form verisi tek tuşla uyarısız kaybolur; madde 10 kabulünü Esc yolunda karşılamaz. Kayıtlı veri kaybı yok → S2.
- **Kanıt:** evidence/tur1/browser-f-summary.json (F11, iki profil), evidence/tur1/masaustu-F11-kapatma.png, mobil-F11-kapatma.png.
- **Sorumlu:** cezeri-duzeltici (web).

## QA-202 — Randevu formunda yalnız Not (veya tarih/saat/işlem/süre/koltuk) değişince form "kirli" sayılmıyor (S3, OPEN)
- **Vaka:** F11. Profil: masaüstü + mobil. Rol: yönetici.
- **Adımlar:** Randevular → "Randevu ver" → yalnız "Not" alanını doldur → X.
- **Beklenen:** Girilen bilgi kaybolacağı için kapatma uyarısı modalı.
- **Gözlenen:** Modal açılmadan kapanır; not kaybolur. `NewAppointment` çekmecesinde `dirty={!!patient || !!f.reason}` — hasta ve Açıklama dışındaki alanlar hesaba katılmıyor.
- **Etki:** Düşük; kullanıcının yazdığı not/seçimi uyarısız kaybolabilir.
- **Kanıt:** evidence/tur1/browser-f-summary.json (F11 "yalnız Not dolu: modal" adımı).
- **Sorumlu:** cezeri-duzeltici (web).

## Kayıtlı riskler (bulgu değil)
- `beforeunload` (sayfa yenileme/sekme kapatma) uyarısı tarayıcı yereldir; uygulama modalıyla değiştirilemez (tarayıcı kısıtı). Madde 10 kapsamı uygulama içi kapatmadır.
- Madde 7'nin kullanıcıdaki gerçek belirtisi bildirilmedi; F07 bulunan iki kusurun (menüden dönüş, varsayılan aralık) düzeltmesini doğrular.
- Telefon girişi yurt dışı biçimde 17 rakama kadar yazdırır; API 8–15 haneyi doğrular (ADR-093). Kullanıcı 16–17 rakam yazarsa kayıtta açık hata alır.

## Tester betiği düzeltmeleri (ürün kusuru değil; beklenti gevşetilmedi)
- f-cases.mjs: sahip rolü FORCE RLS altında olduğundan DB doğrulamaları kiracı bağlamında çalıştırıldı (bağlamsız sorgu 0 satır döndürüp "yazılmadı" kontrollerini yanlışlıkla geçiriyordu); pozitif bağlam kontrolü eklendi.
- f-cases.mjs: kurulum randevuları seed ve kendi randevularıyla çakışmayacak saatlere taşındı (40 dk aralık, geçmiş gün akşamı, bugün 07:10).
- browser-f.mjs: tutar karşılaştırması sayısal kısım üzerinden (Intl "₺1.200,00", uygulama "1.200,00 ₺"); KPI yüklenmesi beklendi; tarih alanı yer tutucuyla bulundu; diş şeması olumlu kontrolü hekimle (yönetici sağlık yetkisine sahip değildir, §05); mobilde ızgara yerine liste görünümü ve tam ekran çekmece dikkate alındı.
