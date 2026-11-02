# Bulgu defteri — qa-20261102-1209-12fc6fd (tur 1: 12fc6fd · tur 2: 08438cf · tur 3: bb49098)

| ID | Önem | Durum | Vaka | Başlık | Sorumlu |
|---|---|---|---|---|---|
| QA-101 | S1 | VERIFIED (tur 2, 08438cf) | N05 | Sağlık yetkisi olmayan rol klinik çıktı belgesinde yazma işlemi yapabiliyor (yönetici iptal 200; sekreter "yazdırıldı" kanıtı 200) | Kodlama (cezeri-duzeltici) |
| QA-102 | S2 | VERIFIED (tur 2, 08438cf) | N05 | Klinik çıktı belgesinin varlığı/olayları sağlık yetkisi olmayan rollere hasta geçmişinde (PİA İz) görünüyor | Kodlama |
| QA-103 | S3 | VERIFIED (tur 2, 08438cf) | N02 | Sağlayıcının düzenlediği (MOCK) / iptal ettiği faturada da "TASLAK — resmî belge değildir" uyarısı, "e-Belge sağlayıcısı bağlı değil" metni ve "Taslağı yazdır" (TASLAK filigranı) gösteriliyor | Kodlama |
| QA-104 | S1 | VERIFIED (tur 3, bb49098) | N05 (komşu) | KVKK hasta dışa aktarımında sağlık yetkisi olmayan yönetici klinik çıktı belgelerinin içeriğini, onay/kanıt olaylarını ve bağlı dosya kayıtlarını alıyor | Kodlama (cezeri-duzeltici) |
| QA-105 | S2 | VERIFIED (tur 3, bb49098) | N05 (komşu) | Onam/belge raporu klinik çıktı belgelerini (hasta, tür "Epikriz / tedavi özeti", başlık) sağlık yetkisi olmayan role listeliyor | Kodlama |
| QA-106 | S2 | OPEN | N05 (komşu) / fix2 risk 1 | Hasta dışa aktarımında sağlık yetkisi olmayan yönetici klinik hassasiyetli dosyaların (radyograf vb.) metaverisini (ad, kategori, SHA-256) alıyor; aynı kullanıcı dosya listesinde bunları görmüyor | Kodlama (cezeri-duzeltici) |
| QA-107 | S3 | OPEN | N05 (komşu) / fix1 risk 3 | Klinik çıktı belgesine bağlanmış idari kategorili dosya (document_scan) sekretere listede, ayrıntıda görünüyor ve klinik belge kimliğini (`patientDocumentId`) açığa veriyor; dışa aktarım ise aynı dosyayı gizliyor (tutarsız) | Kodlama |

## QA-101 (S1) — Klinik çıktı belgesi yazma uçlarında sağlık kapısı yok
- **Ortam/sürüm:** yerel test, `12fc6fd`, sentetik hasta "Epikriz Sınama" (A kliniği).
- **Adımlar:** (1) Hekim `POST /documents` ile EPIKRIZ üretir (201). (2) Sekreter `GET /documents/:id` → **404** (doğru: varlık gizli). (3) Sekreter `POST /documents/:id/print` → **200 `{ok:true}`** ve belgeye `printed` kanıt olayı yazılır. (4) Var olmayan id ile aynı istek → 404 (yani 200/404 farkı varlık kahini). (5) Yönetici (`patient.health.read` yok, `document.revoke` var) `POST /documents/:id/revoke` → **200**; belge iptal oldu (Geçmiş'te "Belge iptal edildi · Selma Tekin").
- **Beklenen (ADR-085):** klinik çıktı belgeleri sağlık verisidir; `patient.health.read` olmayan rol için tüm uçlarda 404 (varlığı bile görünmez), durum değiştiremez, kanıt yazamaz.
- **Gözlenen:** okuma uçları korunuyor, yazma/yan uçlar (print, revoke; muhtemelen decision ve kanıt dosyası bağlama) korunmuyor.
- **Etki:** sağlık yetkisi olmayan rol hekimin klinik belgesini geri alınamaz biçimde iptal edebiliyor ve kanıt zincirine yetkisiz olay ekleyebiliyor; varlık sızıntısı. Kritik iş akışı + yetki ihlali → S1.
- **Kanıt:** `evidence/tur1/N05-http.json` (secPrint 200), `evidence/tur1/N05-yan-uclar.json`, `evidence/tur1/masaustu-N05-sekreter-gecmis.jpg` (yöneticinin iptal olayı).
- **Kök neden ipucu:** `apps/api/src/documents/documents.controller.ts` — kategori kapısı yalnız `render()` (satır ~157), `list` (~249) ve `detail` (~266) içinde; `print`, `decision`, `revoke` ve kanıt/dosya bağlama uçları kategoriyi kontrol etmiyor. Tek yardımcı (ör. `loadDocForWrite(c, ctx, id)`) tüm belge uçlarında kullanılmalı.

## QA-102 (S2) — Hasta geçmişinde klinik çıktı belgesi olayları
- **Adımlar:** QA-101 senaryosu sonrası sekreter `GET /patients/:id/history` → `document.issue` (entityType `patient_document`, entityId = epikriz id, aktör hekim, `content_hash`, `template_version_id`) ve `document.revoke` olayları döner; UI Geçmiş sekmesinde "Belge düzenlendi · Dt. Elif Aras" görünür.
- **Beklenen:** sağlık yetkisi olmayan rol için klinik çıktı belgesine ait olaylar geçmişte görünmez (QA-001'deki klinik varlık filtresiyle tutarlı).
- **Kanıt:** `evidence/tur1/N05-http.json` (histLeak=true, histSample), `evidence/tur1/{masaustu,mobil}-N05-sekreter-gecmis.jpg`.
- **Kök neden ipucu:** `patients.service.ts history()` `CLINICAL_ENTITY_TYPES` yalnız varlık türüne bakıyor; `patient_document` olayları kategoriye göre (clinical_output) ayrıca süzülmeli. `document.issue/print/decision/revoke` olayları için belge kategorisi birleştirilmeli.

## QA-103 (S3) — Düzenlenmiş/iptal faturada taslak uyarıları
- **Adımlar:** MOCK e-belge bağlantısıyla gönderilip `issued` (MOCK202697C69990F) ve sonra `cancelled` olan faturayı Finans → Fatura taslakları → Aç.
- **Gözlenen:** üstte sabit "TASLAK — resmî belge değildir … e-Belge sağlayıcısı bağlı değil" uyarısı, altta "Taslağı yazdır" (TASLAK filigranlı çıktı). Aynı ekranda "Fatura no: MOCK… · MOCK sağlayıcı — resmî belge değil" ve "Sağlayıcı: mock (mock)".
- **Beklenen:** uyarı ve yazdırma durumu yansıtmalı: taslak → TASLAK; sağlayıcıda/düzenlenmiş/iptal → sağlayıcı durumu ("MOCK sağlayıcı tarafından düzenlendi — resmî değil" / gerçek sağlayıcıda "Sağlayıcı belgesi: …"), "bağlı değil" metni bağlantı durumuna göre. Gerçek sağlayıcı geldiğinde düzenlenmiş faturada "TASLAK" ifadesi yanıltıcı olur.
- **Kanıt:** `evidence/tur1/masaustu-N02-fatura-ayrinti.jpg`.

## Tur 2 yeniden sınama (08438cf, temiz seed) — kapanan bulgular
- **QA-101 VERIFIED:** sekreter/yönetici için klinik çıktıda print 404/404, karar 404/404, iptal 404/404, dosya bağlama 422/422 (gerçek/var olmayan aynı); durum `issued` kaldı, kanıt +0; hekim print 200, hekim iptal 200. Kanıt `evidence/tur2b/N05-http.json`, `N05-komsu.json`.
- **QA-102 VERIFIED:** sekreter geçmişinde belge kimliğiyle eşleşen olay 0; hekimde `document.issue`×2 + `document.revoke` görünür. Tarayıcıda (masaüstü+mobil) Geçmiş'te belge olayı yok. Kanıt `evidence/tur2/N05-kesin-eslesme.json`, `evidence/tur2b/{masaustu,mobil}-N05-*.jpg`.
- **QA-103 VERIFIED:** MOCK düzenlenip iptal edilen faturanın ayrıntısında "TASLAK" ibaresi yok, sağlayıcı durumu ve "resmî belge değil" görünüyor (masaüstü + 360 px). Kanıt `evidence/tur2b/{masaustu,mobil}-N02-fatura-ayrinti.jpg`.

## QA-104 (S1) — KVKK hasta dışa aktarımı klinik çıktı belgelerini sağlık yetkisi olmayana veriyor
- **Ortam/sürüm:** yerel test, `08438cf`, temiz seed, sentetik hasta "Epikriz Sınama".
- **Adımlar:** (1) Hekim EPIKRIZ ve HASTA-FOYU üretir. (2) Yönetici (`export.patient` var, `patient.health.read` yok) `POST /patients/:id/export` (gerekçeli) → 200.
- **Gözlenen:** `omitted` = anamnesis_versions, clinical_notes, odontogram_findings, diagnoses (sağlık bölümleri doğru dışlanıyor) **ama** `sections.patient_documents` 2 klinik çıktı satırını `content` (epikriz/föy metni) dahil döndürüyor; `evidence_events` bu belgelerin olaylarını içeriyor. Aynı kural `consent_requests` ve belgeye bağlı `files` kayıtları için de geçerli olmalı.
- **Beklenen (ADR-085 + mevcut dışa aktarım kuralı "sağlık bölümleri ayrıca sağlık yetkisi ister"):** sağlık yetkisi yoksa klinik çıktı belgeleri ve onlara bağlı onay/kanıt/dosya satırları dışa aktarımda yer almaz ve `omitted`/notta belirtilir; onam vb. klinik olmayan belgeler kalır. Sağlık yetkili dışa aktarım (varsa) tamdır.
- **Etki:** sağlık verisi (epikriz/tedavi özeti metni) sağlık yetkisi olmayan role ve klinik dışına çıkan dosyaya sızıyor; QA-101 ile aynı yetki ihlali sınıfı → S1.
- **Kanıt:** `evidence/tur2/N05-kesin-eslesme.json` (adminExport.patient_documents=2, content-var, evidence_events=4), `evidence/tur2b/N05-komsu.json` (adminExportHasClinicalDoc=true).
- **Kök neden ipucu:** `apps/api/src/pilot/export.controller.ts` ~satır 113–117: `patient_documents`, `consent_requests`, `evidence_events`, `files` sorguları kategori süzmüyor; `HEALTH` kümesi (satır 38) yalnız bölüm adına bakıyor. Sağlık yetkisi yoksa `document_types.category <> 'clinical_output'` koşulu eklenmeli.
- **Not:** hekim rolünde `export.patient` yok → 403 (permissions.ts); bu beklenen davranış, kusur değil.

## QA-105 (S2) — Onam/belge raporunda klinik çıktı satırları
- **Adımlar:** QA-104 senaryosu sonrası sekreter `GET /reports/onam?from=<bugün>&to=<bugün>` → 200.
- **Gözlenen:** iki satır klinik çıktı belgesi (hasta adı, tür "Epikriz / tedavi özeti" / "Hasta bilgi föyü (klinik)", başlık); toplam sayıma da dahil.
- **Beklenen:** sağlık yetkisi olmayan rolde klinik çıktı belgeleri rapor satırlarında ve toplamlarda yer almaz (QA-102'deki geçmiş filtresiyle tutarlı). Raporun adı "onam" olduğundan klinik çıktıların hiç listelenmemesi de kabul edilebilir; hangi seçenek seçilirse ADR'de yazılmalı.
- **Etki:** hangi hastaya epikriz/klinik föy düzenlendiği (sağlık işleminin varlığı ve başlığı) sağlık yetkisi olmayan role görünüyor; içerik görünmüyor → S2.
- **Kanıt:** `evidence/tur2/N05-kesin-eslesme.json` (onamSecretary 2 satır), `evidence/tur2b/N05-komsu.json` (onamSecretaryHasClinical=true).
- **Kök neden ipucu:** `apps/api/src/reports/definitions.ts` `onam` (satır ~492) ve `ONAM_CTE`: kategori süzgeci yok; `notClinicalOutputDocSql` benzeri koşul veya `category <> 'clinical_output'`.

## Tur 3 yeniden sınama (bb49098 = ürün 9327d9e, temiz seed)
- **QA-104 VERIFIED:** yönetici dışa aktarımında epikriz/föy id'si ve içeriği yok; `omitted` içinde `patient_documents:clinical_output`, `consent_requests:clinical_output`, `evidence_events:clinical_output`, `files:clinical_output`. Kanıt `evidence/tur3/N05-komsu.json`.
- **QA-105 VERIFIED:** sekreter onam raporunda klinik çıktı satırı yok. Kanıt `evidence/tur3/N05-komsu.json`.
- Diğer tüm HTTP/N vakaları PASS (`evidence/tur3/http-summary.json`, `n-summary.json`).

## QA-106 (S2) — Dışa aktarımda klinik hassasiyetli dosya metaverisi
- **Ortam/sürüm:** yerel test, `bb49098`, temiz seed; tester sondası `qa-runs/.scripts/file-sensitivity-probe.mjs` (düzeltici fix2 risk 1'de bildirmişti; tester bağımsız yeniden üretti).
- **Adımlar:** (1) Hekim yeni sentetik hastaya `radiograph` (sensitivity `clinical`) ve `identity` (administrative) dosyası başlatır (201/201). (2) Yönetici `GET /patients/:id/files` → yalnız kimlik dosyası (radyograf görünmez — doğru). (3) Yönetici `POST /patients/:id/export` → `sections.files` içinde `clinical:radiograph` satırı (ad `panoramik-sonda-….jpg`, kategori, özet) var.
- **Beklenen:** sağlık yetkisi olmayan dışa aktaranda `sensitivity = 'clinical'` dosyalar dosya listesiyle tutarlı biçimde dışlanır ve `omitted` içinde belirtilir (ör. `files:clinical`); idari dosyalar kalır. Sağlık yetkili dışa aktarım tamdır.
- **Etki:** dosya içeriği değil, metaveri (dosya adı, kategori, SHA-256) sızıyor; dosya adı tanı/işlem bilgisi taşıyabilir → S2.
- **Kanıt:** `evidence/tur3/file-sensitivity-probe.json` (adminListSeesClinical=false, adminExportHasClinicalFile=true).
- **Kök neden ipucu:** `apps/api/src/pilot/export.controller.ts` `files` sorgusu `sensitivity` süzmüyor (files.controller `visible()` kuralı: administrative veya `patient.health.read`).

## QA-107 (S3) — Klinik çıktıya bağlı idari dosya sekretere görünüyor
- **Adımlar:** (1) Hekim API ile `POST /files` `{category: "document_scan", patientDocumentId: <düzenlenmiş epikriz id>}` → 201 (sağlık yetkili olduğu için izinli). (2) Sekreter `GET /patients/:id/files` → dosya listede, `name` = "epikriz-imzali-tarama.pdf", `patientDocumentId` = epikriz id. (3) Sekreter `GET /files/:id` → 200. (4) Yönetici dışa aktarımında aynı dosya yok (fix2 ile gizleniyor).
- **Beklenen:** klinik çıktı belgesine bağlı dosya, kategorisinden bağımsız olarak sağlık yetkisi olmayan rol için klinik sayılır: listede yok, ayrıntı/içerik/silme uçlarında var olmayan dosyayla aynı yanıt (404) — dışa aktarımla tutarlı (ADR-085/088). Alternatif olarak bağlantı kurulurken dosya `clinical` hassasiyetine yükseltilebilir; seçim ADR'de yazılmalı.
- **Etki:** arayüz bu bağlantıyı kurmuyor (web'de `patientDocumentId` kullanılmıyor); yalnız sağlık yetkili kullanıcının doğrudan API çağrısıyla oluşuyor. Gizli belgenin kimliği ve hekimin idari diye etiketlediği taramanın içeriği sekretere açılabiliyor → S3.
- **Kanıt:** `evidence/tur3/linked-file-probe.json`.
- **Kök neden ipucu:** `apps/api/src/documents/files.controller.ts` `visible()` yalnız `sensitivity`'ye bakıyor; `list` (satır ~104), `files/:id`, `files/:id/content`, `files/:id/delete` ve yükleme tamamlama uçları `patient_document_id` → `document_types.category = 'clinical_output'` birleştirmesini dikkate almalı (`notClinicalOutputDocIdSql` yeniden kullanılabilir).

## Ortam / betik notları (ürün kusuru değil)
- Tarayıcı betiğinin ilk iki koşusunda N02/N05 "FAIL" tester betiği hatasıydı (hasta adı "Epikriz Sınama" metin aramasına takıldı; diyalog seçici; "Belge düzenlendi" etiketi kalıpta yoktu). Betik düzeltildi; son koşu `evidence/tur1/browser-n-summary.json`.
- n-cases N02'de "Unicode ad" kontrolü listede ilk şahıs faturasını (yuvarlama faturası, aynı alıcı adı) okudu; ad yine "Şükrü Çağlayan İğdır" olarak birebir döndü.
- Tur 2 (tester betiği düzeltmesi, ürün kusuru değil): n-cases N05 geçmiş kontrolü `/Epikriz/` metin eşleşmesiyle hasta adına ("Epikriz Sınama", patient.create olayı) takılıp yanlış pozitif verdi; artık yalnız belge kimliğiyle eşleşiyor. "Hekim dışa aktarımında belge var" beklentisi yanlıştı (hekimde `export.patient` yok) → 403 beklentisine çevrildi. Ürün beklentisi gevşetilmedi; ilk koşu `evidence/tur2/` korunuyor, düzeltilmiş koşu `evidence/tur2b/`.
- Tur 2: n-cases aynı veritabanında ikinci kez koşulamıyor (sentetik hasta çakışması) → temiz seed ile `evidence/tur2b/` koşuldu (VD-030 ile aynı sınıf, test ortamı).
