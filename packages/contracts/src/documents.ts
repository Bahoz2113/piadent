import { z } from "zod";

const uuid = z.uuid("Geçersiz kimlik");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih gg.aa.yyyy biçiminde olmalı");
const optText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());

// ------------------------------------------------------------------ belge türü / şablon
export const DOCUMENT_CATEGORIES = ["consent", "information", "administrative", "privacy", "insurance", "other"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  consent: "Bilgilendirme ve onam", information: "Bilgilendirme", administrative: "İdari belge", privacy: "Kişisel veri / görsel izin",
  insurance: "Kurum / sigorta", other: "Diğer",
};

/**
 * Şablonda kullanılabilecek alanlar (izin listesi). Bilinmeyen alan şablon kaydında reddedilir.
 * Önizleme ve üretim aynı fonksiyonla yapılır; üretilen metin ve hash'i snapshot olarak saklanır.
 */
export const TEMPLATE_FIELDS = {
  "hasta.ad_soyad": "Hastanın adı soyadı",
  "hasta.dosya_no": "Dosya numarası",
  "hasta.dogum_tarihi": "Doğum tarihi (gg.aa.yyyy)",
  "klinik.ad": "Klinik adı",
  "hekim.ad": "Sorumlu hekim",
  "belge.tarih": "Belge tarihi (gg.aa.yyyy)",
  "plan.kalemler": "Bağlı plan sürümünün kalemleri (liste)",
} as const;
export type TemplateField = keyof typeof TEMPLATE_FIELDS;
const FIELD_RE = /\{\{\s*([a-z_.]+)\s*\}\}/g;

export function templateFieldsUsed(body: string): string[] {
  return [...new Set([...body.matchAll(FIELD_RE)].map((m) => m[1]!))];
}
export function unknownTemplateFields(body: string): string[] {
  return templateFieldsUsed(body).filter((f) => !(f in TEMPLATE_FIELDS));
}
/** Metni normalize eder (satır sonu \n, sondaki boşluklar) — hash bu metinden hesaplanır. */
export function normalizeDocumentText(s: string): string {
  return s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").trim() + "\n";
}
export function renderTemplate(body: string, values: Partial<Record<TemplateField, string>>): string {
  return normalizeDocumentText(body.replace(FIELD_RE, (_, k: string) => (values as Record<string, string>)[k] ?? "—"));
}

export const TemplateCreate = z.object({
  documentTypeId: uuid,
  name: z.string().trim().min(2).max(120),
  language: z.enum(["tr", "en"]).default("tr"),
  body: z.string().min(10, "Metin çok kısa").max(20000),
  changeNote: optText(300),
});
export const TemplateVersionCreate = z.object({ body: z.string().min(10).max(20000), changeNote: optText(300) });

export const DocumentIssue = z.object({
  patientId: uuid,
  templateVersionId: uuid,
  appointmentId: uuid.optional(),
  planVersionId: uuid.optional(),
});
export const ACCEPTANCE_METHODS = ["wet_signature_on_paper", "verbal_in_person"] as const;
export const ACCEPTANCE_METHOD_LABELS: Record<(typeof ACCEPTANCE_METHODS)[number], string> = {
  wet_signature_on_paper: "Kâğıt nüshada ıslak imza (personel kaydetti)",
  verbal_in_person: "Yüz yüze sözlü beyan (personel kaydetti)",
};
export const DocumentDecision = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("accepted"),
    method: z.enum(ACCEPTANCE_METHODS),
    attestation: z.literal(true, "Beyanı kaydeden personel onayı gerekli"),
    fileId: uuid.optional(),
    note: optText(300),
  }),
  z.object({ decision: z.literal("declined"), note: optText(300) }),
]);
export const DocumentRevoke = z.object({ reason: z.string().trim().min(3, "Gerekçe gerekli").max(300) });

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  issued: "Hazırlandı", delivered: "Teslim edildi", viewed: "Görüntülendi", accepted: "Kabul kaydedildi", declined: "Reddetti",
  expired: "Süresi doldu", revoked: "İptal edildi",
};
export const EVIDENCE_LABELS: Record<string, string> = {
  issued: "Belge üretildi", printed: "Yazdırıldı", presented_in_person: "Yüz yüze sunuldu", viewed: "Görüntülendi", accepted: "Kabul kaydedildi",
  declined: "Ret kaydedildi", revoked: "İptal edildi", expired: "Süresi doldu", scan_attached: "Taranmış nüsha bağlandı",
};

// ------------------------------------------------------------------ dosya
export const FILE_CATEGORIES = ["radiograph", "clinical_photo", "clinical_document", "document_scan", "identity", "other"] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];
export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  radiograph: "Röntgen", clinical_photo: "Klinik fotoğraf", clinical_document: "Klinik belge (dış rapor vb.)",
  document_scan: "İmzalı/taranmış belge", identity: "Kimlik / idari", other: "Diğer",
};
/** Klinik içerikli kategoriler yalnız sağlık yetkisi olan rollere görünür. */
export const FILE_SENSITIVITY: Record<FileCategory, "clinical" | "administrative"> = {
  radiograph: "clinical", clinical_photo: "clinical", clinical_document: "clinical", document_scan: "administrative", identity: "administrative", other: "administrative",
};
export const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const FILE_MAX_BYTES = 20 * 1024 * 1024;
export const FILE_STATUS_LABELS: Record<string, string> = {
  initiated: "Yükleme bekleniyor", uploaded: "Taranıyor", quarantined: "Karantinada", available: "Kullanılabilir", rejected: "Reddedildi", deleted: "Silindi",
};
export const FileInitiate = z.object({
  patientId: uuid,
  category: z.enum(FILE_CATEGORIES),
  originalName: z.string().trim().min(1).max(200),
  contentType: z.enum(FILE_TYPES, "Desteklenen türler: JPEG, PNG, WEBP, PDF"),
  size: z.number().int().min(1, "Boş dosya").max(FILE_MAX_BYTES, "En fazla 20 MB"),
  appointmentId: uuid.optional(),
  patientDocumentId: uuid.optional(),
});
export const FileDelete = z.object({ reason: z.string().trim().min(3, "Gerekçe gerekli").max(300) });

// ------------------------------------------------------------------ iletişim tercihi ve mesaj
export const COMM_PURPOSES = ["appointment_reminder", "treatment_followup", "payment_reminder", "survey", "marketing"] as const;
export type CommPurpose = (typeof COMM_PURPOSES)[number];
export const COMM_PURPOSE_LABELS: Record<CommPurpose, string> = {
  appointment_reminder: "Randevu hatırlatma", treatment_followup: "Tedavi/kontrol takibi", payment_reminder: "Ödeme hatırlatma",
  survey: "Memnuniyet anketi", marketing: "Kampanya / tanıtım",
};
export const COMM_CHANNELS = ["sms", "whatsapp", "email", "phone"] as const;
export type CommChannel = (typeof COMM_CHANNELS)[number];
export const COMM_CHANNEL_LABELS: Record<CommChannel, string> = { sms: "SMS", whatsapp: "WhatsApp", email: "E-posta", phone: "Telefon" };
export const COMM_SOURCES = ["in_person", "paper_form", "phone", "patient_request"] as const;
export const COMM_SOURCE_LABELS: Record<(typeof COMM_SOURCES)[number], string> = {
  in_person: "Yüz yüze", paper_form: "Kâğıt form", phone: "Telefonla", patient_request: "Hastanın talebi",
};
export const CommPreferenceSet = z.object({
  purpose: z.enum(COMM_PURPOSES),
  channel: z.enum(COMM_CHANNELS),
  status: z.enum(["granted", "withdrawn"]),
  source: z.enum(COMM_SOURCES),
  note: optText(200),
});
export const MessageSend = z.object({
  patientId: uuid,
  purpose: z.enum(COMM_PURPOSES),
  channel: z.enum(["sms", "whatsapp", "email"]),
  body: z.string().trim().min(2).max(640),
});
export const MESSAGE_STATUS_LABELS: Record<string, string> = {
  draft: "Taslak", queued: "Kuyrukta", submitted: "Sağlayıcıya iletildi (teslim bilinmiyor)", delivered: "Teslim edildi",
  failed: "Başarısız", cancelled: "İptal", unknown: "Sonuç bilinmiyor",
};

// ------------------------------------------------------------------ kontrol ve VİA Hazır
export const FollowUpCreate = z.object({
  patientId: uuid,
  dueDate: isoDate,
  reason: z.string().trim().min(3, "Kısa bir gerekçe yazın").max(200),
  practitionerId: uuid.optional(),
});
export const FollowUpCancel = z.object({ reason: z.string().trim().min(3).max(200) });
export const FOLLOW_UP_STATUS_LABELS: Record<string, string> = { open: "Randevu bekliyor", scheduled: "Randevu verildi", done: "Yapıldı", cancelled: "İptal" };

export const ReadinessRuleCreate = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document_for_procedure"), procedureId: uuid, documentTypeId: uuid }),
  z.object({ kind: z.literal("anamnesis_reviewed"), maxAgeDays: z.number().int().min(1).max(3650) }),
]);
export const ReadinessExceptionCreate = z.object({
  itemKey: z.string().regex(/^(anamnesis|document:[0-9a-f-]{36})$/),
  reason: z.string().trim().min(5, "Gerekçe en az 5 karakter").max(300),
});
