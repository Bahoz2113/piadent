# fix3 — QA-004 (S3, FLAKY) · durum: FIX_READY

- Bulgu: tam Playwright koşusunda `erisilebilirlik.spec.ts › sekreter: bugün, ajanda, hasta 360` → axe `document-title (serious)` `/ajanda` için (`<html lang="tr">` altında `<title>` yok); izole 3/3 geçiyordu.
- Hatalı sürüm: f8de83a9ee03e36a1f1f9013c2865f92b7b85d84
- Yeni sürüm (worktree commit): **d6bbdd613043900df4f6f94ee89cc089539bbb70**
- Worktree: `/home/claude/viadent/.claude/worktrees/agent-a4a836406d32c49c4` · dal: `worktree-agent-a4a836406d32c49c4` (f8de83a üzerine tek commit)
- Üretime dağıtım yok. Ana depodaki çalışan servis (:3000) değiştirilmedi; worktree kodu o servise YANSIMAZ — tester yeni derleme yapmalı.

## 1. Tanı (kanıtla)

Gözlemler (hepsi f8de83a / çalışan :3000 servisine karşı, salt okuma):
1. SSR HTML'de `<title>VİADENT</title>` `<head>` içinde var (normal ve `Googlebot` UA, `curl`). İlk belge sorunsuz.
2. `/ajanda` sayfası (`apps/web/app/(app)/ajanda/page.tsx:52-55`, "use client") hidrasyondan hemen sonra `useEffect` içinde **`router.replace("/ajanda?tarih=<bugün>")`** çağırıyor; `weekPrac` set edilince ikinci bir replace daha (aynı URL). MutationObserver + rAF yoklaması ile ölçüm (geçici tanı spec'i, commit edilmedi): sayfa `load` ~120-150 ms, `router.replace` kaynaklı `<title>` kaldır/ekle çifti ~240-440 ms'de; 2 kez. Yani axe taraması (goto'dan hemen sonra, ~300-500 ms sürüyor) tam bu geçişle çakışıyor.
3. Next 15.5.28 **streaming metadata** (`node_modules/next/dist/lib/metadata/metadata.js:150-166`): normal UA için `<title>` `<head>`'e statik yazılmaz; `<div hidden><Suspense fallback={null}><MetadataResolver/></Suspense></div>` içinden React hoisting ile gelir ve istek başına anahtarlanır (`app-render.js:209 getFlightMetadataKey(requestId)`). Her `router.replace` → sunucuya RSC isteği → RSC yükünde başlık ayrı satırda (`c:{"metadata":[["$","title",…` — `curl -H 'RSC: 1' /ajanda?tarih=…` ile doğrulandı) → eski MetadataTree sökülür, yenisi kurulur.
4. İstemci router'ı RSC isteği **200/`text/x-component` değilse veya fetch hata verirse tam sayfa (MPA) yüklemeye düşer** (`fetch-server-response.js:122-128, 151-160`). Bu, geçici bir vekil (3100→3000) ile RSC yanıtı kesilerek doğrulandı: yeni belge başlatıldı ("Execution context was destroyed"), yani `/ajanda` açılışı yük/aksama altında tam yeniden yüklemeye dönüşebiliyor. Bu durumda Playwright `evaluate` yeni yürütme bağlamını bekleyip çalışır; axe `<html lang="tr">` ayrıştırılmış ama `<title>` henüz gelmemiş belgeyi tarar → tam olarak kanıttaki tek ihlal (`document-title`, hedef `html`, başka hiçbir kural yok = neredeyse boş belge).
5. Yeniden üretme denemeleri: ilgili test `--repeat-each=10` (:3000) → 10/10 geçti; vekil ile metadata satırı 700 ms geciktirilmiş → başlık değişimi atomik (rAF boşluğu 0) — yani normal yolda boşluk oluşmuyor; sorun yalnız gezinmenin aksadığı/MPA'ya düştüğü durumda ortaya çıkıyor. Birebir zamanlama (tam koşudaki 1 kez) laboratuvarda yakalanamadı; trace.zip kanıt klasöründe yoktu (`apps/web/test-results` temizlenmiş). Bu nedenle tanı "en tutarlı mekanizma" olarak kaydedildi; yama mekanizmayı tamamen ortadan kaldırıyor (gezinme yok → geçiş yok → MPA'ya düşme yok).

Kök neden (özet): `/ajanda` açılışında gereksiz sunucu gezinmesi (`router.replace`) + Next'in başlığı akışla gelen, istek başına yeniden kurulan metadata'ya bağlaması. Tam koşuda bu geçiş aksadığında belge başlıksız yakalanıyor.

## 2. Yama (en küçük ürün değişikliği)

- `apps/web/app/(app)/ajanda/page.tsx`: URL eşitlemesi `router.replace(...)` → `window.history.replaceState(null, "", href)` (Next 14.1+ bunu router durumuyla eşler; `useSearchParams` güncel kalır). Sunucuya istek yok, metadata yeniden kurulmaz; URL zaten aynıysa yazılmaz. `useRouter` import'u kaldırıldı. Kullanıcıya görünen davranış aynı (adres çubuğu `?tarih=…`, hafta/hekim parametreleri).
- Rota bazlı başlık (`metadata.title`, sunucu bileşeni `layout.tsx`, çocuğu döndürür): `(app)/ajanda` Ajanda, `bugun` Bugün, `hastalar` Hastalar (`template: "%s · VİADENT"` — alt rota şablonu yalnız bir üst katmandan alıyor), `hastalar/[id]` Hasta, `tedavi` Tedavi, `finans` Finans, `operasyon` Operasyon, `raporlar` Raporlar, `yonetim` Yönetim, `hesabim` Hesabım, `giris` Giriş, `davet/[token]` Davet. Kök şablonla "Ajanda · VİADENT" vb.; ilk HTML'de dolu (`curl` ile 12 rota doğrulandı).
- Test: `e2e/erisilebilirlik.spec.ts` `scan()` başına `await expect(page).toHaveTitle(/VİADENT/)` — kararlı durum beklemesi, beklenti sıkılaştırıldı (gevşetilmedi; axe beklentisi aynı).
- Yeni regresyon: `e2e/qa-004-ajanda-baslik.spec.ts` — `/ajanda` açılışında (a) `rsc: 1` başlıklı gezinme isteği 0, (b) `load` olayı 0 (yeniden yükleme yok), (c) rAF ile her karede `<title>` dolu (boş kare listesi `[]`), (d) başlık "Ajanda · VİADENT"; Hafta görünümüne geçişte de aynı. Eski kodda (:3000, f8de83a) **başarısız** (Received "VİADENT"), yamalı kodda geçiyor.

Değişen dosyalar: `apps/web/app/(app)/ajanda/page.tsx` (M), `apps/web/e2e/erisilebilirlik.spec.ts` (M), `apps/web/e2e/qa-004-ajanda-baslik.spec.ts` (A), 12 × `layout.tsx` (A): `apps/web/app/(app)/{ajanda,bugun,hastalar,hastalar/[id],tedavi,finans,operasyon,raporlar,yonetim,hesabim}/layout.tsx`, `apps/web/app/giris/layout.tsx`, `apps/web/app/davet/[token]/layout.tsx`. Test beklentisi, envanter, kapı, geçmiş kanıtlar değiştirilmedi.

## 3. Komutlar ve gerçek sonuçlar (worktree, d6bbdd6)

| Komut | Sonuç |
|---|---|
| `pnpm install --offline --frozen-lockfile` | OK |
| `pnpm typecheck` | 5/5 paket Done (contracts, web, db, api, worker) |
| `pnpm --filter @viadent/web test` | 3 dosya, 25 test geçti |
| `npx next build` (apps/web) | Compiled successfully |
| `NODE_ENV=production API_INTERNAL_URL=http://127.0.0.1:4000 npx next start -p 3200` (worktree kodu, ayrı port; sonra kapatıldı) | Ready; `curl` SSR başlıkları 12 rotada "<Sayfa> · VİADENT" |
| `E2E_BASE_URL=http://127.0.0.1:3200 npx playwright test e2e/qa-004-ajanda-baslik.spec.ts e2e/erisilebilirlik.spec.ts` (iki proje) | **12/12 geçti** (masaustu + telefon-360) |
| `E2E_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/qa-004-ajanda-baslik.spec.ts --project=masaustu` (eski kod) | 1 failed — regresyon testi kusuru yakalıyor |
| `E2E_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/erisilebilirlik.spec.ts -g "bugün, ajanda" --project=masaustu --repeat-each=10` (eski kod, yeniden üretme) | 10/10 geçti (FLAKY; izole yakalanamadı) |

Parola `E2E_PASSWORD` olarak `.demo-credentials` dosyasından okundu, hiçbir yere yazılmadı.

Çalıştırılmayan: tam E2E paketi (`npx playwright test`) yamalı sürüme karşı — paylaşılan veritabanına yazdığı için bu oturumda izin verilmedi; tester yeni derlemede tam koşuyu yapmalı (diğer `/ajanda?tarih=…` kullanan spec'ler `history.replaceState`'ten etkilenmemeli, ancak doğrulanmadı).

## 4. Yan etkiler / notlar
- Tarayıcı sekmesi başlıkları artık sayfa bazlı ("Ajanda · VİADENT"); `document.title`'a "VİADENT" eşitliği bekleyen bir test yoktu (grep). Tester envanterinde başlık görsel karşılaştırması varsa güncelleme gerekebilir — bu raporda değiştirilmedi.
- `/ajanda` her tarih/görünüm değişiminde artık sunucuya RSC isteği atmıyor (daha az yük); veri yükleri `useData` ile zaten istemciden gidiyor, değişmedi.
- `(app)/layout.tsx` (client) altında sunucu bileşeni rota layout'ları eklendi; davranış değişikliği yok, yalnız metadata.
- Ana servise ve veritabanına ürün tarafında dokunulmadı; yalnız E2E testleri (demo oturum açma) çalıştı.
- Geçici tanı araçları (vekil, tanı spec'i, çalıştırma betiği) silindi/durduruldu; worktree temiz.

Durum: **FIX_READY** — bulguyu yalnız bağımsız tester (yeni derleme + tam koşu, en az 2 tam tekrar önerilir) kapatır.
