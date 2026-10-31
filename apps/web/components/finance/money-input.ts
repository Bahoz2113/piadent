import { isMoney, toMinor, fromMinor } from "@viadent/contracts";

/** Kullanıcı girişi: "1.250,50" / "1250,5" / "1250.50" → "1250.50". Geçersizse null. */
export function parseMoneyInput(raw: string): string | null {
  let v = raw.replace(/\s|₺|TL/gi, "");
  if (!v) return null;
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  if (!isMoney(v)) return null;
  return fromMinor(toMinor(v));
}
export const minor = (v: string) => toMinor(v);
export const money = (m: bigint) => fromMinor(m);
