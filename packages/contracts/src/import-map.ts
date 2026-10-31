/**
 * İçe aktarma başlık eşlemesi (Görev 12, ADR-069): API ve web aynı kuralı kullanır — açık eşleme takma adlardan önceliklidir,
 * bilinmeyen başlıklar raporlanır ve yok sayılır. Ayrıca dosyanın yalnız başlık satırını istemcide çıkarmak için yardımcı.
 */
import { normalizeSearch } from "./text";
import { IMPORT_FIELDS, type ImportKind } from "./pilot";

const norm = (s: string) => normalizeSearch(s).replace(/[\s_\-.]+/g, "_");

export function mapImportHeaders(kind: ImportKind, headers: string[], explicit: Record<string, string> = {}) {
  const fields = IMPORT_FIELDS[kind];
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  const ignored = new Set<string>();
  for (const h of headers) {
    const ex = explicit[h];
    if (ex === "") ignored.add(h); // açıkça "eşlenmiyor": takma ad eşleşse de yok sayılır
    else if (ex && fields.some((f) => f.key === ex) && !used.has(ex)) { mapping[h] = ex; used.add(ex); }
  }
  for (const h of headers) {
    if (mapping[h] || ignored.has(h)) continue;
    const n = norm(h);
    const f = fields.find((x) => !used.has(x.key) && (norm(x.key) === n || x.aliases.some((a) => norm(a) === n)));
    if (f) { mapping[h] = f.key; used.add(f.key); }
  }
  const unmapped = headers.filter((h) => !mapping[h]);
  const missing = fields.filter((f) => f.required && !used.has(f.key)).map((f) => f.key);
  return { mapping, unmapped, missing };
}

/** Yalnız başlık satırı: CSV'de ilk satır (“;” ya da “,”, tırnaklı başlık), JSON'da ilk nesnelerin anahtarları. Veri satırları okunmaz. */
export function extractImportHeaders(text: string, format: "csv" | "json"): string[] {
  const src = text.replace(/^﻿/, "");
  if (format === "json") {
    try {
      const v = JSON.parse(src) as unknown;
      const arr = Array.isArray(v) ? v : (v && typeof v === "object" && Array.isArray((v as { rows?: unknown }).rows)) ? (v as { rows: unknown[] }).rows : [];
      return [...new Set(arr.slice(0, 50).flatMap((o) => (o && typeof o === "object" ? Object.keys(o as object) : [])))];
    } catch { return []; }
  }
  const line = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (line.match(/;/g)?.length ?? 0) >= (line.match(/,/g)?.length ?? 0) ? ";" : ",";
  const out: string[] = []; let field = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
    else if (ch === '"' && field === "") q = true;
    else if (ch === delimiter) { out.push(field.trim()); field = ""; }
    else field += ch;
  }
  out.push(field.trim());
  return out;
}
