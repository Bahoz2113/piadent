/**
 * QA-002: VİA İz (hasta geçmişi) ekranında her denetim eylemi Türkçe etiketlidir.
 * API kaynağındaki `audit(c, ctx, { action: "..." })` çağrıları ve dinamik eylem türevleri
 * `AUDIT_ACTION_LABELS` (packages/contracts) içinde kapsanır; bilinmeyen kod okunur geri dönüş alır.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTION_LABELS, LAB_ACTIONS, auditActionLabel } from "@viadent/contracts";

const API_SRC = new URL("../../api/src/", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function actionsInSource(): Set<string> {
  const found = new Set<string>();
  for (const file of walk(API_SRC)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/action: "([a-z_.]+)"/g)) found.add(m[1]!);
    for (const m of src.matchAll(/action: [^"\n]*\? "([a-z_.]+)" : "([a-z_.]+)"/g)) { found.add(m[1]!); found.add(m[2]!); }
    for (const m of src.matchAll(/auditSelf\(req, "([a-z_.]+)"\)/g)) found.add(m[1]!);
    for (const line of src.split("\n")) {
      if (!/insert into audit_events/.test(line)) continue;
      for (const m of line.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) found.add(m[1]!);
    }
  }
  // Şablon dizgisiyle üretilen eylemler (`lab_order.${action}`, `stock.${kind}`, `document.${decision}`).
  for (const a of LAB_ACTIONS) found.add(`lab_order.${a}`);
  for (const k of ["receipt", "usage", "adjustment", "waste", "return", "reverse"]) found.add(`stock.${k}`);
  for (const d of ["accepted", "declined"]) found.add(`document.${d}`);
  return found;
}

describe("QA-002 denetim eylemi etiketleri", () => {
  it("API kaynağındaki her audit eylemi Türkçe etiketli", () => {
    const actions = actionsInSource();
    expect(actions.size).toBeGreaterThan(100);
    const missing = [...actions].filter((a) => !AUDIT_ACTION_LABELS[a]).sort();
    expect(missing).toEqual([]);
  });

  it("teslim testinde ham görülen eylemler etiketli", () => {
    for (const a of ["receivable.create", "payment.create", "allocation.create", "procedure.complete", "procedure.correct", "payment.refund", "file.upload", "finding.create", "diagnosis.create"]) {
      expect(auditActionLabel(a)).not.toContain(a);
      expect(auditActionLabel(a)).toMatch(/[ığüşöçİĞÜŞÖÇa-zA-Z]/);
    }
  });

  it("etiketler ham kod ya da boş değil", () => {
    for (const [code, label] of Object.entries(AUDIT_ACTION_LABELS)) {
      expect(label.trim().length).toBeGreaterThan(3);
      expect(label).not.toBe(code);
      expect(label).not.toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("bilinmeyen eylem için okunur geri dönüş", () => {
    expect(auditActionLabel("gelecek.eylem")).toBe("Diğer işlem (gelecek.eylem)");
  });
});
