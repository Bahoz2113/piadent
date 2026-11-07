# Bulgular — qa-20261107-1245-bbba373

## Tur 1 (bbba373) — 68 zorunlu vaka
- HTTP/tarayıcı tester vakaları (önceki 60 + H01, H03–H05): hepsi PASS. API 414/414, contracts 21/21, web 104/104, V06 EŞLEŞTİ, R07 FORCE RLS.
- E2E tam koşu: 117 geçti, 10 bilinçli atlama, **1 hata** → R04 FAIL.

### QA-401 — Tedavi odontogramında çürük bulgusu, aynı dişe işlem yapılınca erişilebilir adda öne çıkmıyor (S3, VERIFIED — tur2 ve tur8)
- Vaka: R04 (gorev2.spec.ts "hekim: odontogram → … → gerçekleşen işlem", telefon-360). Kanıt: evidence/tur1/R04-R05-e2e-temiz-seed.log satır 101, 134–157.
- Gözlenen: masaüstü projesi aynı seed hastasında 16 numaralı dişe kabul edilmiş plan kalemini (KAN-01 kanal tedavisi) gerçekleştiriyor. Telefon projesi sonra aynı hastayı açtığında diş 16 düğmesinin erişilebilir adı `Diş 16; Kanal tedavisi; Çürük` oluyor; test `^Diş 16; Çürük` bekliyor (seed bulgusu erişilebilir adda) ve bulamıyor.
- Kök neden: ADR-103 ile ad, `visualLabels` sırasıyla üretiliyor (eksik/çekildi → implant → … → kanal → … → dolgu → çürük → kırık). Etkin hastalık bulgusu (çürük, kırık) tedavi/restorasyon işaretlerinin arkasına düşüyor. Önceki sürümde bulgular her zaman ilk sıradaydı.
- Beklenen: dişin güncel sorunu (eksik/çekildi, çürük, kırık) erişilebilir adda ve ipucu durum rozetlerinde tedavi işaretlerinden önce gelsin; tedavi işaretleri sonra. Bilgi kaybı yok, yalnız sıra.
- Etki: düşük (görsel çizim doğru; ekran okuyucu ve ipucu okuma sırası). Test beklentisi gevşetilmez.

## Tur 2 (844c180) — QA-401 yeniden sınama
- Tam tur temiz seed: E2E 118 geçti / 10 bilinçli atlama / 0 hata (gorev2 iki projede geçti), API 414/414, web 108/108, tester vakaları hepsi PASS → QA-401 düzeltmesi doğrulandı (kanıt evidence/tur2/R04-R05-e2e-temiz-seed.log).
- Tur 2 sonrası ürün sahibinden yeni istek (ADR-106: varsayılan Mavi palet, cinsiyet üç seçenek) → yeni revizyon; plan'a H09 eklendi; tam tur tur3 olarak bu revizyonda koşulur.

## Tester betiği uyarlamaları (ADR-106 kabul değişikliği)
- browser-n.mjs N06: "Varsayılana dön" sonrası beklenen `yesil` → `mavi` + `light` (ürün sahibi kararı; aynı vakanın diğer beklentileri değişmedi).
- Tur 3 (cb21a24): h-cases.mjs H09 içindeki "DB 'other' reddi" sondası hata alan transaction'ı geri almadan bağlantıyı havuza bıraktı (25P02); betik H09'da durdu, h-summary yazılmadı (ortam/test betiği arızası, ürün kusuru değil). Düzeltme: ayrı bağlantı + rollback. Tam tur tur4 olarak yeniden koşuldu.
- Tur 4 (cb21a24): iki tester beklentisi düzeltildi, ürün kusuru yok. (1) n-cases N06 HTTP: sekreterin varsayılan görünümü `yesil` bekleniyordu → ADR-106 ile `mavi` + `light` (kabul değişikliği). (2) h-cases H09: oturum yanıtının görünümü boş döndürdüğü varsayılmıştı; API görünümü varsayılanla doldurup döner (önceki sürümden beri böyle) → kontrol "oturumda açık+mavi, DB'de saklı değer yok" olarak doğru davranışa çevrildi. Tam tur tur5 olarak yeniden koşuldu.

## Tur 5 (cb21a24) — 68 + H09
- Tester vakaları hepsi PASS (H01–H05, H09 dahil); E2E 118 geçti / 10 bilinçli atlama / 0 hata; web 113/113; contracts 21/21; V06 EŞLEŞTİ.
- R01: 413/414 — 1 hata → R01 FAIL.

### QA-402 — appointment-past-procedure testi saate bağlı olarak seed randevusuyla çakışıyor (S3, VERIFIED — tur6 ve tur8)
- Vaka: R01 (`apps/api/test/appointment-past-procedure.test.ts` "tolerans içinde (şimdiden birkaç dakika önce) ve ileri saat kabul edilir"). Kanıt: evidence/tur5/R01-api.log satır 13–28. Tur 1–4'te aynı test geçti (aralıklı → FLAKY).
- Gözlenen: test 13:53'te koştu; seed'in ilk hekimine "şimdi − 5 dk" başlangıçlı 15 dk randevu açıyor (≈13:49–14:04). Seed aynı hekime bugün 14:00'te randevu koyuyor → 409 (çakışma), beklenen 201.
- Kök neden: test kendi kaynağını kullanmıyor; seed'in ilk hekimi ve gün içi seed saatleri (09:00, 09:30, 10:00, 11:00, 14:00, 15:30) ile koşu saati çakışınca düşüyor. Ürün davranışı doğru (çakışma 409).
- Beklenen: test kendine özel hekim (ve gerekiyorsa çalışma saati) oluşturarak saatten bağımsız olsun; beklentiler (201 / 422 / 409) değişmesin.

## Tur 6 (df0ea1d) — QA-402 yeniden sınama
- R01 414/414 (QA-402 düzeltmesi doğrulandı: koşu 14:2x, seed hekiminin 14:00 randevusu penceresinde), E2E 118/0 hata, web 113, contracts 21, H01–H09 PASS, V06 EŞLEŞTİ.
- F01 (tester f-cases) 15/16: "tolerans içi (−5 dk) → 409" — QA-402 ile aynı kök neden **tester betiğinde**: F01 seed'in ilk hekimini kullanıyor. Ürün kusuru değil. Betik F01 için koşuya özel hekim kullanacak şekilde düzeltildi (beklentiler aynı). Tam tur tur7 olarak koşuldu.
- Tur 7 (df0ea1d): F01 düzeltmesi doğrulandı (16/16). F12 (tarayıcı, iki profil) "işlem seçenekleri 1": tester betiği seçenekleri sayfa açılır açılmaz sayıyordu; aynı adımda TEM-01 seçimi ve fiyatı görünür olduğundan liste geç yüklenmiş (yarış, tester ölçüm hatası; ürün kusuru değil — elle sonda: sekreter oturumunda liste anında 56 seçenek). Betik seçeneklerin yüklenmesini bekleyecek şekilde düzeltildi (ölçüt > 50 aynı). Tam tur tur8.

## Tur 8 (df0ea1d) — son tam tur
- 69 zorunlu vakanın hepsi PASS: HTTP + tarayıcı (masaüstü 1366 + 360 px), H01–H09, V06 EŞLEŞTİ, R01 414/414, R02 21/21, R03 113/113, R04/R05 E2E 118 geçti / 10 bilinçli atlama / 0 hata, R06, R07.
- QA-401 ve QA-402 VERIFIED (bugs.json). Açık bulgu yok.
- Tur 8 sonrası yeni revizyon 6fe082d (ADR-104 eki: katalog uygulama içinden tamamlanır — canlı demoda 0037'nin büyük SQL'i yerine). Plan'a H10 eklendi; tam tur tur9.
