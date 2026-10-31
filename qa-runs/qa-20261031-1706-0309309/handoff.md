# Kodlamaya devir — qa-20261031-1706-0309309

Sürüm: 0309309c0b0be55892b4aee936d6d7fb2f440e97 · Ortam: yerel test (qa-runs/qa-20261031-1706-0309309/environment.md) · Rol hesapları: sentetik demo (parola güvenli ortamdan)

## QA-001 (S1) — history() klinik bulgu/tanı olaylarını sağlık yetkisi olmayan role veriyor
- Rol: sekreter, finans (ve yönetici/destek — `patient.health.read` yok)
- Gerekli test verisi: hastada ≥1 odontogram bulgusu ve tanı (hekim `POST /patients/:id/findings`, `/diagnoses`)
- Tekrarlama: sekreter oturumu ile `GET /api/v1/patients/<id>/history` (başlıklar: cookie, x-viadent-context)
- Beklenen: `items` içinde `entityType === "clinical_chart"` olay yok. Gerçek: `finding.create` (changes.tooth.to="16") ve `diagnosis.create` dönüyor.
- Kanıt: evidence/V05-http.json, evidence/masaustu-V05-gecmis-sekreter.jpg
- Etkilenen akışlar: Hasta 360 → Geçmiş sekmesi; KVKK dışa aktarım access_log (ikincil); denetim raporu (ikincil, yalnız eylem adı)
- Kabul testi: API testi — sekreter/finans history'de clinical_chart olayı 0; hekim history'de ≥1. Mevcut testler bozulmamalı.

## QA-002 (S3) — VİA İz ekranında ham eylem kodları
- Beklenen: tüm eylemler Türkçe etiketli. Gerçek: `receivable.create`, `payment.create`, `allocation.create`, `procedure.complete`, `procedure.correct`, `payment.refund`, `file.upload`, `finding.create`, `diagnosis.create` ham.
- Kabul: etiket tablosu tamamlanır veya ortak `ACTION_LABELS` kaynağından okunur; bilinmeyen için okunur geri dönüş.

Kurallar: test beklentisi, envanter, kapı (gate.cjs) ve geçmiş kanıt değiştirilmez. Üretime dağıtım yok. Yama + regresyon testi + fix.md (yeni sürüm kimliği, değişen dosyalar, komutlar, yan etkiler) ile geri dönülür; bulguyu yalnız tester kapatır.

---
# 2. devir — QA-003 (S3), sürüm 6324f7651ac34ca19541c2b3659c2b95fbc7860b
- Rol: herhangi (sekreter, finans, hekim) → Hasta 360 → Geçmiş sekmesi (`/hastalar/<id>?sekme=gecmis`)
- Gerekli veri: hastada alacak/tahsilat/dağıtım/işlem olayları (tur2 sentetik hastası var: evidence/tur2/http-summary.json → patient)
- Beklenen: "değişen alanlar" satırlarında `Tutar: 1.000,00 ₺`, `Yöntem: Nakit`, `Kaynak: Elle` gibi okunur Türkçe satırlar; etiket/değer çakışmaz (masaüstü ve 360px).
- Gerçek: `amount` ile `1000.00` üst üste; `method: cash`, `source: manual`, `payment_id: Kayıt` (çakışık).
- Kanıt: evidence/tur2/QA-003-overlap-crop.jpg
- Gözlem (yama değil): `apps/web/app/globals.css` `.timeline li` seçicisi iç liste öğelerini de yakalıyor (`.timeline > li` veya `.change li { display:block }`); `FIELD_LABELS`/`show()` kapsamı dar. Mevcut `PAYMENT_METHOD_LABELS` vb. etiket tabloları `@viadent/contracts` içinde var.
- Kabul testi: web birim — geçmişte üretilebilen alan adlarının tamamı etiketli (API `audit(... changes: { ... })` anahtarlarından türet); E2E/görsel: iç `li` için `display` grid değil (Playwright `toHaveCSS` veya görüntü).
Kurallar aynı: test beklentisi/kapı/kanıt değiştirilmez, üretime dağıtım yok, fix.md ile dön (FIX_READY).

---
# 3. devir — QA-004 (S3, FLAKY), sürüm f8de83a9ee03e36a1f1f9013c2865f92b7b85d84
- Tekrarlama: tam E2E (`npx playwright test`, iki proje) → `[masaustu] erisilebilirlik.spec.ts:32 sekreter: bugün, ajanda, hasta 360` axe `document-title` ihlali `/ajanda`. İzole koşuda 3/3 geçiyor; 1. tur tam koşuda geçmişti.
- Kanıt: evidence/tur3/R04-R05-e2e.log, evidence/tur3/R04-axe-retry.log; varsa `apps/web/test-results/**/trace.zip`.
- Beklenen: `/ajanda` yüklendiği her anda `<title>` dolu. Gerçek: aralıklı boş (axe `doc-has-title`).
- Gözlem: SSR HTML'de `<title>VİADENT</title>` var (normal ve bot UA). `apps/web/app/layout.tsx` kök `metadata`; alt sayfalarda sayfa başlığı yok (tüm sayfalar "VİADENT" — ayrıca erişilebilirlik için sayfa bazlı başlık önerilir: "Ajanda · VİADENT").
- İstenen: kök neden tanısı + en küçük yama (ürün veya test altyapısı; test beklentisi gevşetilmez); fix3.md.

---
# 4. devir — QA-005 (S3, FLAKY, test kodu), sürüm d6bbdd613043900df4f6f94ee89cc089539bbb70
- Tekrarlama: `pnpm --filter @viadent/api test` tam paket; `apps/api/test/gorev1.test.ts:231` "asistan kaydı onay bekler…" aralıklı 409 (`POST /patients/<patients[20]>/anamnesis`, basedOnVersion 0 → hastanın zaten anamnez sürümü var). İkinci koşu 258/258.
- Beklenen: test her koşuda aynı, anamnezi olmayan hastayı seçmeli (ör. testin kendi oluşturduğu yeni sentetik hasta ya da `file_no` ile deterministik seçim ve ön koşul doğrulaması). Test beklentisi (201, criticalFlags, görev görünürlüğü, hekim onayı) değişmez.
- Kanıt: evidence/tur4/R01-api-tests-kosu1-FAIL.log (satır 13–20), evidence/tur4/R01-api-tests-kosu2.log.
- Kök neden tanısı istenir: `patients` dizisi `GET /patients?limit=50` (sıralama `last_name, first_name` — eş isimlerde belirlenimsiz) + aynı dosyada `patients[15]`, `[20]`, `[21]` kullanan anamnez testleri + seed'de anamnezi olan hastalar. Aynı deseni kullanan diğer testleri de gözden geçir (yalnız indeksle hasta seçen anamnez/klinik testleri).
- İstenen: en küçük test-kodu yaması (ürün kodu değişmez), ardından `pnpm --filter @viadent/api test` ≥2 tam koşu (gerçek sonuçlar), fix4.md.
Not: Tester bu sırada E2E'yi `viadent` DB'sine karşı koşuyor; API testleri `viadent_test` kullanır, çakışmaz. E2E/Playwright koşma.

---
# 5. devir — QA-006 (S1, ürün) + QA-007 (S3, test kodu), sürüm 6079d5816defa6e1b702734703cad6b192dfe811
## QA-006 — eşzamanlı trafik altında DB bağlantısı kesilince API süreci çöküyor
- Tekrarlama (tester, derlenmiş API `NODE_ENV=production node apps/api/dist/main.js`, yerel PostgreSQL): sekreter oturumuyla 400 eşzamanlı `GET /api/v1/patients?q=a&limit=20` (8'erli dalgalar) + paralelde 12× `select pg_terminate_backend(pid) from pg_stat_activity where application_name='viadent-api' and datname='viadent' and state='idle'` (0,4 sn aralık) → süreç `node:events:497 Unhandled 'error' event — error: terminating connection due to administrator command` ile çöktü; 395/400 istek bağlantı reddi.
- Kanıt: evidence/tur4/QA-006-api-crash.log, evidence/tur4/QA-006-http-codes.txt, evidence/tur4/R04-R05-e2e-kosu2-FAIL.log (zincirleme 36 E2E hatası).
- Gözlem (yama değil): `apps/api/src/infra/db.service.ts:18` yalnız `pool.on("error")` var (havuzdaki boşta istemci). Havuzdan `connect()` ile alınmış ama henüz sorgu göndermemiş/sorgu arası istemcide (pg_stat'ta "idle" görünür) gelen 57P01 hatası dinleyicisiz → süreç çöker. `Db.tx()` içinde istemci alındıktan sonra `client.on("error", …)` eklenip `release(err)` ile düşürülmesi; ayrıca süreç düzeyinde `process.on("unhandledRejection"/"uncaughtException")` ile log + kontrollü kapanış (çöküş yerine). Worker (`apps/worker`) için de aynı desen kontrol edilsin.
- Beklenen: aynı senaryoda süreç ayakta kalır; etkilenen istekler 500/503 ile döner (hatalı başarı yok), sonraki istekler 200; `/health/ready` havuz toparlanınca 200.
- Kabul testi: `gorev4 › dayanıklılık` genişletilir — trafik altında (≥20 eşzamanlı istek sürerken) idle+aktif `viadent-api` bağlantıları kesilir; süreç yaşıyor, en az bir istek sonrasında 200; mevcut test değişmez (yalnız `datname = current_database()` süzgeci — QA-007).
## QA-007 — dayanıklılık testi küme genelinde bağlantı kesiyor
- `apps/api/test/gorev4.test.ts:418` `pg_terminate_backend` sorgusuna `and datname = current_database()` eklenir (başka DB'deki canlı API'yi etkilemesin). Beklenti aynı.
Kurallar aynı. Fix5.md ile dön. NOT: Tester ana depoda API testlerini ve E2E'yi koşuyor — worktree'de API testini yalnız kendi hedefli dosyalarla (`npx vitest run test/gorev4.test.ts`) koş; paylaşılan `viadent_test` DB'sini kullandığı için tam paket koşturma, bunun yerine fix5.md'de hangi komutların tester tarafından koşulacağını yaz.
