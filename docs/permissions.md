# Yetki modeli

Değerlendirme: **rol + klinik üyeliği + (şube kapsamı) + kaynak ilişkisi + alan yetkisi**. Arayüzde düğme gizlemek güvenlik değildir; aynı kontrol API'de, işçide, dosya indirmede ve dışa aktarımda uygulanır. Kaynak kod: `packages/contracts/src/permissions.ts`.

## Uygulanan izinler
| İzin | Klinik yöneticisi | Hekim | Sekreterya | Asistan | Finans |
|---|:-:|:-:|:-:|:-:|:-:|
| `patient.read` (maskeli özet) | ✔ | ✔ | ✔ | ✔ | ✔ |
| `patient.write` | ✔ | ✔ | ✔ | – | – |
| `patient.identity.unmask` (tam telefon/kimlik) | – | ✔ | ✔ | – | ✔ |
| `patient.health.read` (klinik not, anamnez) | **–** | ✔ | – | ✔ | – |
| `clinical_note.write` | – | ✔ | – | – | – |
| `anamnesis.write` (yeni sürüm) | – | ✔ | – | ✔ | – |
| `anamnesis.review` (hekim onayı) | – | ✔ | – | – | – |
| `appointment.read` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `appointment.write` | ✔ | ✔ | ✔ | – | – |
| `task.read` / `task.write` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `finance.read` (klinik özeti, bakiyeler, kasa, gider listesi, prim raporu) | ✔ | – | – | – | ✔ |
| `account.read` (hasta hesabı: alacak/ödeme/avans/iade) | ✔ | – | ✔ | – | ✔ |
| `payment.write` (tahsilat, avans dağıtımı, dağıtım ters kaydı) | – | – | ✔ | – | ✔ |
| `payment.refund` (iade) | – | – | – | – | ✔ |
| `receivable.write` (elle alacak, alacak iptali) | – | – | – | – | ✔ |
| `expense.write` (gider, gider ters kaydı) | – | – | – | – | ✔ |
| `finance.settings` (kasa/banka hesabı, prim kuralı sürümü) | ✔ | – | – | – | ✔ |
| `anamnesis.template` (anamnez soru şablonu taslağı; yayın hekim `anamnesis.review` ister) | ✔ | ✔ | – | – | – |
| `invoice.write` (fatura taslağı; sağlayıcıya gönderim yalnız bağlıysa) | – | – | – | – | ✔ |
| `document.read` (hasta belgeleri, kanıt olayları) | ✔ | ✔ | ✔ | ✔ | – |
| `document.issue` (onaylı şablondan belge üretme) | – | ✔ | ✔ | – | – |
| `document.decision` (yüz yüze kabul/ret kaydı) | – | ✔ | ✔ | – | – |
| `document.revoke` (belgeyi gerekçeyle iptal) | ✔ | ✔ | – | – | – |
| `template.manage` (belge türü, şablon sürümü, PİA Hazır kuralı) | ✔ | – | – | – | – |
| `file.read` (idari dosyalar; klinik kategoriler ve klinik çıktı belgesine bağlı dosyalar ayrıca `patient.health.read`, ADR-089) | ✔ | ✔ | ✔ | ✔ | – |
| `file.write` (yükleme) | – | ✔ | ✔ | ✔ | – |
| `file.delete` (gerekçeyle silindi işareti) | ✔ | ✔ | – | – | – |
| `communication.write` (iletişim tercihi) | ✔ | ✔ | ✔ | – | – |
| `message.send` (kuyruğa alma; şimdilik MOCK sağlayıcı) | ✔ | – | ✔ | – | ✔ |
| `followup.write` (kontrol planlama) | – | ✔ | – | – | – |
| `readiness.exception` (PİA Hazır gerekçeli istisna) | – | ✔ | – | – | – |
| `audit.read` | ✔ | ✔ | – | – | – |
| `team.manage` (davet, rol, erişim kaldırma), `settings.manage` | ✔ | – | – | – | – |
| `schedule.manage` (hekim/koltuk, çalışma saati, kapatma, işlem türü) | ✔ | – | – | – | – |
| `treatment.read` (plan, teklif, gerçekleşen işlem listesi; tanı/bulgu hariç) | ✔ | ✔ | ✔ | ✔ | ✔ |
| `treatment.write` (plan oluşturma, taslak kalem, teklif, yeni sürüm) | – | ✔ | – | – | – |
| `treatment.decision` (hastanın kabul/ret/kararsız beyanını kaydetme) | – | ✔ | ✔ | – | – |
| `procedure.complete` (gerçekleşen işlem, iptal, düzeltme) | – | ✔ | – | – | – |
| `diagnosis.write` (tanı ve odontogram bulgusu) | – | ✔ | – | – | – |
| `catalog.manage` (işlem kataloğu, tarife sürümleri) | ✔ | – | – | – | – |

Notlar:
- “Yönetici unvanı tüm klinik sağlık içeriğine sınırsız erişim anlamına gelmez” (Plan §05) → yönetici klinik notları **okuyamaz** (testli).
- PİA İz: hasta geçmişi `patient.read` ile görünür, ancak `clinical_note` ve `anamnesis` olayları yalnız `patient.health.read` ile; not/yanıt içeriği audit'e hiç yazılmaz. Gizli dosyaların (ADR-089) `file.*` olayları da yalnız `patient.health.read` ile; onam kanıtındaki gizli dosya kimliği bu yetki yoksa boş döner (ADR-090; KVKK dışa aktarım `access_log`/`evidence_events` ve LOG raporu aynı kural).
- Hasta özetindeki kritik anamnez işaretleri (`clinical`) yalnız `patient.health.read` rollerine döner; diğer rollerde alan `null`.
- Rol değişikliği ve erişim kaldırma kişinin kendisine uygulanamaz; üyelik her istekte okunduğundan bir sonraki istekte geçerlidir.
- PİA Akış: `general` görevler herkese; `clinical` görevler `patient.health.read`, `finance` görevler `finance.read` ister (sunucuda filtrelenir).
- Odontogram ve tanı (`/patients/:id/chart`) `patient.health.read` ister: sekreter plan ve teklif bedelini görür, klinik haritayı görmez; yönetici de görmez (testli, ADR-023).
- Asistan şimdilik işlem kaydetmez; hekim adına kayıt (asistan girer, hekim onaylar) pilot geri bildirimiyle değerlendirilecek.
- Sekreterya vezne işini yapar (tahsilat, dağıtım) ama iade yapamaz ve klinik gelir raporlarını göremez (Plan §05; AT-02 iade testi). Yönetici raporları ve ayarları görür, tahsilat girmez (rol ayrılığı). Hekim varsayılan olarak hasta hesabını ve primi görmez (“ayrı izin”).
- Finansın iade eşiği için ikinci onay seçeneği planlandı (henüz yok).
- Belge türü hekime özel olabilir (`issuer_role = dentist`, ör. istirahat belgesi): sekreter hazırlayamaz (403).
- Klinik dosyalar (röntgen, klinik fotoğraf, klinik belge) sekreter/yönetici/finans listelerinde görünmez ve doğrudan istekte 404 döner; yönetici idari dosyaları görür.

## PİA Köprü yetkileri (Görev 5)
| Yetki | Yönetici | Finans | Diğerleri |
|---|---|---|---|
| `integration.read` — bağlantılar, dış işler, webhook günlüğü | ✔ | ✔ | — |
| `integration.manage` — bağlantı aç/kapat, MOCK davranışı, sır yenileme, yeniden deneme/iptal, MOCK bildirim simülasyonu | ✔ | — | — |
| `integration.approve` — onay kapısındaki işi onaylama/reddetme | ✔ | ✔ | — |

Dört göz: onay yetkisi olsa bile **isteği açan kişi kendi isteğini onaylayamaz** (API `SAME_USER_APPROVAL`, DB check). Online ödeme bağlantısı `payment.write` (sekreter, finans), sağlayıcıdan iade isteği `payment.refund` (finans, yönetici) ister. Webhook ucu oturumsuzdur; yetki yerine HMAC imza + zaman penceresi + bağlantı kimliği kullanılır, kiracı bağlantıdan çözülür (ADR-039).

## Operasyon ve rapor yetkileri (Görev 6)
| Yetki | Yönetici | Hekim | Sekreter | Asistan | Finans |
|---|---|---|---|---|---|
| `lab.read` / `lab.write` — iş emri görme, açma, gönderme, teslim alma | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ | ✔ / — |
| `lab.decide` — kabul / revizyon kararı | — | ✔ | — | — | — |
| `lab.cost` — maliyeti görme ve girme (cari borç) | ✔ | — | — | — | ✔ |
| `supplier.manage` — tedarikçi/laboratuvar tanımı | ✔ | — | — | — | ✔ |
| `supplier.ledger` — cari fatura/ödeme ve ters kayıt; borçlu stok girişi | ✔ | — | — | — | ✔ |
| `commission.payout` — prim ödemesi ve ters kaydı | — | — | — | — | ✔ |
| `stock.read` / `stock.write` / `stock.manage` | ✔ / ✔ / ✔ | ✔ / ✔ / — | — | ✔ / ✔ / — | ✔ / — / — |
| `report.operations` — randevu, kontrol, laboratuvar, mesaj, belge sorguları | ✔ | — | ✔ | — | — |
| `report.clinical` — tedavi, plan, aylık işlem, hekim-hasta (hekim yalnız kendi) | ✔ | ✔ | — | — | — |
| `finance.read` — gelir–gider, nakit, ciro, borç, prim, online ödeme, cari raporları | ✔ | — | — | — | ✔ |
| `report.analytics` — işletme analizi | ✔ | — | — | — | ✔ |
| `report.export` — CSV (denetlenir) | ✔ | — | — | — | ✔ |
| `audit.clinic` — klinik geneli LOG | ✔ | — | — | — | — |
| `import.manage` — içe aktarma: ön kontrol, onay, geri alma (Görev 7) | ✔ | — | — | — | — |
| `export.clinic` — klinik verisinin tamamını açık JSON olarak dışa aktarma (gerekçeli, denetlenir) | ✔ | — | — | — | — |
| `export.patient` — hasta verisi (KVKK veri sahibi talebi; sağlık bölümleri, klinik çıktı belgeleri ile bağlı onay/kanıt/dosya satırları ve klinik hassasiyetli dosyalar ayrıca `patient.health.read`, ADR-088/089) | ✔ | — | — | — | — |

**Destek rolü (`support`, Görev 10, ADR-061):** yalnız yönetici süreli (≤72 sa) ve gerekçeli verir; salt okunur — `patient.read` (kimlik maskeli), `appointment.read`, `task.read`, `treatment.read`, `audit.read`, `audit.clinic`, `integration.read`, `lab.read`, `stock.read`, `report.operations`. Sağlık içeriği, kimlik açma, finans ve yazma yok; davetle atanamaz, klinik rolüne çevrilemez. **Görev 11 (ADR-064):** klinikte ≥2 etkin yönetici varsa erişim `pending` açılır ve talebi açan dışında bir yönetici (`team.manage`) onaylayana kadar etkisizdir.

**Kimlik no (Görev 11, ADR-063):** `patient.identity.unmask` artık yanıtlarda açık kimlik vermez; yalnız `POST /patients/:id/identity` (gerekçe 5–200) ile, her açma `patient.identity.reveal` denetim kaydıyla.

**İki adımlı doğrulama (Görev 7):** her kullanıcı Hesabım'dan açabilir. `VIADENT_REQUIRE_MFA_ROLES` (ör. `clinic_admin,finance`) listesindeki rollerde MFA'sız oturum klinik uçlarına `403 MFA_ENROLLMENT_REQUIRED` alır; yalnız Hesabım açıktır. Zorunluluk platform tabanı (ortam) ∪ klinik politikası (Yönetim → Güvenlik, `settings.manage`; Görev 10). MFA sıfırlama `team.manage` ister, gerekçe zorunludur, kendi hesabına ve başka klinikte de üye olan kullanıcıya uygulanamaz.

Hekimin klinik raporlarda yalnız kendi kayıtlarını görmesi sunucuda üyelik → hekim eşlemesiyle uygulanır; istemcinin gönderdiği hekim kimliği ezilir. Laboratuvar maliyeti yetkisiz rollerin yanıtında alan olarak hiç bulunmaz.

## Henüz uygulanmayan roller
- **Laboratuvar dış kullanıcısı** (P1): yalnız atanmış iş ve gerekli teknik bilgi.
- **Hasta / yetkili yakın** (P1): portal; yakınlık tek başına yetki değildir.
- **PİA-DENT destek**: süreli, amaçlı, kayıtlı erişim; varsayılan hasta içeriği yok.

## Test kanıtları
AT-01 (`tenant-isolation.test.ts`), AT-02/AT-15/AT-20 (`permissions-session.test.ts`), anamnez/davet/rol/kaynak yetkileri (`gorev1.test.ts`), tedavi rolleri ve çapraz tenant (`gorev2.test.ts`, E2E `gorev2.spec.ts`), finans rolleri ve çapraz tenant (`gorev3.test.ts`, E2E `gorev3.spec.ts`), belge/dosya/iletişim rolleri ve çapraz tenant (`gorev4.test.ts`, E2E `gorev4.spec.ts`), PİA Köprü yetkileri, dört göz ve çapraz tenant (`gorev5.test.ts`, E2E `gorev5.spec.ts`), operasyon/rapor yetkileri, hekim “yalnız kendi”, CSV izni ve çapraz tenant (`gorev6.test.ts`, E2E `gorev6.spec.ts`). Sonuçlar: `verification.md`.
