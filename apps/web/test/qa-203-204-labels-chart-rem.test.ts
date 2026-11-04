/**
 * QA-203 (S3): randevu (geriye dönük kayıt, planlanan işlem) ve standart katalog aktarımı (eklenen kodlar) denetim alanları Türkçe ve okunur.
 * QA-204 (S3): Panel grafik metinleri rem — yazı ölçeği ayarı (ADR-082) grafiklere de uygulanır; dar ekran büyütme oranı korunur,
 * ipucu kutusu kök yazı ölçeğiyle büyür.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditFieldLabel, auditValueLabel } from "@viadent/contracts";

describe("QA-203 yeni denetim alanları", () => {
  it("etiketler Türkçe", () => {
    expect(auditFieldLabel("backdated")).toBe("Geriye dönük kayıt");
    expect(auditFieldLabel("backdate_reason")).toBe("Geriye dönük kayıt gerekçesi");
    expect(auditFieldLabel("procedure_id")).toBe("Planlanan işlem");
    expect(auditFieldLabel("added")).toBe("Eklenen kodlar");
  });
  it("değerler okunur: evet/hayır, kod listesi, işlem adı ya da kısa kimlik", () => {
    expect(auditValueLabel("backdated", true)).toBe("Evet");
    expect(auditValueLabel("backdated", false)).toBe("Hayır");
    expect(auditValueLabel("backdate_reason", "Kağıt kayıttan aktarım")).toBe("Kağıt kayıttan aktarım");
    expect(auditValueLabel("added", ["RST-01", "DOL-01"])).toBe("RST-01, DOL-01");
    const id = "7d3f9a2c-5b1e-4c8a-9f0d-123456789abc";
    expect(auditValueLabel("procedure_id", id)).toBe("#7d3f9a2c");
    expect(auditValueLabel("procedure_id", id, { names: new Map([[id, "Kompozit dolgu"]]) })).toBe("Kompozit dolgu");
  });
});

describe("QA-204 grafik yazıları rem", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  it("masaüstü 11/11/12 px karşılığı rem", () => {
    expect(css).toMatch(/\.chart-axis text, \.chart-xlabel \{[^}]*font-size: 0\.6875rem;/);
    expect(css).toMatch(/\.chart-tip \.tip-label \{[^}]*font-size: 0\.6875rem;/);
    expect(css).toMatch(/\.chart-tip \.tip-value \{[^}]*font-size: 0\.75rem;/);
  });
  it("dar ekran büyütmesi (SVG viewBox telafisi) aynı oranla rem", () => {
    const mobile = css.slice(css.indexOf("/* Panel — dar ekran"), css.indexOf("/* Hekimler (ADR-096)"));
    expect(mobile).toMatch(/\.chart-axis text, \.chart-xlabel \{ font-size: 1\.1875rem; \}/);
    expect(mobile).toMatch(/\.chart-tip \.tip-label \{ font-size: 1\.125rem; \}/);
    expect(mobile).toMatch(/\.chart-tip \.tip-value \{ font-size: 1\.25rem; \}/);
  });
  it("ipucu kutusu ölçüsü kök yazı ölçeğini hesaba katar", () => {
    const src = readFileSync(new URL("../components/charts.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/const k = \(useNarrow\(\) \? 1\.7 : 1\) \* rootFontScale\(\);/);
    expect(src).toMatch(/getComputedStyle\(document\.documentElement\)\.fontSize/);
  });
});
