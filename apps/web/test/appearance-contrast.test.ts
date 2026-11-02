/**
 * Görünüm katmanları (ADR-082): her vurgu paleti × her şema WCAG 2.2 AA — metin 4.5:1, odak/arayüz 3:1.
 * CSS'teki değerler @viadent/contracts ACCENT_DEFS ile birebir (tek kaynak), ölçek yalnız rem (px yazı boyutu kalmadı).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENTS, ACCENT_DEFS, SCALE_PERCENT, SCHEMES } from "@viadent/contracts";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
function block(selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${esc}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`blok yok: ${selector}`);
  return Object.fromEntries([...m[1]!.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((x) => [x[1]!, x[2]!.trim()]));
}
const root = block(":root");
const dim = block('html[data-scheme="dim"]'); const dark = block('html[data-scheme="dark"]');
function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe("şema yüzey/metin kontrastı (loş, koyu)", () => {
  for (const [name, s] of [["loş", dim], ["koyu", dark]] as const) {
    it(`${name}: metin, ikincil metin, rozetler, odak`, () => {
      expect(ratio(s.text!, s.bg!)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(s.text!, s.surface!)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(s["text-secondary"]!, s.surface!)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(s["text-secondary"]!, s.bg!)).toBeGreaterThanOrEqual(4.5);
      for (const k of ["success", "warning", "error", "info"]) {
        expect(ratio(s[k]!, s[`${k}-bg`]!), `${k} rozeti`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(s[`${k}-text`]!, s[`${k}-bg`]!), `${k} uyarı metni`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(s.focus!, s.bg!)).toBeGreaterThanOrEqual(3);
      expect(ratio(s.focus!, s.surface!)).toBeGreaterThanOrEqual(3);
    });
  }
  it("açık şema uyarı metinleri", () => {
    for (const k of ["success", "warning", "error", "info"]) expect(ratio(root[`${k}-text`]!, root[`${k}-bg`]!), k).toBeGreaterThanOrEqual(4.5);
  });
});

describe("vurgu paletleri × şema", () => {
  for (const accent of ACCENTS) {
    const def = ACCENT_DEFS[accent];
    it(`${def.label}: açık şema — birincil/yüzey, beyaz metin/birincil, rozet, vurgu kartı`, () => {
      const L = def.light;
      expect(ratio(L.primary, root.surface!)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(L.primary, root.bg!)).toBeGreaterThanOrEqual(4.5);
      expect(ratio("#ffffff", L.primary), "birincil düğme beyaz metin").toBeGreaterThanOrEqual(4.5);
      expect(ratio("#ffffff", L.deep), "sol menü beyaz metin").toBeGreaterThanOrEqual(4.5);
      expect(ratio(L.primary, L.tint), "birincil rozet").toBeGreaterThanOrEqual(4.5);
      expect(ratio(root.text!, L.accentSurface), "vurgu kartı metni").toBeGreaterThanOrEqual(4.5);
    });
    for (const [name, s] of [["loş", dim], ["koyu", dark]] as const) {
      it(`${def.label}: ${name} şema — birincil/yüzey, koyu metin/birincil, rozet, vurgu kartı`, () => {
        const D = def.dark;
        expect(ratio(D.primary, s.surface!)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(D.primary, s.bg!)).toBeGreaterThanOrEqual(4.5);
        expect(ratio("#0f1613", D.primary), "birincil düğme koyu metin (--on-primary)").toBeGreaterThanOrEqual(4.5);
        expect(ratio("#ffffff", D.deep), "sol menü beyaz metin").toBeGreaterThanOrEqual(4.5);
        expect(ratio(D.primary, D.tint), "birincil rozet").toBeGreaterThanOrEqual(4.5);
        expect(ratio(s.text!, D.accentSurface), "vurgu kartı metni").toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`${def.label}: CSS katmanı contracts ile aynı`, () => {
      const l = block(`html[data-accent="${accent}"]`);
      expect(l["brand-primary"]).toBe(def.light.primary); expect(l["brand-deep"]).toBe(def.light.deep); expect(l["brand-accent"]).toBe(def.light.accent);
      const d = block(`html[data-accent="${accent}"][data-scheme="dim"], html[data-accent="${accent}"][data-scheme="dark"]`);
      expect(d["brand-primary"]).toBe(def.dark.primary); expect(d["brand-deep"]).toBe(def.dark.deep); expect(d["on-primary"]).toBe("#0f1613");
    });
  }
  it("varsayılan palet (yeşil, açık) :root ile aynı — görünüm ayarı yokken değişiklik yok", () => {
    expect(root["brand-primary"]).toBe(ACCENT_DEFS.yesil.light.primary);
    expect(root["brand-accent"]).toBe(ACCENT_DEFS.yesil.light.accent);
  });
});

describe("yazı ölçeği", () => {
  it("globals.css'te px yazı boyutu kalmadı (rem); ölçek katmanları contracts ile aynı", () => {
    expect(css).not.toMatch(/font-size:\s*[0-9.]+px/);
    for (const s of [1, 2, 4, 5] as const) expect(css).toContain(`html[data-scale="${s}"] { font-size: ${SCALE_PERCENT[s]}%; }`);
    expect(SCHEMES).toContain("system");
  });
});
