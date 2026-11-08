import { z } from "zod";
import { isoDate } from "./zdate";

const uuid = z.uuid("Geçersiz kimlik");
const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), trimmed(max).optional());

export const LoginInput = z.object({
  email: z.email("Geçerli bir e-posta girin").max(200),
  password: z.string().min(1, "Parola gerekli").max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const SwitchMembershipInput = z.object({ membershipId: uuid });

// ---------------------------------------------------------------- hasta
/** 07.11.2026 ürün sahibi kararı (ADR-106): yalnız Kadın, Erkek, Belirtmek istemiyorum (migration 0039). */
export const GENDERS = ["female", "male", "unspecified"] as const;
export const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = {
  female: "Kadın", male: "Erkek", unspecified: "Belirtmek istemiyorum",
};
export const NATIONAL_ID_TYPES = ["tckn", "passport", "other"] as const;
export const NATIONAL_ID_LABELS: Record<(typeof NATIONAL_ID_TYPES)[number], string> = {
  tckn: "T.C. Kimlik No", passport: "Pasaport", other: "Diğer belge",
};

export const PatientCreate = z
  .object({
    firstName: trimmed(80).min(1, "Ad gerekli"),
    lastName: trimmed(80).min(1, "Soyad gerekli"),
    birthDate: z.preprocess((v) => (v === "" ? undefined : v), isoDate.optional()),
    gender: z.enum(GENDERS).optional(),
    nationalIdType: z.enum(NATIONAL_ID_TYPES).optional(),
    nationalId: optionalText(32),
    phone: optionalText(32),
    email: z.preprocess((v) => (v === "" ? undefined : v), z.email("Geçerli bir e-posta girin").max(200).optional()),
    city: optionalText(80),
    primaryPractitionerId: uuid.optional(),
    referralSource: optionalText(120),
    /** Mükerrer aday uyarısını gördükten sonra bilinçli kayıt. */
    acknowledgeDuplicates: z.boolean().optional(),
  })
  .refine((v) => !!v.nationalId === !!v.nationalIdType, {
    message: "Kimlik türü ve numarası birlikte girilmeli",
    path: ["nationalId"],
  });
export type PatientCreate = z.infer<typeof PatientCreate>;

export const PatientUpdate = z.object({
  version: z.number().int().positive(),
  firstName: trimmed(80).min(1).optional(),
  lastName: trimmed(80).min(1).optional(),
  birthDate: z.union([isoDate, z.null()]).optional(),
  gender: z.union([z.enum(GENDERS), z.null()]).optional(),
  phone: z.union([trimmed(32), z.null()]).optional(),
  email: z.union([z.email().max(200), z.null()]).optional(),
  city: z.union([trimmed(80), z.null()]).optional(),
  primaryPractitionerId: z.union([uuid, z.null()]).optional(),
  referralSource: z.union([trimmed(120), z.null()]).optional(),
});
export type PatientUpdate = z.infer<typeof PatientUpdate>;

export const PatientSearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ---------------------------------------------------------------- ajanda
export const APPOINTMENT_STATUSES = [
  "planned", "confirmed", "checked_in", "in_progress", "completed", "no_show", "cancelled",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  planned: "Planlandı", confirmed: "Teyitli", checked_in: "Geldi", in_progress: "Tedavide",
  completed: "Tamamlandı", no_show: "Gelmedi", cancelled: "İptal",
};
/** Randevu durum makinesi (Plan §06). İletişim sonucu ayrı alandır. */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  planned: ["confirmed", "checked_in", "no_show", "cancelled"],
  confirmed: ["checked_in", "no_show", "cancelled"],
  checked_in: ["in_progress", "completed"],
  in_progress: ["completed"],
  completed: [],
  no_show: [],
  cancelled: [],
};

export const CONTACT_OUTCOMES = ["not_contacted", "informed", "unreachable"] as const;
export const CONTACT_OUTCOME_LABELS: Record<(typeof CONTACT_OUTCOMES)[number], string> = {
  not_contacted: "Aranmadı", informed: "Bilgi verildi", unreachable: "Ulaşılamadı",
};

/** Geçmişe randevu: başlangıç şimdiden bu kadar dakika önceyse yeni randevu reddedilir (ADR-094); yürüyerek gelen hasta için kısa tolerans. */
export const APPOINTMENT_PAST_GRACE_MINUTES = 10;
/** Bir randevuya bağlanabilecek en çok planlanan işlem (ADR-107). */
export const APPOINTMENT_MAX_PROCEDURES = 10;
export const AppointmentCreate = z.object({
  patientId: uuid,
  appointmentTypeId: uuid.optional(),
  /** Planlanan katalog işlemi; fiyat tarifeden gösterilir, tahakkuk yalnız gerçekleşen işlemden doğar. Eski istemciler için; yeni istemci `procedureIds`. */
  procedureId: uuid.optional(),
  /**
   * 08.11.2026 (ADR-107): planlanan işlemler (sıralı, en çok 10, tekrar yok). İSTEĞE BAĞLI — randevu verirken sekreter işlemi/tanıyı
   * bilmeyebilir; hekim muayenede belirler. Verilirse `procedureId` yok sayılır.
   */
  procedureIds: z.array(uuid).max(APPOINTMENT_MAX_PROCEDURES, `En çok ${APPOINTMENT_MAX_PROCEDURES} işlem`)
    .refine((a) => new Set(a).size === a.length, "Aynı işlem iki kez seçilemez").optional(),
  /** Geriye dönük düzeltme kaydı (yalnız schedule.manage, gerekçe zorunlu, denetime yazılır). Arayüz yeni randevuda sunmaz. */
  backdateReason: optionalText(300),
  /** Çalışma saati dışı uyarısını gördükten sonra bilinçli kayıt (audit'e yazılır). Kapatma bunu aşamaz. */
  allowOutsideHours: z.boolean().optional(),
  practitionerId: uuid,
  chairId: uuid.optional(),
  date: isoDate,
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Saat ss:dd biçiminde olmalı"),
  durationMinutes: z.number().int().min(5, "En az 5 dakika").max(720, "En fazla 12 saat"),
  reason: optionalText(120),
  note: optionalText(1000),
});
export type AppointmentCreate = z.infer<typeof AppointmentCreate>;

export const AppointmentStatusChange = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(APPOINTMENT_STATUSES),
    cancelReason: optionalText(300),
  })
  .refine((v) => v.status !== "cancelled" || !!v.cancelReason, {
    message: "İptal nedeni gerekli",
    path: ["cancelReason"],
  });

export const AppointmentContactChange = z.object({
  version: z.number().int().positive(),
  contactOutcome: z.enum(CONTACT_OUTCOMES),
});

export const DayQuery = z.object({ date: isoDate.optional(), from: isoDate.optional(), days: z.coerce.number().int().min(1).max(14).optional() });

// ---------------------------------------------------------------- kaynak ve takvim yönetimi
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Saat ss:dd biçiminde olmalı");
export const WEEKDAY_LABELS = ["", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"] as const;
export const WEEKDAY_SHORT = ["", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const;

export const PractitionerUpsert = z.object({
  displayName: trimmed(80).min(2, "Ad en az 2 karakter"),
  title: optionalText(60),
  membershipId: uuid.optional(),
  active: z.boolean().optional(),
});
export const ChairUpsert = z.object({ name: trimmed(60).min(1, "Ad gerekli"), active: z.boolean().optional() });
export const AppointmentTypeUpsert = z.object({
  name: trimmed(80).min(2, "Ad en az 2 karakter"),
  defaultMinutes: z.number().int().min(5).max(720),
  /** Bu türle verilen randevuya varsayılan olarak bağlanacak katalog işlemi (fiyat gösterimi için). */
  procedureId: uuid.nullable().optional(),
  active: z.boolean().optional(),
});
export const WorkScheduleReplace = z.object({
  blocks: z.array(z.object({ weekday: z.number().int().min(1).max(7), start: hhmm, end: hhmm }))
    .max(28)
    .refine((b) => b.every((x) => x.end > x.start), { message: "Bitiş başlangıçtan sonra olmalı" }),
});
/** 07.11.2026: kapatma türü. Resmî tatil tüm kliniği, rapor ve izin tek hekimi kapatır (hekim çalışma saatleri altında girilir). */
export const CLOSURE_KINDS = ["closure", "public_holiday", "sick_leave", "leave"] as const;
export type ClosureKind = (typeof CLOSURE_KINDS)[number];
export const CLOSURE_KIND_LABELS: Record<ClosureKind, string> = { closure: "Kapatma", public_holiday: "Resmî tatil", sick_leave: "Rapor", leave: "İzin" };
/** Sabit tarihli resmî tatiller (gün-ay). Dinî bayramların tarihi her yıl değişir; elle girilir. */
export const FIXED_PUBLIC_HOLIDAYS: [string, string][] = [
  ["01-01", "Yılbaşı"], ["04-23", "Ulusal Egemenlik ve Çocuk Bayramı"], ["05-01", "Emek ve Dayanışma Günü"], ["05-19", "Atatürk'ü Anma, Gençlik ve Spor Bayramı"],
  ["07-15", "Demokrasi ve Millî Birlik Günü"], ["08-30", "Zafer Bayramı"], ["10-29", "Cumhuriyet Bayramı"],
];
export const AvailabilityQuery = z.object({
  practitionerId: uuid, date: isoDate, minutes: z.coerce.number().int().min(5).max(720).default(30), chairId: uuid.optional(),
});
export const ClosureCreate = z
  .object({
    kind: z.enum(CLOSURE_KINDS).default("closure"),
    scope: z.enum(["clinic", "practitioner", "chair"]),
    practitionerId: uuid.optional(),
    chairId: uuid.optional(),
    startDate: isoDate,
    startTime: hhmm,
    endDate: isoDate,
    endTime: hhmm,
    reason: trimmed(300).min(2, "Neden gerekli"),
  })
  .refine((v) => v.scope !== "practitioner" || !!v.practitionerId, { message: "Hekim seçin", path: ["practitionerId"] })
  .refine((v) => v.scope !== "chair" || !!v.chairId, { message: "Ünite seçin", path: ["chairId"] })
  .refine((v) => v.kind !== "public_holiday" || v.scope === "clinic", { message: "Resmî tatil tüm kliniği kapatır", path: ["scope"] })
  .refine((v) => (v.kind !== "sick_leave" && v.kind !== "leave") || v.scope === "practitioner", { message: "Rapor ve izin bir hekim için girilir", path: ["practitionerId"] });

/** 07.11.2026 (anamnez yerine): hasta kartında sağlık özeti. Sağlık verisidir; içerik yalnız sağlık yetkili rollere döner. */
const healthText = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(1000, "En fazla 1000 karakter").nullable().optional());
export const PatientHealthNotesInput = z.object({ chronicConditions: healthText, regularMedications: healthText, allergies: healthText });

// ---------------------------------------------------------------- hasta yakınları
export const RELATIONS = ["mother", "father", "legal_guardian", "spouse", "child", "sibling", "relative", "other"] as const;
export const RELATION_LABELS: Record<(typeof RELATIONS)[number], string> = {
  mother: "Anne", father: "Baba", legal_guardian: "Vasi / yasal temsilci", spouse: "Eş", child: "Çocuk",
  sibling: "Kardeş", relative: "Akraba", other: "Diğer",
};
export const RelationCreate = z
  .object({
    relatedPatientId: uuid.optional(),
    contactName: optionalText(120),
    contactPhone: optionalText(32),
    relation: z.enum(RELATIONS),
    isLegalRepresentative: z.boolean().optional(),
    representationEvidence: optionalText(300),
    canReceiveInfo: z.boolean().optional(),
    validUntil: z.preprocess((v) => (v === "" ? undefined : v), isoDate.optional()),
    note: optionalText(300),
  })
  .refine((v) => !!v.relatedPatientId || !!v.contactName, { message: "Kayıtlı hasta seçin veya kişi adı girin", path: ["contactName"] })
  .refine((v) => !v.isLegalRepresentative || !!v.representationEvidence, {
    message: "Yasal temsil için dayanak belge/açıklama gerekli", path: ["representationEvidence"],
  });
export const RelationEnd = z.object({ reason: trimmed(300).min(2, "Neden gerekli") });

// ---------------------------------------------------------------- anamnez
export const AnamnesisSave = z.object({
  basedOnVersion: z.number().int().min(0),
  answers: z.record(z.string(), z.object({ value: z.enum(["yes", "no", "unknown"]), detail: optionalText(500) })),
});

// ---------------------------------------------------------------- ekip
export const InvitationCreate = z.object({
  email: z.email("Geçerli bir e-posta girin").max(200),
  fullName: trimmed(120).min(2, "Ad soyad gerekli"),
  role: z.enum(["clinic_admin", "dentist", "secretary", "assistant", "finance"]),
});
export const InvitationAccept = z.object({ password: z.string().min(10, "Parola en az 10 karakter olmalı").max(200) });
export const RoleChange = z.object({ role: z.enum(["clinic_admin", "dentist", "secretary", "assistant", "finance"]) });

// ---------------------------------------------------------------- klinik not
export const ClinicalNoteCreate = z
  .object({
    body: z.string().trim().min(1, "Not boş olamaz").max(20000),
    correctsNoteId: uuid.optional(),
    correctionReason: optionalText(500),
    appointmentId: uuid.optional(),
  })
  .refine((v) => !v.correctsNoteId || !!v.correctionReason, {
    message: "Düzeltme nedeni gerekli",
    path: ["correctionReason"],
  });

// ---------------------------------------------------------------- görev
export const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const;
export const TaskUpdate = z
  .object({
    status: z.enum(["in_progress", "blocked", "done", "cancelled"]),
    closedReason: optionalText(300),
  })
  .refine((v) => !(v.status === "cancelled") || !!v.closedReason, {
    message: "İptal nedeni gerekli",
    path: ["closedReason"],
  });

export const MembershipRevoke = z.object({ reason: optionalText(300) });

// ---------------------------------------------------------------- hata sözleşmesi
export interface ApiError {
  code: string;
  message: string;
  field_errors?: Record<string, string>;
  correlation_id?: string;
  details?: unknown;
}

export function zodFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
