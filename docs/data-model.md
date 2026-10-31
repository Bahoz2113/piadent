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

`tasks.kind` genişledi: `closure_conflict`, `anamnesis_review` (sensitivity `clinical`); Görev 2: `plan_unscheduled`, `plan_decision_pending`.

## Görev 2 tabloları (`0003_treatment.sql`)
Hepsi `tenant_id` + RLS (ENABLE + FORCE) + `(tenant_id, id)` bileşik FK.
| Tablo | Amaç | Kural |
|---|---|---|
| `procedures` | İşlem kataloğu | `(tenant, code)` tekil; `tooth_scope` ∈ tooth/surface/quadrant/arch/mouth; kod ve kapsam API'de değişmez |
| `tariff_versions` / `tariff_items` | Sürümlü tarife (genel veya hekime özel) | yayında olanın kalemi/başlığı tetikleyiciyle donar; fiyat `numeric(14,2)` |
| `odontogram_findings` | Mevcut durum (çürük, dolgu, eksik…) | silinmez; `current → historic \| entered_in_error` + gerekçe |
| `diagnoses` | Tanı | konum + açıklama + isteğe bağlı kod; `active → resolved \| entered_in_error` |
| `treatment_plans` | Plan başlığı | uygulama rolü yalnız SELECT/INSERT |
| `plan_versions` | Sürüm + durum | tetikleyici geçişleri sınırlar; plan başına tek taslak, tek kabul |
| `plan_items` | Kalem: konum, adet, seans, birim fiyat snapshot'ı, indirim+gerekçe, elle fiyat+açıklama | `line_total` üretilmiş sütun; taslak dışında değiştirilemez/silinemez |
| `plan_decisions` | Kabul/ret/kararsız beyanı | yalnız ekleme |
| `performed_procedures` | Gerçekleşen işlem | ziyarete (randevu) bağlı; bedel snapshot; yalnız `completed → cancelled \| corrected`; düzeltme `corrects_id` ile |
| `clinical_notes.appointment_id` | Notu ziyarete bağlama | bileşik FK |

Konum sütunları: `location_kind`, `tooth`, `surfaces text[]`, `quadrant`, `arch` (check kısıtları türle tutarlılığı zorlar).

## Görev 3 tabloları (`0004_finance.sql`)
| Tablo | Amaç | Kural |
|---|---|---|
| `cash_accounts` | Kasa / banka / POS (manuel) | TRY; hareketi olan hesabın türü değişmez |
| `receivables` | Alacak (işlemden veya elle) | tutar > 0 ve değişmez; `active → cancelled` (gerekçe); işlem başına tek alacak; kur alanları hazır, TRY dışı reddedilir |
| `payments` | Tahsilat | yalnız ekleme; yöntem nakit / kart (manuel) / havale / diğer |
| `allocations` | Ödeme → alacak dağıtımı | yalnız ekleme; ters kayıt negatif + `reverses_id` + gerekçe; tetikleyici: ödeme ve alacak sınırı, aynı hasta, kilitli |
| `refunds` | İade | yalnız ekleme; tetikleyici: ödemeyi aşamaz, önce dağıtım ters kaydı |
| `expenses` | Gider | yalnız ekleme; ters kayıt negatif + `reverses_id` (tekil) |
| `cash_movements` | Kasa hareketi (+ giriş / − çıkış) | kaynak başına tek hareket |
| `idempotency_keys` | Tekilleştirme | (tenant, işlem, anahtar) birincil anahtar; istek hash'i + yanıt |
| `commission_rule_versions` | Prim kuralı sürümü | yalnız ekleme; geçerlilik tarihi; hekime özel veya genel |
| `commission_accruals` | Prim tahakkuku | dağıtım başına bir satır; oran snapshot'ı; ters prim orijinal oranla |

## Görev 4 tabloları (`0005_documents_files.sql`)
| Tablo | Amaç | Kural |
|---|---|---|
| `document_types` | VİADENT belge türü kataloğu | kategori, kabul gerekir mi, hazırlayabilen rol, inceleme durumu (DEMO) |
| `templates` / `template_versions` | Şablon ve sürümü | onaylı sürümün metni/özeti donar; şablon başına tek taslak; DEMO işareti |
| `patient_documents` | Üretilmiş belge | metin snapshot + SHA-256, şablon sürümü değişmez; yalnız `issued → revoked` |
| `consent_requests` | Karar isteği (kabul gerektiren türler) | kararlı/kapalı istek tekrar değişmez; 30 gün sonra süresi dolar |
| `evidence_events` | Kanıt olayları | yalnız ekleme; belge özeti; kabulde yöntem zorunlu; taranmış nüsha bağlantısı |
| `file_assets` / `file_access_events` | Dosya metadata'sı ve erişim izi | içerik DB'de değil; durum makinesi tetikleyiciyle; tarama zamanı olmadan available olmaz; hash değişmez |
| `communication_preferences` | Amaç × kanal izni | yalnız ekleme; en son kayıt geçerli |
| `messages` / `delivery_events` | Mesaj ve durum olayları | sağlayıcı yalnız `mock`; teslim ≠ gönderim; süre aşımı → unknown |
| `follow_ups` | Kontrol | randevu bağlanınca scheduled, gerçekleşince done |
| `readiness_rules` / `readiness_exceptions` | VİA Hazır kural ve gerekçeli istisna | kural türüne göre zorunlu alanlar (check) |

## Durum makineleri (uygulanan)
**Randevu:** `planned → confirmed | checked_in | no_show | cancelled`; `confirmed → checked_in | no_show | cancelled`; `checked_in → in_progress | completed`; `in_progress → completed`. `completed`, `no_show`, `cancelled` terminal. Saati gelmemiş randevu `no_show` olamaz.
**İletişim sonucu:** `not_contacted | informed | unreachable` — durumdan bağımsız; “Bilgi verildi” geldi anlamına gelmez.
**Plan sürümü:** `draft → proposed | cancelled`; `proposed → accepted | rejected | superseded | cancelled`; `accepted → superseded | cancelled` (DB tetikleyicisi).
**Gerçekleşen işlem:** `completed → cancelled | corrected`.
**Tarife:** `draft → published → retired`.
**Şablon sürümü:** `draft → approved → retired`. **Belge isteği:** `issued → accepted | declined | expired | revoked`; `accepted → revoked`. **Dosya:** `initiated → uploaded | rejected | deleted`; `uploaded → available | quarantined | rejected`; `available/quarantined/rejected → deleted`. **Mesaj:** `queued → submitted | failed | cancelled`; `submitted → unknown` (teslim bildirimi Görev 5). **Kontrol:** `open ⇄ scheduled → done`; `open/scheduled → cancelled`.
**Alacak:** `active → cancelled` (dağıtımlar önce ters kayda alınır).
**Görev:** `open | in_progress | blocked | done | cancelled`; kapalı görev yeniden açılmaz; iptal gerekçe ister.

## Planlanan tablolar (Plan §07 sözlüğü, sırasıyla)
- Görev 1 kalanı: `identity_document` (çoklu belge). Ayrı `visit` tablosu açılmadı: ziyaret = geliş kaydı yapılmış randevu (ADR-025).
- Görev 5: `message`, `delivery_event`, `integration_job`, `webhook_event`.
- Görev 6: `lab_order`, `lab_event`, `commission_rule_version`, `commission_accrual`, `commission_payout`, `inventory_item`, `lot`, `stock_movement`.
- Görev 7: `import_batch`.
