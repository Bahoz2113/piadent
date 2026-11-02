import { APPOINTMENT_STATUS_LABELS, CONTACT_OUTCOME_LABELS, GENDER_LABELS, RELATION_LABELS } from "./schemas";
import { CASH_ACCOUNT_KIND_LABELS, COMMISSION_BASIS_LABELS, PAYMENT_METHOD_LABELS } from "./finance";
import {
  COMM_CHANNEL_LABELS, COMM_PURPOSE_LABELS, COMM_SOURCE_LABELS, DOCUMENT_STATUS_LABELS, FILE_CATEGORY_LABELS, FILE_STATUS_LABELS,
  FOLLOW_UP_STATUS_LABELS, MESSAGE_STATUS_LABELS, type CommChannel, type CommPurpose,
} from "./documents";
import { INTEGRATION_KIND_LABELS, ONLINE_PAYMENT_STATUS_LABELS, OPERATION_LABELS, TRANSPORT_LABELS } from "./integrations";
import { LAB_COST_STAGE_LABELS, LAB_STATUS_LABELS, SUPPLIER_KIND_LABELS } from "./operations";
import { DECISION_LABELS, PLAN_STATUS_LABELS } from "./treatment";
import { IMPORT_KIND_LABELS } from "./pilot";
import { INVOICE_DOC_TYPE_LABELS, INVOICE_STATUS_LABELS } from "./invoices";
import { ROLE_LABELS } from "./permissions";
import { formatTRY, isMoney } from "./money";

/**
 * Denetim izi (PİA İz) eylem etiketleri — tek kaynak (QA-002).
 * API `audit(c, ctx, { action })` çağrılarındaki her eylem burada Türkçe etiketlidir; web ve raporlar buradan okur.
 * Yeni bir audit eylemi eklendiğinde bu tabloya da eklenir (apps/web/test/audit-labels.test.ts kapsamı doğrular).
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // Hasta kaydı ve ilişkiler
  "patient.create": "Hasta kaydı oluşturuldu",
  "patient.update": "Hasta bilgileri güncellendi",
  "patient.export": "Hasta verisi dışa aktarıldı (KVKK)",
  "patient.identity.reveal": "Kimlik numarası görüntülendi",
  "relation.create": "Hasta ilişkisi eklendi",
  "relation.end": "Hasta ilişkisi sonlandırıldı",
  "communication_preference.set": "İletişim tercihi kaydedildi",
  "message.queue": "Mesaj kuyruğa alındı",
  "follow_up.create": "Kontrol takibi oluşturuldu",
  "follow_up.cancel": "Kontrol takibi iptal edildi",
  "task.status": "Takip görevi güncellendi",

  // Randevu ve çizelge
  "appointment.create": "Randevu oluşturuldu",
  "appointment.status": "Randevu durumu değişti",
  "appointment.contact": "İletişim sonucu kaydedildi",
  "appointment_type.create": "Randevu türü eklendi",
  "appointment_type.update": "Randevu türü güncellendi",
  "chair.create": "Koltuk eklendi",
  "chair.update": "Koltuk güncellendi",
  "practitioner.create": "Hekim kaydı eklendi",
  "practitioner.update": "Hekim kaydı güncellendi",
  "schedule.replace": "Çalışma çizelgesi güncellendi",
  "closure.create": "Kapalı gün eklendi",
  "closure.cancel": "Kapalı gün iptal edildi",

  // Klinik içerik (yalnız sağlık yetkisiyle görünür)
  "anamnesis.save": "Anamnez kaydedildi",
  "anamnesis.review": "Anamnez gözden geçirildi",
  "clinical_note.create": "Klinik not eklendi",
  "clinical_note.correct": "Klinik not düzeltmesi eklendi",
  "finding.create": "Odontogram bulgusu eklendi",
  "finding.status": "Odontogram bulgu durumu değişti",
  "diagnosis.create": "Tanı eklendi",
  "diagnosis.status": "Tanı durumu değişti",

  // Tedavi planı ve işlemler
  "plan.create": "Tedavi planı oluşturuldu",
  "plan.item_add": "Plana işlem eklendi",
  "plan.item_update": "Plan işlemi güncellendi",
  "plan.item_remove": "Plan işlemi çıkarıldı",
  "plan.reprice": "Plan yeniden fiyatlandırıldı",
  "plan.propose": "Plan teklif edildi",
  "plan.decision": "Plan kararı kaydedildi",
  "plan.new_version": "Plan yeni sürümü oluşturuldu",
  "plan.cancel": "Tedavi planı iptal edildi",
  "procedure.complete": "İşlem tamamlandı",
  "procedure.correct": "İşlem düzeltmesi kaydedildi",
  "procedure.cancel": "Gerçekleşen işlem iptal edildi",
  "procedure.create": "Katalog işlemi eklendi",
  "procedure.update": "Katalog işlemi güncellendi",
  "tariff.create": "Tarife taslağı oluşturuldu",
  "tariff.items": "Tarife kalemleri güncellendi",
  "tariff.publish": "Tarife yayımlandı",
  "tariff.retire": "Tarife yürürlükten kaldırıldı",
  "readiness_rule.create": "Hazırlık kuralı eklendi",
  "readiness_rule.update": "Hazırlık kuralı güncellendi",
  "readiness.exception": "Hazırlık istisnası verildi",

  // Finans
  "receivable.create": "Alacak kaydı oluşturuldu",
  "receivable.cancel": "Alacak kaydı iptal edildi",
  "payment.create": "Tahsilat alındı",
  "payment.refund": "İade yapıldı",
  "receipt.print": "Makbuz yazdırıldı",
  "anamnesis_template.create": "Anamnez şablonu taslağı oluşturuldu",
  "anamnesis_template.update": "Anamnez şablonu taslağı güncellendi",
  "anamnesis_template.publish": "Anamnez şablonu yayınlandı",
  "anamnesis_template.retire": "Anamnez şablonu emekli edildi",
  "invoice.create": "Fatura taslağı oluşturuldu",
  "invoice.update_lines": "Fatura taslağı satırları güncellendi",
  "invoice.cancel": "Fatura taslağı iptal edildi",
  "invoice.submit_blocked": "Fatura gönderimi engellendi (sağlayıcı yok)",
  "allocation.create": "Tahsilat alacağa eşlendi",
  "allocation.reverse": "Tahsilat eşlemesi geri alındı",
  "online_payment.create": "Çevrim içi ödeme talebi oluşturuldu",
  "online_payment.cancel": "Çevrim içi ödeme talebi iptal edildi",
  "expense.create": "Gider kaydedildi",
  "expense.reverse": "Gider ters kayıtla düzeltildi",
  "cash_account.create": "Kasa/banka hesabı eklendi",
  "cash_account.update": "Kasa/banka hesabı güncellendi",
  "commission_rule.create": "Prim kuralı oluşturuldu",
  "commission_payout.create": "Prim ödemesi kaydedildi",
  "commission_payout.reverse": "Prim ödemesi ters kayıtla düzeltildi",

  // Belge, onam ve dosya
  "document.issue": "Belge düzenlendi",
  "document.revoke": "Belge iptal edildi",
  "document.accepted": "Onam kabul edildi",
  "document.declined": "Onam reddedildi",
  "document_type.update": "Belge türü güncellendi",
  "template.create": "Belge şablonu oluşturuldu",
  "template_version.create": "Şablon sürümü oluşturuldu",
  "template_version.approve": "Şablon sürümü onaylandı",
  "template_version.retire": "Şablon sürümü yürürlükten kaldırıldı",
  "file.upload": "Dosya yüklendi",
  "file.delete": "Dosya silindi",

  // Laboratuvar, stok ve cari
  "lab_order.create": "Laboratuvar iş emri oluşturuldu",
  "lab_order.update": "Laboratuvar iş emri güncellendi",
  "lab_order.note": "Laboratuvar iş emrine not eklendi",
  "lab_order.work_sheet": "Laboratuvar iş fişi üretildi",
  "lab_order.send": "İş emri laboratuvara gönderildi",
  "lab_order.in_production": "İş emri üretime alındı",
  "lab_order.receive": "Laboratuvar işi teslim alındı",
  "lab_order.accept": "Laboratuvar işi kabul edildi",
  "lab_order.revision": "Laboratuvar işi revizyona gönderildi",
  "lab_order.cancel": "Laboratuvar iş emri iptal edildi",
  "lab_cost.create": "Laboratuvar maliyeti kaydedildi",
  "lab_cost.reverse": "Laboratuvar maliyeti ters kayıtla düzeltildi",
  "stock_item.create": "Stok kalemi eklendi",
  "stock_item.update": "Stok kalemi güncellendi",
  "stock.receipt": "Stok girişi yapıldı",
  "stock.usage": "Stok kullanımı kaydedildi",
  "stock.adjustment": "Stok düzeltmesi yapıldı",
  "stock.waste": "Stok fire kaydı yapıldı",
  "stock.return": "Stok iadesi yapıldı",
  "stock.reverse": "Stok hareketi ters kayıtla düzeltildi",
  "stock.count": "Stok sayımı yapıldı",
  "supplier.create": "Tedarikçi eklendi",
  "supplier.update": "Tedarikçi güncellendi",
  "supplier_bill.create": "Tedarikçi faturası kaydedildi",
  "supplier_payment.create": "Tedarikçi ödemesi kaydedildi",
  "supplier_entry.reverse": "Cari hareket ters kayıtla düzeltildi",

  // Ekip, güvenlik ve oturum
  "invitation.create": "Davet gönderildi",
  "invitation.revoke": "Davet iptal edildi",
  "invitation.accept": "Davet kabul edildi",
  "membership.role": "Üyelik rolü değişti",
  "membership.revoke": "Üyelik sonlandırıldı",
  "support.grant_requested": "Destek erişimi talep edildi",
  "support.grant": "Destek erişimi verildi",
  "support.grant_approved": "Destek erişimi onaylandı",
  "security.policy_update": "Güvenlik politikası güncellendi",
  "password.reset": "Parola sıfırlandı",
  "password.change": "Parola değiştirildi",
  "mfa.enable": "İki aşamalı doğrulama açıldı",
  "mfa.disable": "İki aşamalı doğrulama kapatıldı",
  "mfa.reset": "İki aşamalı doğrulama sıfırlandı",
  "mfa.recovery_regenerate": "Kurtarma kodları yenilendi",
  "session.login": "Oturum açıldı",
  "session.switch": "Klinik bağlamı değiştirildi",
  "session.revoke_others": "Diğer oturumlar kapatıldı",
  "access.denied_or_missing": "Erişim reddedildi veya kayıt bulunamadı",

  // Ayarlar, entegrasyon, aktarım
  "settings.akis_update": "PİA Akış ayarları güncellendi",
  "integration_connection.create": "Entegrasyon bağlantısı oluşturuldu",
  "integration_connection.update": "Entegrasyon bağlantısı güncellendi",
  "integration_connection.rotate_secret": "Entegrasyon gizli anahtarı yenilendi",
  "integration_job.create": "Entegrasyon işi oluşturuldu",
  "integration_job.approve": "Entegrasyon işi onaylandı",
  "integration_job.reject": "Entegrasyon işi reddedildi",
  "integration_job.retry": "Entegrasyon işi yeniden denendi",
  "integration_job.cancel": "Entegrasyon işi iptal edildi",
  "import.dry_run": "Veri aktarımı prova edildi",
  "import.commit": "Veri aktarımı uygulandı",
  "import.rollback": "Veri aktarımı geri alındı",
  "export.clinic": "Klinik verisi dışa aktarıldı",
  "report.export": "Rapor dışa aktarıldı",
  "seed.synthetic": "Sentetik demo verisi yüklendi",
  "system.national_id_encrypted": "Kimlik numaraları şifrelendi (sistem)",
  "system.secret_key_rotated": "Gizli anahtar döndürüldü (sistem)",
};

/** Eylem kodunu Türkçe etikete çevirir; tanımsız kod için okunur geri dönüş: "Diğer işlem (kod)". */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? `Diğer işlem (${action})`;
}

// ------------------------------------------------------------------ değişen alan etiketleri (QA-003)
/**
 * Denetim kaydındaki `changes` nesnesinin alan anahtarları — tek kaynak.
 * API'deki `audit(..., { changes: { ... } })` nesneleri ve `diff(before, next, [...])` sütun listelerinden türetilir;
 * apps/web/test/audit-labels.test.ts kaynağı tarayıp her anahtarın burada olduğunu doğrular.
 */
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  // Hasta kartı ve yakınlar
  first_name: "Ad", last_name: "Soyad", birth_date: "Doğum tarihi", gender: "Cinsiyet", national_id: "Kimlik no", phone_e164: "Telefon",
  email: "E-posta", city: "Şehir", primary_practitioner_id: "Sorumlu hekim", referral_source: "Nereden duydu", field: "Alan",
  relation: "Yakınlık", is_legal_representative: "Yasal temsilci", can_receive_info: "Bilgi alabilir", ended_reason: "Sonlandırma nedeni",
  // Randevu ve kaynaklar
  starts_at: "Randevu zamanı", practitioner_id: "Hekim", chair_id: "Koltuk", status: "Durum", contact_outcome: "İletişim sonucu",
  cancel_reason: "İptal nedeni", reason: "Gerekçe", display_name: "Görünen ad", title: "Unvan / başlık", membership_id: "Ekip üyesi",
  default_minutes: "Varsayılan süre (dk)", blocks: "Çizelge bloğu sayısı", affected: "Etkilenen randevu", scope: "Kapsam", active: "Aktif",
  outside_working_hours: "Mesai dışı randevu",
  // Klinik ve tedavi
  corrects_note_id: "Düzeltilen not", corrects_id: "Düzeltilen işlem", tooth: "Diş", procedure: "İşlem kodu", critical_count: "Kritik yanıt sayısı",
  version: "Sürüm", changed: "Değişen kalem", decision: "Karar", unit_price: "Birim fiyat", discount: "İndirim", item_count: "Kalem sayısı", code: "Kod",
  anamnesis: "Anamnez",
  // Finans
  amount: "Tutar", method: "Yöntem", source: "Kaynak", payment_id: "Tahsilat", receipt_no: "Makbuz no", doc_type: "Belge türü", buyer_name: "Alıcı", grand_total: "Genel toplam", line_count: "Satır sayısı", question_count: "Soru sayısı", receivable_id: "Alacak", reverses_id: "Ters kaydı yapılan hareket",
  basis: "Prim esası", rate: "Oran (%)", valid_from: "Geçerlilik başlangıcı", category: "Kategori", kind: "Tür", name: "Ad",
  // Belge, dosya, iletişim
  template_version_id: "Şablon sürümü", body_hash: "İçerik özeti", content_hash: "İçerik özeti", request_status: "Onam talebi durumu",
  purpose: "Amaç", channel: "Kanal", due_date: "Vade", sha256: "Dosya özeti (SHA-256)", file_sha256: "Dosya özeti (SHA-256)",
  // Laboratuvar, stok, cari
  supplier_id: "Tedarikçi", work_type: "İş türü", order_no: "İş emri no", stage: "Aşama", teeth: "Dişler", shade: "Renk",
  instructions: "Talimatlar", target_date: "Hedef tarih", appointment_id: "Randevu", item_id: "Stok kalemi", quantity: "Miktar",
  counted: "Sayılan miktar", min_level: "Asgari seviye", lot_id: "Lot / parti", contact_name: "İlgili kişi", phone: "Telefon", tax_no: "Vergi no", note: "Not",
  // Ekip ve güvenlik
  role: "Rol", mfa: "İki aşamalı doğrulama", require_mfa_roles: "MFA zorunlu roller", hours: "Süre (saat)", expires_at: "Son geçerlilik", four_eyes: "Dört göz onayı",
  overdueCheckinMinutes: "Geciken geliş uyarısı (dk)", missingContactDays: "Eksik iletişim penceresi (gün)",
  planUnscheduledDays: "Plan sonrası randevu süresi (gün)", proposalPendingDays: "Teklif yanıt süresi (gün)",
  // Entegrasyon, aktarım, rapor
  provider: "Sağlayıcı", secret: "Gizli anahtar", config: "Bağlantı ayarları", operation: "İşlem", approval: "Onay", transport_status: "İletim durumu",
  imported: "Aktarılan satır", skipped: "Atlanan satır", valid: "Geçerli satır", rows: "Satır sayısı", omitted: "Dışarıda bırakılan",
  sections: "Bölümler", tables: "Tablolar", report: "Rapor", params: "Parametreler",
};

/** Alan anahtarını Türkçe etikete çevirir; `amaç:kanal` (iletişim tercihi) ve `document:<id>` (hazırlık) gibi türetilmiş anahtarları da çözer. */
export function auditFieldLabel(field: string): string {
  const direct = AUDIT_FIELD_LABELS[field];
  if (direct) return direct;
  const m = field.match(/^([a-z_]+):([a-z_0-9-]+)$/);
  if (m) {
    if (m[1] === "document") return "Hazırlık belgesi";
    const p = COMM_PURPOSE_LABELS[m[1] as CommPurpose]; const ch = COMM_CHANNEL_LABELS[m[2] as CommChannel];
    if (p && ch) return `${p} · ${ch}`;
  }
  return field.replace(/_/g, " ");
}

const MONEY_FIELDS = new Set(["amount", "unit_price", "discount", "grand_total"]);
const DATETIME_FIELDS = new Set(["starts_at", "expires_at"]);
const DATE_FIELDS = new Set(["birth_date", "due_date", "valid_from", "target_date"]);
const HASH_FIELDS = new Set(["body_hash", "content_hash", "sha256", "file_sha256"]);
const ID_FIELDS = new Set(["corrects_id", "corrects_note_id", "reverses_id"]);

const GENERIC_STATUS: Record<string, string> = {
  active: "Aktif", pending: "Bekliyor", cancelled: "İptal", ended: "Sonlandırıldı", revoked: "İptal edildi", retired: "Yürürlükten kaldırıldı",
  published: "Yayımlandı", draft: "Taslak", approved: "Onaylandı", proposed: "Teklif sunuldu", current: "Güncel", superseded: "Yeni sürümle değişti",
  completed: "Tamamlandı", deleted: "Silindi", dead: "Başarısız (deneme sınırı)", queued: "Sırada", open: "Açık", paid: "Ödendi", posted: "İşlendi",
  reversed: "Ters kayıtla düzeltildi", accepted: "Kabul edildi", rejected: "Reddedildi", expired: "Süresi doldu", missing: "Eksik", excepted: "İstisna verildi",
  granted: "İzin verildi", withdrawn: "İzin geri çekildi",
};
const STATUS_BY_ENTITY: Record<string, Record<string, string>> = {
  appointment: APPOINTMENT_STATUS_LABELS, treatment_plan: PLAN_STATUS_LABELS, plan_version: PLAN_STATUS_LABELS, lab_order: LAB_STATUS_LABELS,
  patient_document: DOCUMENT_STATUS_LABELS, file: FILE_STATUS_LABELS, follow_up: FOLLOW_UP_STATUS_LABELS, online_payment_request: ONLINE_PAYMENT_STATUS_LABELS,
  message: MESSAGE_STATUS_LABELS, integration_job: TRANSPORT_LABELS, invoice: INVOICE_STATUS_LABELS,
};
const SOURCE_LABELS: Record<string, string> = {
  performed_procedure: "Gerçekleşen işlemden", manual: "Elle", provider_webhook: "Sağlayıcı bildirimi", lab_cost: "Laboratuvar maliyeti",
  stock_receipt: "Stok girişi", ...COMM_SOURCE_LABELS,
};
const KIND_LABELS: Record<string, string> = {
  ...SUPPLIER_KIND_LABELS, ...CASH_ACCOUNT_KIND_LABELS, ...INTEGRATION_KIND_LABELS, ...IMPORT_KIND_LABELS,
  anamnesis: "Anamnez", document: "Belge", document_type: "Belge türü",
};
const APPROVAL_LABELS: Record<string, string> = { pending: "Onay bekliyor", approved: "Onaylandı", rejected: "Reddedildi", not_required: "Onay gerekmez" };
const SCOPE_LABELS: Record<string, string> = { clinic: "Tüm klinik", practitioner: "Hekim", chair: "Koltuk" };
const ENUM_BY_FIELD: Record<string, Record<string, string>> = {
  method: PAYMENT_METHOD_LABELS, source: SOURCE_LABELS, kind: KIND_LABELS, gender: GENDER_LABELS, contact_outcome: CONTACT_OUTCOME_LABELS,
  relation: RELATION_LABELS, decision: DECISION_LABELS, basis: COMMISSION_BASIS_LABELS, stage: LAB_COST_STAGE_LABELS, role: ROLE_LABELS,
  purpose: COMM_PURPOSE_LABELS, channel: COMM_CHANNEL_LABELS, request_status: DOCUMENT_STATUS_LABELS, transport_status: TRANSPORT_LABELS,
  approval: APPROVAL_LABELS, operation: OPERATION_LABELS, scope: SCOPE_LABELS, category: FILE_CATEGORY_LABELS, field: { national_id: "Kimlik no" },
};

export interface AuditValueOptions {
  /** Kaydın `entity_type` değeri; `status` gibi varlığa göre değişen enum'ları seçer. */
  entityType?: string;
  /** Kimlik → ad eşlemesi (hekim, koltuk, tedarikçi…). Eşleşmeyen kimlik kısa (#ilk8) gösterilir. */
  names?: ReadonlyMap<string, string> | Record<string, string>;
  /** Klinik saat dilimine göre tarih/saat biçimi; verilmezse ham metin kullanılır. */
  formatDateTime?: (iso: string) => string;
  formatDate?: (iso: string) => string;
}

function nameOf(names: AuditValueOptions["names"], id: string): string | undefined {
  if (!names) return undefined;
  return names instanceof Map ? names.get(id) : (names as Record<string, string>)[id];
}

/** Değişen alan değerini Türkçe, okunur metne çevirir (para `1.000,00 ₺`, enum etiketi, kısa kimlik, Evet/Hayır). */
export function auditValueLabel(field: string, value: unknown, opts: AuditValueOptions = {}): string {
  if (value === null || value === undefined || value === "") return "Belirtilmedi";
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (Array.isArray(value)) return value.length === 0 ? "Yok" : value.map((v) => auditValueLabel(field, v, opts)).join(", ");
  if (typeof value === "object") return Object.keys(value as object).length === 0 ? "Yok" : JSON.stringify(value);
  const s = String(value);
  if (MONEY_FIELDS.has(field)) return isMoney(s) ? formatTRY(s) : s;
  if (field === "rate") return `%${s}`;
  if (field === "doc_type") return (INVOICE_DOC_TYPE_LABELS as Record<string, string>)[s] ?? s;
  if (field === "secret") return "••••";
  if (field.endsWith("_id") || ID_FIELDS.has(field)) return nameOf(opts.names, s) ?? (s.length > 8 ? `#${s.slice(0, 8)}` : s);
  if (HASH_FIELDS.has(field)) return `${s.slice(0, 8)}…`;
  if (DATETIME_FIELDS.has(field)) return opts.formatDateTime ? opts.formatDateTime(s) : s;
  if (DATE_FIELDS.has(field)) return opts.formatDate ? opts.formatDate(s) : s;
  if (field === "status") return (opts.entityType && STATUS_BY_ENTITY[opts.entityType]?.[s]) ?? GENERIC_STATUS[s] ?? s;
  if (field === "require_mfa_roles") return s.split(",").map((r) => ROLE_LABELS[r.trim() as keyof typeof ROLE_LABELS] ?? r.trim()).join(", ");
  const table = ENUM_BY_FIELD[field];
  if (table) return table[s] ?? s;
  // Türetilmiş anahtarlar: `amaç:kanal` (granted/withdrawn), `document:<id>` ve `anamnesis` (missing/excepted).
  if (field === "anamnesis" || field.includes(":")) return GENERIC_STATUS[s] ?? s;
  return s;
}
