/**
 * ADR-109: POS sürücü arabirimi (Faz 0). Ürün kodu cihaza/sağlayıcıya bu arabirim üzerinden konuşur; gerçek sürücüler
 * (Token TokenX Connect, Pavo, GMP-3 yerel ajan…) sağlayıcı sözleşmesi + test cihazı geldiğinde eklenir.
 *
 * Gerçek sürücü kuralı: cihaz çağrısı DB transaction'ı içinde beklenmez — gönderim outbox/yerel ajan üzerinden, sonuç
 * webhook/yoklama ile gelir; yanıt gelmezse niyet "sonuç bilinmiyor" olur ve fişe bakılarak elle çözülür (çift çekim yok).
 * Faz 0'daki iki sürücü dış sisteme hiç bağlanmaz:
 *  - manual: bağımsız banka POS'u. Tutar cihaza gönderilmez; çekim cihazda yapılır, onay kodu + son 4 hane elle girilir.
 *  - mock:   DENEME cihazı. Tutarı "gönderir" ve kart okutma sonucunu kullanıcı benzetir. Gerçek çekim yapmaz.
 */
import type { PosDriver } from "@viadent/contracts";

export interface PosSendResult { providerRef: string }
export interface PosDriverImpl {
  readonly id: PosDriver;
  /** Tutarı yazılımdan cihaza gönderebilir mi? */
  readonly sendsAmount: boolean;
  /** Cihaza tutarı gönder (yalnız sendsAmount). */
  send(intent: { intentNo: number; amount: string; installments: number }): Promise<PosSendResult>;
  /** Cihazdaki bekleyen işlemi iptal et (en iyi çaba; sonucu bilinmiyorsa niyet "sonuç bilinmiyor"a düşer). */
  cancel(intent: { providerRef: string | null }): Promise<void>;
  /** Kart okutma sonucunun benzetimi — yalnız DENEME sürücüsü. */
  readonly simulates: boolean;
}

const manual: PosDriverImpl = {
  id: "manual", sendsAmount: false, simulates: false,
  async send() { throw new Error("manual sürücü tutar göndermez"); },
  async cancel() { /* cihaz bağlantısı yok */ },
};

const mock: PosDriverImpl = {
  id: "mock", sendsAmount: true, simulates: true,
  async send(i) { return { providerRef: `DENEME-${String(i.intentNo).padStart(6, "0")}` }; },
  async cancel() { /* benzetim: bekleyen işlem cihazdan düşer */ },
};

const DRIVERS: Record<PosDriver, PosDriverImpl> = { manual, mock };
export function posDriver(id: PosDriver): PosDriverImpl { return DRIVERS[id]; }
