# Envanter — qa-20261102-1209-12fc6fd

Kaynak: depo (`apps/api/src/*/*.controller.ts`, `apps/web/app/**/page.tsx`, sekmeler, `packages/contracts`) + çalışan ürün (giriş yapılmış 6 rol).

## API: 32 controller / 229 uç
- `auth/appearance.controller.ts`: Get appearance; Put appearance; 
- `auth/auth.controller.ts`: Get health; Get health/ready; Get metrics; Post auth/login; Post auth/mfa; Post auth/logout; Get session; Post session/switch; 
- `auth/mfa.controller.ts`: Get mfa/recovery; Post mfa/recovery/regenerate; Get mfa; Post mfa/setup; Post mfa/enable; Post mfa/disable; Get sessions; Post sessions/revoke-others; Post password; 
- `bridge/bridge.controller.ts`: Post webhooks/:connectionId; Get integrations/overview; Post integrations/connections/mock; Post integrations/connections/:id/rotate-secret; Patch integrations/connections/:id; Get integrations/jobs; Get integrations/jobs/:id; Post integration-jobs/:id/approve; Post integration-jobs/:id/reject; Post integration-jobs/:id/retry; Post integration-jobs/:id/cancel; Get integrations/webhooks; Post integrations/mock/simulate; Get patients/:patientId/online-payments; Post patients/:patientId/online-payments; Post online-payments/:id/cancel; Post payments/:id/provider-refunds; 
- `clinical/anamnesis-templates.controller.ts`: Patch :id; Post :id/publish; Post :id/retire; 
- `clinical/anamnesis.controller.ts`: Get :version; Post :version/review; 
- `clinical/clinical.controller.ts`: 
- `documents/care.controller.ts`: Get patients/:patientId/communication; Post patients/:patientId/communication-preferences; Post messages; Get patients/:patientId/follow-ups; Post follow-ups; Post follow-ups/:id/cancel; Get appointments/:id/readiness; Post appointments/:id/readiness-exceptions; Get readiness-rules; Post readiness-rules; Post readiness-rules/:id/active; 
- `documents/documents.controller.ts`: Get document-types; Get templates; Post templates; Post templates/:id/versions; Patch template-versions/:id; Post template-versions/:id/approve; Post template-versions/:id/retire; Post template-versions/:id/preview; Post documents; Get patients/:patientId/documents; Get documents/:id; Post documents/:id/print; Post documents/:id/decision; Post documents/:id/revoke; Post document-types/:id/active; 
- `documents/files.controller.ts`: Post files; Put files/:id/content; Get patients/:patientId/files; Get files/:id; Get files/:id/content; Post files/:id/delete; 
- `finance/account.controller.ts`: Get patients/:patientId/account; Post receivables; Post receivables/:id/cancel; Post payments; Post payments/:id/allocations; Post allocations/:id/reverse; Post payments/:id/refunds; 
- `finance/finance.controller.ts`: Get cash-accounts; Post cash-accounts; Patch cash-accounts/:id; Get expenses; Post expenses; Post expenses/:id/reverse; Get finance/summary; Get finance/balances; Get finance/cash; Get commission-rules; Post commission-rules; Get commissions; Post commission-payouts; Post commission-payouts/:id/reverse; 
- `finance/invoices.controller.ts`: Get patients/:patientId/invoices; Get invoices/:id; Post invoices; Put invoices/:id/lines; Post invoices/:id/cancel; Post invoices/:id/submit; 
- `finance/receipts.controller.ts`: Get receipts/:id; Post receipts/:id/print; 
- `operations/lab.controller.ts`: Get lab-orders; Get patients/:patientId/lab-orders; Get lab-orders/:id; Get lab-orders/:id/work-sheet; Post lab-orders; Patch lab-orders/:id; Post lab-orders/:id/transition; Post lab-orders/:id/notes; Post lab-orders/:id/costs; Post lab-costs/:id/reverse; Get lab-orders-summary; 
- `operations/stock.controller.ts`: Get stock/items; Post stock/items; Patch stock/items/:id; Get stock/items/:id/movements; Get patients/:patientId/stock-usage; Post stock/receipts; Post stock/usages; Post stock/waste; Post stock/counts; Post stock/movements/:id/reverse; 
- `operations/suppliers.controller.ts`: Get suppliers; Post suppliers; Patch suppliers/:id; Get supplier-balances; Get suppliers/:id/ledger; Post supplier-bills; Post supplier-payments; Post supplier-entries/:id/reverse; 
- `ops/ops.controller.ts`: Post bootstrap; 
- `patients/patients.controller.ts`: Post duplicates; Get :id; Post :id/identity; Patch :id; Get :id/history; 
- `patients/relations.controller.ts`: Post :relationId/end; 
- `pilot/export.controller.ts`: Post exports/clinic; Post patients/:patientId/export; 
- `pilot/import.controller.ts`: Post imports; Get imports; Get imports/:id; Get imports/:id/errors.csv; Post imports/:id/commit; Post imports/:id/rollback; 
- `reports/reports.controller.ts`: Get reports; Get reports/:id; Get reports/:id/export; 
- `scheduling/resources.controller.ts`: Get admin/resources; Get agenda-context; Post practitioners; Patch practitioners/:id; Put practitioners/:id/schedule; Post chairs; Patch chairs/:id; Post appointment-types; Patch appointment-types/:id; Get closures; Post closures; Post closures/:id/cancel; 
- `scheduling/scheduling.controller.ts`: Get resources; Get appointments; Get patients/:id/appointments; Post appointments; Post appointments/:id/status; Post appointments/:id/contact; 
- `tasks/tasks.controller.ts`: Get tasks; Post tasks/:id/status; Post via-akis/refresh; 
- `team/invitations.controller.ts`: Get :token; Post :token/accept; 
- `team/security.controller.ts`: Get policy; Put policy; Get support-grants; Post support-grants; Get akis; Put akis; Post support-grants/:id/approve; 
- `team/team.controller.ts`: Post :id/role; Get invitations; Post invitations; Post invitations/:id/revoke; Post :id/revoke; Post :id/mfa-reset; Post :id/password-reset; 
- `treatment/catalog.controller.ts`: Get procedures; Post procedures; Get procedures/:id/consumables; Put procedures/:id/consumables; Patch procedures/:id; Get tariffs; Get tariffs/:id; Post tariffs; Put tariffs/:id/items; Post tariffs/:id/publish; Post tariffs/:id/retire; Get price; 
- `treatment/chart.controller.ts`: Get patients/:patientId/chart; Post patients/:patientId/findings; Post findings/:id/status; Post patients/:patientId/diagnoses; Post diagnoses/:id/status; Get patients/:patientId/visits; Post patients/:patientId/performed; Post performed/:id/cancel; Post performed/:id/correct; 
- `treatment/plans.controller.ts`: Get plans; Get patients/:patientId/plans; Post patients/:patientId/plans; Post plan-versions/:id/items; Patch plan-items/:id; Delete plan-items/:id; Post plan-versions/:id/reprice; Post plan-versions/:id/propose; Post plan-versions/:id/decision; Post plans/:id/versions; Post plan-versions/:id/cancel; 

## Ekranlar (13 sayfa)
- /
- /(app)/ajanda
- /(app)/bugun
- /(app)/finans
- /(app)/hastalar
- /(app)/hastalar/[id]
- /(app)/hesabim
- /(app)/operasyon
- /(app)/raporlar
- /(app)/tedavi
- /(app)/yonetim
- /davet/[token]
- /giris

Hasta 360 sekmeleri: Özet, Tedavi, Finans (Ödemeler, Makbuz, Online ödeme, **Fatura taslakları**, Hareket defteri), Sağlık (anamnez), Belgeler (**klinik çıktılar**), İletişim, Laboratuvar, Geçmiş. Yönetim sekmeleri: Ekip, Hekim/koltuk, İşlem türleri, Kapatmalar, Katalog (**Sarf**), Belge şablonları, **Anamnez şablonu**, PİA Köprü (**e-belge MOCK**), Veri aktarımı, Dışa aktarım, Güvenlik (PİA Akış eşikleri: **Yükseltme süresi**). Üst çubuk: arama, klinik, hesap, **Görünüm**, çıkış. Raporlar: 20 rapor (**Mali müşavir dönem dökümü** yeni), CSV + **Excel**.

## Roller (6)
clinic_admin, dentist, secretary, assistant, finance, support (+ çoklu üyelik kullanıcısı). İzin matrisi: `packages/contracts/src/permissions.ts`; yeni izinler `invoice.write` (finans), `anamnesis.template` (yönetici, hekim).

## Kiracılar (2): Yeşilvadi (A), Mavi (B) — sentetik.

## Entegrasyonlar
SMS (MOCK), online ödeme (MOCK), e-belge (MOCK, bu sürümde), WhatsApp/e-posta/e-Nabız/e-imza: engelli (erişim bekleniyor). İşlem kümesi OPERATIONS=7; canlı kapı VIADENT_EXTERNAL_SEND_ENABLED.

## CLI
`pnpm db:reset|db:seed|db:migrate`, `packages/db/src/backup-cli.ts` (yedek/geri yükleme), `rotate-keys.ts`, `qa/cezeri/gate.cjs`.

## Bu sürümdeki yeni/değişen kapsam (önceki koşuya göre)
N01 makbuz (0021) · N02 fatura taslağı + MOCK e-belge (0023, 0026, 0027) · N03 mali müşavir dökümü · N04 anamnez şablonu (0024) · N05 klinik çıktı belgeleri (0025) · N06 görünüm (0022) · N07 PİA Akış SLA (0028) · N08 XLSX · N09 mobil kart + ham kod temizliği · N10 sarf reçetesi (0029). Önceki vakalar V01–V06, P01–P03, R01–R07 korunur (çıkarılmadı).

## Açık / keşfedilemeyen
- Gerçek sağlayıcı (SMS/PSP/GİB/e-Nabız) davranışı: sözleşme/test ortamı yok → kapsam dışı (release-gates §3).
- Fiziksel cihaz, iOS/Android: ortam yok → NA (insan adımı).
