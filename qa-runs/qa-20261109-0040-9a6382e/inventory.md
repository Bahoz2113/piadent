# Envanter — qa-20261107-1245-bbba373 (önceki koşunun envanterine ek)

Önceki envanter: qa-runs/qa-20261107-0145-b910f90/inventory.md (değişmedi). Bu pakette eklenen / değişen:

| Kimlik | Yüzey | Kaynak | Vaka |
|---|---|---|---|
| UI-ODO | Hasta kartı Özet → Diş şeması (anatomik çizim, ipucu, ayrıntı, karma dizi) | components/treatment/odontogram.tsx, tooth-model.ts, tooth-shapes.ts, tooth-summary.tsx | H02, V02 (regresyon), F05, F12 |
| UI-ODO-T | Tedavi sekmesi odontogramı (yüzey seçimi) | treatment-tab.tsx | gorev2 E2E (R04) |
| UI-APT-PERF | Randevu ayrıntısı → Yapılan işlemi dişe işle | components/appointment/perform-on-tooth.tsx, ajanda/page.tsx | H02 |
| API-PERF | POST /patients/:id/performed (değişmedi; yeni giriş noktası) | chart.controller.ts | H01 |
| DOC-CAT | Belge kataloğu 42 tür + 39 DEMO şablon; 0037 | contracts/document-templates-standard.ts, seed.ts, migration 0037 | H03, H04, H07 |
| UI-IMG | Hasta kartı → Görüntülemeler (liste, süzgeç, görüntüleyici, yeni ekle) | components/patient/imaging-tab.tsx | H06 |
| API-IMG | POST /files (imagingKind, takenOn, teeth, imagingNote; DICOM), GET /patients/:id/files | files.controller.ts, contracts/documents.ts, db/files.ts (DICM), migration 0038 | H05, N11 (regresyon) |
| UI-DATE | DateField takvim başlığı: ay + yıl seçimi | components/date-field.tsx | H08, F01 (regresyon) |
| ROL | Görüntüleme/şema: yönetici, hekim, asistan; sekreter/finans kapalı | permissions (değişmedi) | H05, H06, F12 |

NA: fiziksel mobil cihaz, android/ios, VS Code (ürün kapsamı dışı; önceki koşudaki gerekçe). DICOM tarayıcı önizlemesi ürün kapsamında yok (indir). Vercel ~4,5 MB istek sınırı yerel ortamda sınanamaz (kayıtlı risk).

## 08.11.2026 eklemeleri (ADR-107)
| Kimlik | Parça | Kaynak | Vaka |
|---|---|---|---|
| API-APPT-PROCS | POST /appointments \`procedureIds\` (isteğe bağlı, ≤10, tekrar yok; eski \`procedureId\`), yanıt \`procedures[]\` + toplam \`plannedPrice\` | scheduling.service.ts, contracts/schemas.ts, migration 0040 | I01–I04, I08 |
| DB-0040 | appointment_procedures (FORCE RLS, uygulama rolü SELECT/INSERT), demo ünite adları | 0040_appointment_procedures_units.sql | I04, I06, R07 |
| UI-BOOK | Randevu ver: İşlemler (isteğe bağlı) listesi, Kaldır, toplam, süre toplamı; Ünite etiketi | new-appointment-page.tsx | I08, B04, F12 (regresyon) |
| UI-VISIT-DX | Randevu ayrıntısı: Planlanan işlemler, Tanılar (çoklu diş), dişe işlemde planlanan hızlı seçim | ajanda/page.tsx, visit-diagnoses.tsx, perform-on-tooth.tsx, odontogram.tsx (multiSelected) | I05, I09, H02 (regresyon) |
| UI-PANEL | Panel: başlık klinik adı + tarih, Bugünün randevuları | bugun/page.tsx | I07, B01 (regresyon) |
| UI-FLOW | İş akışı sekmesi (/is-akisi) PİA Akış | is-akisi/page.tsx, shell.tsx | I07, gorev akış E2E (regresyon) |
| UNIT | Koltuk → Ünite (arayüz, hata, denetim etiketi) | resources, agenda-settings, errors.ts, audit.ts | I06 |

## 09.11.2026 eklemeleri (ADR-108 Laboratuvar)
| Kimlik | Parça | Kaynak | Vaka |
|---|---|---|---|
| LAB-IMP | İş emri ölçü türü/tarihi, istenen malzeme (oluştur/güncelle/föy, kilit) | lab.controller.ts, contracts/operations.ts, 0041 | J01, J05 |
| PO | Malzeme siparişi API (liste, özet, ayrıntı, oluştur, gönder/iptal, teslim al) | purchase.controller.ts, stock.controller.ts receiveStock | J02, J03, J06 |
| DB-0041 | purchase_orders/lines/receipts (FORCE RLS, kolon yetkisi, tetikleyici), supplier_entries kaynağı, tasks kind | 0041_lab_impression_purchase_orders.sql | J02, J03, R07 |
| AKIS-PO | Geciken malzeme siparişi görevi | packages/db/src/operations-akis.ts | J04 |
| UI-LAB | /laboratuvar (Hasta işleri, Malzeme siparişleri, Tedarikçiler), Operasyon = Stok, yönlendirmeler | laboratuvar/page.tsx, purchase-orders.tsx, lab.tsx, operasyon/page.tsx, shell.tsx | J05–J07, regresyon gorev6/0711/erişilebilirlik |
