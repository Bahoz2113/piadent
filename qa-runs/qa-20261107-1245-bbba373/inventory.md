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
