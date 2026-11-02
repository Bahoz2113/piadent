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

---

# Devir 3 — qa-20261102-1209-12fc6fd tur 3 → cezeri-duzeltici

- Sınanan sürüm: `bb49098` (ürün = fix2 `9327d9e`). Gate: **BEKLET** (açık S2/S3; tarayıcı ve tam regresyon bir sonraki revizyonda).
- Kapanan: QA-104, QA-105 → VERIFIED (`evidence/tur3/N05-komsu.json`).
- Açık: **QA-106 (S2)**, **QA-107 (S3)** — ayrıntı ve kök neden ipucu `bugs.md`; kanıt `evidence/tur3/file-sensitivity-probe.json`, `evidence/tur3/linked-file-probe.json`. Kapsam N11 olarak plana eklendi.
- Kabul ölçütleri (tester yeniden sınar; gevşetilmez):
  1. QA-106: `patient.health.read` olmayan dışa aktaranda `POST /patients/:id/export` `sections.files` içinde `sensitivity = 'clinical'` dosya yok; `omitted` içinde açık işaret (ör. `files:clinical`) ve not; counts/checksums tutarlı; denetim kaydı işareti taşır; idari dosyalar kalır; sağlık yetkili dışa aktarım tam.
  2. QA-107: klinik çıktı belgesine (`patient_document_id` → `document_types.category = 'clinical_output'`) bağlı dosya, kategorisinden bağımsız olarak sağlık yetkisi olmayan rol için klinik sayılır: `GET /patients/:id/files` listesinde yok; `GET /files/:id`, `GET /files/:id/content`, `POST /files/:id/delete` ve varsa yükleme tamamlama/diğer dosya uçları var olmayan dosyayla aynı yanıtı verir (404) ve yan etki üretmez; dışa aktarımla tutarlı. Hekim mevcut davranışı korur. Seçilen yaklaşım (sorguda birleştirme ya da bağlantıda hassasiyeti `clinical`'a yükseltme) ADR ile yazılır; yükseltme seçilirse mevcut kayıtlar için yeni migration (`0030_*`) gerekir.
  3. Regresyon testleri ekle (`apps/api/test/qa-106-107-file-sensitivity.test.ts`): yukarıdaki her uç için sekreter/yönetici 404 = var olmayan; hekim 200; dışa aktarım işaretleri.
- Kurallar ve ortam uyarısı: Devir 2 ile aynı (izole worktree, `viadent_fix`/`viadent_fix_test`, ayrı port; :3000/:4000 ve `viadent`/`viadent_test`'e dokunma; uygulanmış migration değişmez; `qa-runs/` altında yalnız `fix3.md`; canlıya gönderim yok).
- **Dal tabanı:** worktree `origin/main` (canlı demo geçmişi) üzerinden açılabilir; ortak ata yok. Çalışma dalını mutlaka `main` ucundan aç (`git checkout -b fix/qa-20261102-tur3 <main ucu>`).
- Geri dönüş: `fix3.md` (SHA'lar, değişen dosyalar, komutlar, gerçek sonuçlar, riskler, FIX_READY).

---

# Devir 4 — qa-20261102-1209-12fc6fd tur 4 → cezeri-duzeltici

- Sınanan sürüm: `49a151b` (ürün = fix3 `215e5f3`). QA-106, QA-107 → VERIFIED.
- Açık: **QA-108 (S3)** — `bugs.md`; kanıt `evidence/tur4/file-trace-probe.json`, `file-history-secretary.json`, `evidence-file-probe.json`.
- Kabul ölçütleri (gevşetilmez):
  1. Sağlık yetkisi olmayan rol için `GET /patients/:id/history` gizli dosyaya (ADR-089 kuralı: klinik hassasiyet veya klinik çıktıya bağlı) ait `file.*` olaylarını içermez; idari dosya olayları kalır; hekim hepsini görür.
  2. Aynı kural `POST /patients/:id/export` `access_log` bölümünde uygulanır.
  3. `GET /documents/:id` kanıt listesinde ve dışa aktarım `evidence_events` içinde gizli dosyanın `fileId`/`file_id` alanı sağlık yetkisi olmayan rol için görünmez (null/çıkarılmış; kanıt satırının kendisi kalır). Alternatif ya da ek olarak onam taraması bağlamada kategori kısıtı getirilirse ADR'de yazılır ve hekim akışı testle sabitlenir.
  4. Regresyon testi `apps/api/test/qa-108-file-trace.test.ts`; önce yamasız kırmızı, sonra yeşil; tam API paketi + typecheck.
- Kurallar/ortam/dal tabanı: Devir 3 ile aynı (çalışma dalını yerel `main` ucundan aç: `git checkout -b fix/qa-20261102-tur4 main`). Geri dönüş `fix4.md`.

---

# Devir 5 — qa-20261102-1209-12fc6fd tur 5 → cezeri-duzeltici

- Sınanan sürüm: `fe98345` (ürün = fix4 `81584fa`, cherry-pick). QA-108 → VERIFIED.
- Açık: **QA-109 (S3)** — `bugs.md`; kanıt `evidence/tur5/quarantine-task-probe.json`.
- Kabul ölçütleri (gevşetilmez):
  1. ADR-089 kuralına göre gizli olan (klinik hassasiyetli ya da klinik çıktıya bağlı) dosya karantinaya/redde düştüğünde açılan görev, sağlık yetkisi olmayan role (`GET /tasks`, görev ayrıntısı/durum uçları, varsa bildirim/Bugün ekranı sayaçları) görünmez; var olmayan görevle aynı yanıt.
  2. Görev, dosyayı ele alabilecek role yönlenir (ör. `sensitivity` klinik + atanan `dentist`) ya da yöneticinin işlem yolu ADR-091'de tanımlanır; seçilen yolun uçtan uca işlediği testle gösterilir (görevi alan rol dosya ayrıntısını açabilir veya görevi kapatabilir).
  3. İdari dosya karantina görevi bugünkü davranışı korur.
  4. Var olan görev kayıtları için gerekiyorsa yeni migration `0030_*`; uygulanmışlar değişmez.
  5. Regresyon testi `apps/api/test/qa-109-quarantine-task.test.ts` (yamasız kırmızı → yamalı yeşil); tam API paketi, worker testleri, typecheck; web değişirse web testleri.
- Ek: aynı sınıftan kalan yüzeyleri (bildirimler, Bugün/görev sayaçları, metrikler, PİA Akış/eskalasyon görevleri, yedek/hazırlık raporları) kod okumayla tara; kapsamda olanları düzelt, kalanları `fix5.md`'de risk olarak yaz.
- Kurallar/ortam/dal tabanı: Devir 3–4 ile aynı (`git checkout -b fix/qa-20261102-tur5 main`). Geri dönüş `fix5.md`.
