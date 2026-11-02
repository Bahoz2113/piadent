import { ACCENT_DEFS, DEFAULT_APPEARANCE, SCALE_PERCENT, normalizeAppearance, type Appearance } from "@viadent/contracts";

/** Görünüm tercihi (ADR-082). Tek kaynak localStorage anahtarı; kök layout'taki nonce'lu betik aynı anahtarı okur (ilk boyamada titreme yok). */
export const APPEARANCE_KEY = "piadent.gorunum";

export function readLocalAppearance(): Appearance {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? "{}")); } catch { return DEFAULT_APPEARANCE; }
}

export function resolveScheme(scheme: Appearance["scheme"]): "light" | "dim" | "dark" {
  if (scheme !== "system") return scheme;
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch { return "light"; }
}

/** <html> özniteliklerini ve tarayıcı tema rengini uygular; CSS bu özniteliklerden okur. */
export function applyAppearance(a: Appearance) {
  const html = document.documentElement;
  const scheme = resolveScheme(a.scheme);
  html.dataset.scheme = scheme;
  html.dataset.accent = a.accent;
  html.dataset.scale = String(a.scale);
  html.style.colorScheme = scheme === "light" ? "light" : "dark";
  const def = ACCENT_DEFS[a.accent];
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", (scheme === "light" ? def.light : def.dark).deep);
}

export function saveLocalAppearance(a: Appearance) {
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a)); } catch { /* özel pencere / engelli depolama: yalnız bu oturum */ }
}

/** Kök layout'a gömülen betik (nonce'lu): hidrasyondan önce çalışır. Mantık applyAppearance ile aynı tutulur. */
export function appearanceBootScript(): string {
  const deep = JSON.stringify(Object.fromEntries(Object.entries(ACCENT_DEFS).map(([k, v]) => [k, { l: v.light.deep, d: v.dark.deep }])));
  return `(function(){try{var a=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)})||"{}")||{};` +
    `var s=a.scheme||"system";if(s==="system"){s=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}` +
    `var ok={light:1,dim:1,dark:1};if(!ok[s])s="light";var D=${deep};var ac=D[a.accent]?a.accent:"yesil";var sc=[1,2,3,4,5].indexOf(a.scale)>=0?a.scale:3;` +
    `var h=document.documentElement;h.dataset.scheme=s;h.dataset.accent=ac;h.dataset.scale=String(sc);h.style.colorScheme=s==="light"?"light":"dark";` +
    `var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",s==="light"?D[ac].l:D[ac].d);}catch(e){}})();`;
}

export { SCALE_PERCENT };
