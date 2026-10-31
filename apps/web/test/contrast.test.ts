/** WCAG 2.2 kontrast kontrolü (W06): tasarım tokenlarından okunur; turuncu vurgu küçük beyaz metin zemini değildir. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const token = (name: string) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token yok: ${name}`);
  return m[1]!;
};
function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe("renk kontrastı", () => {
  const W = "#ffffff";
  const normal: [string, string, string][] = [
    ["text", "bg", "ana metin / zemin"], ["text", "surface", "ana metin / yüzey"], ["text-secondary", "surface", "ikincil metin / yüzey"],
    ["text-secondary", "bg", "ikincil metin / zemin"], ["text", "accent-surface", "vurgu kartı"],
    ["success", "success-bg", "başarı rozeti"], ["warning", "warning-bg", "uyarı rozeti"], ["error", "error-bg", "hata rozeti"], ["info", "info-bg", "bilgi rozeti"],
    ["brand-primary", "primary-tint", "birincil rozet"], ["brand-primary", "surface", "bağlantı"],
  ];
  for (const [fg, bg, label] of normal) {
    it(`${label} ≥ 4.5:1`, () => expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5));
  }
  it("birincil düğme ve sol menü beyaz metin ≥ 4.5:1", () => {
    expect(ratio(token("brand-primary"), W)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token("brand-deep"), W)).toBeGreaterThanOrEqual(4.5);
  });
  it("turuncu vurgu küçük beyaz metin için uygun değil (yalnız dekoratif kullanılır)", () => {
    expect(ratio(token("brand-accent"), W)).toBeLessThan(4.5);
    expect(css).not.toMatch(/background:\s*var\(--brand-accent\);[^}]*color:\s*#fff/);
  });
  it("odak rengi zemine karşı ≥ 3:1 (arayüz bileşeni)", () => {
    expect(ratio(token("focus"), token("bg"))).toBeGreaterThanOrEqual(3);
    expect(ratio(token("focus"), token("surface"))).toBeGreaterThanOrEqual(3);
  });
});
