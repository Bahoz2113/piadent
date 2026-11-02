import { z } from "zod";
import { isMoney, toMinor } from "./money";

const positiveMoney = z.string().trim().refine(isMoney, "Tutar 1250.00 biçiminde olmalı (en çok 2 ondalık)").refine((v) => !isMoney(v) || toMinor(v) > 0n, "Tutar sıfırdan büyük olmalı");

/**
 * Fatura taslağı iç modeli (Faz 2.2, ADR-083). PİA-DENT fatura NUMARASI ÜRETMEZ: numara yalnız yetkili e-belge sağlayıcısının
 * yanıtıyla gelir. Sağlayıcı bağlı değilken taslak oluşturulur, düzenlenir, iptal edilir; "gönder" 409 döner (sahte başarı yok).
 */
export const INVOICE_DOC_TYPES = ["e_arsiv", "e_fatura", "e_smm"] as const;
export type InvoiceDocType = (typeof INVOICE_DOC_TYPES)[number];
export const INVOICE_DOC_TYPE_LABELS: Record<InvoiceDocType, string> = { e_arsiv: "e-Arşiv fatura", e_fatura: "e-Fatura", e_smm: "e-Serbest Meslek Makbuzu" };

export const INVOICE_STATUSES = ["draft", "pending_provider", "issued", "rejected", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Taslak", pending_provider: "Sağlayıcıda bekliyor", issued: "Düzenlendi (sağlayıcı)", rejected: "Sağlayıcı reddetti", cancelled: "İptal",
};

export const BUYER_TYPES = ["individual", "company"] as const;
export const BUYER_TYPE_LABELS: Record<(typeof BUYER_TYPES)[number], string> = { individual: "Şahıs", company: "Kurum / şirket" };

/** Türkiye'de sağlık hizmetleri için yaygın oranlar; klinik seçer, sistem vergi danışmanlığı yapmaz. */
export const VAT_RATES = [0, 1, 10, 20] as const;

export const InvoiceLineInput = z.object({
  description: z.string().trim().min(2).max(200),
  quantity: z.number().int().min(1).max(999),
  unitPrice: positiveMoney,
  vatRate: z.union([z.literal(0), z.literal(1), z.literal(10), z.literal(20)]),
  receivableId: z.string().uuid().optional(),
}).strict();

export const InvoiceCreate = z.object({
  patientId: z.string().uuid(),
  docType: z.enum(INVOICE_DOC_TYPES),
  buyerType: z.enum(BUYER_TYPES),
  buyerName: z.string().trim().min(2).max(160),
  /** Yalnız kurum: VKN 10 hane. Şahıs kimlik numarası hasta kartından alınır, faturada kopyalanmaz. */
  buyerTaxNo: z.string().regex(/^[0-9]{10}$/, "VKN 10 haneli olmalı").optional(),
  buyerTaxOffice: z.string().trim().max(80).optional(),
  buyerAddress: z.string().trim().max(400).optional(),
  buyerEmail: z.string().trim().email().max(160).optional(),
  note: z.string().trim().max(400).optional(),
  lines: z.array(InvoiceLineInput).min(1).max(50),
}).strict().superRefine((v, ctx) => {
  if (v.buyerType === "company" && !v.buyerTaxNo) ctx.addIssue({ code: "custom", path: ["buyerTaxNo"], message: "Kurum faturasında VKN zorunlu." });
  if (v.buyerType === "individual" && v.docType === "e_fatura") ctx.addIssue({ code: "custom", path: ["docType"], message: "Şahıs alıcıya e-Fatura kesilmez; e-Arşiv seçin." });
  if (v.buyerType === "company" && v.docType === "e_arsiv") ctx.addIssue({ code: "custom", path: ["docType"], message: "Kurum alıcıya e-Arşiv yerine e-Fatura seçin." });
});
export type InvoiceCreate = z.infer<typeof InvoiceCreate>;

export const InvoiceLinesReplace = z.object({ lines: z.array(InvoiceLineInput).min(1).max(50) }).strict();
export const InvoiceCancel = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
