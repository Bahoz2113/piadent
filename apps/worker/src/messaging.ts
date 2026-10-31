/**
 * Mesaj sağlayıcı portu. Gerçek SMS/WhatsApp/e-posta sağlayıcısı (sözleşme + test erişimi) Görev 5'te eklenecek.
 * MockMessagingAdapter: HİÇBİR mesaj dışarı gönderilmez. İsteği "kabul eder" ve sahte bir sağlayıcı kimliği döner;
 * teslim bildirimi ÜRETMEZ — böylece arayüz "teslim edildi" göremez, süre aşımında durum "bilinmiyor" olur (AT-12).
 */
import { randomUUID } from "node:crypto";

export interface MessagingPort {
  readonly name: string;
  submit(m: { channel: string; to: string; body: string; idempotencyKey: string }): Promise<{ accepted: true; providerMessageId: string } | { accepted: false; error: string }>;
}

export class MockMessagingAdapter implements MessagingPort {
  readonly name = "MOCK (gerçek gönderim yok)";
  async submit(m: { channel: string; to: string; body: string; idempotencyKey: string }) {
    if (process.env.MOCK_MESSAGING_MODE === "reject") return { accepted: false as const, error: "MOCK: sağlayıcı reddetti" };
    void m;
    return { accepted: true as const, providerMessageId: `mock-${randomUUID()}` };
  }
}
