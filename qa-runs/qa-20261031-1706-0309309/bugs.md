# Bulgu defteri — qa-20261031-1706-0309309 (sürüm 0309309c0b0be55892b4aee936d6d7fb2f440e97)

| ID | Önem | Durum | Başlık | Sorumlu |
|---|---|---|---|---|
| QA-001 | S1 | OPEN | Sağlık yetkisi olmayan roller (sekreter, finans, yönetici, destek) hasta geçmişinde odontogram bulgu/tanı olaylarını (`finding.create` + diş numarası, `diagnosis.create`) görüyor | kodlama (cezeri-duzeltici) |
| QA-002 | S3 | OPEN | Hasta geçmişi (VİA İz) ekranında birçok olay ham kodla gösteriliyor (`receivable.create`, `payment.create`, `procedure.correct`, `finding.create` …) — Türkçe etiket yok | kodlama |

## QA-001 — ayrıntı
- **Etki:** `patient.health.read` izni olmayan rol, hastanın ağız/diş bulgusu olduğunu, hangi dişte olduğunu (diş 16) ve tanı konduğunu öğreniyor. Plan §05 ve izin matrisi (`treatment.read`: "tanı/bulgu hariç") ihlali. Tenant dışına sızıntı yok; tenant içi rol sınırı. Bu yüzden S0 değil S1 (bulgu türü ve tanı metni görünmüyor; varlık + diş numarası görünüyor).
- **Tekrar (HTTP):** sekreter oturumu → `GET /api/v1/patients/<id>/history` → `items[]` içinde `{action:"finding.create", entityType:"clinical_chart", changes:{tooth:{to:"16"}}}` ve `{action:"diagnosis.create"}`. Finans rolünde aynı. Kanıt: `evidence/V05-http.json` (secretaryClinicalEventsVisible), `evidence/masaustu-V05-gecmis-sekreter.jpg`, `evidence/mobil-V05-gecmis-sekreter.jpg`.
- **Kaynak (tester gözlemi, yama değil):** `apps/api/src/patients/patients.service.ts` `history()` filtresi yalnız `clinical_note`, `anamnesis` dışlıyor; `clinical_chart` dışlanmıyor. İkincil: `POST /patients/:id/export` `access_log` ve "denetim" raporu sağlık yetkisi olmayan rollere `finding.create` eylem adını (değersiz) veriyor — kodlama ekibi kapsam kararı versin.
- **Kabul:** `patient.health.read` olmayan her rol için history yanıtında `entity_type='clinical_chart'` olay yok; hekim/asistan için var. Regresyon testi eklensin (API).

## QA-002 — ayrıntı
- **Etki:** Kullanıcı arayüzü metinleri Türkçe kuralı; sekreter/finans "VİA İz" sekmesinde `receivable.create` gibi kodlar okuyor. İşlevi engellemiyor.
- **Kanıt:** `evidence/masaustu-V05-gecmis-sekreter.jpg`.
- **Kaynak (gözlem):** `apps/web/app/(app)/hastalar/[id]/page.tsx` `ACTION_LABELS` yalnız 8 eylemi kapsıyor; finans/klinik/odontogram/dosya eylemleri yok.
- **Kabul:** Geçmişte görünen her eylem için Türkçe etiket; bilinmeyen eylem için "Diğer işlem (kod)" gibi okunur geri dönüş.

## 2. tur (sürüm 6324f76) — yeniden sınama
| ID | Önem | Durum | Not |
|---|---|---|---|
| QA-001 | S1 | VERIFIED | Sekreter/finans history'de clinical_chart 0 (HTTP + masaüstü + mobil); KVKK dışa aktarım access_log klinik 0; denetim raporu klinik satır 0, `action=finding` → 0. Kanıt: evidence/tur2/V05-http.json, evidence/tur2/*-V05-gecmis-sekreter.jpg, evidence/tur2/QA-001-*.json |
| QA-002 | S3 | VERIFIED | Geçmişte ham eylem kodu yok (Türkçe etiketler). Kanıt: evidence/tur2/masaustu-V05-gecmis-sekreter.jpg |
| QA-003 | S3 | OPEN | **Yeni:** VİA İz "değişen alanlar" satırlarında etiket ve değer üst üste biniyor (okunmuyor); alan adları ham (`amount`, `method`, `source`, `payment_id`, `receivable_id`, `procedure`, `corrects_id`) ve değerler ham (`cash`, `manual`). 1. turda da vardı (gözden kaçtı), yeni ID ile açıldı. |

### QA-003 — ayrıntı
- **Etki:** Geçmiş sekmesinde değişen alan bilgisi okunamıyor (görsel çakışma) + Türkçe metin kuralı ihlali. İşlev engeli yok → S3.
- **Kanıt:** evidence/tur2/QA-003-overlap-crop.jpg (masaüstü), evidence/tur2/mobil-V05-gecmis-sekreter.jpg.
- **Kaynak (tester gözlemi):** `apps/web/app/globals.css:214` `.timeline li { display:grid; grid-template-columns: 14px 1fr }` seçicisi iç `ul.change > li` öğelerine de uygulanıyor → metin düğümü 14px sütuna düşüyor, değer üstüne biniyor. `FIELD_LABELS` finans/klinik alanlarını kapsamıyor; `show()` enum değerlerini (cash/manual/…) çevirmiyor.
- **Kabul:** iç liste öğeleri normal akışta (çakışma yok; masaüstü + 360px); geçmişte görünen tüm alan adları Türkçe; enum değerleri (ödeme yöntemi, alacak kaynağı, durumlar) mevcut etiket tablolarından (PAYMENT_METHOD_LABELS vb.) çevrilir; kimlik alanları (payment_id, receivable_id, corrects_id) "Kayıt" yerine kısa kimlik veya gizlenir. Web birim testi: FIELD_LABELS kapsamı.

## 3. tur (sürüm f8de83a) — final yeniden sınama
| ID | Önem | Durum | Not |
|---|---|---|---|
| QA-003 | S3 | VERIFIED | Geçmiş değişen alanlar: `Tutar: 1.000,00 ₺`, `Yöntem: Nakit`, `Kaynak: Elle`, `Tahsilat: #25cccaa2`; çakışma yok (masaüstü + 360px). Kanıt: evidence/tur3/masaustu-V05-gecmis-sekreter.jpg, evidence/tur3/mobil-V05-gecmis-sekreter.jpg; web birim 25/25 (yeni audit-field-labels 7 test) |
| QA-004 | S3 | OPEN (FLAKY) | **Yeni:** tam E2E koşusunda `erisilebilirlik.spec.ts › sekreter: bugün, ajanda, hasta 360` — axe `document-title (serious)` `/ajanda` sayfasında `<title>` yok; aynı test izole 3/3 geçti, 1. tur tam koşuda da geçmişti → aralıklı. Sunucu HTML'inde `<title>VİADENT</title>` var (curl ile doğrulandı); hipotez: tam koşuda yük altında tarama geçiş anındaki belgeyi yakalıyor (istemci yönlendirme/akış). Ürün kusuru mu test ortamı arızası mı **belirsiz** → tekrarla kapatılmaz; tanı için kodlamaya devredildi. |

### QA-004 — ayrıntı
- Kanıt: evidence/tur3/R04-R05-e2e.log (satır ~88: 41 satırlık axe çıktısı), evidence/tur3/R04-axe-retry.log (3 izole koşu geçti).
- Etki: ekran okuyucu kullanıcısı için sayfa başlığı anlık eksik olabilir; işlev engeli yok → S3. Ancak kural gereği FLAKY vaka açıkken karar TESLİME ADAY olamaz.
- Önerilen tanı: tam koşuda `/ajanda` için trace (`trace: retain-on-failure` zaten açık → `test-results/` içinde trace.zip varsa incelenmeli); `<title>` DOM'a ne zaman giriyor; `page.goto` sonrası `document.title` boş anı var mı. Düzeltme ürün tarafındaysa (başlığın akışla geç gelmesi) sayfa düzeyinde statik `metadata`/`generateMetadata`; test tarafındaysa tarama öncesi kararlı duruma bekleme (beklenti değişmeden).

## 4. tur (sürüm d6bbdd6) — yeniden sınama
| ID | Önem | Durum | Not |
|---|---|---|---|
| QA-004 | S3 | (yeniden sınanıyor) | V01–V05 + P01–P03 HTTP 8/8, tarayıcı 10/10; tam E2E ×2 koşuluyor |
| QA-005 | S3 | FIX_READY (FLAKY, test kodu) → sürüm 6079d58, bkz. fix4.md; tester yeniden sınar | **Yeni:** API testleri 1. koşuda `gorev1.test.ts › H07 › asistan kaydı onay bekler…` → `POST /patients/:id/anamnesis` beklenen 201, gelen 409 (sürüm çakışması: hastanın zaten anamnezi var); 2. koşu 258/258. Test, hastayı `GET /patients?limit=50` listesinin 20. sırasından alıyor; liste sırası (ad/soyad eşitliğinde) ve/veya aynı dosyadaki diğer testlerin anamnez yazdığı hasta ile çakışma → belirlenimsiz. Ürün kusuru değil, **test belirlenimsizliği** (sentetik seed + liste sırasına bağımlılık). Kanıt: evidence/tur4/R01-api-tests-kosu1-FAIL.log, evidence/tur4/R01-api-tests-kosu2.log |
| QA-006 | **S1** | OPEN | **Yeni (ürün):** Eşzamanlı istek trafiği varken veritabanı boştaki bağlantıları sonlandırınca (`pg_terminate_backend`, yeniden başlatma/failover/pooler geri dönüşümü eşdeğeri) API süreci **çöküyor**: `node:events … Unhandled 'error' event … terminating connection due to administrator command` (pg Client, havuzdan alınmış bağlantıda dinleyicisiz hata). Tester tarafından 2 kez üretildi: (a) 4. tur 2. tam E2E koşusu sırasında (kodlama ajanının API testi `gorev4 › dayanıklılık` küme genelinde idle `viadent-api` bağlantılarını kesti) → API düştü, 36 E2E vakası zincirleme başarısız; (b) kontrollü tekrar: 400 eşzamanlı `GET /patients?q=a` + 12×`pg_terminate_backend(... datname='viadent' and state='idle')` → 5 istek 200, 395 bağlantı reddi, süreç çöktü. Mevcut `gorev4` dayanıklılık testi yalnız trafiksiz durumu kapsıyor. Kanıt: evidence/tur4/QA-006-api-crash.log, evidence/tur4/QA-006-http-codes.txt, evidence/tur4/R04-R05-e2e-kosu2-FAIL.log |
| QA-007 | S3 | OPEN (test kodu) | `apps/api/test/gorev4.test.ts:418` dayanıklılık testi `pg_terminate_backend` ile **tüm kümedeki** `viadent-api` bağlantılarını kesiyor (`datname` süzgeci yok) → aynı kümede çalışan başka ortamı (burada canlı demo API'si) etkiler. `datname = current_database()` ile sınırlanmalı. |

## 5. tur (sürüm 01b4c00) — final yeniden sınama
| ID | Önem | Durum | Not |
|---|---|---|---|
| QA-004 | S3 | VERIFIED | 4. tur 1. tam E2E 76/76 + 5. tur temiz-seed tam E2E (aşağıda); yeni regresyon `qa-004-ajanda-baslik.spec.ts` geçti; başlıklar "Ajanda · VİADENT" vb. |
| QA-005 | S3 | VERIFIED | API tam paket 3× (2 normal + 1 karışık sıra seed=3) 259/259; 5. turda 260/260 ×2. Kanıt: evidence/tur5/R01-api-tests-kosu{1,2}.log |
| QA-006 | S1 | VERIFIED | Kontrollü senaryo ×2 (idle: 398×200 + 2×503, 37 kesme; idle+aktif: 382×200 + 18×503, 59 kesme) → süreç ayakta, sonrası 200, `/health/ready` 200 ve `pool.clientErrors` 94; 0 yakalanmamış istisna. Yeni regresyon testi gorev4 (API 260). Kanıt: evidence/tur5/QA-006-retest.txt |
| QA-007 | S3 | VERIFIED | `datname = current_database()` süzgeci; 5. tur API koşuları sırasında canlı API (:4000) etkilenmedi. |

**Not (bulgu değil, ortam):** 5. tur 2. ardışık tam E2E koşusu (aynı DB'de 6. koşu, yeniden seed yok) `gorev3 › vezne → dağıtım → iade` 2/2 projede başarısız: önceki koşuların aynı hastaya yazdığı ve iadesi tamamlanmış 150,00 ₺ ödeme satırı `.first()` ile seçildi, "İade" düğmesi yok. Belgelenmiş ön koşul (verification.md: "temiz seed") ihlali; ürün kusuru değil. Backlog: E2E test verisinin tekrarlı koşuya dayanıklı yapılması (koşu-benzersiz tutar/hasta). Kanıt: evidence/tur5/R04-R05-e2e-kosu2-kirli-seed-FAIL.log. Ardından DB sıfırlanıp seed yüklendi ve tam E2E yeniden koşuldu (kosu3).
