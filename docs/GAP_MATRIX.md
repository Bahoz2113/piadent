# GAP_MATRIX — PİA-DENT × "Eksik Tamamlama Nihai Dosyası" (Faz 0)

Tarih: 02.11.2026 · Sürüm: `08c71a5` · Yöntem: PDF'deki her madde **koda bakılarak** sınıflandırıldı (kural: "Videoda görünmeyen bir işlevi kodu kontrol etmeden eksik sayma"). Kanıt sütunu dosya:satır verir; `pnpm test` ile çalışan testler ayrıca belirtilir.

Sınıflar: **MEVCUT** (kabul ölçütü karşılanıyor, test var) · **KISMI** (çekirdek var, PDF'nin istediği bir parça yok) · **EKSİK** (kodda karşılığı yok) · **BOZUK** (var ama yanlış davranıyor) · **KAPSAM DIŞI** (ADR/release-gates ile bilinçli ertelendi — pazarlama iddiası yapılmaz).

Önemli not: Video temelli inceleme raporu ("Mevcut Sürüm İnceleme") birçok maddeyi "kanıt yok" yazdı. Bunların büyük kısmı kodda **mevcut**; video kısa olduğu için gösterilmemişti. Aşağıda her biri kanıtla düzeltildi.

## A. Klinik çekirdek

| # | Madde (PDF) | Sınıf | Kanıt | Eksik parça / not |
|---|---|---|---|---|
| A1 | Hasta kartı (kimlik, iletişim, mükerrer kontrol, geçmiş) | MEVCUT | `patients.controller.ts:14-57` (list, duplicates, create, identity, patch, history); web `hastalar/[id]/page.tsx:38-44` 7 sekme | — |
| A2 | Anamnez (sürümlü, hekim onayı) | MEVCUT | `clinical/anamnesis.controller.ts` (list, :version, create, review); `components/patient/anamnesis.tsx`; test `gorev1.test.ts` | Soru şablonu yönetimi 02.11'de eklendi (D3) |
| A3 | Tanı (kod + açıklama, durum) | MEVCUT (KISMI: kod serbest metin) | `chart.controller.ts:103-127` diagnoses + status; `0003_treatment.sql:76-98` (active/resolved/entered_in_error; `code` serbest — ADR-023: resmî kodlama kaynağı doğrulanana kadar) | ICD-10 doğrulamalı kod listesi: Faz 4 adayı (lisanslı kaynak gerekir) |
| A4 | Odontogram: FDI, yetişkin/süt/karma, yüzey | MEVCUT | `components/treatment/odontogram.tsx:74-110` (permanent/primary/mixed); `treatment-tab.tsx:40-65` seçici; `contracts/treatment.ts:14,48` FDI regex `[1-8][1-8]` (51–85 süt dişleri dahil); `chart.controller.ts:73-74` yüzey doğrulaması | — |
| A5 | Bulgu (odontogram_findings) | MEVCUT | `chart.controller.ts:68-86` | — |
| A6 | Diş/yüzey bazlı tedavi girişi (gerçekleşen işlem) | MEVCUT | `chart.controller.ts:159-264` performed/cancel/correct; `0003_treatment.sql:262` (completed/cancelled/corrected — silme yok, düzeltme kaydı) | — |
| A7 | Tedavi planı yaşam döngüsü (taslak→teklif→kabul/ret→yeni sürüm→iptal) | MEVCUT | `plans.controller.ts:26-322`; `0003_treatment.sql:143,219-220` DB tetikleyicisiyle geçiş kuralı; test `gorev2.test.ts` | — |
| A8 | Tedavi kataloğu + tarife (sürüm, yayın, emeklilik) + fiyat sorgusu | MEVCUT | `catalog.controller.ts:19-169`; `0003_treatment.sql:28` | Hekim bazlı tarife farklılaştırması yok (B7) |
| A9 | Hasta geçmişi / zaman çizelgesi (PİA İz) + sağlık verisi rol filtresi | MEVCUT | `patients.service.ts history()` `CLINICAL_ENTITY_TYPES`; QA-001 testi `qa-001-history-health.test.ts` | — |
| A10 | Onam/belge şablonları (sürüm, onay, yazdır, karar, iptal) | MEVCUT | `documents.controller.ts`; kategori seti `0005` + `0025` (clinical_output) | — |
| A11 | Hasta dosyaları (yükleme, karantina/antivirüs, silme) | MEVCUT | `files.controller.ts:34-153`; env `CLAMD_HOST`, `FILE_QUARANTINE_PURGE_DAYS` | — |
| A12 | Hasta yakını / ilişki | MEVCUT | `relations.controller.ts:21-111` | — |

## B. Finans çekirdek

| # | Madde | Sınıf | Kanıt | Eksik parça / not |
|---|---|---|---|---|
| B1 | Alacak (tahakkuk) oluşturma/iptal; işlemden otomatik alacak | MEVCUT | `account.controller.ts:111-129`; `source in ('performed_procedure','manual')` | — |
| B2 | Tahsilat (idempotency, dağıtım, ters kayıt) | MEVCUT | `account.controller.ts:147-207`; `0020_receivable_allocated.sql`; CEZERİ V04/P01 PASS | — |
| B3 | İade (ters kayıt, sağlayıcı iadesi mock) | MEVCUT | `account.controller.ts:234`; `bridge.controller.ts:348` | — |
| B4 | Tahsilat/iade makbuzu çıktısı | **MEVCUT (02.11, ADR-081)** | `0021_receipts.sql` (TM/IM seri, tetikleyici, değişmez); `finance/receipts.controller.ts`; `components/finance/receipt-print.ts`; test `receipts.test.ts` 9, E2E `makbuz.spec.ts` | Faz 2.1 tamamlandı; CEZERİ koşusu bekliyor |
| B5 | Fatura / e-Fatura / e-Arşiv / e-SMM | **KISMI → taslak modeli MEVCUT (02.11, ADR-083)**; gerçek düzenleme KAPSAM DIŞI (sözleşme kapısı) | `0023_invoices.sql`, `finance/invoices.controller.ts`, `components/finance/invoices.tsx`; test `invoices.test.ts` 10, E2E `fatura-taslagi.spec.ts` | Numara yalnız sağlayıcıdan; sağlayıcı yokken submit 409 |
| B6 | Kasa/banka hesapları, gider, nakit akışı, bakiye | MEVCUT | `finance.controller.ts:32-237` | Çek/senet, döviz, POS komisyonu: KAPSAM DIŞI (TRY tek para birimi — ADR) |
| B7 | Hekim primi (kural, tahakkuk, ödeme, ters kayıt) | MEVCUT | `finance.controller.ts:267-376`; `0007_operations.sql:180-182` işlem→prim bağı | Hekim bazlı tarife yok |
| B8 | Tedarikçi/lab carisi (fatura, ödeme, ters kayıt, ekstre) | MEVCUT | `suppliers.controller.ts:20-149` | — |
| B9 | Online ödeme isteği (mock sağlayıcı, webhook, iade) | MEVCUT (mock etiketli) | `bridge.controller.ts:291-348` | Gerçek PSP: KAPSAM DIŞI, sözleşme kapısı |
| B10 | Hesap planı / resmî muhasebe | KAPSAM DIŞI; **mali müşavir dönem dökümü MEVCUT (02.11)** | rapor `muhasebe-donem` (`contracts/reports.ts`, `reports/definitions.ts`) | CSV ekranla birebir; makbuz no'lu |

## C. Operasyon

| # | Madde | Sınıf | Kanıt | Not |
|---|---|---|---|---|
| C1 | Ajanda: hekim/koltuk, randevu türü, kapatma, çakışma, durum makinesi | MEVCUT | `scheduling.controller.ts`, `resources.controller.ts:22-233`; CEZERİ V03/P02 PASS | — |
| C2 | Hazırlık kuralları, takip, iletişim tercihi, mesaj (mock) | MEVCUT | `care.controller.ts:27-207` | Gerçek SMS/WhatsApp: KAPSAM DIŞI (sözleşme) |
| C3 | Laboratuvar iş emri (durum, iş föyü, maliyet→cari) | MEVCUT | `lab.controller.ts:49-297`; `0007_operations.sql:80,102` plan kalemi bağı | — |
| C4 | Stok (giriş, kullanım→hasta/işlem, fire, sayım, ters kayıt) | MEVCUT | `stock.controller.ts:24-243`; `0007_operations.sql:271-289` + `patient_id`, `performed_procedure_id` FK | Otomatik sarf (işlem başına reçete) yok → KISMI olarak Faz 4 adayı |
| C5 | PİA Akış (görev motoru, ayarlar) | KISMI | `tasks.controller.ts:19-73`; `0018_akis_settings.sql` | PDF: SLA/yükseltme (escalation) yok — `due_at` var, gecikince atama/bildirim yok |
| C6 | İçe/dışa aktarma (CSV, KVKK hasta ihracı, klinik ihracı, geri alma) | MEVCUT | `import.controller.ts:286-481`, `export.controller.ts:57-87` | — |

## D. Raporlar, UI, marka

| # | Madde | Sınıf | Kanıt | Not |
|---|---|---|---|---|
| D1 | Rapor kataloğu (19 rapor, drill-down, CSV) | MEVCUT | `contracts/reports.ts:23-78`; `reports.controller.ts:87-99` | PDF: XLSX/PDF çıktı yok → KISMI (Faz 4) |
| D2 | **Rapor kartlarında ham kaynak kodları (R22, T07…)** | **BOZUK (UX)** | `raporlar/page.tsx:127,138` `sourceIds.join(" · ")` kullanıcıya gösteriliyor | İç izlenebilirlik kodu; UI'dan kaldır/ipucuna taşı |
| D3 | Anamnez soru şablonu yönetimi | **MEVCUT (02.11, ADR-084)** | `0024_anamnesis_templates.sql`, `clinical/anamnesis-templates.controller.ts`, `components/admin/anamnesis-templates.tsx`; test `anamnesis-templates.test.ts` 5, E2E `anamnez-sablonu.spec.ts` | Yayın yalnız hekim; eski kayıtlar kendi sürümünde |
| D4 | Klinik çıktı şablonları (epikriz, reçete yazısı, hasta bilgi föyü) | **MEVCUT (02.11, ADR-085)** | `0025_clinical_output_types.sql`, `documents.controller.ts render()` yeni alanlar + sağlık kapısı; test `clinical-output.test.ts` 4, E2E `klinik-cikti.spec.ts` | e-reçete değil; tanı kodu serbest |
| D5 | Mobil: geniş tablolar | KISMI | `globals.css:144` `.table-wrap{overflow-x:auto}` + kırılımlar 264-318; E2E `telefon-360` projesi | PDF: kart görünümü/kolon gizleme yok; yatay kaydırma var |
| D6 | Marka yazımı | KARAR VERİLDİ (02.11) | Ürün sahibi: **PİA-DENT** (ADR-081 notu) | PDF'deki "PiaDent" geçersiz |
| D7 | Tema/ölçek/renk şeması kişiselleştirme | **MEVCUT (02.11, ADR-082)** | `contracts/appearance.ts`, `0022_user_appearance.sql`, `auth/appearance.controller.ts`, `components/appearance-drawer.tsx`, `lib/appearance.ts`; testler `appearance-contrast.test.ts` 33, API 4, E2E `gorunum.spec.ts` | 7 palet × 4 şema × 5 ölçek; logo sabit |
| D8 | Hasta portalı / online randevu | KAPSAM DIŞI | yok | Faz 4+ (ayrı güvenlik modeli gerekir) |

## E. Güvenlik, çok kiracılılık, uyum

| # | Madde | Sınıf | Kanıt |
|---|---|---|---|
| E1 | Tenant izolasyonu (RLS ENABLE+FORCE, bileşik FK, Db.tx(ctx)) + test | MEVCUT | `tenant-isolation.test.ts`, `pentest.test.ts`, `security.test.ts`; CEZERİ V01 PASS |
| E2 | RBAC (6 rol, izin matrisi) + oturum | MEVCUT | `permissions-session.test.ts`; `docs/permissions.md` |
| E3 | 2FA (TOTP, kurtarma kodları, rol bazlı zorunluluk) | MEVCUT | `mfa.controller.ts:48-150`; `0012_security_hardening.sql:17` `require_mfa_roles`; `security.controller.ts:19-30` |
| E4 | Destek erişimi (support grant, onay) | MEVCUT | `security.controller.ts:47-120` |
| E5 | Denetim kaydı (audit) + LOG raporu + etiketler | MEVCUT | `contracts/audit.ts` (`AUDIT_ACTION_LABELS`, `AUDIT_FIELD_LABELS`); QA-002/003 kapandı |
| E6 | KVKK: hasta veri ihracı, saklama/temizlik, erişim günlüğü | MEVCUT (teknik) | `export.controller.ts:87`; `0010_pilot_infra.sql:4` saklama; env `IMPORT_ROW_RETENTION_DAYS`, `FILE_PURGE_DAYS` | Hukuki metinler/aydınlatma içeriği: insan kapısı (release-gates) |
| E7 | Yedek/geri yükleme | MEVCUT (betik) | `docs/backup-restore.md`; env `BACKUP_*` | Canlı (Supabase) için sağlayıcı yedeği; tatbikat insan adımı |
| E8 | Gizli anahtar yönetimi | MEVCUT | `VIADENT_SECRET_KEY(S_OLD)` döndürme | **Pilot öncesi tüm anahtarlar döndürülecek** (handoff) |

## F. Entegrasyonlar (hepsi etiketli mock — sahte başarı yok)

| Kanal | Durum | Kanıt | Gerçeğe geçiş kapısı |
|---|---|---|---|
| SMS / WhatsApp / e-posta | mock bağlayıcı, webhook, iş kuyruğu | `bridge.controller.ts:54-266`; `integrations.ts:7-21` | Sağlayıcı sözleşmesi + `VIADENT_EXTERNAL_SEND_ENABLED` |
| Online ödeme | mock | `bridge.controller.ts:291-348` | PSP sözleşmesi, 3D Secure test ortamı |
| e-Fatura/e-Arşiv/e-SMM | yok (`mock:false`) | `integrations.ts:21` | GİB entegratörü + mali müşavir |
| e-Nabız / sağlık kaydı | yok | `health_registry` tanımlı, adaptör yok | Bakanlık test ortamı; "onaylı" iddiası yapılmaz |
| e-İmza | yok | `signature` tanımlı | — |

## Özet sayım
MEVCUT 35 (B4, D7, D3, D4 02.11'de eklendi) · KISMI 4 (C4, C5, D1, D5) · EKSİK 0 · BOZUK 1 (D2 ham rapor kodları) · KAPSAM DIŞI 6 · KARAR 0 (D6 → PİA-DENT).

Video incelemesinin "P0 eksik" dediği 7 kalemden 5'i (anamnez, tanı, odontogram, diş/yüzey işlem girişi, plan yaşam döngüsü) kodda mevcut ve test altında; gerçek 2 P0 açığı: **makbuz çıktısı (B4)** ve **fatura taslağı iç modeli (B5)**.
