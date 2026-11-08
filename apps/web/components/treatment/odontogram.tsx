"use client";
/**
 * PİA-DENT odontogramı (ADR-103) — özgün, anatomik diş çizimi. FDI numaralama; hastanın sağı ekranın solunda.
 * Her dişte iki görünüm: yandan (taç + kök) ve çiğneme yüzü (5 yüzey). Gerçekleşen işlemler dişe kendiliğinden yansır
 * (dolgu yüzeyde, kron taçta, kanal kökte, implant vida, çekilen diş soluk ve çarpılı). Dişin üstüne gelince / odaklanınca
 * ipucunda o dişin işlem geçmişi; tıklayınca seçilir. Bilgi yalnız renkle verilmez: erişilebilir ad + ipucu metni + kısa sembol.
 */
import { useEffect, useId, useState, type ReactElement, type ReactNode } from "react";
import { toothKind, TOOTH_KIND_LABELS, isAnterior, type Surface } from "@viadent/contracts";
import { fmtDate } from "@/lib/format";
import { buccalShape, OCCLUSAL, occlusalRegions, type Region } from "./tooth-shapes";
import { toothStates, visualLabels, type ToothRecord, type ToothState, type ToothVisual } from "./tooth-model";

export { toothStates };
export type { ToothState };

const UPPER_PERM = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"];
const LOWER_PERM = ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"];
const UPPER_PRIM = ["55", "54", "53", "52", "51", "61", "62", "63", "64", "65"];
const LOWER_PRIM = ["85", "84", "83", "82", "81", "71", "72", "73", "74", "75"];

export const C = {
  enamel: "#FBF8F1", dentin: "#EFE2C6", outline: "#8C9A93", rootOutline: "#B4A88E",
  filling: "#4F86C0", crown: "#E0B84F", canal: "#8E44AD", implant: "#7C8B98", veneer: "#F1C98E", sealant: "#2E9B66", inlay: "#C99A2E",
  caries: "#B42318", selected: "#5B4BC4", missing: "#B42318",
};

/** Ekrandaki 5 bölgeyi diş yüzeyine çevirir (üst çenede vestibül üstte, alt çenede altta; meziyal orta hatta doğru). */
export function regionSurface(tooth: string, region: Region): Surface {
  const q = Number(tooth[0]);
  const quad = q > 4 ? q - 4 : q;
  const upper = quad <= 2;
  const leftHalf = quad === 1 || quad === 4;
  if (region === "center") return isAnterior(tooth) ? "I" : "O";
  if (region === "top") return upper ? "B" : "L";
  if (region === "bottom") return upper ? "L" : "B";
  if (region === "left") return leftHalf ? "D" : "M";
  return leftHalf ? "M" : "D";
}

const isUpper = (t: string) => { const q = Number(t[0]); return q === 1 || q === 2 || q === 5 || q === 6; };
const mesialOnRight = (t: string) => { const q = Number(t[0]); return q === 1 || q === 4 || q === 5 || q === 8; };

/** Yandan görünüm: kök(ler) + taç; işlemler katman olarak. */
function BuccalView({ tooth, v, w, h, uid }: { tooth: string; v: ToothVisual; w: number; h: number; uid: string }) {
  const kind = toothKind(tooth);
  const shape = buccalShape(tooth, kind);
  const lower = !isUpper(tooth);
  const clip = `${uid}-crown`;
  const mR = mesialOnRight(tooth);
  const has = (s: string) => v.filled.includes(s);
  const car = (s: string) => v.caries.includes(s);
  // Taç üstünde yüzey yamaları (üst çene yönünde): O/I oklüzal kenar, M/D yan, B orta. L yandan görünmez (çiğneme yüzünde).
  const patch = (s: string): ReactElement | null => {
    if (s === "O" || s === "I") return <rect x="0" y="63" width="40" height="13" />;
    if (s === "B") return <ellipse cx="20" cy="54" rx="6.5" ry="6" />;
    if (s === "M") return mR ? <rect x="27" y="44" width="13" height="32" /> : <rect x="0" y="44" width="13" height="32" />;
    if (s === "D") return mR ? <rect x="0" y="44" width="13" height="32" /> : <rect x="27" y="44" width="13" height="32" />;
    return null;
  };
  const surfaces = ["O", "I", "M", "D", "B"];
  return (
    <svg viewBox="0 0 40 76" width={w} height={h} aria-hidden focusable="false" className="tooth-buccal">
      <defs><clipPath id={clip}><path d={shape.crown} /></clipPath></defs>
      <g transform={lower ? "translate(0 76) scale(1 -1)" : undefined} opacity={v.missing ? 0.28 : 1}>
        {!v.implant && !v.pontic && shape.roots.map((d, i) => (
          <path key={i} d={d} fill="url(#vd-dentin)" stroke={C.rootOutline} strokeWidth="0.9" strokeDasharray={v.missing ? "2 2" : undefined} />
        ))}
        {v.implant && (
          <g>
            <path d="M15 42 L15.5 12 Q20 6 24.5 12 L25 42 Z" fill={C.implant} stroke="#5B6872" strokeWidth="0.8" />
            {[16, 21, 26, 31, 36].map((y) => <path key={y} d={`M14.6 ${y} L25.4 ${y - 2.5}`} stroke="#4A5660" strokeWidth="1.1" />)}
          </g>
        )}
        {v.rootCanal && !v.implant && shape.canals.map((d, i) => <path key={i} d={d} fill="none" stroke={C.canal} strokeWidth="2.3" strokeLinecap="round" />)}
        {v.post && !v.implant && <path d="M20 44 L20 30" stroke="#5E6B74" strokeWidth="2.6" strokeLinecap="round" />}
        <path d={shape.crown} fill={v.crown ? "url(#vd-crown)" : "url(#vd-enamel)"} stroke={v.crown ? "#9C7A22" : C.outline} strokeWidth={v.crown ? 1.2 : 0.9}
          strokeDasharray={v.missing ? "2 2" : undefined} />
        {!v.crown && !v.missing && <path d="M14 46 Q13 56 15 66" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.9" />}
        <g clipPath={`url(#${clip})`}>
          {v.veneer && <rect x="0" y="40" width="40" height="36" fill={C.veneer} opacity="0.75" />}
          {v.fillWhole && <rect x="0" y="40" width="40" height="36" fill={C.filling} opacity="0.85" />}
          {!v.fillWhole && <g fill={C.filling}>{surfaces.filter(has).map((s) => <g key={s}>{patch(s)}</g>)}</g>}
          {v.cariesWhole && <rect x="0" y="40" width="40" height="36" fill="url(#vd-caries)" />}
          {!v.cariesWhole && <g fill="url(#vd-caries)">{surfaces.filter(car).map((s) => <g key={s}>{patch(s)}</g>)}</g>}
          {v.inlay && <rect x="10" y="63" width="20" height="13" fill={C.inlay} />}
          {v.sealant && <rect x="8" y="67" width="24" height="9" fill={C.sealant} opacity="0.85" />}
          {v.fracture && <path d="M12 46 L18 55 L14 60 L22 70" stroke="#7B4B00" strokeWidth="1.6" fill="none" />}
        </g>
      </g>
      {v.missing && <path d="M8 18 L32 64 M32 18 L8 64" stroke={C.missing} strokeWidth="2.6" strokeLinecap="round" />}
    </svg>
  );
}

/** Çiğneme yüzü: diş türüne göre hat, 5 yüzey (seçilebilir). */
function OcclusalView({ tooth, v, w, selectedSurfaces, selected, onSurface, uid }: {
  tooth: string; v: ToothVisual; w: number; selectedSurfaces: string[]; selected: boolean; onSurface?: (s: Surface) => void; uid: string;
}) {
  const kind = toothKind(tooth);
  const { outline, box } = OCCLUSAL[kind];
  const clip = `${uid}-occ`;
  const fillFor = (s: Surface) => {
    if (selectedSurfaces.includes(s)) return C.selected;
    if (v.crown) return C.crown;
    if (v.fillWhole || v.filled.includes(s)) return C.filling;
    if (v.cariesWhole || v.caries.includes(s)) return "url(#vd-caries)";
    if ((s === "O" || s === "I") && v.inlay) return C.inlay;
    if ((s === "O" || s === "I") && v.sealant) return C.sealant;
    if (s === "B" && v.veneer) return C.veneer;
    return C.enamel;
  };
  return (
    <svg viewBox="0 0 40 40" width={w} height={w} aria-hidden focusable="false" className="tooth-occlusal" opacity={v.missing ? 0.3 : 1}>
      <defs><clipPath id={clip}><path d={outline} /></clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        {occlusalRegions(box).map(({ r, d }) => {
          const s = regionSurface(tooth, r);
          return (
            <path key={r} d={d} data-surface={s} fill={fillFor(s)} stroke={C.outline} strokeWidth="0.7"
              onClick={onSurface ? (e) => { e.stopPropagation(); onSurface(s); } : undefined} style={onSurface ? { cursor: "pointer" } : undefined}>
              <title>{s}</title>
            </path>
          );
        })}
      </g>
      <path d={outline} fill="none" stroke={selected ? "var(--brand-primary)" : v.crown ? "#9C7A22" : C.outline} strokeWidth={selected ? 1.8 : 1.1}
        strokeDasharray={v.missing ? "2 2" : undefined} />
      {v.implant && <circle cx="20" cy="20" r="3.2" fill={C.implant} stroke="#4A5660" strokeWidth="0.8" />}
    </svg>
  );
}

const RECORD_KIND: Record<ToothRecord["kind"], string> = { done: "Yapılan işlemler", planned: "Planlanan", finding: "Mevcut durum", diagnosis: "Tanı" };

/** Diş ipucu / ayrıntı içeriği — özet kartının seçili diş paneli de kullanır. */
export function ToothRecords({ state, limit }: { state?: ToothState; limit?: number }) {
  if (!state || state.records.length === 0) return <p className="small muted">Bu dişe ait kayıt yok.</p>;
  const groups = (["done", "planned", "finding", "diagnosis"] as const).map((k) => [k, state.records.filter((r) => r.kind === k)] as const).filter(([, l]) => l.length);
  return (
    <div className="tooth-records">
      {groups.map(([k, list]) => (
        <div key={k}>
          <h4 className="small muted">{RECORD_KIND[k]}</h4>
          <ul>
            {list.slice(0, limit ?? list.length).map((r, i) => (
              <li key={i} className="small">
                {r.code && <strong>{r.code} </strong>}{r.label}{r.surfaces.length ? ` (${r.surfaces.join("")})` : ""}
                {r.at && <span className="muted"> · {fmtDate(r.at)}</span>}{r.by && <span className="muted"> · {r.by}</span>}
              </li>
            ))}
            {limit && list.length > limit && <li className="small muted">+{list.length - limit} kayıt daha — dişe tıklayın</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function toothTitle(t: string) { return `Diş ${t} · ${TOOTH_KIND_LABELS[toothKind(t)]}`; }

export function Odontogram({ dentition, states, selected, multiSelected, selectedSurfaces = [], onSelect, onSurface, compact }: {
  dentition: "permanent" | "primary" | "mixed";
  states: Record<string, ToothState>;
  selected: string | null;
  /** ADR-107: birden fazla diş seçimi (ör. aynı tanıyı birkaç dişe kaydetmek); yüzey seçimi yalnız `selected` dişte. */
  multiSelected?: string[];
  selectedSurfaces?: string[];
  onSelect: (tooth: string) => void;
  onSurface?: (tooth: string, s: Surface) => void;
  compact?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const tipId = `${uid}-tip`;
  const [hover, setHover] = useState<{ tooth: string; x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    if (!hover) return;
    const hide = () => setHover(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, [hover]);

  const rows: string[][] =
    dentition === "permanent" ? [UPPER_PERM, LOWER_PERM]
    : dentition === "primary" ? [UPPER_PRIM, LOWER_PRIM]
    : [UPPER_PERM, UPPER_PRIM, LOWER_PRIM, LOWER_PERM];

  const label = (t: string) => {
    const s = states[t];
    const parts = [`Diş ${t}`];
    if (s) parts.push(...visualLabels(s.visual));
    if (s?.diagnoses) parts.push(`${s.diagnoses} aktif tanı`);
    if (s?.planned) parts.push(`${s.planned} planlı işlem`);
    if (s?.done) parts.push(`${s.done} gerçekleşen işlem`);
    return parts.join("; ");
  };

  const show = (t: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const below = isUpper(t);
    const x = Math.min(Math.max(r.left + r.width / 2, 160), window.innerWidth - 160);
    setHover({ tooth: t, x, y: below ? r.bottom + 6 : r.top - 6, below });
  };

  const hs = hover ? states[hover.tooth] : undefined;
  return (
    <div className={`odonto-wrap ${compact ? "is-compact" : ""}`}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <linearGradient id="vd-enamel" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#EFE6D3" /><stop offset="0.35" stopColor="#FFFFFF" /><stop offset="0.75" stopColor="#FAF5EA" /><stop offset="1" stopColor="#E6DCC6" />
          </linearGradient>
          <linearGradient id="vd-dentin" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#E2CFA4" /><stop offset="0.45" stopColor="#F4E8CD" /><stop offset="1" stopColor="#DCC79A" />
          </linearGradient>
          <linearGradient id="vd-crown" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#F2D57E" /><stop offset="0.5" stopColor="#E0B84F" /><stop offset="1" stopColor="#C99A2E" />
          </linearGradient>
          <pattern id="vd-caries" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="#F6CFCA" /><line x1="0" y1="0" x2="0" y2="4" stroke={C.caries} strokeWidth="2" />
          </pattern>
        </defs>
      </svg>
      <div className="odonto" role="group" aria-label="Odontogram">
        {rows.map((row, ri) => {
          const top = ri < rows.length / 2;
          const prim = row.length === 10;
          const bw = prim ? 30 : 38, bh = prim ? 56 : 72, ow = prim ? 26 : 34;
          return (
            <div key={ri} className={`odonto-row ${prim ? "primary" : ""} ${ri === rows.length / 2 - 1 ? "arch-gap" : ""}`}>
              {row.map((t, i) => {
                const s = states[t];
                const v = s?.visual ?? EMPTY;
                const sel = selected === t || !!multiSelected?.includes(t);
                const marks = [...(s?.diagnoses ? ["Tn"] : []), ...(s?.planned ? ["P"] : [])];
                const state = visualLabels(v).join(", ");
                const buccal = <BuccalView tooth={t} v={v} w={bw} h={bh} uid={`${uid}-${t}`} />;
                const occ = <OcclusalView tooth={t} v={v} w={ow} uid={`${uid}-${t}`} selected={sel} selectedSurfaces={selected === t ? selectedSurfaces : []}
                  onSurface={onSurface && selected === t ? (sf) => onSurface(t, sf) : undefined} />;
                return (
                  <button key={t} type="button" data-tooth={t} data-state={state || undefined}
                    className={`tooth ${sel ? "is-selected" : ""} ${i === row.length / 2 ? "midline" : ""} ${s?.done ? "has-done" : s?.planned ? "has-planned" : ""} ${v.missing ? "is-missing" : ""}`}
                    aria-pressed={sel} aria-label={label(t)} aria-describedby={hover?.tooth === t ? tipId : undefined}
                    onClick={() => onSelect(t)}
                    onMouseEnter={(e) => show(t, e.currentTarget)} onMouseLeave={() => setHover(null)}
                    onFocus={(e) => show(t, e.currentTarget)} onBlur={() => setHover(null)}>
                    {top ? <><span className="tooth-no">{t}</span>{buccal}{occ}</> : <>{occ}{buccal}<span className="tooth-no">{t}</span></>}
                    <span className="tooth-marks" aria-hidden>{marks.join(" ") || " "}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {hover && (
        <div id={tipId} role="tooltip" className={`tooth-tip ${hover.below ? "below" : "above"}`} style={{ left: hover.x, top: hover.y }}>
          <strong>{toothTitle(hover.tooth)}</strong>
          {hs && visualLabels(hs.visual).length > 0 && <div className="tooth-tip-state">{visualLabels(hs.visual).map((x) => <span key={x} className="badge badge-neutral">{x}</span>)}</div>}
          <ToothRecords state={hs} limit={4} />
        </div>
      )}
      {!compact && <Legend />}
    </div>
  );
}

const EMPTY: ToothVisual = {
  missing: false, extracted: false, implant: false, crown: false, rootCanal: false, post: false, veneer: false, sealant: false, inlay: false,
  pontic: false, fracture: false, filled: [], fillWhole: false, caries: [], cariesWhole: false,
};

function Mini({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>{children}</svg>;
}
function Legend() {
  return (
    <ul className="odonto-legend" aria-label="Açıklama">
      <li><Mini><rect x="2" y="2" width="12" height="12" rx="3" fill={C.filling} /></Mini>Dolgu</li>
      <li><Mini><rect x="2" y="2" width="12" height="12" rx="3" fill={C.crown} stroke="#9C7A22" /></Mini>Kron</li>
      <li><Mini><path d="M8 1 L8 15" stroke={C.canal} strokeWidth="3" strokeLinecap="round" /></Mini>Kanal tedavisi</li>
      <li><Mini><rect x="5" y="1" width="6" height="14" rx="2" fill={C.implant} /><path d="M4 5 L12 4 M4 9 L12 8 M4 13 L12 12" stroke="#4A5660" /></Mini>İmplant</li>
      <li><Mini><rect x="2" y="2" width="12" height="12" rx="3" fill={C.veneer} /></Mini>Laminate</li>
      <li><Mini><rect x="2" y="2" width="12" height="12" rx="3" fill={C.sealant} /></Mini>Fissür örtücü</li>
      <li><Mini><rect x="2" y="2" width="12" height="12" rx="3" fill="url(#vd-caries)" stroke={C.caries} /></Mini>Çürük</li>
      <li><Mini><rect x="2" y="2" width="12" height="12" rx="3" fill={C.enamel} stroke={C.outline} strokeDasharray="2 2" opacity="0.6" /><path d="M3 3 L13 13 M13 3 L3 13" stroke={C.missing} strokeWidth="2" /></Mini>Çekildi / eksik</li>
      <li><span className="sw sw-done" />İşlem yapılan diş</li>
      <li><span className="sw sw-planned" />Planlı işlem bekleyen (P)</li>
      <li><strong>Tn</strong> Aktif tanı</li>
      <li><span className="sw" style={{ background: C.selected }} />Seçili yüzey</li>
    </ul>
  );
}
