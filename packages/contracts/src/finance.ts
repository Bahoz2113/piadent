import { z } from "zod";
import { isoDate } from "./zdate";
import { isMoney, toMinor } from "./money";

const uuid = z.uuid("Geçersiz kimlik");
const positiveMoney = z.string().trim().refine(isMoney, "Tutar 1250.00 biçiminde olmalı (en çok 2 ondalık)")
  .refine((v) => !isMoney(v) || toMinor(v) > 0n, "Tutar sıfırdan büyük olmalı");
const optText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());

/** İlk kapsam yalnız TRY. Çoklu para birimi veri modelinde hazır ama davranış kapalı (ADR-028). */
export const CURRENCIES = ["TRY"] as const;
export const PAYMENT_METHODS = ["cash", "card_manual", "bank_transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Görüntüleme etiketi: kullanıcı girişindeki yöntemler + sağlayıcı kaynaklı "online" (yalnız VİA Köprü yazar). */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod | "online", string> = {
  online: "Online (MOCK sağlayıcı)",
  cash: "Nakit",
  card_manual: "Kart (manuel kayıt · POS bağlantısı yok)",
  bank_transfer: "Havale / EFT",
  other: "Diğer",
};
export const CASH_ACCOUNT_KINDS = ["cash", "bank", "pos_manual"] as const;
export const CASH_ACCOUNT_KIND_LABELS: Record<(typeof CASH_ACCOUNT_KINDS)[number], string> = {
  cash: "Kasa (nakit)", bank: "Banka hesabı", pos_manual: "POS (manuel kayıt)",
};

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

const AllocationLine = z.object({ receivableId: uuid, amount: positiveMoney });

export const PaymentCreate = z.object({
  patientId: uuid,
  amount: positiveMoney,
  currency: z.enum(CURRENCIES).default("TRY"),
  method: z.enum(PAYMENT_METHODS),
  cashAccountId: uuid,
  paidAt: z.iso.datetime({ offset: true }).optional(),
  note: optText(300),
  /** Dağıtım açıkça verilir; verilmeyen kısım avans olarak kalır (ödeme borçla otomatik karışmaz). */
  allocations: z.array(AllocationLine).max(50).default([]),
});
export const AllocateInput = z.object({ allocations: z.array(AllocationLine).min(1).max(50) });
export const ReverseAllocationInput = z.object({ reason: z.string().trim().min(3, "Gerekçe gerekli").max(300) });
export const RefundCreate = z.object({
  amount: positiveMoney,
  method: z.enum(PAYMENT_METHODS),
  cashAccountId: uuid,
  reason: z.string().trim().min(3, "İade gerekçesi gerekli").max(300),
});
export const ReceivableCreate = z.object({
  patientId: uuid,
  description: z.string().trim().min(2, "Açıklama gerekli").max(200),
  amount: positiveMoney,
  currency: z.enum(CURRENCIES).default("TRY"),
  practitionerId: uuid.optional(),
  dueDate: isoDate.optional(),
});
export const ReceivableCancel = z.object({ reason: z.string().trim().min(3, "Gerekçe gerekli").max(300) });
export const ExpenseCreate = z.object({
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().min(2).max(200),
  amount: positiveMoney,
  cashAccountId: uuid,
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
export const CashAccountUpsert = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(CASH_ACCOUNT_KINDS),
  active: z.boolean().optional(),
});
export const COMMISSION_BASES = ["collection", "treatment"] as const;
export const COMMISSION_BASIS_LABELS: Record<(typeof COMMISSION_BASES)[number], string> = {
  collection: "Tahsilat dağıtımı bazlı", treatment: "Tedavi (gerçekleşen işlem) bazlı",
};
export const CommissionRuleCreate = z.object({
  practitionerId: uuid.optional(),
  basis: z.enum(COMMISSION_BASES).default("collection"),
  rate: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Oran yüzde olarak, örn. 10 veya 12.5")
    .refine((v) => Number(v) >= 0 && Number(v) <= 100, "Oran 0–100 arası olmalı"),
  validFrom: isoDate,
  note: optText(200),
});

export const EXPENSE_CATEGORIES = ["Kira", "Personel", "Malzeme", "Laboratuvar", "Fatura (elektrik/su/internet)", "Vergi/harç", "Diğer"] as const;

/** Yüzde oranla prim: kuruşa yuvarlama (yarım yukarı), işaret korunur. Örn. 600.00 × %10 = 60.00; −100.00 → −10.00. */
export function commissionAmount(base: string, rate: string): string {
  const b = toMinor(base);
  const [ri, rf = ""] = rate.split(".");
  const r100 = BigInt(ri!) * 100n + BigInt((rf + "00").slice(0, 2)); // oran × 100
  const raw = b * r100;                    // kuruş × oran × 100 → /10000 = kuruş
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const q = (abs + 5000n) / 10000n;
  const m = neg ? -q : q;
  const sign = m < 0n ? "-" : "";
  const a = m < 0n ? -m : m;
  return `${sign}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
}
