# fix4 — QA-005 (S3, FLAKY, test kodu) → FIX_READY

**Bulgu:** `apps/api/test/gorev1.test.ts` "H07 sürümlü anamnez › asistan kaydı onay bekler…" aralıklı `POST /patients/:id/anamnesis` → beklenen 201, gelen 409 `VERSION_CONFLICT`.
**Sınanan sürüm:** d6bbdd613043900df4f6f94ee89cc089539bbb70
**Yeni sürüm:** `6079d5816defa6e1b702734703cad6b192dfe811`
**Worktree / branch:** `/home/claude/viadent/.claude/worktrees/agent-ad0429ede9116e1d5`, branch `worktree-agent-ad0429ede9116e1d5` (d6bbdd6 üzerine 1 commit). Ana depoya merge edilmedi; üretime dağıtım yok.

## 1. Tanı (kök neden) — kanıtlı

Zincir üç halkadan oluşuyor; hiçbiri ürün kusuru değil.

1. **Hasta seçimi liste indeksine bağlı.** `gorev1` `beforeAll`'da `patients = GET /patients?limit=50` alıyor ve H07 testleri `patients[20]` / `patients[21]`'i kullanıyordu. Liste `patients.service.ts:198` ile `order by … p.last_name, p.first_name` (DB collation `C.UTF-8`; Türkçe harfler çok baytlı olduğu için ASCII'den sonra sıralanır).
2. **Dosya sırası koşudan koşuda değişiyor.** `vitest.config.ts`: `fileParallelism: false` (dosyalar sıralı, tek paylaşılan `viadent_test` DB'si, yalnız `globalSetup`'ta sıfırlanır). Vitest `BaseSequencer.sort` (vitest 4.1.12, `coverage.*.js:48-75`) dosyaları önbellekteki (`apps/api/node_modules/.vite/vitest/<hash>/results.json`) **önceki koşu süresine** göre (başarısız olan önce, sonra uzun süren önce) sıralar. Süreler her koşuda ±yüzlerce ms oynadığı için `gorev1`'den önce hangi dosyaların koştuğu değişir.
3. **Önceki dosyalar "Demir"den önce sıralanan hasta ekliyor.** Seed'de A kiracısında 24 hasta, eş ad-soyad **yok** (`FIRST[(i*7)%20]`, `LAST[(i*5)%15]`; sorgu: `select last_name, first_name, count(*) … having count(*)>1` → seed-sonrası boş). Seed'de **yalnız dosya no 1 (Ayşe Demir)** anamnezli (`seed.ts:170`, `patientIds[0]`, v1, `allergy`). Salt seed sıralamasında Ayşe Demir indeks **9**, `[20]` = Oğuz Öztürk, `[21]` = Çağla Öztürk (anamnezsiz → test geçer). Ama:
   - `gorev4.test.ts` `newPatient()` → 9 adet soyadı **"Belge"** hasta,
   - `scheduling-patients.test.ts` → **"Aksoy"**×2, **"Bir"**×1.
   C sıralamasında `Aksoy < Belge < Bir < Demir`; bu iki dosya `gorev1`'den önce koşarsa 12 hasta araya girer, Ayşe Demir `[21]`'e (11 girerse `[20]`'ye) kayar → `basedOnVersion: 0` ile 409 (controller `anamnesis.controller.ts:69-73`: `currentVersion !== basedOnVersion`). Tester'ın logunda `[20]` (satır 236), benim yeniden üretimimde `[21]` (satır 251) patladı — aynı kök neden, farklı kayma miktarı.

**Yeniden üretim (yamadan önce, bu worktree'de):**
```
cd apps/api && npx vitest run --sequence.shuffle.files --sequence.seed=3 test/gorev4.test.ts test/scheduling-patients.test.ts test/gorev1.test.ts
→ sıra: scheduling-patients → gorev4 → gorev1; Tests 1 failed | 55 passed
  FAIL gorev1.test.ts > H07 > her kayıt yeni sürüm… ❯ test/gorev1.test.ts:251  expected 201, got 409
(seed=1 ve seed=2: gorev1 önce/ortada → 56/56 geçti)
```
**DB kanıtı** (bu koşudan sonra, `ADMIN_DATABASE_URL`/`viadent_test`, RLS'siz; sorgu `row_number() over (order by last_name, first_name)` A kiracısı aktif hastalar):
```
idx file_no ad soyad          anamnez
0   27 Ece Aksoy              0
1   26 Leyla Aksoy            0
2-3    Anneoğlu ×2 (gorev1 H03, beforeAll'dan SONRA oluştu → beforeAll anında -2 kaydır)
4-11   Aslan ×8 (seed)        0
12-20  Belge ×9 (gorev4)      0
21  30 Kimlik Bir             0
22  16 Ahmet Demir            1   ← beforeAll anında [20]: "asistan" testi buraya v1 yazdı (201)
23   1 Ayşe Demir             1   ← beforeAll anında [21]: seed v1 var → "her kayıt yeni sürüm" basedOnVersion 0 → 409
eş ad-soyad (A): yalnız test-üretimi "Hakan Yücel"×2; seed'de yok
anamnezli: file_no 1 (A: Ayşe Demir, B: Mustafa Kaya) + Ahmet Demir (testin yazdığı)
collation: C.UTF-8
```
Tam paket koşusu sonunda A kiracısında 104 hasta birikiyor; "Mehmet Demir" ×2 gibi eş ad-soyadlar oluşuyor (bkz. §5 ürün notu).

## 2. Yama (yalnız test kodu; ürün kodu değişmedi)

`git diff d6bbdd6..6079d58 --stat`: 2 dosya, +34/−5.

**`apps/api/test/gorev1.test.ts`** (H07 bloğu)
- `freshPatient(lastName)` yardımcısı: sekreter `POST /patients` ile taze sentetik hasta ("Anamnez <soyad>"), ardından hekim `GET /patients/:id/anamnesis` ile **ön koşul doğrulaması** `current === null`.
- "asistan kaydı onay bekler…": `patients[20]` → `freshPatient("Onaybekler")`. Beklentiler aynen: 201, `{version:1, criticalFlags:["anticoagulant"], reviewed:false}`, görev `sensitivity: clinical`, sekreter görmez, asistan review 403, hekim review 200, tekrar 409, görev kapanır.
- "her kayıt yeni sürüm…": `patients[21]` → `freshPatient("Surumlu")`. Beklentiler aynen (v2, stale 409, v1 korunur, history 2, 422 tanımsız soru, audit'te içerik yok, sekreter anamnez olayı görmez).
- "sekreter ve yönetici anamnezi okuyamaz…": dosya no 1 artık `patients` dizisinden değil `GET /patients?q=1` (sayısal terim → `file_no` eşleşmesi önce) ile seçilir; liste 50'yi aşsa da deterministik. Beklentiler aynen (403/403, `clinical: null`, hekimde `["allergy"]`).
- **Yeni regresyon testi** "QA-005 regresyon…": dosya no 1'e `basedOnVersion: 0` → 409 `VERSION_CONFLICT`, `details.currentVersion ≥ 1` (flaky'nin tetikleyici ön koşulunu belgeler); taze hastaya ilk kayıt → 201, `version: 1`.
- `patients` dizisi randevu testlerinde (`[10]–[17]`) ve H03 `[15]` (yalnız ilişki ekleme) kullanılmaya devam eder: bu testler hastanın önceki klinik durumuna bağımlı değil, kayma zararsız; değiştirilmedi (en küçük yama).

**`apps/api/test/permissions-session.test.ts`** (aynı desen, gözden geçirme sonucu)
- "klinik yöneticisi … hekim yazabilir": `anyPatient()` = `items[0]` ile seçilen hastaya klinik not yazıp `items[0].id === created.id` ve `toHaveLength(2)` bekliyordu — başka bir test bu hastaya not yazsaydı aynı şekilde patlardı (bugün yazan yok; **gizli/latent** risk). Taze hasta ("Klinik Notsuz") kullanır; `notedPatientId` modül değişkenine yazar.
- "VİA İz: … hekim görür": önceki testin `items[0]`'a not yazmış olmasına **örtük** bağlıydı (ilk yamadan sonra 1. koşuda bu yüzden kırıldı ve düzeltildi); artık `notedPatientId`'yi açıkça kullanır. Beklentiler aynen.
- `anyPatient()` salt-okunur 403 testinde kalır (sıra önemsiz).

Gözden geçirilen ama değiştirilmeyen dosyalar: `scheduling-patients.test.ts` (`patients[0..7]` yalnız randevu/çakışma; klinik yazma yok), `tenant-isolation.test.ts` (`items[0]` yalnız 404 beklentisi), `gorev2/gorev13` (kendi oluşturduğu/`external_ref` ile seçtiği hasta), `gorev7/9` (liste erişim testleri). E2E/Playwright incelenmedi ve koşulmadı (tester ana DB'de koşuyor).

## 3. Komutlar ve gerçek sonuçlar (worktree, `.env` ana depodan kopya, commit dışı — `.gitignore`'da)

| # | Komut | Sonuç |
|---|---|---|
| 0 | `pnpm install --frozen-lockfile --offline` | Done |
| 1 | yamadan önce: `npx vitest run --sequence.shuffle.files --sequence.seed=3 test/gorev4… test/scheduling-patients… test/gorev1…` | **1 failed / 55** (`gorev1.test.ts:251`, 409) — kusur üretildi |
| 2 | `pnpm typecheck` | 5 paket Done, hata yok |
| 3 | yamadan sonra aynı seed=3 alt küme | 57/57 passed |
| 4 | `pnpm --filter @viadent/api test` (1. tam koşu) | **20 dosya / 259 test passed**, 50.34s, exit 0 |
| 5 | `pnpm --filter @viadent/api test` (2. tam koşu, önbellekli sıra) | **20 / 259 passed**, 51.11s, exit 0 |
| 6 | `npx vitest run --sequence.shuffle.files --sequence.seed=3` (3. tam koşu, karışık sıra) | **20 / 259 passed**, 48.16s, exit 0 |

Ara durum (şeffaflık): ilk `permissions-session` yamasından sonraki ilk tam koşu 258/259 (yukarıdaki "VİA İz" örtük bağ) idi; düzeltilip 1–2–3 koşuları yeniden alındı. Test sayısı 258 → 259 (yeni regresyon testi).

## 4. Yan etkiler

- Test DB'de (`viadent_test`) 4 ek sentetik hasta/koşu (Anamnez Onaybekler/Surumlu/Regresyon, Klinik Notsuz); DB her koşuda sıfırlanıyor, kalıcı etki yok.
- Ürün kodu, migration, seed, gate, envanter, plan, results, geçmiş kanıtlar değişmedi. Test beklentileri değişmedi.
- `tester` için not: ana depoda vitest sonuç önbelleği (`apps/api/node_modules/.vite/vitest/…/results.json`) dosya sırasını etkiler; yeniden sınamada yama bu önbellekten bağımsız geçmelidir. Dilerse `--sequence.shuffle.files --sequence.seed=3` ile eski kusur sırası da yeniden denenebilir.

## 5. Ürün için ayrı öneri (yama yapılmadı — backlog adayı)

`GET /patients` sıralaması `last_name, first_name` ile bitiyor; eş ad-soyadlı hastalarda (gerçek klinikte sık: "Mehmet Demir" ×2 — tam paket sonrası test DB'de de oluştu) satır sırası PostgreSQL'de belirlenimsiz. Bugün sayfalama yok (`limit` var, `offset`/cursor yok) ve UI arama odaklı olduğundan görünür bir kusur yaratmıyor; ancak ileride sayfalama/cursor eklenirse kayıt atlama/yineleme yaşanır. Öneri: sıralamaya kararlı kuyruk anahtarı eklemek (`…, p.file_no` ya da `p.id`), tek satırlık ve indeks maliyeti yok. Ayrıca `C.UTF-8` collation'da Türkçe harflerle başlayan soyadların (Ç, Ö, Ş, İ, Ü) listenin sonuna düşmesi UI alfabetik sıra beklentisiyle uyuşmayabilir (`tr-TR` ICU collation veya `search_text` üstünden sıralama değerlendirilebilir). Her ikisi de ürün kararı; bu düzeltmenin kapsamı dışında.

## Durum

**FIX_READY** — bağımsız tester `6079d58` üzerinde `pnpm --filter @viadent/api test` ≥2 koşu (ve isteğe bağlı seed=3 karışık sıra) ile yeniden sınar; bulguyu yalnız tester kapatır.
