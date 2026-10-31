import { z } from "zod";
import { FINDING_TYPES, LOCATION_KINDS, SURFACES, TOOTH_SCOPES } from "./dental";
import { isMoney } from "./money";

const uuid = z.uuid("Geçersiz kimlik");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih gg.aa.yyyy biçiminde olmalı");
const money = z.string().trim().refine(isMoney, "Tutar 1250.00 biçiminde olmalı (en çok 2 ondalık)");
const opt = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());

/** API'nin döndürdüğü konum nesnesi (boş alanlar null) aynen geri gönderilebilir. */
const nullToUndef = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === null ? undefined : v), t);
export const DentalLocationInput = z.object({
  kind: z.enum(LOCATION_KINDS),
  tooth: nullToUndef(z.string().regex(/^[1-8][1-8]$/, "Geçersiz diş numarası (FDI)").optional()),
  surfaces: nullToUndef(z.array(z.enum(SURFACES)).max(5).optional()),
  quadrant: nullToUndef(z.number().int().min(1).max(4).optional()),
  arch: nullToUndef(z.enum(["upper", "lower"]).optional()),
});

export const ProcedureUpsert = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.-]{1,19}$/, "Kod 2–20 karakter: harf, rakam, nokta, tire"),
  name: z.string().trim().min(2).max(120),
  category: opt(60),
  toothScope: z.enum(TOOTH_SCOPES),
  defaultMinutes: z.number().int().min(5).max(720).optional(),
  active: z.boolean().optional(),
});

export const TariffCreate = z.object({
  name: z.string().trim().min(2).max(120),
  validFrom: isoDate,
  practitionerId: uuid.optional(),
  copyFromId: uuid.optional(),
});
export const TariffItemsSet = z.object({ items: z.array(z.object({ procedureId: uuid, price: money })).max(500) });

export const DiagnosisCreate = z.object({
  location: DentalLocationInput,
  code: opt(30),
  description: z.string().trim().min(2, "Açıklama gerekli").max(500),
  appointmentId: uuid.optional(),
});
export const ClinicalStatusChange = z.object({
  status: z.enum(["resolved", "entered_in_error", "historic"]),
  reason: z.string().trim().min(2, "Gerekçe gerekli").max(300),
});
export const FindingCreate = z.object({
  tooth: z.string().regex(/^[1-8][1-8]$/, "Geçersiz diş"),
  surfaces: z.array(z.enum(SURFACES)).max(5).default([]),
  findingType: z.enum(FINDING_TYPES),
  note: opt(300),
});

export const PlanCreate = z.object({ title: z.string().trim().min(2).max(120), practitionerId: uuid });
export const PlanItemInput = z
  .object({
    procedureId: uuid,
    location: DentalLocationInput,
    quantity: z.number().int().min(1).max(50).default(1),
    sessionNo: z.number().int().min(1).max(50).default(1),
    discount: money.optional(),
    discountReason: opt(200),
    manualPrice: money.optional(),
    priceNote: opt(200),
  })
  .refine((v) => !v.discount || Number(v.discount) === 0 || !!v.discountReason, { message: "İndirim gerekçesi gerekli", path: ["discountReason"] })
  .refine((v) => !v.manualPrice || !!v.priceNote, { message: "Elle fiyat için açıklama gerekli", path: ["priceNote"] });
export const PlanDecisionInput = z.object({ decision: z.enum(["accepted", "rejected", "undecided"]), note: opt(500) });
export const PlanCancelInput = z.object({ reason: z.string().trim().min(2, "Gerekçe gerekli").max(300) });

export const PerformInput = z
  .object({
    appointmentId: uuid,
    planItemId: uuid.optional(),
    procedureId: uuid.optional(),
    location: DentalLocationInput.optional(),
    quantity: z.number().int().min(1).max(50).default(1),
    note: opt(500),
  })
  .refine((v) => !!v.planItemId || (!!v.procedureId && !!v.location), { message: "Plan kalemi veya işlem + konum gerekli", path: ["planItemId"] });
export const PerformCancelInput = z.object({ reason: z.string().trim().min(2, "Gerekçe gerekli").max(300) });

export const PLAN_STATUS_LABELS: Record<string, string> = {
  draft: "Taslak", proposed: "Teklif sunuldu", accepted: "Kabul edildi", rejected: "Reddedildi", superseded: "Yeni sürümle değişti", cancelled: "İptal",
};
export const DECISION_LABELS: Record<string, string> = { accepted: "Kabul", rejected: "Ret", undecided: "Kararsız" };
