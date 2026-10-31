# Düzeltme raporu (2. devir) — qa-20261031-1706-0309309

- Bulgu: **QA-003 (S3)** — Hasta 360 → Geçmiş (VİA İz) "değişen alanlar": etiket/değer çakışması + ham alan adı ve enum değerleri.
- Sınanan sürüm: `6324f7651ac34ca19541c2b3659c2b95fbc7860b`
- **Yeni sürüm (teslim adayı): `f8de83a9ee03e36a1f1f9013c2865f92b7b85d84`** (`f8de83a`)
- Worktree: `/home/claude/viadent/.claude/worktrees/agent-a0ca0658bfb279b5a` · Branch: `worktree-agent-a0ca0658bfb279b5a` (6324f76 üzerinden açıldı, `git log -1` ile doğrulandı)
- Üretime dağıtım: **yok**. Migration değişikliği: yok. API davranış değişikliği: yok. Test beklentisi / envanter / gate / geçmiş kanıt değişikliği: **yok** (yalnız yeni test dosyası + mevcut E2E'ye ek kontrol).
- Durum: **FIX_READY** — kapatma yalnız bağımsız tester yeniden sınamasıyla.

| ID | Önem | Durum | Yama |
|---|---|---|---|
| QA-003 | S3 | **FIX_READY** | `.timeline > li` grid seçicisi + `ul.change > li { display: list-item }`; `AUDIT_FIELD_LABELS` / `auditFieldLabel()` / `auditValueLabel()` tek kaynak (`packages/contracts/src/audit.ts`), Hasta 360 Geçmiş sekmesi buradan okur |

## Kusur üretimi (yama öncesi)
Geçici test (`apps/web/test/_repro-qa003.test.ts`, commit edilmedi, silindi) HEAD 6324f76'daki dosyaları `git show` ile okuyup kabul ölçütünü denetledi — **2/2 kusur doğrulandı**:
- `apps/web/app/globals.css`: `.timeline li { display: grid; grid-template-columns: 14px … }` seçicisi var, `.timeline > li` yok → iç `ul.change > li` öğeleri de grid'e düşüyor (metin 14px sütuna, değer üstüne biniyor). Tester kanıtı `evidence/tur2/QA-003-overlap-crop.jpg` ile uyumlu.
- `apps/web/app/(app)/hastalar/[id]/page.tsx` eski `FIELD_LABELS` tablosunda `amount, method, source, payment_id, receivable_id, procedure, corrects_id, tooth` **hiçbiri yok**; `show()` içinde `names.get(…) ?? "Kayıt"` → kimlikler "Kayıt" olarak görünüyor; `cash`/`manual` çevrilmiyor.

## Diff özeti

### CSS (kabul 1 — çakışma yok, masaüstü + 360px)
- `apps/web/app/globals.css:214-216`: `.timeline li` → `.timeline > li` (grid yalnız olay satırı). Eklenen: `.timeline .change li { display: list-item; overflow-wrap: anywhere; }` (uzun değerler 360px'te taşmaz). `.timeline` sınıfı yalnız hasta geçmişi `<ol>`'unda kullanılıyor (grep ile doğrulandı); başka ekran etkilenmez.

### Tek kaynak etiket/çeviri (kabul 2–5)
- `packages/contracts/src/audit.ts` (ekleme, mevcut `AUDIT_ACTION_LABELS` değişmedi):
  - `AUDIT_FIELD_LABELS` (≈105 anahtar): API `apps/api/src` içindeki tüm `changes` anahtarları — `audit(..., { changes: { k: { from, to } } })` nesneleri, koşullu spread'ler (`...(x ? { corrects_id: … } : {})`), `diff(before, next, [...])` sütun listeleri (hasta kartı, tedarikçi), `changes[k] = …` döngülerinin kaynak nesneleri (hekim güncelleme `next`, lab iş emri `next`, VİA Akış `AkisSettings` anahtarları). Finans: `amount: Tutar, method: Yöntem, source: Kaynak, payment_id: Tahsilat, receivable_id: Alacak, reverses_id, basis, rate, …`; klinik: `procedure: İşlem kodu, tooth: Diş, corrects_id: Düzeltilen işlem, corrects_note_id, …`.
  - `auditFieldLabel(field)`: tablo + türetilmiş anahtarlar — iletişim tercihi `"<amaç>:<kanal>"` → "Randevu hatırlatma · SMS" (`COMM_PURPOSE_LABELS`/`COMM_CHANNEL_LABELS`), hazırlık `document:<uuid>` → "Hazırlık belgesi", `anamnesis` → "Anamnez"; bilinmeyen → alt çizgiler boşluk.
  - `auditValueLabel(field, value, { entityType, names, formatDateTime, formatDate })`:
    - para (`amount`, `unit_price`, `discount`) → `formatTRY` → `1.000,00 ₺`; `rate` → `%12.5`
    - enum'lar mevcut tablolardan: `method` → `PAYMENT_METHOD_LABELS` (cash → Nakit, online dahil); `source` → alacak/cari/sağlayıcı kaynakları (`performed_procedure` → "Gerçekleşen işlemden", `manual` → "Elle", `provider_webhook`, `lab_cost`, `stock_receipt`) + `COMM_SOURCE_LABELS`; `kind` → `SUPPLIER/CASH_ACCOUNT/INTEGRATION/IMPORT_KIND_LABELS`; `gender`, `contact_outcome`, `relation`, `decision`, `basis`, `stage`, `role`, `purpose`, `channel`, `request_status`, `transport_status`, `operation`, `category` (`FILE_CATEGORY_LABELS`) → ilgili `@viadent/contracts` tabloları; küçük yeni tablolar yalnız karşılığı olmayanlar için (`approval`, `scope`, alacak/cari kaynakları, genel durumlar).
    - `status` → `entityType`'a göre (`appointment`, `treatment_plan`/`plan_version`, `lab_order`, `patient_document`, `file`, `follow_up`, `online_payment_request`, `message`, `integration_job`), yoksa genel durum tablosu (active/cancelled/ended/revoked/retired/published/…; iletişim tercihi `granted`/`withdrawn`; hazırlık `missing`/`excepted`).
    - kimlikler (`*_id`, `corrects_id`, `reverses_id`) → `names` eşlemesinden ad, yoksa **`#ilk8`** (artık "Kayıt" yok); hash alanları ilk 8 + "…"; `secret` → "••••".
    - boolean → Evet/Hayır; dizi → virgülle; null/boş → "Belirtilmedi"; tarih/saat alanları çağıranın klinik saat dilimli biçimleyicisiyle.
- `apps/web/app/(app)/hastalar/[id]/page.tsx`: yerel `FIELD_LABELS` ve `show()` dalları kaldırıldı; `auditFieldLabel(k)` + `auditValueLabel(k, v, { entityType: e.entityType, names, formatDateTime: fmtDateTime(iso, tz), formatDate: fmtDate })`. Ek küçük düzeltme: `from` null olan değişikliklerde (örn. `payment.refund`, `plan.item_add`) `Belirtilmedi → X` yerine doğrudan `X` gösterilir. Kullanılmayan importlar (`APPOINTMENT_STATUS_LABELS`, `CONTACT_OUTCOME_LABELS`, `AppointmentStatus`) temizlendi.

### Testler
- **Yeni** `apps/web/test/audit-field-labels.test.ts` (7 test): API kaynağını tarayıp (`changes: {` gövdesi küme-dengeli okunur; `key: { from:` şekli; `diff(..., [...])` listeleri; `const next = {…}` + `changes[k]` döngüleri; `AKIS_DEFAULTS` anahtarları) türetilen **her** alan anahtarı `AUDIT_FIELD_LABELS` içinde; etiketler ham anahtar değil; türetilmiş anahtar çözümü; teslim testinde ham görülen değerler (`1000.00` → `1.000,00 ₺`, `cash` → Nakit, `manual` → Elle, lab/randevu/ilişki durumları, `granted`); kimlikler `#7d3f9a2c` ya da ad, "Kayıt" değil; tarih biçimleyici; `globals.css` grid seçicisi `.timeline > li` ve `.timeline .change li { display: list-item|block }`.
- **E2E ek kontrol** `apps/web/e2e/critical-flow.spec.ts` ("sekreter … VİA İz" testi): `.timeline .change li` ilk öğesi görünür, `toHaveCSS("display", "list-item")`, ham anahtarla başlamıyor, "Randevu zamanı:" satırı görünür. **Bu oturumda çalıştırılmadı** (API+DB+web servisi gerekir); geçmiş sayılmaz — tester koşusuna bırakıldı.

## Komutlar ve gerçek sonuçlar (worktree, sürüm f8de83a)
| Komut | Sonuç |
|---|---|
| `pnpm install --offline --frozen-lockfile` | Done (worktree'de node_modules yoktu; store'dan 252 paket) |
| `pnpm --filter @viadent/web exec vitest run test/_repro-qa003.test.ts test/audit-field-labels.test.ts` (yama sonrası, geçici repro dahil) | 2 dosya, **9/9 geçti** — repro: HEAD'deki eski CSS/FIELD_LABELS kusurlu (doğrulandı); yeni test: yama kabul ölçütlerini sağlıyor |
| `pnpm typecheck` | contracts, db, web, worker, api: **Done** (hata yok) |
| `pnpm --filter @viadent/web test` | **3 dosya, 25/25 geçti** (audit-labels, audit-field-labels, contrast) |
| `pnpm --filter @viadent/contracts test` | **1 dosya, 15/15 geçti** |
| `pnpm --filter @viadent/web lint` | Betik yok (projede lint script tanımlı değil) |
| E2E (`critical-flow.spec.ts`) | **Çalıştırılmadı** (servis gerektirir) |

## Yan etkiler / notlar
- `packages/contracts/src/audit.ts` artık `schemas/finance/documents/integrations/operations/treatment/pilot/permissions/money` modüllerinden import ediyor; bu modüller `audit.ts`'i import etmiyor → döngü yok (typecheck + testler temiz).
- Değer çevirisi görüntüleme katmanı; API `changes` içeriği, denetim kaydı ve raporlar değişmedi. Denetim/KVKK dışa aktarımı ham veriyi vermeye devam eder.
- `.timeline .change li { overflow-wrap: anywhere }` 360px'te uzun değerlerin (hash, uzun gerekçe) yatay taşmasını engeller.
- Tester için öneri: tur2 sentetik hastasında (`evidence/tur2/http-summary.json → patient`) Geçmiş sekmesinde `Tutar: 1.000,00 ₺`, `Yöntem: Nakit`, `Kaynak: Elle`, `Tahsilat: #xxxxxxxx` satırlarını masaüstü + 360px'te doğrula; `.timeline .change li` için `display: list-item`.
- `.env` ana depodan worktree'ye kopyalandı (gitignore'da, commit dışı). `apps/web/tsconfig.tsbuildinfo` typecheck ile değişti, geri alındı (commit dışı).
