/**
 * Kesin para aritmetiği: tutarlar API'de "1250.00" biçiminde metin, hesapta kuruş cinsinden bigint.
 * JavaScript kayan noktasıyla para toplanmaz (Plan §06).
 */
const RE = /^-?\d{1,12}(\.\d{1,2})?$/;

export function isMoney(v: string): boolean { return RE.test(v); }

export function toMinor(v: string): bigint {
  if (!RE.test(v)) throw new Error(`Geçersiz tutar: ${v}`);
  const neg = v.startsWith("-");
  const [i, f = ""] = (neg ? v.slice(1) : v).split(".");
  const minor = BigInt(i!) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -minor : minor;
}

export function fromMinor(m: bigint): string {
  const neg = m < 0n;
  const a = neg ? -m : m;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
}

export function addMoney(...vals: string[]): string { return fromMinor(vals.reduce((s, v) => s + toMinor(v), 0n)); }
export function mulMoney(v: string, qty: number): string {
  if (!Number.isInteger(qty) || qty < 0) throw new Error("Adet tam sayı olmalı");
  return fromMinor(toMinor(v) * BigInt(qty));
}

/** Görüntüleme: "1250.00" → "1.250,00 ₺" (tr-TR). Hesap için kullanılmaz. */
export function formatTRY(v: string | null | undefined, currency = "TRY"): string {
  if (v === null || v === undefined) return "—";
  const m = toMinor(v);
  const neg = m < 0n;
  const a = neg ? -m : m;
  const int = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sym = currency === "TRY" ? " ₺" : ` ${currency}`;
  return `${neg ? "-" : ""}${int},${String(a % 100n).padStart(2, "0")}${sym}`;
}

/** KDV: tutar × oran / 100, kuruşa yarım-yukarı yuvarlanır (bigint; kayan nokta yok). Oran tam sayı yüzde (0, 1, 10, 20). */
export function vatOf(amount: string, ratePercent: number): string {
  if (!Number.isInteger(ratePercent) || ratePercent < 0 || ratePercent > 100) throw new Error("KDV oranı 0–100 tam sayı olmalı");
  const m = toMinor(amount) * BigInt(ratePercent);
  const q = m / 100n; const r = m % 100n;
  return fromMinor(q + (r >= 50n ? 1n : 0n));
}
