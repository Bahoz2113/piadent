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
| `document.read` (hasta belgeleri, kanıt olayları) | ✔ | ✔ | ✔ | ✔ | – |
| `document.issue` (onaylı şablondan belge üretme) | – | ✔ | ✔ | – | – |
| `document.decision` (yüz yüze kabul/ret kaydı) | – | ✔ | ✔ | – | – |
| `document.revoke` (belgeyi gerekçeyle iptal) | ✔ | ✔ | – | – | – |
| `template.manage` (belge türü, şablon sürümü, VİA Hazır kuralı) | ✔ | – | – | – | – |
| `file.read` (idari dosyalar; klinik kategoriler ayrıca `patient.health.read`) | ✔ | ✔ | ✔ | ✔ | – |
| `file.write` (yükleme) | – | ✔ | ✔ | ✔ | – |
| `file.delete` (gerekçeyle silindi işareti) | ✔ | ✔ | – | – | – |
| `communication.write` (iletişim tercihi) | ✔ | ✔ | ✔ | – | – |
| `message.send` (kuyruğa alma; şimdilik MOCK sağlayıcı) | ✔ | – | ✔ | – | ✔ |
| `followup.write` (kontrol planlama) | – | ✔ | – | – | – |
| `readiness.exception` (VİA Hazır gerekçeli istisna) | – | ✔ | – | – | – |
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
- VİA İz: hasta geçmişi `patient.read` ile görünür, ancak `clinical_note` ve `anamnesis` olayları yalnız `patient.health.read` ile; not/yanıt içeriği audit'e hiç yazılmaz.
- Hasta özetindeki kritik anamnez işaretleri (`clinical`) yalnız `patient.health.read` rollerine döner; diğer rollerde alan `null`.
- Rol değişikliği ve erişim kaldırma kişinin kendisine uygulanamaz; üyelik her istekte okunduğundan bir sonraki istekte geçerlidir.
- VİA Akış: `general` görevler herkese; `clinical` görevler `patient.health.read`, `finance` görevler `finance.read` ister (sunucuda filtrelenir).
- Odontogram ve tanı (`/patients/:id/chart`) `patient.health.read` ister: sekreter plan ve teklif bedelini görür, klinik haritayı görmez; yönetici de görmez (testli, ADR-023).
- Asistan şimdilik işlem kaydetmez; hekim adına kayıt (asistan girer, hekim onaylar) pilot geri bildirimiyle değerlendirilecek.
- Sekreterya vezne işini yapar (tahsilat, dağıtım) ama iade yapamaz ve klinik gelir raporlarını göremez (Plan §05; AT-02 iade testi). Yönetici raporları ve ayarları görür, tahsilat girmez (rol ayrılığı). Hekim varsayılan olarak hasta hesabını ve primi görmez (“ayrı izin”).
- Finansın iade eşiği için ikinci onay seçeneği planlandı (henüz yok).
- Belge türü hekime özel olabilir (`issuer_role = dentist`, ör. istirahat belgesi): sekreter hazırlayamaz (403).
- Klinik dosyalar (röntgen, klinik fotoğraf, klinik belge) sekreter/yönetici/finans listelerinde görünmez ve doğrudan istekte 404 döner; yönetici idari dosyaları görür.

## VİA Köprü yetkileri (Görev 5)
| Yetki | Yönetici | Finans | Diğerleri |
|---|---|---|---|
| `integration.read` — bağlantılar, dış işler, webhook günlüğü | ✔ | ✔ | — |
| `integration.manage` — bağlantı aç/kapat, MOCK davranışı, sır yenileme, yeniden deneme/iptal, MOCK bildirim simülasyonu | ✔ | — | — |
| `integration.approve` — onay kapısındaki işi onaylama/reddetme | ✔ | ✔ | — |

Dört göz: onay yetkisi olsa bile **isteği açan kişi kendi isteğini onaylayamaz** (API `SAME_USER_APPROVAL`, DB check). Online ödeme bağlantısı `payment.write` (sekreter, finans), sağlayıcıdan iade isteği `payment.refund` (finans, yönetici) ister. Webhook ucu oturumsuzdur; yetki yerine HMAC imza + zaman penceresi + bağlantı kimliği kullanılır, kiracı bağlantıdan çözülür (ADR-039).

## Henüz uygulanmayan roller
- **Laboratuvar dış kullanıcısı** (P1): yalnız atanmış iş ve gerekli teknik bilgi.
- **Hasta / yetkili yakın** (P1): portal; yakınlık tek başına yetki değildir.
- **VİADENT destek**: süreli, amaçlı, kayıtlı erişim; varsayılan hasta içeriği yok.

## Test kanıtları
AT-01 (`tenant-isolation.test.ts`), AT-02/AT-15/AT-20 (`permissions-session.test.ts`), anamnez/davet/rol/kaynak yetkileri (`gorev1.test.ts`), tedavi rolleri ve çapraz tenant (`gorev2.test.ts`, E2E `gorev2.spec.ts`), finans rolleri ve çapraz tenant (`gorev3.test.ts`, E2E `gorev3.spec.ts`), belge/dosya/iletişim rolleri ve çapraz tenant (`gorev4.test.ts`, E2E `gorev4.spec.ts`), VİA Köprü yetkileri, dört göz ve çapraz tenant (`gorev5.test.ts`, E2E `gorev5.spec.ts`). Sonuçlar: `verification.md`.
