# Bulgular — qa-20261107-1245-bbba373

## Tur 1 (bbba373) — 68 zorunlu vaka
- HTTP/tarayıcı tester vakaları (önceki 60 + H01, H03–H05): hepsi PASS. API 414/414, contracts 21/21, web 104/104, V06 EŞLEŞTİ, R07 FORCE RLS.
- E2E tam koşu: 117 geçti, 10 bilinçli atlama, **1 hata** → R04 FAIL.

### QA-401 — Tedavi odontogramında çürük bulgusu, aynı dişe işlem yapılınca erişilebilir adda öne çıkmıyor (S3, FIX_READY)
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
