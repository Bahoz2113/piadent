/**
 * QA-401 (qa-20261107-1245-bbba373): dişin güncel sorunu (çekildi/eksik, çürük, kırık) erişilebilir adda ve
 * ipucu/Özet rozetlerinde tedavi işaretlerinden önce gelir; tedavi işaretleri mevcut göreli sırasıyla sonra.
 * Yalnız sıra kuralı; içerik değişmez.
 */
import { describe, expect, it } from "vitest";
import { visualLabels, type ToothVisual } from "../components/treatment/tooth-model";

const base: ToothVisual = {
  missing: false, extracted: false, implant: false, pontic: false, crown: false, rootCanal: false, post: false,
  veneer: false, inlay: false, sealant: false, fillWhole: false, filled: [], cariesWhole: false, caries: [], fracture: false,
};
const v = (o: Partial<ToothVisual>): ToothVisual => ({ ...base, ...o });

describe("QA-401 visualLabels sırası: bulgu önce, tedavi sonra", () => {
  it("kanal + çürük olan dişte ilk etiket Çürük (gorev2 diş 16 senaryosu)", () => {
    const l = visualLabels(v({ rootCanal: true, cariesWhole: true }));
    expect(l[0]).toBe("Çürük");
    expect(l).toEqual(["Çürük", "Kanal tedavisi"]);
  });

  it("yüzeyli çürük dolgudan önce", () => {
    expect(visualLabels(v({ filled: ["O"], caries: ["D"] }))).toEqual(["Çürük (D)", "Dolgu (O)"]);
  });

  it("kırık tedavi işaretlerinden önce, çürükten sonra", () => {
    expect(visualLabels(v({ crown: true, fracture: true, caries: ["M"] }))).toEqual(["Çürük (M)", "Kırık", "Kron"]);
  });

  it("tam sıra: eksik → çürük → kırık → implant … dolgu", () => {
    const all = v({
      missing: true, implant: true, pontic: true, crown: true, rootCanal: true, post: true, veneer: true,
      inlay: true, sealant: true, filled: ["O"], caries: ["D"], fracture: true,
    });
    expect(visualLabels(all)).toEqual([
      "Eksik diş", "Çürük (D)", "Kırık", "İmplant", "Köprü gövdesi", "Kron", "Kanal tedavisi", "Post / kor",
      "Laminate / veneer", "İnley / onley", "Fissür örtücü", "Dolgu (O)",
    ]);
    expect(visualLabels(v({ extracted: true, missing: true, cariesWhole: true }))[0]).toBe("Çekildi");
  });
});
