# Devir 1 — qa-20261102-1209-12fc6fd → cezeri-duzeltici

- Sınanan sürüm: `12fc6fd47406e3e3142248490550298abf27af03` (main)
- Açık bulgular: **QA-101 (S1)**, **QA-102 (S2)**, **QA-103 (S3)** — ayrıntı ve kanıt: `bugs.md`, `evidence/tur1/N05-http.json`, `evidence/tur1/N05-yan-uclar.json`, `evidence/tur1/*-N05-sekreter-gecmis.jpg`, `evidence/tur1/masaustu-N02-fatura-ayrinti.jpg`.
- Kabul ölçütleri (tester bunları yeniden sınar; gevşetilmez):
  1. QA-101: `patient.health.read` olmayan rol için klinik çıktı (`document_types.category = 'clinical_output'`) belgelerinde **tüm** belge uçları (`GET /documents/:id`, `POST /documents/:id/print|decision|revoke`, belgeye kanıt/dosya bağlayan uçlar, varsa diğerleri) var olmayan belgeyle **aynı** yanıtı vermeli (404), durum değiştirmemeli, kanıt olayı yazmamalı. Sağlık yetkili roller (hekim; asistan okuma) mevcut davranışı korur. Regresyon testi: sekreter print → 404 ve kanıt sayısı değişmez; yönetici revoke → 404 ve durum `issued` kalır; hekim revoke → 200.
  2. QA-102: sağlık yetkisi olmayan rolün hasta geçmişinde (`GET /patients/:id/history` ve UI Geçmiş) klinik çıktı belgelerine ait olaylar (`document.issue/print/decision/revoke`, kanıt) görünmemeli; diğer (onam vb.) belge olayları görünmeye devam etmeli. Hekim tüm olayları görür.
  3. QA-103: fatura ayrıntısındaki üst uyarı, alt düğme ve yazdırma çıktısı durumu yansıtmalı: yalnız `draft` (ve `rejected`) için "TASLAK" ve "Taslağı yazdır"; `pending_provider/issued/cancelled` için sağlayıcı durumu (MOCK ise açıkça "MOCK — resmî değil"); "e-Belge sağlayıcısı bağlı değil" yalnız gerçekten bağlı değilken. TASLAK filigranı düzenlenmiş/iptal faturada basılmamalı.
- Kurallar: ürün yamasını izole worktree'de yap; uygulanmış migration'ı değiştirme (gerekirse yeni `0030_*`); test beklentilerini, kilitli planı, geçmiş kanıtları değiştirme; üretime/canlıya gönderim yok.
- **Ortam uyarısı (QA-007 dersi):** tester'ın servisleri :3000/:4000 ve DB'leri `viadent`, `viadent_test` üzerinde çalışıyor ve aynı anda tam API regresyonu koşuyor. Kendi testlerini **ayrı DB adlarıyla** koş (worktree `.env` içinde `DATABASE_URL`/`MIGRATION_DATABASE_URL`/`ADMIN_DATABASE_URL`/`WORKER_DATABASE_URL`/`BACKUP_DATABASE_URL` veritabanı adını `viadent_fix` yap → test DB `viadent_fix_test`); :3000/:4000 süreçlerini durdurma; küme genelinde bağlantı sonlandırma yapma.
- Geri dönüş: yeni commit SHA, değişen dosyalar, çalıştırılan komutlar ve gerçek sonuçları `fix1.md` olarak bu klasöre yaz; durum FIX_READY. Kapatma yalnız tester yeniden sınamasıyla.

---

# Devir 2 — qa-20261102-1209-12fc6fd tur 2 → cezeri-duzeltici

- Sınanan sürüm: `08438cf` (main; fix1 ürün yaması `3948cb7`). Gate: **DURDUR** (açık S1).
- Kapanan: QA-101, QA-102, QA-103 → VERIFIED (kanıt `evidence/tur2b/`, `evidence/tur2/N05-kesin-eslesme.json`).
- Açık bulgular: **QA-104 (S1)**, **QA-105 (S2)** — ayrıntı, adımlar, kök neden ipucu: `bugs.md`.
- Kabul ölçütleri (tester yeniden sınar; gevşetilmez):
  1. QA-104: `patient.health.read` olmayan dışa aktaran için `POST /patients/:id/export` yanıtında klinik çıktı (`document_types.category = 'clinical_output'`) belgeleri **ve** bu belgelere bağlı `consent_requests`, `evidence_events`, `files` (file_assets.patient_document_id) satırları yer almaz; `omitted` alanı ve not bunu açıkça belirtir (ör. `patient_documents:clinical_output`); `counts`/`checksums` kalan içerikle tutarlıdır. Klinik olmayan belgeler (onam vb.) ve olayları kalır. Sağlık yetkili dışa aktaranda (ör. sağlık yetkili yönetici veya test için yetki verilmiş rol) tüm belgeler kalır. Denetim kaydı (`patient.export`) dışlananları içerir. Aynı mantık klinik geneli dışa aktarımda (`export.clinic`) da varsa uygulanır ya da neden uygulanmadığı ADR'de yazılır.
  2. QA-105: sağlık yetkisi olmayan rolde `GET /reports/onam` satırları **ve toplamları** klinik çıktı belgelerini içermez (CSV/XLSX biçimleri de). Sağlık yetkili rol için davranış ADR ile seçilir (ya klinik çıktılar onam raporunda hiç yer almaz ya da yalnız sağlık yetkiliye görünür) ve testle sabitlenir.
  3. Regresyon testi ekle: yönetici dışa aktarımında epikriz `content` metni ve id'si yok, onam belgesi var; sekreter onam raporunda epikriz satırı yok, toplam buna göre.
- Kurallar: ürün yamasını izole worktree'de yap; uygulanmış migration'ı değiştirme (gerekirse yeni `0030_*`); test beklentilerini, kilitli planı, geçmiş kanıtları değiştirme; üretime/canlıya gönderim yok.
- **Ortam uyarısı:** tester'ın servisleri :3000/:4000 ve DB'leri `viadent`, `viadent_test` üzerinde. Kendi testlerini **ayrı DB adlarıyla** koş (worktree `.env` içinde DB adlarını `viadent_fix` yap → test DB `viadent_fix_test`; önceki turdan kalmış olabilir, gerekirse sıfırla); :3000/:4000 süreçlerini durdurma; küme genelinde bağlantı sonlandırma yapma.
- Geri dönüş: yeni commit SHA, değişen dosyalar, çalıştırılan komutlar ve gerçek sonuçları `fix2.md` olarak bu klasöre yaz; durum FIX_READY. Kapatma yalnız tester yeniden sınamasıyla.
