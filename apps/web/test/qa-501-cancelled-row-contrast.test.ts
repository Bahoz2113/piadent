/**
 * CEZERİ qa-20261108-1900-959f7ef QA-501: Panel "Bugünün randevuları" listesinde iptal satırı opaklıkla soluklaştırılınca
 * ikincil metin (hekim · ünite · açıklama) tüm palet × şema birleşimlerinde 4.5:1'in altına düşüyordu (axe color-contrast).
 * Kural: iptal satırı üstü çizili metin + "İptal" durum rozetiyle ayırt edilir; opaklık/filtre gibi kontrastı düşüren yöntem yok.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/(app)/bugun/page.tsx", import.meta.url), "utf8");
const rules = (needle: string) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1]!.includes(needle)).map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));

describe("QA-501: iptal edilen randevu satırı kontrastı korur", () => {
  it("iptal satırı üstü çizili", () => {
    const r = rules(".today-row.is-cancelled");
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((x) => /text-decoration:\s*line-through/.test(x.body))).toBe(true);
  });
  it("günün randevuları satırlarında metni soluklaştıran opaklık, filtre veya renk karışımı yok", () => {
    for (const x of rules(".today-")) {
      expect(x.body, x.sel).not.toMatch(/(^|;|\s)opacity\s*:/);
      expect(x.body, x.sel).not.toMatch(/filter\s*:/);
      expect(x.body, x.sel).not.toMatch(/color-mix\(/);
    }
  });
  it("iptal satırı durum rozetini (İptal) gösterir; ikincil metin tokenlı .muted sınıfıyla", () => {
    expect(panel).toMatch(/a\.status === "cancelled" \? "is-cancelled" : ""/);
    expect(panel).toMatch(/<StatusBadge status=\{a\.status\} \/>/);
    expect(panel).toMatch(/className="today-main">[\s\S]*?className="muted small"/);
  });
});
