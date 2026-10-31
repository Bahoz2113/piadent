/**
 * İçe aktarma ayrıştırıcıları: CSV (“;” veya “,”, tırnak, CRLF, BOM), JSON dizi; Türkçe tarih ve tutar biçimleri.
 * Belirsiz değer tahmin edilmez: “1.250” gibi binlik/ondalık ayrımı belirsiz tutar hatadır.
 */
import { mapImportHeaders, normalizeSearch } from "@viadent/contracts";

/** Geriye uyumlu ad: eşleme mantığı contracts paketine taşındı (web'de de kullanılır, ADR-069). */
export const mapHeaders = mapImportHeaders;

export interface Parsed { headers: string[]; rows: Record<string, string>[]; delimiter?: string }

export function parseCsv(text: string): Parsed {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const records: string[][] = [];
  let field = "", rec: string[] = [], q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"' && field === "") q = true;
    else if (ch === delimiter) { rec.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      rec.push(field); field = "";
      if (rec.some((x) => x.trim() !== "")) records.push(rec);
      rec = [];
    } else field += ch;
  }
  if (q) throw new Error("Kapanmamış tırnak işareti var (CSV bozuk).");
  rec.push(field);
  if (rec.some((x) => x.trim() !== "")) records.push(rec);
  const [head, ...body] = records;
  if (!head) return { headers: [], rows: [], delimiter };
  const headers = head.map((h) => h.trim());
  return { headers, delimiter, rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}

export function parseJson(text: string): Parsed {
  const v = JSON.parse(text.replace(/^﻿/, "")) as unknown;
  const arr = Array.isArray(v) ? v : (v && typeof v === "object" && Array.isArray((v as { rows?: unknown }).rows)) ? (v as { rows: unknown[] }).rows : null;
  if (!arr) throw new Error("JSON bir dizi (veya rows dizisi olan nesne) olmalı.");
  const headers = [...new Set(arr.flatMap((o) => (o && typeof o === "object" ? Object.keys(o as object) : [])))];
  return { headers, rows: arr.map((o) => Object.fromEntries(headers.map((h) => {
    const x = (o as Record<string, unknown>)?.[h];
    return [h, x === null || x === undefined ? "" : String(x).trim()];
  }))) };
}

/** gg.aa.yyyy, g.a.yyyy, gg/aa/yyyy veya yyyy-aa-gg → ISO; geçersiz takvim tarihi null. */
export function parseDate(v: string): string | null {
  const s = v.trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (mt) { d = +mt[1]!; m = +mt[2]!; y = +mt[3]!; }
  else if ((mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { y = +mt[1]!; m = +mt[2]!; d = +mt[3]!; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Tutar: “1250,50”, “1250.50”, “1.250,50”, “1,250.50”, “₺1.250,50”, “1250”. İki ayırıcı varsa sondaki ondalıktır.
 * Yalnız nokta ve tam 3 haneli gruplar (“1.250”) belirsizdir → hata. En çok 2 ondalık; sonuç “1250.50”.
 */
export function parseMoney(v: string): { value: string | null; error?: string } {
  let s = v.replace(/\s|₺|TL|TRY/gi, "");
  if (!s) return { value: null, error: "Tutar boş" };
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const th = dec === "." ? "," : ".";
    s = s.split(th).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    if (!/^\d+(,\d{1,2})?$/.test(s)) return { value: null, error: "Tutar biçimi geçersiz" };
    s = s.replace(",", ".");
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    return { value: null, error: "Belirsiz tutar (binlik mi ondalık mı?): 1250,00 veya 1.250,00 yazın" };
  }
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return { value: null, error: "Tutar biçimi geçersiz (en çok 2 ondalık)" };
  const [i, f = ""] = s.split(".");
  const out = `${neg ? "-" : ""}${String(Number(i))}.${(f + "00").slice(0, 2)}`;
  return { value: out };
}

export function parseGender(v: string): "female" | "male" | "unspecified" | null | "invalid" {
  const n = normalizeSearch(v);
  if (!n) return null;
  if (["k", "kadin", "kiz", "f", "female", "woman"].includes(n)) return "female";
  if (["e", "erkek", "m", "male", "man"].includes(n)) return "male";
  if (["belirtilmemis", "diger", "bilinmiyor", "unspecified", "other"].includes(n)) return "unspecified";
  return "invalid";
}
