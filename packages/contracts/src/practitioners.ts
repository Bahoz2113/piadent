/**
 * Hekimler modülü (ADR-096): ücret modeli sürümleri ve maaş ödemeleri. Tutarlar metin ("45000.00"); kayan nokta yok.
 * Bordro, SGK ve stopaj hesabı PİA-DENT kapsamı dışındadır — burada yalnız klinik içi hakediş ve kasadan çıkış izlenir.
 */
import { z } from "zod";
import { isoDate } from "./zdate";
import { isMoney, toMinor } from "./money";

const uuid = z.uuid("Geçersiz kimlik");
const optText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());
const positiveMoney = z.string().trim().refine(isMoney, "Tutar 45000.00 biçiminde olmalı (en çok 2 ondalık)")
  .refine((v) => !isMoney(v) || toMinor(v) > 0n, "Tutar sıfırdan büyük olmalı");

export const PAY_MODELS = ["commission", "salary", "salary_commission"] as const;
export type PayModel = (typeof PAY_MODELS)[number];
export const PAY_MODEL_LABELS: Record<PayModel, string> = {
  commission: "Yalnız prim", salary: "Sabit maaş", salary_commission: "Maaş + prim",
};

export const CompensationCreate = z.object({
  payModel: z.enum(PAY_MODELS),
  monthlySalary: z.preprocess((v) => (v === "" || v === null ? undefined : v), positiveMoney.optional()),
  validFrom: isoDate,
  note: optText(300),
}).superRefine((v, ctx) => {
  if (v.payModel !== "commission" && !v.monthlySalary) ctx.addIssue({ code: "custom", path: ["monthlySalary"], message: "Aylık maaş tutarını girin." });
  if (v.payModel === "commission" && v.monthlySalary) ctx.addIssue({ code: "custom", path: ["monthlySalary"], message: "Yalnız prim modelinde maaş tutarı girilmez." });
});

/** Dönem "YYYY-MM" (ay); ödeme o ayın maaş hakedişini aşamaz. */
export const SalaryPaymentCreate = z.object({
  practitionerId: uuid,
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Dönem YYYY-AA biçiminde olmalı"),
  amount: positiveMoney,
  cashAccountId: uuid,
  paidAt: z.iso.datetime({ offset: true }).optional(),
  note: optText(300),
});
