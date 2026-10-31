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
| `appointment.read` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `appointment.write` | ✔ | ✔ | ✔ | – | – |
| `task.read` / `task.write` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `finance.read` | ✔ | – | – | – | ✔ |
| `payment.refund` | – | – | – | – | ✔ |
| `audit.read` | ✔ | ✔ | – | – | – |
| `team.manage`, `settings.manage` | ✔ | – | – | – | – |

Notlar:
- “Yönetici unvanı tüm klinik sağlık içeriğine sınırsız erişim anlamına gelmez” (Plan §05) → yönetici klinik notları **okuyamaz** (testli).
- VİA İz: hasta geçmişi `patient.read` ile görünür, ancak `clinical_note` olayları yalnız `patient.health.read` ile; not içeriği audit'e hiç yazılmaz.
- VİA Akış: `general` görevler herkese; `clinical` görevler `patient.health.read`, `finance` görevler `finance.read` ister (sunucuda filtrelenir).
- Ödeme/iade uçları Görev 3'te eklenecek; `payment.refund` iznini kullanacak. Finansın iade eşiği için ikinci onay seçeneği planlandı.

## Henüz uygulanmayan roller
- **Laboratuvar dış kullanıcısı** (P1): yalnız atanmış iş ve gerekli teknik bilgi.
- **Hasta / yetkili yakın** (P1): portal; yakınlık tek başına yetki değildir.
- **VİADENT destek**: süreli, amaçlı, kayıtlı erişim; varsayılan hasta içeriği yok.

## Test kanıtları
AT-01 (`tenant-isolation.test.ts`), AT-02/AT-15/AT-20 (`permissions-session.test.ts`). Sonuçlar: `verification.md`.
