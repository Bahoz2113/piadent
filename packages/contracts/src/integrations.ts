import { z } from "zod";
import { isMoney, toMinor } from "./money";

const uuid = z.uuid("Geçersiz kimlik");
const positiveMoney = z.string().trim().refine(isMoney, "Tutar 1250.00 biçiminde olmalı").refine((v) => !isMoney(v) || toMinor(v) > 0n, "Tutar sıfırdan büyük olmalı");

export const INTEGRATION_KINDS = ["sms", "whatsapp", "email", "payment", "e_invoice", "health_registry", "signature"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
export const INTEGRATION_KIND_LABELS: Record<IntegrationKind, string> = {
  sms: "SMS", whatsapp: "WhatsApp", email: "E-posta", payment: "Online ödeme", e_invoice: "e-Fatura / e-Arşiv / e-SMM",
  health_registry: "Sağlık Bakanlığı (DHBS / e-Nabız)", signature: "Belge doğrulama / imza",
};
/**
 * Sağlayıcı durumu kataloğu (dürüst rapor). MOCK dışında doğrulanmış adaptör yoktur; her biri için üretime geçiş kanıtı Plan §08'dedir.
 */
export const PROVIDER_READINESS: Record<IntegrationKind, { mock: boolean; waitingFor: string }> = {
  sms: { mock: true, waitingFor: "Sağlayıcı seçimi, sözleşme, test hesabı, teslim webhook dokümanı; iletişim izni değerlendirmesi" },
  payment: { mock: true, waitingFor: "Ödeme kuruluşu sözleşmesi, sandbox erişimi, callback imza dokümanı; kart verisi VİADENT'te tutulmaz" },
  whatsapp: { mock: false, waitingFor: "Resmî WhatsApp Business Platform erişimi (QR oturumu resmî API değildir), şablon onayı" },
  email: { mock: false, waitingFor: "E-posta sağlayıcısı ve alan adı doğrulaması (SPF/DKIM)" },
  e_invoice: { mock: false, waitingFor: "Yetkili GİB entegratörü sözleşmesi, test belgesi, iptal/itiraz senaryosu ve mali müşavir onayı" },
  health_registry: { mock: false, waitingFor: "Sağlık Bakanlığı DHBS/SBYS güncel kapsam teyidi, kayıt/tescil, test ortamı ve veri seti eşlemesi" },
  signature: { mock: false, waitingFor: "Yöntemin klinik/hukuki uygunluk değerlendirmesi ve sağlayıcı seçimi (ADR-033)" },
};

export const OPERATION_LABELS: Record<string, string> = { "sms.send": "SMS gönderimi", "payment.create_link": "Ödeme bağlantısı", "payment.refund": "Sağlayıcı üzerinden iade" };
export const TRANSPORT_LABELS: Record<string, string> = {
  held: "Onay bekliyor", queued: "Sırada", sending: "Gönderiliyor", accepted: "Sağlayıcı kabul etti", rejected: "Sağlayıcı reddetti",
  unknown: "Sonuç bilinmiyor (durum sorgulanacak)", dead: "Başarısız (deneme sınırı)", cancelled: "İptal",
};
export const OUTCOME_LABELS: Record<string, string> = {
  pending: "Nihai sonuç bekleniyor", succeeded: "Tamamlandı", failed: "Başarısız", unknown: "Bilinmiyor", not_applicable: "—",
};
export const ONLINE_PAYMENT_STATUS_LABELS: Record<string, string> = {
  created: "Bağlantı hazırlanıyor", link_ready: "Bağlantı hazır (ödeme bekleniyor)", paid: "Ödendi (sağlayıcı bildirdi)", failed: "Başarısız",
  expired: "Süresi doldu", cancelled: "İptal",
};

export const OnlinePaymentCreate = z.object({ amount: positiveMoney, description: z.string().trim().min(2).max(120).default("Diş tedavisi ödemesi") });
export const ProviderRefundCreate = z.object({ amount: positiveMoney, reason: z.string().trim().min(3, "İade gerekçesi gerekli").max(300) });
export const JobReject = z.object({ reason: z.string().trim().min(3, "Gerekçe gerekli").max(300) });
export const MockConnectionCreate = z.object({ kind: z.enum(["sms", "payment"]) });
export const ConnectionUpdate = z.object({
  status: z.enum(["active", "disabled"]).optional(),
  mockBehavior: z.enum(["accept", "reject", "timeout", "unavailable"]).optional(),
  mockQueryResult: z.enum(["accepted", "not_found"]).optional(),
});
export const MOCK_EVENTS = ["message.delivered", "message.failed", "payment.succeeded", "payment.failed", "refund.succeeded", "refund.failed"] as const;
export const MockSimulate = z.object({
  jobId: uuid,
  event: z.enum(MOCK_EVENTS),
  amount: positiveMoney.optional(),
  /** Ters sıra / çift olay denemeleri için olay kimliği ve zamanı verilebilir. */
  eventId: z.string().regex(/^[A-Za-z0-9_-]{6,80}$/).optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
