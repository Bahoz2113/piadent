/**
 * Diş modeli — FDI (ISO 3950) iki haneli numaralama. Bu, uluslararası standart numaralamadır;
 * çizim ve ekran PİA-DENT'e özgüdür. Yüzeyler: M (meziyal), D (distal), O (okluzal, arka dişler) /
 * I (insizal, ön dişler), B (bukkal/vestibül), L (lingual/palatinal).
 */
export const PERMANENT_TEETH: readonly string[] = [1, 2, 3, 4].flatMap((q) => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${q}${n}`));
export const PRIMARY_TEETH: readonly string[] = [5, 6, 7, 8].flatMap((q) => [1, 2, 3, 4, 5].map((n) => `${q}${n}`));
export const ALL_TEETH = new Set([...PERMANENT_TEETH, ...PRIMARY_TEETH]);

export const SURFACES = ["M", "D", "O", "I", "B", "L"] as const;
export type Surface = (typeof SURFACES)[number];
export const SURFACE_LABELS: Record<Surface, string> = {
  M: "Meziyal", D: "Distal", O: "Okluzal", I: "İnsizal", B: "Bukkal / vestibül", L: "Lingual / palatinal",
};

export function isPrimary(tooth: string): boolean { return /^[5-8][1-5]$/.test(tooth); }
/** Ön diş (kesici + kanin): ikinci hane 1–3. */
export function isAnterior(tooth: string): boolean { return /^[1-8][1-3]$/.test(tooth); }
export function quadrantOf(tooth: string): number { const q = Number(tooth[0]); return q > 4 ? q - 4 : q; }
export function archOf(tooth: string): "upper" | "lower" { const q = quadrantOf(tooth); return q <= 2 ? "upper" : "lower"; }

/** Dişe göre geçerli yüzeyler: ön dişte O yerine I. */
export function validSurfaces(tooth: string): Surface[] {
  return isAnterior(tooth) ? ["M", "D", "I", "B", "L"] : ["M", "D", "O", "B", "L"];
}

export const LOCATION_KINDS = ["tooth", "quadrant", "arch", "mouth"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];
export const TOOTH_SCOPES = ["tooth", "surface", "quadrant", "arch", "mouth"] as const;
export type ToothScope = (typeof TOOTH_SCOPES)[number];
export const TOOTH_SCOPE_LABELS: Record<ToothScope, string> = {
  tooth: "Diş", surface: "Diş + yüzey", quadrant: "Çeyrek çene", arch: "Çene (alt/üst)", mouth: "Tüm ağız",
};

export interface DentalLocation {
  kind: LocationKind;
  tooth?: string;
  surfaces?: Surface[];
  quadrant?: number;
  arch?: "upper" | "lower";
}

/** Konumun işlem kapsamına ve diş modeline uygunluğunu denetler; hata metni veya null döner. */
export function validateLocation(scope: ToothScope, loc: DentalLocation): string | null {
  const needKind: LocationKind = scope === "surface" ? "tooth" : scope;
  if (loc.kind !== needKind) return `Bu işlem için konum türü “${TOOTH_SCOPE_LABELS[scope]}” olmalı.`;
  if (loc.kind === "tooth") {
    if (!loc.tooth || !ALL_TEETH.has(loc.tooth)) return "Geçersiz diş numarası (FDI).";
    const s = loc.surfaces ?? [];
    if (scope === "surface" && s.length === 0) return "En az bir yüzey seçin.";
    if (scope === "tooth" && s.length > 0) return "Bu işlem yüzey almaz.";
    const ok = validSurfaces(loc.tooth);
    const bad = s.filter((x) => !ok.includes(x));
    if (bad.length) return `${loc.tooth} numaralı dişte geçersiz yüzey: ${bad.join(", ")}.`;
    if (new Set(s).size !== s.length) return "Aynı yüzey iki kez seçilmiş.";
  }
  if (loc.kind === "quadrant" && !(loc.quadrant && loc.quadrant >= 1 && loc.quadrant <= 4)) return "Çeyrek 1–4 olmalı.";
  if (loc.kind === "arch" && !["upper", "lower"].includes(loc.arch ?? "")) return "Çene alt veya üst olmalı.";
  return null;
}

export function locationLabel(loc: { kind: string; tooth?: string | null; surfaces?: string[] | null; quadrant?: number | null; arch?: string | null }): string {
  if (loc.kind === "tooth") return `Diş ${loc.tooth}${loc.surfaces?.length ? ` (${loc.surfaces.join("")})` : ""}`;
  if (loc.kind === "quadrant") return `${loc.quadrant}. çeyrek`;
  if (loc.kind === "arch") return loc.arch === "upper" ? "Üst çene" : "Alt çene";
  return "Tüm ağız";
}

/**
 * DEMO bulgu türleri (mevcut durum işaretleri). Klinik terminoloji ve kodlama klinisyenle
 * doğrulanacak; resmî kod sistemi iddiası yoktur.
 */
export const FINDING_TYPES = ["caries", "filling", "crown", "root_canal", "missing", "implant", "bridge_pontic", "fracture", "other"] as const;
export type FindingType = (typeof FINDING_TYPES)[number];
export const FINDING_LABELS: Record<FindingType, string> = {
  caries: "Çürük", filling: "Dolgu", crown: "Kron", root_canal: "Kanal tedavili", missing: "Eksik diş",
  implant: "İmplant", bridge_pontic: "Köprü gövdesi", fracture: "Kırık", other: "Diğer",
};
/** Odontogramda kısa sembol (renge ek olarak metin; yalnız renkle anlatılmaz). */
export const FINDING_SYMBOL: Record<FindingType, string> = {
  caries: "Ç", filling: "D", crown: "K", root_canal: "KT", missing: "×", implant: "İ", bridge_pontic: "KG", fracture: "F", other: "•",
};

/**
 * Odontogramda gerçekleşen işlemin dişe yansıması (ADR-103). Önce PİA-DENT standart kodu (procedures-standard.ts), kliniğin
 * kendi işlemleri için ad anahtar kelimesi. Görsel işarettir; klinik kayıt yerine geçmez. Eşleşmeyen işlem yalnız dişin
 * işlem geçmişinde görünür.
 */
export const TOOTH_EFFECTS = ["filling", "extraction", "root_canal", "crown", "implant", "veneer", "sealant", "inlay", "post"] as const;
export type ToothEffect = (typeof TOOTH_EFFECTS)[number];
export const TOOTH_EFFECT_LABELS: Record<ToothEffect, string> = {
  filling: "Dolgu", extraction: "Çekildi", root_canal: "Kanal tedavisi", crown: "Kron", implant: "İmplant",
  veneer: "Laminate / veneer", sealant: "Fissür örtücü", inlay: "İnley / onley", post: "Post / kor",
};

const EFFECT_BY_CODE: Record<string, ToothEffect[]> = {
  "DOL-01": ["filling"], "DOL-02": ["filling"], "DOL-03": ["filling"], "DOL-04": ["filling"], "DOL-05": ["filling"], "PED-01": ["filling"],
  "INL-01": ["inlay"],
  "KAN-01": ["root_canal"], "KAN-02": ["root_canal"], "KAN-03": ["root_canal"], "KAN-04": ["root_canal"], "PED-02": ["root_canal"],
  "CEK-01": ["extraction"], "CEK-02": ["extraction"], "CEK-03": ["extraction"],
  "IMP-01": ["implant"], "IMP-02": ["implant", "crown"],
  "KRN-01": ["crown"], "KRN-02": ["crown"], "KRN-03": ["crown"],
  "LAM-01": ["veneer"], "PST-01": ["post"], "FSR-01": ["sealant"],
};
/** Standart listede dişe iz bırakmayan kodlar (röntgen, anestezi, kuafaj, greft…): ad eşlemesine düşmez. */
const NO_EFFECT_CODES = new Set(["RAD-01", "ANS-01", "KAN-05", "CER-01", "IMP-03", "PED-03"]);

export function procedureToothEffects(code: string | null | undefined, name: string | null | undefined): ToothEffect[] {
  const c = (code ?? "").trim().toUpperCase();
  if (EFFECT_BY_CODE[c]) return EFFECT_BY_CODE[c]!;
  if (NO_EFFECT_CODES.has(c)) return [];
  const n = (name ?? "").toLocaleLowerCase("tr-TR");
  if (/çekim|çekildi|ekstraksiyon/.test(n)) return ["extraction"];
  if (/implant/.test(n)) return /kron|kuron|üstü/.test(n) ? ["implant", "crown"] : ["implant"];
  if (/kanal/.test(n)) return ["root_canal"];
  if (/inley|onley|inlay|onlay/.test(n)) return ["inlay"];
  if (/laminat|veneer|lamina/.test(n)) return ["veneer"];
  if (/fissür/.test(n)) return ["sealant"];
  if (/kron|kuron|köprü/.test(n)) return ["crown"];
  if (/\bpost\b|\bkor\b/.test(n)) return ["post"];
  if (/dolgu|restorasyon/.test(n)) return ["filling"];
  return [];
}

/** Diş türü (FDI ikinci hane): çizim şekli için. */
export type ToothKind = "central" | "lateral" | "canine" | "premolar" | "molar";
export function toothKind(tooth: string): ToothKind {
  const n = Number(tooth[1]);
  if (isPrimary(tooth)) return n === 1 ? "central" : n === 2 ? "lateral" : n === 3 ? "canine" : "molar";
  return n === 1 ? "central" : n === 2 ? "lateral" : n === 3 ? "canine" : n <= 5 ? "premolar" : "molar";
}
export const TOOTH_KIND_LABELS: Record<ToothKind, string> = {
  central: "orta kesici", lateral: "yan kesici", canine: "köpek dişi", premolar: "küçük azı", molar: "büyük azı",
};
