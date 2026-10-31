/**
 * QA-003: PİA İz "değişen alanlar" satırlarında alan adı ve değer Türkçe/okunur; iç liste öğeleri grid'e düşmez.
 * Alan anahtarları API kaynağından türetilir: `audit(..., { changes: { k: ... } })` nesnelerinin üst düzey anahtarları,
 * `diff(before, next, [...])` sütun listeleri ve dinamik `changes[k] = ...` döngülerinin kaynak nesneleri.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AKIS_DEFAULTS, AUDIT_FIELD_LABELS, auditFieldLabel, auditValueLabel } from "@viadent/contracts";

const API_SRC = new URL("../../api/src/", import.meta.url).pathname;
const CSS = new URL("../app/globals.css", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** `changes: {` sonrası küme parantezi dengeli okunur; yalnız en dış düzeydeki `anahtar:` çiftleri alınır. */
function literalKeys(src: string, out: Set<string>) {
  let i = 0;
  while ((i = src.indexOf("changes: {", i)) >= 0) {
    const start = i + "changes: ".length;
    let depth = 0, end = start;
    for (; end < src.length; end++) {
      if (src[end] === "{") depth++;
      else if (src[end] === "}" && --depth === 0) break;
    }
    const body = src.slice(start + 1, end);
    let d = 0, top = "";
    for (const ch of body) { if (ch === "{" || ch === "(" || ch === "[") d++; else if (ch === "}" || ch === ")" || ch === "]") d--; if (d === 0) top += ch; }
    for (const m of top.matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) out.add(m[1]!);
    i = end;
  }
}

function fieldsInSource(): Set<string> {
  const found = new Set<string>();
  for (const file of walk(API_SRC)) {
    const src = readFileSync(file, "utf8");
    literalKeys(src, found);
    // Koşullu spread / üçlü ifade içindeki anahtarlar: `...(x ? { key: { from: ... } } : {})` — audit değişiklik şekli `key: { from:` tektir.
    for (const m of src.matchAll(/([A-Za-z_][A-Za-z0-9_]*): \{ from:/g)) found.add(m[1]!);
    // diff(before, next, ["a", "b", ...]) sütun listeleri
    for (const m of src.matchAll(/diff\([^,]+,\s*[^,]+,\s*\[([^\]]*)\]/g)) for (const k of m[1]!.matchAll(/"([a-z_0-9]+)"/g)) found.add(k[1]!);
    // Nesneden türetilen değişiklikler: `const next = { a: ..., b: ... }` + `changes[k] = ...`
    if (/changes\[k\] = /.test(src)) {
      for (const m of src.matchAll(/const next = \{([\s\S]*?)\};/g)) for (const k of m[1]!.matchAll(/(?:^|[,{]\s*|\n\s*)([a-z_]+):/g)) found.add(k[1]!);
    }
  }
  // PİA Akış ayarları: `changes[k]` döngüsü AkisSettings anahtarları üzerinden
  for (const k of Object.keys(AKIS_DEFAULTS)) found.add(k);
  return found;
}

describe("QA-003 değişen alan etiketleri", () => {
  it("API kaynağındaki her changes anahtarı Türkçe etiketli", () => {
    const fields = fieldsInSource();
    expect(fields.size).toBeGreaterThan(60);
    for (const f of ["amount", "method", "source", "payment_id", "receivable_id", "procedure", "corrects_id", "tooth", "status", "reason", "outside_working_hours", "corrects_note_id", "lot_id", "first_name", "contact_name"]) expect(fields.has(f)).toBe(true);
    const missing = [...fields].filter((f) => !AUDIT_FIELD_LABELS[f]).sort();
    expect(missing).toEqual([]);
  });

  it("etiketler ham anahtar değil, Türkçe karakter/boşluk içeren okunur metin", () => {
    for (const [k, label] of Object.entries(AUDIT_FIELD_LABELS)) {
      expect(label.trim().length).toBeGreaterThan(1);
      expect(label).not.toBe(k);
      expect(label).not.toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("türetilmiş anahtarlar (amaç:kanal, document:<id>) çözülür", () => {
    expect(auditFieldLabel("appointment_reminder:sms")).toBe("Randevu hatırlatma · SMS");
    expect(auditFieldLabel("document:0f5c2b6e-1111-4222-8333-444455556666")).toBe("Hazırlık belgesi");
    expect(auditFieldLabel("anamnesis")).toBe("Anamnez");
  });

  it("teslim testinde ham görülen değerler çevrilir", () => {
    expect(auditValueLabel("amount", "1000.00")).toBe("1.000,00 ₺");
    expect(auditValueLabel("amount", "-250.50")).toBe("-250,50 ₺");
    expect(auditValueLabel("method", "cash")).toBe("Nakit");
    expect(auditValueLabel("method", "online")).toMatch(/Online/);
    expect(auditValueLabel("source", "manual")).toBe("Elle");
    expect(auditValueLabel("source", "performed_procedure")).toBe("Gerçekleşen işlemden");
    expect(auditValueLabel("source", "in_person")).toBe("Yüz yüze");
    expect(auditValueLabel("status", "cancelled", { entityType: "appointment" })).not.toBe("cancelled");
    expect(auditValueLabel("status", "sent", { entityType: "lab_order" })).toBe("Laboratuvara gönderildi");
    expect(auditValueLabel("status", "ended", { entityType: "patient_relation" })).toBe("Sonlandırıldı");
    expect(auditValueLabel("appointment_reminder:sms", "granted")).toBe("İzin verildi");
    expect(auditValueLabel("kind", "cash")).toBe("Kasa (nakit)");
    expect(auditValueLabel("role", "secretary")).not.toBe("secretary");
    expect(auditValueLabel("is_legal_representative", true)).toBe("Evet");
    expect(auditValueLabel("tooth", "36")).toBe("36");
    expect(auditValueLabel("procedure", "RST-01")).toBe("RST-01");
    expect(auditValueLabel("amount", null)).toBe("Belirtilmedi");
  });

  it("kimlik alanları 'Kayıt' yerine ad ya da kısa kimlik gösterir", () => {
    const id = "7d3f9a2c-5b1e-4c8a-9f0d-123456789abc";
    expect(auditValueLabel("payment_id", id)).toBe("#7d3f9a2c");
    expect(auditValueLabel("receivable_id", id)).toBe("#7d3f9a2c");
    expect(auditValueLabel("corrects_id", id)).toBe("#7d3f9a2c");
    expect(auditValueLabel("practitioner_id", id, { names: new Map([[id, "Dt. Ayşe Kaya"]]) })).toBe("Dt. Ayşe Kaya");
    expect(auditValueLabel("payment_id", id)).not.toBe("Kayıt");
  });

  it("tarih/saat alanları klinik biçimleyiciyi kullanır", () => {
    expect(auditValueLabel("starts_at", "2026-10-31T09:00:00.000Z", { formatDateTime: () => "31.10.2026 12:00" })).toBe("31.10.2026 12:00");
    expect(auditValueLabel("birth_date", "1990-05-01", { formatDate: () => "01.05.1990" })).toBe("01.05.1990");
  });

  it("globals.css: grid seçicisi yalnız üst düzey olay satırını hedefler", () => {
    const css = readFileSync(CSS, "utf8");
    const gridRule = css.split("\n").find((l) => /\.timeline\s*>?\s*li\s*\{[^}]*display:\s*grid/.test(l));
    expect(gridRule).toBeDefined();
    expect(gridRule).toMatch(/\.timeline\s*>\s*li/);
    expect(css).toMatch(/\.timeline \.change li \{[^}]*display: (list-item|block)/);
  });
});
