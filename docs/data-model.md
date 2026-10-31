# Veri modeli

Kaynak gerçek: `packages/db/migrations/*.sql`. Bu belge özet ve kurallardır.

## Genel kurallar
- `id uuid` (gen_random_uuid), `tenant_id` tüm iş tablolarında, ilişkilerde `(tenant_id, id)` bileşik yabancı anahtar.
- Otomatik soft-delete yok: hasta **arşivlenir** (`status`), klinik not **düzeltme kaydıyla** düzeltilir, randevu **iptal nedeni** ile iptal edilir. Klinik ve finans geçmişi silinerek düzeltilmez.
- İyimser kilit: `version` + istemcinin gönderdiği sürüm; uyuşmazlıkta 409 `VERSION_CONFLICT`.
- Sayaçlar (`tenant_counters`) satır kilidiyle artar (dosya no).

## Uygulanmış tablolar (0001_core)
| Tablo | Amaç | Önemli kurallar |
|---|---|---|
| `tenants` | Klinik işletmesi | `timezone`, `currency`, `is_demo`. Açılış yalnız owner rolüyle |
| `branches` | Şube | |
| `users` | Global kullanıcı | e-posta küçük harf tekil; scrypt parola özeti |
| `memberships` | Kullanıcı × klinik × rol | `active`/`revoked`; her istekte doğrulanır |
| `sessions` | Oturum | `token_hash` (SHA-256), `active_membership_id`, `expires_at`, `revoked_at` |
| `tenant_counters` | Tenant içi sayaç | |
| `practitioners` | Hekim kaynağı | üyelikle bağlanabilir |
| `chairs` | Koltuk/ünit | şube içinde ad tekil |
| `patients` | Hasta | `file_no` tenant içi tekil; `search_text` (Türkçe normalize, trigram indeks); `phone_e164`/`phone_digits` (**tekil değil** — aile ortak numara); kimlik türü+no birlikte; aktif kayıtlarda kimlik no tekil; gelecek doğum tarihi tetikleyiciyle reddedilir; `birth_date` boş olabilir (uydurulmaz) |
| `clinical_notes` | Klinik not (ilk dilim) | yalnız ekleme; `corrects_note_id` + zorunlu `correction_reason` |
| `appointments` | Randevu | durum makinesi ve **ayrı** `contact_outcome`; iki exclusion constraint; iptal nedeni zorunlu; ≤12 saat |
| `tasks` | VİA Akış görevi | `kind`, `sensitivity` (general/clinical/finance), `dedupe_key` (açık görevlerde tekil), `reason`, `next_step`, `assignee_role`, kapanış nedeni zorunlu |
| `audit_events` | VİA İz | yalnız değişen alanlar (`changes` jsonb); telefon/kimlik maskeli; klinik not içeriği yazılmaz; güncellenemez |
| `outbox_events` | Arka plan iş kuyruğu | `pending → processing → done/dead`, deneme ve `available_at` |

## Uygulanmış tablolar (0002_agenda_patient_team — Görev 1)
| Tablo | Amaç | Önemli kurallar |
|---|---|---|
| `appointment_types` | İşlem türü + varsayılan süre (T04) | ad tenant içinde tekil; `appointments.appointment_type_id` |
| `work_schedules` | Haftalık çalışma blokları (T05) | ISO haftagünü, `[start_min, end_min)`; aynı gün çakışan blok exclusion ile engelli |
| `closures` | Kapatma (T06) | kapsam clinic/practitioner/chair; gerekçe zorunlu; iptal = `cancelled_at` (silinmez) |
| `patient_relations` | Yakın/veli (H03) | kayıtlı hasta veya kişi adı; yasal temsil = dayanak + doğrulayan + zaman (check); sonlandırma gerekçeli; aktif çift tekil |
| `anamnesis_versions` | Sürümlü anamnez (H07) | (hasta, sürüm) tekil; uygulama rolü UPDATE edemez; `critical_flags` sunucuda hesaplanır |
| `anamnesis_reviews` | Hekim onayı | sürüm başına bir onay |
| `invitations` | Ekip daveti (T20) | yalnız token özeti; 72 saat; açık davet e-posta başına tekil; `app.invitation_tenant()` dar SECURITY DEFINER |

`tasks.kind` genişledi: `closure_conflict`, `anamnesis_review` (sensitivity `clinical`).

## Durum makineleri (uygulanan)
**Randevu:** `planned → confirmed | checked_in | no_show | cancelled`; `confirmed → checked_in | no_show | cancelled`; `checked_in → in_progress | completed`; `in_progress → completed`. `completed`, `no_show`, `cancelled` terminal. Saati gelmemiş randevu `no_show` olamaz.
**İletişim sonucu:** `not_contacted | informed | unreachable` — durumdan bağımsız; “Bilgi verildi” geldi anlamına gelmez.
**Görev:** `open | in_progress | blocked | done | cancelled`; kapalı görev yeniden açılmaz; iptal gerekçe ister.

## Planlanan tablolar (Plan §07 sözlüğü, sırasıyla)
- Görev 1 kalanı: `identity_document` (çoklu belge), `visit` (Görev 2 ile).
- Görev 2: `procedure_catalog`, `tariff_version`, `treatment_plan`, `plan_version`, `plan_item`, `performed_procedure`, `diagnosis`, `odontogram_finding`.
- Görev 3: `receivable`, `payment`, `allocation`, `refund`, `cash_movement`, `expense`, `idempotency_key` — `numeric(14,2)`, para birimi + kur snapshot alanları.
- Görev 4: `template`, `template_version`, `patient_document`, `consent_request`, `evidence_event`, `file_asset`, `file_version`, `file_access_event`, `communication_preference`.
- Görev 5: `message`, `delivery_event`, `integration_job`, `webhook_event`.
- Görev 6: `lab_order`, `lab_event`, `commission_rule_version`, `commission_accrual`, `commission_payout`, `inventory_item`, `lot`, `stock_movement`.
- Görev 7: `import_batch`.
