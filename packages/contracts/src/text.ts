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

/** Yurt içi telefon hane kuralı: 0 ile yazılırsa 11, 0 olmadan 10 hane (ör. 0555 123 45 67 / 555 123 45 67). Yurt dışı: + veya 00 ile, 8–15 hane. */
export const PHONE_RULE_MESSAGE = "Telefon 0 ile başlıyorsa 11, 0 olmadan 10 hane olmalı (ör. 0555 123 45 67). Yurt dışı numarayı + ile yazın.";
function isInternational(raw: string): boolean {
  const t = raw.trim();
  return t.startsWith("+") || t.replace(/\D+/g, "").startsWith("00");
}
/** Yazarken sınır: yurt içi numarada 0'lı 11, 0'sız 10 haneden fazlası eklenmez; yalnız rakam, boşluk, +, -, ( ) kabul edilir. */
export function limitPhoneInput(raw: string): string {
  const cleaned = raw.replace(/[^\d+\-() ]/g, "").replace(/(?!^)\+/g, "");
  const max = isInternational(cleaned) ? 17 : cleaned.replace(/\D+/g, "").startsWith("0") ? 11 : 10;
  let n = 0, out = "";
  for (const ch of cleaned) {
    if (/\d/.test(ch)) { if (n >= max) continue; n++; }
    out += ch;
  }
  return out;
}

/** Telefonu yalnız rakamlara indirger; TR yerel biçimi (0'lı 11 / 0'sız 10 hane) +90 ile E.164'e çevrilir. Kurala uymayan yurt içi numara null döner. */
export function normalizePhone(raw: string, defaultCountry = "90"): { e164: string; digits: string } | null {
  let d = raw.replace(/\D+/g, "");
  if (!d) return null;
  if (raw.trim().startsWith("+")) {
    // uluslararası biçim
  } else if (d.startsWith("00")) {
    d = d.slice(2);
  } else if (defaultCountry === "90") {
    if (d.startsWith("0")) { if (d.length !== 11) return null; d = "90" + d.slice(1); }
    else { if (d.length !== 10) return null; d = "90" + d; }
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

/** Görüntüleme: +905551234567 → "+90 555 123 45 67"; diğer ülkeler olduğu gibi. */
export function formatPhone(e164: string | null): string | null {
  if (!e164) return null;
  const m = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+90 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}
