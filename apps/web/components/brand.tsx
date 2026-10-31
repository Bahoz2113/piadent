/**
 * PİA-DENT markası (seçilen logo 09: gülümseme + nabız). Özgün vektör çizim; palet globals.css ile aynı.
 * `BrandMark`: yalnız işaret (yan menü, favicon ile aynı geometri). `BrandLogo`: işaret + kelime markası.
 */
export const BRAND_MARK_PATHS = {
  /** gülümseme yayı (koyu zeminde beyaz, açık zeminde yeşil) */
  smile: "M18 58c8 22 48 22 56 0",
  /** nabız çizgisi (terracotta) */
  pulse: "M20 42h14l5-11 6 24 6-18 4 8h19",
} as const;

export function BrandMark({ size = 30, tile = true, title = "PİA-DENT" }: { size?: number; tile?: boolean; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 92 92" role="img" aria-label={title} focusable="false">
      {tile && <rect width="92" height="92" rx="22" fill="var(--brand-primary, #0f5c4d)" />}
      <path d={BRAND_MARK_PATHS.smile} fill="none" stroke={tile ? "#ffffff" : "var(--brand-primary, #0f5c4d)"} strokeWidth="9" strokeLinecap="round" />
      <path d={BRAND_MARK_PATHS.pulse} fill="none" stroke="var(--brand-accent, #c66b3d)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Belge/föy yazdırma penceresi gibi React dışı bağlamlar için düz SVG metni (açık zemin). */
export function brandMarkSvgString(size = 28): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 92 92" aria-hidden="true"><rect width="92" height="92" rx="22" fill="#0f5c4d"/><path d="${BRAND_MARK_PATHS.smile}" fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round"/><path d="${BRAND_MARK_PATHS.pulse}" fill="none" stroke="#c66b3d" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Yazdırma penceresi başlığı: işaret + PİA-DENT + klinik adı (isteğe bağlı). Metin içeriği çağıran tarafça kaçışlanmış olmalı. */
export function printHeaderHtml(clinic?: string): string {
  const clinicHtml = clinic ? `<span style="margin-left:auto;color:#4f625d">${clinic}</span>` : "";
  return `<div style="display:flex;align-items:center;gap:10px;margin:32px 32px 0;padding-bottom:12px;border-bottom:1px solid #d9e2dd;font:600 15px/1 system-ui;color:#172b27;letter-spacing:.04em">${brandMarkSvgString(28)}<span>PİA<span style="color:#0f5c4d;font-weight:500">-DENT</span></span>${clinicHtml}</div>`;
}

export function BrandLogo({ tagline }: { tagline?: string }) {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden><BrandMark size={30} /></span>
      <span className="brand-text">PİA-DENT{tagline && <small>{tagline}</small>}</span>
    </div>
  );
}
