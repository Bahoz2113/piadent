import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih gg.aa.yyyy biçiminde olmalı");
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
export const GENDERS = ["female", "male", "other", "unspecified"] as const;
export const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = {
  female: "Kadın", male: "Erkek", other: "Diğer", unspecified: "Belirtilmedi",
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

export const AppointmentCreate = z.object({
  patientId: uuid,
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

export const DayQuery = z.object({ date: isoDate.optional() });

// ---------------------------------------------------------------- klinik not
export const ClinicalNoteCreate = z
  .object({
    body: z.string().trim().min(1, "Not boş olamaz").max(20000),
    correctsNoteId: uuid.optional(),
    correctionReason: optionalText(500),
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
