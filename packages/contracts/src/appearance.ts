import { z } from "zod";

/**
 * Görünüm tercihleri (Faz 4.7, ADR-082): kullanıcı düzeyinde; marka işareti (logo) değişmez, arayüz vurgu rengi / şema / ölçek değişir.
 * Her palet açık VE koyu şemada WCAG AA (metin 4.5:1, odak 3:1) için ayrı ayrı denetlenir (apps/web/test/contrast.test.ts).
 */
export const SCHEMES = ["system", "light", "dim", "dark"] as const;
export type Scheme = (typeof SCHEMES)[number];
export const SCHEME_LABELS: Record<Scheme, string> = { system: "Cihaz ayarı", light: "Açık", dim: "Loş", dark: "Koyu" };

export const ACCENTS = ["yesil", "deniz", "lacivert", "mor", "bordo", "kahve", "antrasit"] as const;
export type Accent = (typeof ACCENTS)[number];

export interface AccentTokens { primary: string; primaryHover: string; deep: string; tint: string; accent: string; accentSurface: string }
export interface AccentDef { label: string; light: AccentTokens; dark: AccentTokens }

/** Açık şema: primary beyaz üstünde ≥4.5:1. Koyu şema: primary koyu yüzey (#121a18 civarı) üstünde ≥4.5:1 (daha açık ton). */
export const ACCENT_DEFS: Record<Accent, AccentDef> = {
  yesil:    { label: "Yeşil (varsayılan)", light: { primary: "#0f5c4d", primaryHover: "#0c4c40", deep: "#123c34", tint: "#e3efeb", accent: "#c66b3d", accentSurface: "#f5e4da" },
                                            dark:  { primary: "#6fcfb6", primaryHover: "#8ad9c4", deep: "#0d2b25", tint: "#163b33", accent: "#e8956a", accentSurface: "#3a2418" } },
  deniz:    { label: "Deniz",               light: { primary: "#0b5d6b", primaryHover: "#094c57", deep: "#0f3c45", tint: "#e0eff1", accent: "#c2642a", accentSurface: "#f6e3d6" },
                                            dark:  { primary: "#67c7d6", primaryHover: "#86d3df", deep: "#0a2a30", tint: "#133a41", accent: "#e9955f", accentSurface: "#3b2416" } },
  lacivert: { label: "Lacivert",            light: { primary: "#2b4a8c", primaryHover: "#233d75", deep: "#1e3160", tint: "#e4eaf6", accent: "#b7691f", accentSurface: "#f6e8d6" },
                                            dark:  { primary: "#9db4ee", primaryHover: "#b3c5f3", deep: "#141f3a", tint: "#1e2b4c", accent: "#e2a45d", accentSurface: "#3a2a12" } },
  mor:      { label: "Mor",                 light: { primary: "#5a3d9a", primaryHover: "#4a327f", deep: "#3a2866", tint: "#ece6f7", accent: "#b25d2c", accentSurface: "#f6e4d8" },
                                            dark:  { primary: "#c1a9f2", primaryHover: "#cfbcf5", deep: "#231a3d", tint: "#2f2452", accent: "#e59a68", accentSurface: "#3b2416" } },
  bordo:    { label: "Bordo",               light: { primary: "#8a2a3e", primaryHover: "#722333", deep: "#5a1c29", tint: "#f6e4e8", accent: "#2f6f5e", accentSurface: "#dcefe8" },
                                            dark:  { primary: "#f0a3b3", primaryHover: "#f4b8c5", deep: "#34141c", tint: "#4a1f2a", accent: "#7fd0b8", accentSurface: "#163a30" } },
  kahve:    { label: "Kahve",               light: { primary: "#6b4a2b", primaryHover: "#573c22", deep: "#46301c", tint: "#f1e9e1", accent: "#2d6a7a", accentSurface: "#dceef2" },
                                            dark:  { primary: "#dbb892", primaryHover: "#e3c6a6", deep: "#2a1e14", tint: "#3b2c1f", accent: "#7cc6d6", accentSurface: "#143a43" } },
  antrasit: { label: "Antrasit",            light: { primary: "#3b4a52", primaryHover: "#2f3c43", deep: "#242e34", tint: "#e7ecee", accent: "#b9642f", accentSurface: "#f6e4d8" },
                                            dark:  { primary: "#b7c7cf", primaryHover: "#c6d3da", deep: "#161d21", tint: "#243036", accent: "#e59a68", accentSurface: "#3b2416" } },
};

export const SCALES = [1, 2, 3, 4, 5] as const;
export type Scale = (typeof SCALES)[number];
/** Kök yazı boyutu yüzdesi; 3 = varsayılan (16 px). */
export const SCALE_PERCENT: Record<Scale, number> = { 1: 87.5, 2: 93.75, 3: 100, 4: 106.25, 5: 112.5 };

export const Appearance = z.object({
  scheme: z.enum(SCHEMES).default("system"),
  accent: z.enum(ACCENTS).default("yesil"),
  scale: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).default(3),
}).strict();
export type Appearance = z.infer<typeof Appearance>;
export const DEFAULT_APPEARANCE: Appearance = { scheme: "system", accent: "yesil", scale: 3 };

/** Bilinmeyen/bozuk değer varsayılana düşer (localStorage veya eski kayıt). */
export function normalizeAppearance(v: unknown): Appearance {
  const r = Appearance.safeParse(v && typeof v === "object" ? v : {});
  return r.success ? r.data : DEFAULT_APPEARANCE;
}
