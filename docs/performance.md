# Performans ölçümü (Görev 7)

Plan §11 hedefi: 100.000 sentetik hasta, 1 milyon sentetik randevu, 50 eşzamanlı kullanıcı altında temel aramalarda **p95 API ≤ 500 ms**, temel sayfa **≤ 2 sn**. “Ölçülmemiş tasarım hedefidir; donanım, ağ, sorgu ve veri hacmiyle birlikte raporlanır.” Aşağıdaki her sayı 23.10.2026'da gerçekten koşulmuştur; ham çıktılar `docs/perf/`.

## Ortam
| | |
|---|---|
| Donanım | 2 vCPU Intel Xeon @ 2,80 GHz, 7,8 GiB RAM, yerel disk; **veritabanı + API + web + yük üreteci + tarayıcı aynı makinede** (üretimden kötümser) |
| Yazılım | PostgreSQL 16.15 (varsayılan ayarlar), Node 22.22, API `NODE_ENV=production` (tsx ile, tek süreç, havuz 10 bağlantı), web `next build` + `next start` |
| Ağ | yerel (127.0.0.1); internet gecikmesi ve TLS dahil değil |
| Veri | `viadent_perf` (yalnız sentetik): **demo-yesil** 100.024 hasta, 25 + seed hekim, **1.000.009 randevu** (2021-06 → 2026-11, hekim başına çakışmasız 30 dk; geçmiş: tamamlandı/gelmedi/iptal, gelecek: planlı/onaylı); **demo-mavi** küçük klinik (çapraz klinik etkisi). Kurulum `pnpm --filter @viadent/db exec tsx src/perf-data.ts` (~3 dk) |
| Araç | `scripts/perf/load.mjs` (bağımlılıksız; her sanal kullanıcı gerçek rolle oturum açar), `scripts/perf/pages.mjs` (Chromium) |

## İş karışımı (her sanal kullanıcı)
%25 hasta arama (ad parçası / çok kelime / 4 haneli telefon sonu / 8 hane), %18 hasta kartı, %12 hasta randevu geçmişi, %20 günlük ajanda (gün başına ~500 randevu), %10 Bugün görevleri, %5 kaynaklar, %5 finans özeti (yönetici/finans), %5 **yazma**: gelecek tarihe randevu oluşturma (çakışma denetimli). Roller: sekreter ×2, hekim, yönetici, finans, asistan.

## API sonuçları — 50 eşzamanlı kullanıcı
| Profil | Düşünme süresi | İstek/sn | Genel p50 | **Genel p95** | p99 | Hedef (p95 ≤ 500 ms) |
|---|---|---|---|---|---|---|
| Gerçekçi | 1–4 sn | 19,4 | 15,6 ms | **39,6 ms** | 58,4 ms | ✅ |
| Yoğun | 0,2–0,6 sn | 101,7 | 74,1 ms | **201,8 ms** | 254,8 ms | ✅ |
| Doygunluk (stres) | 0 | 113,4 | 435,9 ms | **565,3 ms** | 621,7 ms | ❌ (kapasite sınırı) |

Uç bazında (gerçekçi profil, p95): arama 41,6 · hasta kartı 27,0 · randevu geçmişi 22,8 · günlük ajanda 49,6 · Bugün 18,9 · finans özeti 32,2 · randevu oluşturma 44,6 ms. Tüm istekler 200/201 (hata yok).

**Yorum.** Doygunluk profilinde tüm uçlar aynı ~440 ms medyana yığılıyor: bu sorgu yavaşlığı değil **kuyruklanmadır** (50 / 113 istek/sn ≈ 440 ms). Darboğaz tek Node süreci (~%82 CPU) + aynı 2 çekirdeği paylaşan PostgreSQL. Bu makinede güvenli kapasite ≈ **100 istek/sn**; 50 gerçek klinik kullanıcısı bunun ~%20'sini kullanır. Üretimde API'nin ayrı sunucuda ve ≥2 süreçte (cluster/PM2 veya konteyner çoğaltma) çalışması gerekir; derlenmiş JS (tsx değil) ayrıca kazanım sağlar — ölçülmedi.

## Sayfa sonuçları (Chromium, 1366 px, yönetici)
Ölçüm: gezinmeden ağ boşalana (`networkidle`) kadar — HTML + JS + tüm API çağrıları, **Playwright'ın 500 ms sessizlik penceresi dahil** (yani gerçek kullanılabilirlik ≈ 0,5 sn daha kısa). 5 tekrarın medyanı / en kötüsü (ms):

| Sayfa | Boşta | 50 kullanıcı yükü altında | Hedef (≤ 2 sn) |
|---|---|---|---|
| Bugün | 1144 / 1206 | 1282 / 1376 | ✅ |
| Hastalar | 1080 / 1243 | 1202 / 1363 | ✅ |
| Hasta arama (“ayşe”, 2.085 eşleşme) | 965 / 1055 | 1037 / 1268 | ✅ |
| Ajanda (gün, ~500 randevu) | 814 / 1342 | 1238 / 1576 | ✅ |
| Hasta 360 | 854 / 892 | 904 / 975 | ✅ |
| Finans | 715 / 781 | 773 / 804 | ✅ |
| Raporlar | 736 / 790 | 840 / 905 | ✅ |
| Operasyon | 747 / 786 | 772 / 830 | ✅ |

## Ölçümle bulunan ve düzeltilen sorunlar (ADR-047)
1. **Hasta arama tam tablo taraması (RLS + LEAKPROOF):** RLS'li tabloda sızdırmazlık işaretsiz `LIKE` operatörü güvenlik koşulundan önce değerlendirilemediği için trigram dizini kullanılmıyordu → 100k hastada sorgu ~110 ms, 5 kullanıcıda bile arama p95 ~960 ms. `textlike` LEAKPROOF (süper kullanıcı katalog ayarı; RLS aynen yürürlükte) + arama sözcük başına ayrı `LIKE` koşulu (`LIKE ALL(dizi)` dizin kullanamıyor) → sorgu **~2 ms**.
2. **Kısa sayısal arama tüm hastaları sıralıyordu:** “0555” 100.000 telefonla eşleşip benzerliğe göre sıralanıyordu. Kural: ≥ 7 hane → telefon içinde, 4–6 hane → telefon **sonu** (“son 4 hane” alışkanlığı), dosya no sayısal eşitlik (benzersiz dizin). Telefon için trigram dizini (`0009_search_perf.sql`).
3. **Perf verisinde v4 olmayan UUID:** API'nin UUID doğrulaması md5 tabanlı kimlikleri doğru şekilde reddetti; üreteç v4 biçimine çevrildi (uygulama hatası değil, test verisi hatası).

## Ölçülmeyenler / açık
- Raporlar büyük veriyle ölçülmedi (senkron; 2.000/20.000 satır sınırı). Plan: sınırı aşan raporlar arka plana.
- Haftalık ajanda (~3.500 randevu) ve 500+ randevulu günde telefon görünümü ölçülmedi.
- İnternet gecikmesi/TLS, ayrı DB sunucusu, çok süreçli API, PostgreSQL ayarı (shared_buffers vb.) — üretim topolojisi seçilince tekrar ölçülmeli.
- Yük altında yazma yoğun senaryolar (toplu tahsilat, gün sonu) ölçülmedi.

## Tekrarlamak için
```
VIADENT_DEMO_PASSWORD=<parola> pnpm --filter @viadent/db exec tsx src/perf-data.ts
DATABASE_URL=<app rolü>/viadent_perf API_PORT=4100 NODE_ENV=production pnpm --filter @viadent/api start
BASE=http://127.0.0.1:4100 PASSWORD=<parola> VUS=50 DURATION=180 THINK_MIN=1000 THINK_MAX=4000 node scripts/perf/load.mjs
```
