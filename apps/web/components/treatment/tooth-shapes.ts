/**
 * PİA-DENT diş çizimleri (ADR-103) — özgün vektör, anatomik oranlara göre sadeleştirilmiş. Tüm şekiller ÜST çene yönündedir
 * (kök yukarıda, taç aşağıda; görünüm kutusu 40×76, mine–sement sınırı y=42, oklüzal kenar y≈74). Alt çene dişleri aynı şekli
 * dikey çevirerek kullanır. Oklüzal (çiğneme yüzü) görünümler 40×40 kutudadır.
 */
import type { ToothKind } from "@viadent/contracts";

export interface BuccalShape { crown: string; roots: string[]; canals: string[] }

const CEJ = 42;

export const BUCCAL: Record<ToothKind, BuccalShape> = {
  central: {
    crown: "M9 42 C8 52 9 64 11 71 Q20 75 29 71 C31 64 32 52 31 42 Q20 39 9 42 Z",
    roots: ["M11 42 C12 28 16 10 20 4 C24 10 28 28 29 42 Z"],
    canals: ["M20 41 C20 30 20 18 20 9"],
  },
  lateral: {
    crown: "M11 42 C10 52 11 63 13 70 Q20 74 27 70 C29 63 30 52 29 42 Q20 39.5 11 42 Z",
    roots: ["M13 42 C14 28 17 12 20 6 C23 12 26 28 27 42 Z"],
    canals: ["M20 41 C20 30 20 19 20 11"],
  },
  canine: {
    crown: "M10 42 C9 52 11 62 15 68 L20 74.5 L25 68 C29 62 31 52 30 42 Q20 39 10 42 Z",
    roots: ["M12 42 C13 26 17 8 20 1 C23 8 27 26 28 42 Z"],
    canals: ["M20 41 C20 28 20 15 20 6"],
  },
  premolar: {
    crown: "M8 42 C7 52 8 62 11 68 L15 73.5 L20 69.5 L25 73.5 L29 68 C32 62 33 52 32 42 Q20 39 8 42 Z",
    roots: ["M12 42 C13 28 17 12 20 6 C23 12 27 28 28 42 Z"],
    canals: ["M20 41 C20 30 20 19 20 11"],
  },
  molar: {
    crown: "M4 42 C3 52 4 62 7 68 L11 73.5 L16 69.5 L20 73.5 L24 69.5 L29 73.5 L33 68 C36 62 37 52 36 42 Q20 38.5 4 42 Z",
    roots: [
      "M6 42 C5 30 6 18 9 8 C12 18 14 30 15 42 Z",
      "M25 42 C26 30 28 18 31 8 C34 18 35 30 34 42 Z",
    ],
    canals: ["M10.5 41 C10 32 9.6 22 9.3 13", "M29.5 41 C30 32 30.4 22 30.7 13"],
  },
};

/** Üst birinci küçük azı iki köklü, üst büyük azılar üç köklü (orta kök palatinal, arkada). */
const UPPER_PREMOLAR_4: BuccalShape = {
  ...BUCCAL.premolar,
  roots: ["M10 42 C10 30 12 16 15 8 C17 16 19 30 20 42 Z", "M20 42 C21 30 23 16 25 8 C28 16 30 30 30 42 Z"],
  canals: ["M15 41 C15 30 15 20 15 13", "M25 41 C25 30 25 20 25 13"],
};
const UPPER_MOLAR: BuccalShape = {
  ...BUCCAL.molar,
  roots: [
    "M15 42 C16 30 18 16 20 5 C22 16 24 30 25 42 Z",
    "M6 42 C5 30 6 18 9 8 C12 18 14 30 15 42 Z",
    "M25 42 C26 30 28 18 31 8 C34 18 35 30 34 42 Z",
  ],
  canals: ["M10.5 41 C10 32 9.6 22 9.3 13", "M20 41 C20 30 20 19 20 10", "M29.5 41 C30 32 30.4 22 30.7 13"],
};

export function buccalShape(tooth: string, kind: ToothKind): BuccalShape {
  const q = Number(tooth[0]); const n = Number(tooth[1]);
  const upper = q === 1 || q === 2 || q === 5 || q === 6;
  const permanent = q <= 4;
  if (upper && permanent && n === 4) return UPPER_PREMOLAR_4;
  if (upper && kind === "molar") return UPPER_MOLAR;
  return BUCCAL[kind];
}

export { CEJ };

/** Oklüzal görünüm dış hattı ve sınır kutusu (yüzey bölgeleri bu kutudan türetilir, hatla kırpılır). */
export const OCCLUSAL: Record<ToothKind, { outline: string; box: [number, number, number, number] }> = {
  central: { outline: "M7 15 Q7 11 12 10.5 L28 10.5 Q33 11 33 15 L33 24 Q33 30 20 30.5 Q7 30 7 24 Z", box: [7, 10.5, 33, 30.5] },
  lateral: { outline: "M9 15 Q9 11.5 13 11 L27 11 Q31 11.5 31 15 L31 24 Q31 29.5 20 30 Q9 29.5 9 24 Z", box: [9, 11, 31, 30] },
  canine: { outline: "M20 7 Q31 9 32 19 Q31 30 20 33 Q9 30 8 19 Q9 9 20 7 Z", box: [8, 7, 32, 33] },
  premolar: { outline: "M20 6 Q32 7 33 20 Q32 33 20 34 Q8 33 7 20 Q8 7 20 6 Z", box: [7, 6, 33, 34] },
  molar: { outline: "M10 4.5 Q20 3 30 4.5 Q36 5.5 36 12 L36 28 Q36 34.5 30 35.5 Q20 37 10 35.5 Q4 34.5 4 28 L4 12 Q4 5.5 10 4.5 Z", box: [4, 3.5, 36, 36.5] },
};

export type Region = "top" | "bottom" | "left" | "right" | "center";
export function occlusalRegions([x0, y0, x1, y1]: [number, number, number, number], ratio = 0.32): { r: Region; d: string }[] {
  const w = x1 - x0, h = y1 - y0;
  const ix0 = x0 + w * ratio, ix1 = x1 - w * ratio, iy0 = y0 + h * ratio, iy1 = y1 - h * ratio;
  return [
    { r: "top", d: `M${x0} ${y0} L${x1} ${y0} L${ix1} ${iy0} L${ix0} ${iy0} Z` },
    { r: "right", d: `M${x1} ${y0} L${x1} ${y1} L${ix1} ${iy1} L${ix1} ${iy0} Z` },
    { r: "bottom", d: `M${x1} ${y1} L${x0} ${y1} L${ix0} ${iy1} L${ix1} ${iy1} Z` },
    { r: "left", d: `M${x0} ${y1} L${x0} ${y0} L${ix0} ${iy0} L${ix0} ${iy1} Z` },
    { r: "center", d: `M${ix0} ${iy0} L${ix1} ${iy0} L${ix1} ${iy1} L${ix0} ${iy1} Z` },
  ];
}
