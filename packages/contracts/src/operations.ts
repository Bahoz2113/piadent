/**
 * Görev 6 — Operasyon: tedarikçi/cari, laboratuvar iş emri, prim ödemesi, stok.
 * Tutarlar metin ("1250.00"), miktarlar en çok 3 ondalık metin ("2.5"); kayan nokta yok.
 */
import { z } from "zod";
import { isoDate } from "./zdate";
import { isMoney, toMinor } from "./money";
import { ALL_TEETH } from "./dental";

const uuid = z.uuid("Geçersiz kimlik");
const positiveMoney = z.string().trim().refine(isMoney, "Tutar 1250.00 biçiminde olmalı (en çok 2 ondalık)")
  .refine((v) => !isMoney(v) || toMinor(v) > 0n, "Tutar sıfırdan büyük olmalı");
const optText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());
const reason = z.string().trim().min(3, "Gerekçe gerekli").max(300);
export const QTY_RE = /^\d{1,9}(\.\d{1,3})?$/;
export const positiveQty = z.string().trim().regex(QTY_RE, "Miktar 2 veya 2.5 biçiminde olmalı (en çok 3 ondalık)")
  .refine((v) => Number(v) > 0, "Miktar sıfırdan büyük olmalı");
const nonNegQty = z.string().trim().regex(QTY_RE, "Miktar 0 veya üzeri olmalı (en çok 3 ondalık)");

// ------------------------------------------------------------------ tedarikçi / cari
export const SUPPLIER_KINDS = ["lab", "medical", "other"] as const;
export type SupplierKind = (typeof SUPPLIER_KINDS)[number];
export const SUPPLIER_KIND_LABELS: Record<SupplierKind, string> = { lab: "Laboratuvar", medical: "Medikal firma", other: "Diğer tedarikçi" };
export const SupplierUpsert = z.object({
  kind: z.enum(SUPPLIER_KINDS),
  name: z.string().trim().min(2, "Ad gerekli").max(120),
  contactName: optText(120),
  phone: optText(30),
  email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.email("Geçerli e-posta girin").max(200).optional()),
  taxNo: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().regex(/^[0-9]{10,11}$/, "Vergi/TC no 10–11 hane").optional()),
  note: optText(500),
  active: z.boolean().optional(),
});
export const SupplierBillCreate = z.object({
  supplierId: uuid, amount: positiveMoney, description: z.string().trim().min(2).max(200), documentNo: optText(60),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
export const SupplierPaymentCreate = z.object({
  supplierId: uuid, amount: positiveMoney, cashAccountId: uuid, description: z.string().trim().min(2).max(200).default("Tedarikçi ödemesi"),
  documentNo: optText(60), occurredAt: z.iso.datetime({ offset: true }).optional(),
});
export const ReverseInput = z.object({ reason });

// ------------------------------------------------------------------ laboratuvar (Plan §06 durumları)
export const LAB_STATUSES = ["draft", "sent", "in_production", "received", "revision", "accepted", "cancelled"] as const;
export type LabStatus = (typeof LAB_STATUSES)[number];
export const LAB_STATUS_LABELS: Record<LabStatus, string> = {
  draft: "Taslak", sent: "Laboratuvara gönderildi", in_production: "Üretimde", received: "Klinikte teslim alındı (kabul bekliyor)",
  revision: "Revizyonda", accepted: "Kabul edildi", cancelled: "İptal",
};
export const LAB_ACTIONS = ["send", "in_production", "receive", "accept", "revision", "cancel"] as const;
export type LabAction = (typeof LAB_ACTIONS)[number];
/** Eylem → hedef durum ve izin verilen kaynak durumlar (DB tetikleyicisiyle aynı makine). */
export const LAB_TRANSITIONS: Record<LabAction, { to: LabStatus; from: LabStatus[] }> = {
  send: { to: "sent", from: ["draft"] },
  in_production: { to: "in_production", from: ["sent", "revision"] },
  receive: { to: "received", from: ["sent", "in_production", "revision"] },
  accept: { to: "accepted", from: ["received"] },
  revision: { to: "revision", from: ["received"] },
  cancel: { to: "cancelled", from: ["draft", "sent", "in_production", "revision"] },
};
export const LAB_ACTION_LABELS: Record<LabAction, string> = {
  send: "Laboratuvara gönder", in_production: "Üretimde olarak işaretle", receive: "Teslim alındı", accept: "Kabul et",
  revision: "Revizyona gönder", cancel: "İptal et",
};
const teeth = z.array(z.string().refine((t) => ALL_TEETH.has(t), "Geçersiz diş numarası (FDI)")).max(32).default([]);
export const LabOrderCreate = z.object({
  patientId: uuid,
  practitionerId: uuid.optional(),
  supplierId: uuid,
  workType: z.string().trim().min(2, "İş tanımı gerekli").max(120),
  teeth,
  shade: optText(30),
  instructions: optText(1000),
  targetDate: isoDate.optional(),
  planItemId: uuid.optional(),
  appointmentId: uuid.optional(),
});
export const LabOrderUpdate = z.object({
  expectedVersion: z.number().int().positive(),
  supplierId: uuid.optional(),
  workType: z.string().trim().min(2).max(120).optional(),
  teeth: teeth.optional(),
  shade: optText(30),
  instructions: optText(1000),
  targetDate: isoDate.optional(),
  appointmentId: uuid.nullable().optional(),
});
export const LabTransition = z.object({
  action: z.enum(LAB_ACTIONS),
  note: optText(500),
  targetDate: isoDate.optional(),
});
export const LAB_COST_STAGES = ["initial", "revision", "extra"] as const;
export const LAB_COST_STAGE_LABELS: Record<(typeof LAB_COST_STAGES)[number], string> = { initial: "İlk iş", revision: "Revizyon", extra: "Ek iş / malzeme" };
export const LabCostCreate = z.object({ stage: z.enum(LAB_COST_STAGES), amount: positiveMoney, description: z.string().trim().min(2).max(200) });

// ------------------------------------------------------------------ prim ödemesi
export const CommissionPayoutCreate = z.object({
  practitionerId: uuid, amount: positiveMoney, cashAccountId: uuid,
  periodFrom: isoDate.optional(), periodTo: isoDate.optional(), note: optText(300),
  paidAt: z.iso.datetime({ offset: true }).optional(),
});

// ------------------------------------------------------------------ stok
export const STOCK_UNITS = ["adet", "kutu", "paket", "ml", "g", "set", "kartus"] as const;
export const STOCK_UNIT_LABELS: Record<(typeof STOCK_UNITS)[number], string> = {
  adet: "adet", kutu: "kutu", paket: "paket", ml: "ml", g: "g", set: "set", kartus: "kartuş",
};
export const STOCK_MOVEMENT_KINDS = ["receipt", "usage", "waste", "adjustment", "return"] as const;
export const STOCK_MOVEMENT_LABELS: Record<(typeof STOCK_MOVEMENT_KINDS)[number], string> = {
  receipt: "Giriş", usage: "Kullanım", waste: "Fire / imha", adjustment: "Sayım düzeltmesi", return: "Tedarikçiye iade",
};
export const StockItemUpsert = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9._-]{2,30}$/, "Kod 2–30 karakter (harf, rakam, . _ -)"),
  name: z.string().trim().min(2).max(120),
  unit: z.enum(STOCK_UNITS),
  category: optText(60),
  trackLots: z.boolean().default(false),
  minLevel: nonNegQty.default("0"),
  active: z.boolean().optional(),
});
export const StockReceipt = z.object({
  itemId: uuid, quantity: positiveQty,
  lotNo: optText(60), expiryDate: isoDate.optional(),
  unitCost: positiveMoney.optional(), supplierId: uuid.optional(),
  /** Birim maliyet ve tedarikçi verilirse cari borç (fatura) aynı transaction'da oluşur. */
  createBill: z.boolean().default(false), documentNo: optText(60),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
export const StockUsage = z.object({
  itemId: uuid, lotId: uuid.optional(), quantity: positiveQty,
  patientId: uuid.optional(), performedProcedureId: uuid.optional(), reason: optText(300),
});
export const StockWaste = z.object({ itemId: uuid, lotId: uuid.optional(), quantity: positiveQty, kind: z.enum(["waste", "return"]).default("waste"), reason });
/** Sayım: sayılan miktar girilir; fark sistem tarafından düzeltme hareketi olarak yazılır (miktar ezilmez). */
export const StockCount = z.object({ itemId: uuid, lotId: uuid.optional(), countedQuantity: nonNegQty, reason });
