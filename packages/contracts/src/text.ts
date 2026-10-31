/** Türkçe-farkında arama normalizasyonu: "Şükrü IŞIK" → "sukru isik". */
const MAP: Record<string, string> = {
  ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", I: "i", İ: "i", i: "i", ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u",
  â: "a", Â: "a", î: "i", Î: "i", û: "u", Û: "u",
};

export function normalizeSearch(input: string): string {
  return input
    .replace(/[çÇğĞıIİiöÖşŞüÜâÂîÎûÛ]/g, (ch) => MAP[ch] ?? ch)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Türkçe başlık biçimi: "ayşe nur" → "Ayşe Nur" (İ/ı kuralına uyar). */
export function toTitleTr(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1).toLocaleLowerCase("tr-TR") : w))
    .join(" ");
}

/** Telefonu yalnız rakamlara indirger; TR yerel biçimi (05xx / 5xx) +90 ile E.164'e çevrilir. */
export function normalizePhone(raw: string, defaultCountry = "90"): { e164: string; digits: string } | null {
  let d = raw.replace(/\D+/g, "");
  if (!d) return null;
  if (raw.trim().startsWith("+")) {
    // uluslararası biçim
  } else if (d.startsWith("00")) {
    d = d.slice(2);
  } else if (defaultCountry === "90" && d.length === 11 && d.startsWith("0")) {
    d = "90" + d.slice(1);
  } else if (defaultCountry === "90" && d.length === 10 && d.startsWith("5")) {
    d = "90" + d;
  }
  if (d.length < 8 || d.length > 15) return null;
  return { e164: "+" + d, digits: d };
}

export function maskPhone(e164: string | null): string | null {
  if (!e164) return null;
  const tail = e164.slice(-2);
  return e164.slice(0, Math.min(4, e164.length - 2)) + " *** ** " + tail;
}

export function maskNationalId(id: string | null): string | null {
  if (!id) return null;
  return "•".repeat(Math.max(0, id.length - 4)) + id.slice(-4);
}

/** TCKN algoritmik doğrulaması (resmî kimlik doğrulaması DEĞİLDİR; yalnız biçim kontrolü). */
export function isValidTckn(v: string): boolean {
  if (!/^[1-9]\d{10}$/.test(v)) return false;
  const n = v.split("").map(Number);
  const odd = n[0]! + n[2]! + n[4]! + n[6]! + n[8]!;
  const even = n[1]! + n[3]! + n[5]! + n[7]!;
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = n.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d10 === n[9] && d11 === n[10];
}
