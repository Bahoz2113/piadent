# Düzeltme raporu — qa-20261031-1706-0309309

- Sınanan sürüm: `0309309c0b0be55892b4aee936d6d7fb2f440e97`
- **Yeni sürüm (teslim adayı): `6324f7651ac34ca19541c2b3659c2b95fbc7860b`** (`6324f76`)
- Worktree: `/home/claude/viadent/.claude/worktrees/agent-ae524bfcb66885fce` · Branch: `worktree-agent-ae524bfcb66885fce`
- Üretime dağıtım: **yok**. Migration değişikliği: yok. Test beklentisi / envanter / gate / geçmiş kanıt değişikliği: yok (yalnız yeni test dosyaları eklendi).

| ID | Önem | Durum | Yama |
|---|---|---|---|
| QA-001 | S1 | **FIX_READY** | `history()`, KVKK export `access_log`, denetim (`log`) raporu — `patient.health.read` yoksa `clinical_chart`/`clinical_note`/`anamnesis` olayları dışlanır |
| QA-002 | S3 | **FIX_READY** | `AUDIT_ACTION_LABELS` + `auditActionLabel()` tek kaynak (`packages/contracts`), hasta sayfası buradan okur; bilinmeyen kod → "Diğer işlem (kod)" |

## Kusur üretimi (yama öncesi)
`apps/api/test/qa-001-history-health.test.ts` sürüm 0309309 üzerinde koşuldu: **3 failed** (sekreter/finans history'de `finding.create`/`diagnosis.create` görünüyor; admin export `access_log` 2 klinik olay; `log` raporu 4 klinik satır) — tester kanıtıyla uyumlu. Diğer 255 mevcut test geçti.

## Diff özeti

### QA-001
- `apps/api/src/audit/audit.ts`: `export const CLINICAL_ENTITY_TYPES = ["anamnesis","clinical_note","clinical_chart"]` (tek kaynak, yorumla Plan §05 bağı).
- `apps/api/src/patients/patients.service.ts` `history()`: `entity_type not in ('clinical_note','anamnesis')` → `($2::boolean or e.entity_type <> all($3::text[]))`, parametre `CLINICAL_ENTITY_TYPES`. Hekim/asistan (sağlık yetkili) için davranış değişmedi.
- `apps/api/src/pilot/export.controller.ts` hasta dışa aktarımı: `access_log` sorgusu aynı kuralla süzülür (`health` false ise klinik olaylar yok). Diğer bölümler ve `omitted` listesi değişmedi.
- `apps/api/src/reports/definitions.ts` `log` runner: `where` ifadesine `($5::boolean or e.entity_type <> all($6::text[]))` eklendi; hem satır listesi hem `totals` (count/actors) aynı `where` ile hesaplandığı için tutarlı. Eylem öneki (`action=finding`) ile süzmede de sızmaz.

### QA-002
- `packages/contracts/src/audit.ts` (yeni): `AUDIT_ACTION_LABELS` (160+ eylem; `apps/api/src` içindeki tüm `audit(...)` eylemleri + şablon dizgisiyle üretilenler: `lab_order.*` (LAB_ACTIONS), `stock.*` (receipt/usage/adjustment/waste/return/reverse), `document.accepted/declined`, `procedure.complete/correct`, `clinical_note.create/correct`, `support.grant*`, `mfa.*`, `session.*`, `invitation.accept`, sistem eylemleri) ve `auditActionLabel(code)` → etiket ya da `Diğer işlem (kod)`.
- `packages/contracts/src/index.ts`: `export * from "./audit"`.
- `apps/web/app/(app)/hastalar/[id]/page.tsx`: yerel 8 girişli `ACTION_LABELS` kaldırıldı; `<strong>{auditActionLabel(e.action)}</strong>`.

### Yeni testler
- `apps/api/test/qa-001-history-health.test.ts` (4 test): hekim history'de clinical_chart ≥1; sekreter **ve** finans history'de clinical_chart 0, `finding.create`/`diagnosis.create` yok, tanı metni sızmaz, `patient.create` görünür kalır; admin export `access_log` klinik olay 0; admin `log` raporu klinik satır 0 ve `action=finding` süzgeci 0 satır / count 0.
- `apps/web/test/audit-labels.test.ts` (4 test): API kaynağını tarayıp (`action: "..."`, üçlü operatör türevleri, `auditSelf`, ham `insert into audit_events` literal'leri + şablon türevleri) her eylemin etiketli olduğunu doğrular (>100 eylem); teslim testinde ham görülen 9 eylem etiketli; etiketler ham kod/boş değil; bilinmeyen kod için `Diğer işlem (gelecek.eylem)`.

## Değişen dosyalar
```
apps/api/src/audit/audit.ts                 |   7 ++
apps/api/src/patients/patients.service.ts   |   6 +-
apps/api/src/pilot/export.controller.ts     |   7 +-
apps/api/src/reports/definitions.ts         |   6 +-
apps/api/test/qa-001-history-health.test.ts |  69 ++++ (yeni)
apps/web/app/(app)/hastalar/[id]/page.tsx   |   9 +-
apps/web/test/audit-labels.test.ts          |  67 ++++ (yeni)
packages/contracts/src/audit.ts             | 169 ++++ (yeni)
packages/contracts/src/index.ts             |   1 +
```

## Koşulan komutlar ve gerçek sonuçlar (worktree içinde, 31.10.2026)
| Komut | Sonuç |
|---|---|
| `pnpm install --offline --frozen-lockfile` | Done (bağımlılıklar kuruldu) |
| `pnpm --filter @viadent/api test` (yama ÖNCESİ, yeni test dahil) | 20 dosya: 1 failed / 19 passed · 258 test: **3 failed** (hepsi qa-001) / 255 passed |
| `pnpm --filter @viadent/api exec vitest run test/qa-001-history-health.test.ts` (yama sonrası) | **4 passed** |
| `pnpm typecheck` | contracts, web, db, api, worker: **Done** (hata yok) |
| `pnpm --filter @viadent/api test` (yama sonrası) | **20 dosya / 258 test passed**, 46,7 s (gerçek PostgreSQL test DB) |
| `pnpm --filter @viadent/web test` | **2 dosya / 18 test passed** |
| `pnpm --filter @viadent/contracts test` | **1 dosya / 15 test passed** |

Not: Worktree'de `.env` yoktu; ana depodaki `.env` kopyalandı (gitignore'da, commit'e girmedi). `apps/web/tsconfig.tsbuildinfo` typecheck ile değişmişti, geri alındı (commit dışı).

## Olası yan etkiler
- **Denetim (`log`) raporu**: sağlık yetkisi olmayan yönetici artık klinik olayları (anamnez/klinik not/bulgu-tanı) hiç görmez; `totals.count` de düşer. Raporun mevcut notunun ("değer içerikleri gösterilmez") ötesine geçen bilinçli bir daraltmadır (Plan §05, izin matrisi `treatment.read`: tanı/bulgu hariç). Sağlık yetkili kullanıcıda değişiklik yok.
- **KVKK hasta dışa aktarımı**: sağlık yetkisi olmayan aktarımda `access_log` bölümü klinik olayları içermez; dosyadaki mevcut not ("Sağlık bölümleri … hekimle birlikte tamamlayın") bu eksikliği de kapsar. `counts.access_log` düşer; `checksums` doğal olarak değişir.
- **VİA İz ekranı**: etiket kaynağı değişti; mevcut 8 etiket metni birebir korundu, kalan eylemler yeni Türkçe etiket aldı. Ekran davranışı/dizilimi değişmedi.
- Hasta sayfasında `clinical_note.*` etiketleri tanımlı kalır; bu olaylar yalnız sağlık yetkisiyle gelir (filtre API tarafında).
- Kapsam dışı (ayrı iş kalemi önerisi): denetim raporunun `action` sütunu hâlâ ham kodu gösteriyor (rapor filtresi önekle çalışıyor; etiketlemek süzme davranışını etkileyebilir). İstenirse `auditActionLabel` oradan da okunabilir.

## Yeniden sınama önerisi (tester)
1. V05 senaryosu: sekreter + finans → `GET /api/v1/patients/<id>/history` → `items[].entityType` içinde `clinical_chart` yok; hekim → var. Masaüstü/mobil Geçmiş sekmesi ekran görüntüsü: ham kod yok.
2. Admin → `POST /patients/<id>/export` → `sections.access_log` içinde `finding.create`/`diagnosis.create` yok.
3. Admin → Raporlar → "LOG sorgulama" → `finding`/`diagnosis`/`anamnesis`/`clinical_note` eylemleri listelenmez.
4. Gate: `node qa/cezeri/gate.cjs qa-runs/<id>/results.json qa-runs/<id>/plan.json 6324f7651ac34ca19541c2b3659c2b95fbc7860b`.

Durum: **FIX_READY** (QA-001, QA-002). Bulguları yalnız bağımsız tester kapatır.
