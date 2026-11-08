import { z } from "zod";
import { isoDate } from "./zdate";
import { isMoney, toMinor } from "./money";

/**
 * ADR-109 (09.11.2026): POS entegrasyonu — Faz 0. Sağlayıcıdan bağımsız ödeme niyeti (PaymentIntent) çekirdeği.
 * Kart verisi tutulmaz: yalnız son 4 hane, onay (provizyon) kodu ve taksit sayısı.
 */
const uuid = z.uuid("Geçersiz kimlik");
const positiveMoney = z.string().trim().refine(isMoney, "Tutar 1250.00 biçiminde olmalı (en çok 2 ondalık)")
  .refine((v) => !isMoney(v) || toMinor(v) > 0n, "Tutar sıfırdan büyük olmalı");
const nonNegMoney = z.string().trim().refine(isMoney, "Tutar 1250.00 biçiminde olmalı (en çok 2 ondalık)");
const optText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());

export const POS_DRIVERS = ["manual", "mock"] as const;
export type PosDriver = (typeof POS_DRIVERS)[number];
export const POS_DRIVER_LABELS: Record<PosDriver, string> = {
  manual: "Banka POS'u · elle eşleştirme (tutar cihaza gönderilmez)",
  mock: "DENEME cihazı · tutarı cihaza gönderir (benzetim, gerçek çekim yok)",
};
/** Tutarı yazılımdan cihaza gönderebilen sürücüler. Gerçek sağlayıcılar (ÖKC/Android POS) ayrı fazda eklenir. */
export const POS_DEVICE_DRIVERS: readonly PosDriver[] = ["mock"];

export const POS_INTENT_STATUSES = ["created", "awaiting_card", "approved", "declined", "cancelled", "unknown"] as const;
export type PosIntentStatus = (typeof POS_INTENT_STATUSES)[number];
export const POS_INTENT_STATUS_LABELS: Record<PosIntentStatus, string> = {
  created: "Oluşturuldu",
  awaiting_card: "Cihazda kart bekleniyor",
  approved: "Onaylandı",
  declined: "Reddedildi",
  cancelled: "İptal edildi",
  unknown: "Sonuç bilinmiyor — POS fişini kontrol edin",
};
export const POS_OPEN_STATUSES: readonly PosIntentStatus[] = ["created", "awaiting_card", "unknown"];
export const POS_MODES = ["device", "manual"] as const;
export const POS_MODE_LABELS: Record<(typeof POS_MODES)[number], string> = { device: "Tutar cihaza gönderildi", manual: "Elle eşleştirildi" };
/** Cihazdan yanıt gelmezse niyet bu süreden sonra "sonuç bilinmiyor" olur (çift çekim yerine elle çözüm). */
export const POS_DEVICE_TIMEOUT_SECONDS = 180;
export const POS_MAX_INSTALLMENTS = 12;

const authCode = z.string().trim().regex(/^[A-Za-z0-9]{4,12}$/, "Onay kodu 4–12 harf/rakam olmalı (POS fişindeki provizyon/onay kodu)");
/** Yalnız son 4 hane. Daha uzun bir rakam dizisi (tam kart numarası) reddedilir ve hiçbir yerde saklanmaz. */
const cardLast4 = z.string().trim().regex(/^\d{4}$/, "Kartın yalnız son 4 hanesini girin");
const installments = z.coerce.number().int("Taksit tam sayı olmalı").min(1, "En az 1").max(POS_MAX_INSTALLMENTS, `En çok ${POS_MAX_INSTALLMENTS} taksit`);

const AllocationLine = z.object({ receivableId: uuid, amount: positiveMoney });

export const PosTerminalUpsert = z.object({
  name: z.string().trim().min(2, "Ad gerekli").max(80),
  driver: z.enum(POS_DRIVERS),
  cashAccountId: uuid,
  branchId: uuid.optional(),
  bankName: optText(80),
  terminalRef: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().regex(/^[A-Za-z0-9 ._-]{2,40}$/, "Terminal no 2–40 karakter (harf, rakam, boşluk . _ -)").optional()),
  active: z.boolean().optional(),
});

export const PosIntentCreate = z.object({
  terminalId: uuid,
  patientId: uuid,
  amount: positiveMoney,
  installments: installments.default(1),
  appointmentId: uuid.optional(),
  note: optText(300),
  allocations: z.array(AllocationLine).max(50).default([]),
  /** device: tutar cihaza gönderilir (yalnız cihaz sürücülü terminal). manual: çekim banka POS'unda yapıldı, sonuç elle eşleştirilir. */
  mode: z.enum(POS_MODES),
  authCode: authCode.optional(),
  cardLast4: cardLast4.optional(),
}).superRefine((v, ctx) => {
  if (v.mode === "manual") {
    if (!v.authCode) ctx.addIssue({ code: "custom", path: ["authCode"], message: "POS fişindeki onay kodunu girin" });
    if (!v.cardLast4) ctx.addIssue({ code: "custom", path: ["cardLast4"], message: "Kartın son 4 hanesini girin" });
  }
});

/** Sonucu belirsiz (ya da elle kapatılan) niyetin çözümü: fişte çekim var → onay; yok → reddedildi. */
export const PosIntentResolve = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("approved"), authCode, cardLast4, installments: installments.optional() }),
  z.object({ outcome: z.literal("declined"), reason: z.string().trim().min(3, "Gerekçe gerekli").max(300) }),
]);
export const PosIntentCancel = z.object({ reason: z.string().trim().min(3, "Gerekçe gerekli").max(300) });
/** Yalnız DENEME sürücüsü: cihazdaki kart okutma sonucunun benzetimi. */
export const PosIntentSimulate = z.object({ outcome: z.enum(["approved", "declined", "no_response"]) });

export const PosSettlementCreate = z.object({
  terminalId: uuid,
  date: isoDate,
  slipCount: z.coerce.number().int("Adet tam sayı olmalı").min(0).max(10000),
  slipTotal: nonNegMoney,
  note: optText(300),
});
