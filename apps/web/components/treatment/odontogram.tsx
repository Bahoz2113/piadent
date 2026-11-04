"use client";
/**
 * PİA-DENT odontogramı — özgün vektör çizim. FDI numaralama; hastanın sağı ekranın solunda.
 * Her diş klavye ile seçilebilir bir düğmedir. Bilgi yalnız renkle verilmez: yüzey deseni,
 * kısa sembol ve erişilebilir ad birlikte kullanılır.
 */
import { FINDING_LABELS, FINDING_SYMBOL, isAnterior, type FindingType, type Surface } from "@viadent/contracts";

export interface ToothState {
  findings: { type: FindingType; surfaces: string[] }[];
  planned: number;     // planlanan (tamamlanmamış) kalem sayısı
  done: number;        // gerçekleşen işlem sayısı
  diagnoses: number;   // aktif tanı
}

const UPPER_PERM = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"];
const LOWER_PERM = ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"];
const UPPER_PRIM = ["55", "54", "53", "52", "51", "61", "62", "63", "64", "65"];
const LOWER_PRIM = ["85", "84", "83", "82", "81", "71", "72", "73", "74", "75"];

const FILL: Partial<Record<FindingType, string>> = {
  caries: "url(#vd-caries)", filling: "#7FA9C9", crown: "#E3C26F", root_canal: "#B78BC9", implant: "#9BB3AA", bridge_pontic: "#E3C26F", fracture: "url(#vd-fracture)",
};

/** Ekrandaki 5 bölgeyi diş yüzeyine çevirir (üst çenede vestibül üstte, alt çenede altta; meziyal orta hatta doğru). */
function regionSurface(tooth: string, region: "top" | "bottom" | "left" | "right" | "center"): Surface {
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

function ToothSvg({ tooth, state, selected, selectedSurfaces, onSurface }: {
  tooth: string; state?: ToothState; selected: boolean; selectedSurfaces: string[]; onSurface?: (s: Surface) => void;
}) {
  const missing = state?.findings.some((f) => f.type === "missing");
  const wholeType = state?.findings.find((f) => f.surfaces.length === 0 && f.type !== "missing")?.type;
  const fillFor = (s: Surface) => {
    if (selectedSurfaces.includes(s)) return "#5B4BC4";
    const f = state?.findings.find((x) => x.surfaces.includes(s));
    if (f) return FILL[f.type] ?? "#C9D3CE";
    if (wholeType) return FILL[wholeType] ?? "#C9D3CE";
    return "#FFFFFF";
  };
  const regions: { r: "top" | "bottom" | "left" | "right" | "center"; d: string }[] = [
    { r: "top", d: "M2 2 L38 2 L27 13 L13 13 Z" },
    { r: "right", d: "M38 2 L38 38 L27 27 L27 13 Z" },
    { r: "bottom", d: "M38 38 L2 38 L13 27 L27 27 Z" },
    { r: "left", d: "M2 38 L2 2 L13 13 L13 27 Z" },
    { r: "center", d: "M13 13 L27 13 L27 27 L13 27 Z" },
  ];
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden focusable="false">
      {regions.map(({ r, d }) => {
        const s = regionSurface(tooth, r);
        return (
          <path key={r} d={d} fill={fillFor(s)} stroke={selected ? "#0F5C4D" : "#8DA39A"} strokeWidth={selected ? 1.6 : 1}
            onClick={onSurface ? (e) => { e.stopPropagation(); onSurface(s); } : undefined} style={onSurface ? { cursor: "pointer" } : undefined}>
            <title>{s}</title>
          </path>
        );
      })}
      {missing && <path d="M4 4 L36 36 M36 4 L4 36" stroke="#B42318" strokeWidth="3" strokeLinecap="round" />}
    </svg>
  );
}

/** Klinik haritadan diş başına durum (bulgu, tanı, planlı ve gerçekleşen işlem sayısı). Özet ve Tedavi sekmesi ortak kullanır. */
export function toothStates(chart: {
  findings: { tooth: string; surfaces: string[]; type: FindingType; status: string }[];
  diagnoses: { location: { tooth?: string | null }; status: string }[];
  planned: { location: { tooth?: string | null }; quantity: number; performedQty: number }[];
  performed: { location: { tooth?: string | null }; status: string }[];
} | null | undefined): Record<string, ToothState> {
  const out: Record<string, ToothState> = {};
  const get = (t: string) => (out[t] ??= { findings: [], planned: 0, done: 0, diagnoses: 0 });
  for (const f of chart?.findings ?? []) if (f.status === "current") get(f.tooth).findings.push({ type: f.type, surfaces: f.surfaces });
  for (const d of chart?.diagnoses ?? []) if (d.status === "active" && d.location.tooth) get(d.location.tooth).diagnoses++;
  for (const p of chart?.planned ?? []) if (p.location.tooth && p.performedQty < p.quantity) get(p.location.tooth).planned++;
  for (const p of chart?.performed ?? []) if (p.status === "completed" && p.location.tooth) get(p.location.tooth).done++;
  return out;
}

export function Odontogram({ dentition, states, selected, selectedSurfaces = [], onSelect, onSurface }: {
  dentition: "permanent" | "primary" | "mixed";
  states: Record<string, ToothState>;
  selected: string | null;
  selectedSurfaces?: string[];
  onSelect: (tooth: string) => void;
  onSurface?: (tooth: string, s: Surface) => void;
}) {
  const rows: string[][] =
    dentition === "permanent" ? [UPPER_PERM, LOWER_PERM]
    : dentition === "primary" ? [UPPER_PRIM, LOWER_PRIM]
    : [UPPER_PERM, UPPER_PRIM, LOWER_PRIM, LOWER_PERM];

  const label = (t: string) => {
    const s = states[t];
    const parts = [`Diş ${t}`];
    if (s?.findings.length) parts.push(s.findings.map((f) => `${FINDING_LABELS[f.type]}${f.surfaces.length ? ` (${f.surfaces.join("")})` : ""}`).join(", "));
    if (s?.diagnoses) parts.push(`${s.diagnoses} aktif tanı`);
    if (s?.planned) parts.push(`${s.planned} planlı işlem`);
    if (s?.done) parts.push(`${s.done} gerçekleşen işlem`);
    return parts.join("; ");
  };

  return (
    <div className="odonto-wrap">
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <pattern id="vd-caries" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="#F3C9C4" /><line x1="0" y1="0" x2="0" y2="5" stroke="#B42318" strokeWidth="2" />
          </pattern>
          <pattern id="vd-fracture" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#FBEFD9" /><path d="M0 6 L6 0" stroke="#7B4B00" strokeWidth="1.2" />
          </pattern>
        </defs>
      </svg>
      <div className="odonto" role="group" aria-label="Odontogram">
        {rows.map((row, ri) => (
          <div key={ri} className={`odonto-row ${row.length === 10 ? "primary" : ""} ${ri === rows.length / 2 - 1 ? "arch-gap" : ""}`}>
            {row.map((t, i) => {
              const s = states[t];
              const symbols = [
                ...(s?.findings ?? []).filter((f) => f.type !== "missing").map((f) => FINDING_SYMBOL[f.type]),
                ...(s?.diagnoses ? ["Tn"] : []),
                ...(s?.planned ? ["P"] : []),
                ...(s?.done ? ["✓"] : []),
              ];
              const top = ri < rows.length / 2;
              return (
                <button key={t} type="button" className={`tooth ${selected === t ? "is-selected" : ""} ${i === row.length / 2 ? "midline" : ""} ${s?.done ? "has-done" : s?.planned ? "has-planned" : ""}`}
                  aria-pressed={selected === t} aria-label={label(t)} onClick={() => onSelect(t)}>
                  {top && <span className="tooth-no">{t}</span>}
                  <ToothSvg tooth={t} state={s} selected={selected === t} selectedSurfaces={selected === t ? selectedSurfaces : []}
                    onSurface={onSurface && selected === t ? (sf) => onSurface(t, sf) : undefined} />
                  {!top && <span className="tooth-no">{t}</span>}
                  <span className="tooth-marks" aria-hidden>{[...new Set(symbols)].slice(0, 3).join(" ") || " "}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <ul className="odonto-legend" aria-label="Açıklama">
        <li><span className="sw" style={{ background: "repeating-linear-gradient(45deg,#F3C9C4,#F3C9C4 3px,#B42318 3px,#B42318 4px)" }} />Ç Çürük</li>
        <li><span className="sw" style={{ background: "#7FA9C9" }} />D Dolgu</li>
        <li><span className="sw" style={{ background: "#E3C26F" }} />K Kron</li>
        <li><span className="sw" style={{ background: "#B78BC9" }} />KT Kanal tedavili</li>
        <li><span className="sw x" />× Eksik</li>
        <li><strong>Tn</strong> Tanı</li><li><strong>P</strong> Planlı</li><li><strong>✓</strong> Gerçekleşti</li>
        <li><span className="sw sw-done" />İşlem yapılan diş</li><li><span className="sw sw-planned" />Planlı işlem bekleyen diş</li>
        <li><span className="sw" style={{ background: "#5B4BC4" }} />Seçili yüzey</li>
      </ul>
    </div>
  );
}
