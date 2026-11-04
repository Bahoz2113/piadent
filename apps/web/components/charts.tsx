"use client";
/**
 * Panel grafikleri — kütüphanesiz SVG (ADR-095). Tek seri grafikler: işaret rengi marka birincil rengi (tema/vurgu değişince izler),
 * metinler metin renginde; ızgara ince ve sakin. Sütun ≤ 24 px, uçta 4 px yuvarlak, çizgi 2 px, uç noktası 2 px yüzey halkalı.
 * Her grafikte imleçle ipucu ve "Tablo" görünümü vardır (değerler yalnız renk/şekille verilmez; ekran okuyucu tabloyu okur).
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Table2, BarChart3 } from "lucide-react";

export type Point = { key: string; label: string; value: number; display: string };

const W = 560, H = 200, PAD = { l: 44, r: 12, t: 12, b: 28 };

const TICKS = 4;
/** Eksen üst sınırı: TICKS adımlı "yuvarlak" adım (1·2·5·10 × 10ⁿ, en az 1) — adet grafiklerinde etiketler tam sayı kalır. */
function niceMax(v: number): number {
  if (v <= 0) return TICKS;
  const raw = v / TICKS;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
  return step * TICKS;
}
export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} Mn`;
  if (a >= 10_000) return `${(v / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} B`;
  return v.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}

function Frame({ title, subtitle, data, children, empty }: { title: string; subtitle?: string; data: Point[]; children: ReactNode; empty?: string }) {
  const [table, setTable] = useState(false);
  const id = useId();
  return (
    <section className="card chart-card" aria-labelledby={`${id}-t`}>
      <div className="card-head">
        <div><h2 id={`${id}-t`}>{title}</h2>{subtitle && <p className="muted small">{subtitle}</p>}</div>
        <button className="btn btn-sm btn-ghost" onClick={() => setTable((x) => !x)} aria-pressed={table} title={table ? "Grafik görünümü" : "Tablo görünümü"}>
          {table ? <BarChart3 size={15} aria-hidden /> : <Table2 size={15} aria-hidden />}{table ? "Grafik" : "Tablo"}
        </button>
      </div>
      <div className="card-pad chart-body">
        {data.length === 0 || data.every((d) => d.value === 0) ? <p className="muted small chart-empty">{empty ?? "Bu dönemde veri yok."}</p>
          : table ? (
            <div className="table-wrap" tabIndex={0}>
              <table className="table"><thead><tr><th>Dönem</th><th className="num">Değer</th></tr></thead>
                <tbody>{data.map((d) => <tr key={d.key}><td>{d.label}</td><td className="num">{d.display}</td></tr>)}</tbody></table>
            </div>
          ) : children}
      </div>
    </section>
  );
}

/** Dar ekranda SVG küçülür ve yazılar CSS ile büyütülür (globals.css); ipucu kutusu da aynı oranda büyür. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** Kök yazı boyutu / 16: grafik metinleri rem (yazı ölçeği ayarı, ADR-082) olduğundan ipucu kutusu da bu oranda büyür (QA-204). */
function rootFontScale(): number {
  if (typeof window === "undefined") return 1;
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return px > 0 ? px / 16 : 1;
}

function Tip({ x, y, p }: { x: number; y: number; p: Point }) {
  // Tip yalnız imleç/dokunma sonrası (istemcide) çizilir; kök ölçek render anında okunur.
  const k = (useNarrow() ? 1.7 : 1) * rootFontScale();
  const w = Math.min(W - 4, Math.max(84, Math.max(p.label.length, p.display.length) * 7.4 + 20) * k);
  const h = 38 * k;
  const left = Math.min(Math.max(x - w / 2, 2), W - w - 2);
  const top = Math.max(y - h - 10, 2);
  return (
    <g className="chart-tip" pointerEvents="none">
      <rect x={left} y={top} width={w} height={h} rx={8} />
      <text x={left + 10 * k} y={top + 15 * k} className="tip-label">{p.label}</text>
      <text x={left + 10 * k} y={top + 31 * k} className="tip-value">{p.display}</text>
    </g>
  );
}

function Axis({ max, ticks = TICKS }: { max: number; ticks?: number }) {
  const ih = H - PAD.t - PAD.b;
  return (
    <g className="chart-axis" aria-hidden>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i, y = PAD.t + ih - (ih * i) / ticks;
        return <g key={i}><line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} /><text x={PAD.l - 6} y={y + 4} textAnchor="end">{compact(v)}</text></g>;
      })}
    </g>
  );
}

/** Sütun grafiği (zaman ya da kategori ekseni). `every` ile her n. etiket yazılır. */
export function ColumnChart({ title, subtitle, data, every = 1, empty }: { title: string; subtitle?: string; data: Point[]; every?: number; empty?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const band = iw / Math.max(data.length, 1);
  const bw = Math.min(24, Math.max(band - 4, 3));
  return (
    <Frame title={title} subtitle={subtitle} data={data} empty={empty}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${d.display}`).join(", ")}`} onMouseLeave={() => setHover(null)}>
        <Axis max={max} />
        {data.map((d, i) => {
          const h = (d.value / max) * ih, x = PAD.l + band * i + (band - bw) / 2, y = PAD.t + ih - h;
          const r = Math.min(4, h / 2, bw / 2);
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)}>
              <rect x={PAD.l + band * i} y={PAD.t} width={band} height={ih} fill="transparent" />
              {h > 0 && <path className={`chart-col ${hover === i ? "is-hover" : ""}`}
                d={`M${x},${PAD.t + ih} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + bw - r},${y} Q${x + bw},${y} ${x + bw},${y + r} L${x + bw},${PAD.t + ih} Z`} />}
              {i % every === 0 && <text className="chart-xlabel" x={PAD.l + band * i + band / 2} y={H - 8} textAnchor="middle">{d.label.split(" ")[0]}</text>}
            </g>
          );
        })}
        <line className="chart-base" x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} />
        {hover !== null && data[hover] && <Tip x={PAD.l + band * hover + band / 2} y={PAD.t + ih - (data[hover]!.value / max) * ih} p={data[hover]!} />}
      </svg>
    </Frame>
  );
}

/** Çizgi grafiği (tek seri, alan yıkaması %10, son nokta etiketli). */
export function LineChart({ title, subtitle, data, empty }: { title: string; subtitle?: string; data: Point[]; empty?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const min = Math.min(0, ...data.map((d) => d.value));
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const step = iw / Math.max(data.length - 1, 1);
  const pts = useMemo(() => data.map((d, i) => [PAD.l + step * i, PAD.t + ih - ((d.value - min) / (max - min || 1)) * ih] as const), [data, step, ih, max, min]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = pts.length ? `${line} L${pts[pts.length - 1]![0]},${PAD.t + ih} L${pts[0]![0]},${PAD.t + ih} Z` : "";
  const last = pts.length - 1;
  return (
    <Frame title={title} subtitle={subtitle} data={data} empty={empty}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${d.display}`).join(", ")}`} onMouseLeave={() => setHover(null)}>
        <Axis max={max} />
        <path className="chart-area" d={area} />
        <path className="chart-line" d={line} />
        {data.map((d, i) => (
          <g key={d.key} onMouseEnter={() => setHover(i)}>
            <rect x={pts[i]![0] - step / 2} y={PAD.t} width={step} height={ih} fill="transparent" />
            {i % 2 === (last % 2) && <text className="chart-xlabel" x={pts[i]![0]} y={H - 8} textAnchor="middle">{d.label.split(" ")[0]}</text>}
          </g>
        ))}
        {hover !== null && <line className="chart-cross" x1={pts[hover]![0]} x2={pts[hover]![0]} y1={PAD.t} y2={PAD.t + ih} />}
        {last >= 0 && <circle className="chart-dot" cx={pts[last]![0]} cy={pts[last]![1]} r={4} />}
        {hover !== null && hover !== last && <circle className="chart-dot" cx={pts[hover]![0]} cy={pts[hover]![1]} r={4} />}
        {hover !== null && <Tip x={pts[hover]![0]} y={pts[hover]![1]} p={data[hover]!} />}
      </svg>
    </Frame>
  );
}

/** Yatay çubuk listesi (kategori payı): ad · çubuk · değer. Renk tek; kimlik satır adından gelir. */
export function BarList({ title, subtitle, data, empty }: { title: string; subtitle?: string; data: Point[]; empty?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Frame title={title} subtitle={subtitle} data={data} empty={empty}>
      <ul className="barlist" aria-label={title}>
        {data.map((d) => (
          <li key={d.key} title={`${d.label}: ${d.display}`}>
            <span className="barlist-label">{d.label}</span>
            <span className="barlist-track" aria-hidden><span className="barlist-bar" style={{ width: `${Math.max((d.value / max) * 100, 2)}%` }} /></span>
            <span className="barlist-value">{d.display}<span className="muted small"> · %{total ? Math.round((d.value / total) * 100) : 0}</span></span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}
