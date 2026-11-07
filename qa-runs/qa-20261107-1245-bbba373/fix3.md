# Düzeltme paketi 3 — QA-403 (tur 10)

**Bulgu QA-403 (S3, sorumlu: geliştirme).** Sürüm 6fe082d. R03 (`apps/web` vitest) 1 başarısız:
`test/audit-field-labels.test.ts > QA-003 … > API kaynağındaki her changes anahtarı Türkçe etiketli`
— `expected [ 'replaced', 'templates', 'types' ] to deeply equal []`.

**Etki:** `apps/api/src/documents/standard-catalog.ts` içindeki `document_catalog.install` denetim olayının `changes` anahtarları (`types`, `templates`, `replaced`) `packages/contracts/src/audit.ts` `AUDIT_FIELD_LABELS`'ta yok → PİA İz "değişen alanlar" satırında ham İngilizce anahtar görünür.

**Beklenen:** Üç anahtarın Türkçe etiketi olsun (ör. "Eklenen belge türü", "Eklenen şablon", "Yenilenen yer tutucu metin"); mevcut etiketlerle çakışmasın. Testi gevşetme. Değişiklikten sonra `cd apps/web && npx vitest run`, `cd packages/contracts && npx vitest run`, `pnpm typecheck` çalıştır; tek commit (Co-Authored-By/Claude-Session satırlarıyla) ve `gelistirme-gecmisi`'ne push. Kanıt: commit sha + test çıktısı özeti.
