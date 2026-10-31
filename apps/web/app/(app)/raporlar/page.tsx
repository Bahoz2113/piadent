"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BarChart3, Download, Play } from "lucide-react";
import { formatTRY, type ColumnType, type Drill, type ReportColumn, type ReportDef } from "@viadent/contracts";
import { api, ApiFailure, getPageContext } from "@/lib/api";
import { useSession } from "@/lib/session";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Alert, EmptyState, ErrorState, Loading, SelectField, TextField, DateField } from "@/components/ui";

interface Catalog {
  reports: (ReportDef & { ownOnly: boolean })[]; canExport: boolean; today: string;
  options: { practitioners: { id: string; name: string }[]; procedures: { id: string; name: string }[]; suppliers: { id: string; name: string; kind: string }[] };
}
interface Result {
  id: string; title: string; sourceIds: string[]; from: string; to: string; columns: ReportColumn[]; rows: (Record<string, unknown> & { _drill?: Drill; valueType?: ColumnType })[];
  totals: Record<string, string | number | null>; totalLabels: Record<string, [string, ColumnType]>; notes?: string[]; truncated?: boolean; limit: number;
}
type Params = Record<string, string>;
const GROUPS = ["Finans", "Tedavi", "Operasyon", "Stok ve cari", "Denetim", "Analiz"] as const;
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const TAB_FOR: Record<string, string> = { finans: "finans", tedavi: "tedavi", iletisim: "iletisim", belgeler: "belgeler", gecmis: "gecmis", lab: "lab" };

function cell(v: unknown, type: ColumnType, tz: string) {
  if (v === null || v === undefined || v === "") return "—";
  switch (type) {
    case "money": return formatTRY(String(v));
    case "int": return Number(v).toLocaleString("tr-TR");
    case "qty": return Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
    case "percent": return `%${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "date": return fmtDate(String(v));
    case "datetime": return fmtDateTime(String(v), tz);
    case "badge": return <span className="badge badge-neutral">{String(v)}</span>;
    default: {
      const t = String(v);
      if (/^\d{4}-\d{2}$/.test(t)) return `${MONTHS[Number(t.slice(5)) - 1]} ${t.slice(0, 4)}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return fmtDate(t);
      return t;
    }
  }
}

export default function ReportsPage() {
  const { tz } = useSession();
  const [cat, setCat] = useState<Catalog | null>(null);
  const [catErr, setCatErr] = useState<ApiFailure | null>(null);
  const [stack, setStack] = useState<{ id: string; params: Params }[]>([]);
  const [params, setParams] = useState<Params>({});
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const current = stack.at(-1);
  const def = cat?.reports.find((r) => r.id === current?.id);

  const run = useCallback(async (id: string, p: Params) => {
    setBusy(true); setErr(null);
    try {
      const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined)).toString();
      setRes(await api<Result>(`/reports/${id}${q ? `?${q}` : ""}`));
      window.history.replaceState(null, "", `/raporlar?rapor=${id}${q ? `&${q}` : ""}`);
    } catch (e) { setErr(e as ApiFailure); setRes(null); } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    api<Catalog>("/reports").then((c) => {
      setCat(c);
      const q = new URLSearchParams(window.location.search);
      const id = q.get("rapor");
      const r = c.reports.find((x) => x.id === id);
      if (id && r) {
        q.delete("rapor");
        const p = { ...(r.maxDays > 1 ? { from: `${c.today.slice(0, 7)}-01`, to: c.today } : {}), ...Object.fromEntries(q.entries()) };
        setStack([{ id, params: p }]); setParams(p); void run(id, p);
      }
    }, (e) => setCatErr(e as ApiFailure));
  }, [run]);

  function open(id: string, p: Params, push = false) {
    const r = cat!.reports.find((x) => x.id === id);
    const base: Params = r && r.maxDays > 1 ? { from: `${cat!.today.slice(0, 7)}-01`, to: cat!.today } : {};
    const next = { ...base, ...p };
    setStack((s) => (push ? [...s, { id, params: next }] : [{ id, params: next }]));
    setParams(next); setRes(null); void run(id, next);
  }
  function back() {
    const s = stack.slice(0, -1);
    setStack(s);
    const prev = s.at(-1);
    if (prev) { setParams(prev.params); void run(prev.id, prev.params); } else { setRes(null); window.history.replaceState(null, "", "/raporlar"); }
  }
  async function exportCsv() {
    if (!current) return;
    setErr(null);
    try {
      const q = new URLSearchParams(params).toString();
      const r = await fetch(`/api/v1/reports/${current.id}/export${q ? `?${q}` : ""}`, { credentials: "same-origin", headers: { "x-viadent-context": getPageContext() } });
      if (!r.ok) { const b = await r.json().catch(() => ({ code: "HTTP_ERROR", message: "Dışa aktarılamadı." })); throw new ApiFailure(r.status, b); }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `viadent-${current.id}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setErr(e as ApiFailure); }
  }

  if (catErr) return <div className="card"><ErrorState error={catErr} /></div>;
  if (!cat) return <div className="card"><Loading /></div>;
  return (
    <>
      <div className="page-head">
        <div><h1>Raporlar</h1><p>Her toplam kaynak kayıtlarla mutabıktır; satıra tıklayarak kaynağa inebilirsiniz. Gün sınırı klinik saat dilimidir ({tz}).</p></div>
      </div>
      {!current || !def ? (
        cat.reports.length === 0 ? <div className="card"><EmptyState icon={<BarChart3 size={28} />} title="Rolünüz için rapor yok" /></div> : (
          <div className="stack" style={{ gap: 20 }}>
            {GROUPS.map((g) => {
              const rs = cat.reports.filter((r) => r.group === g);
              if (!rs.length) return null;
              return (
                <section key={g}>
                  <h2 className="small muted" style={{ textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>{g}</h2>
                  <div className="report-grid">{rs.map((r) => (
                    <button key={r.id} className="report-card" onClick={() => open(r.id, {})}>
                      <strong>{r.title}</strong>
                      <div className="small muted" style={{ margin: "4px 0" }}>{r.description}</div>
                      <div className="src">{r.sourceIds.join(" · ")}{r.ownOnly ? " · yalnız kendi kayıtlarınız" : ""}</div>
                    </button>))}</div>
                </section>
              );
            })}
          </div>
        )
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm" onClick={back}><ArrowLeft size={15} aria-hidden />{stack.length > 1 ? "Önceki rapor" : "Rapor listesi"}</button>
            <h2 style={{ margin: 0 }}>{def.title}</h2><span className="small muted">{def.sourceIds.join(" · ")}</span>
          </div>
          <section className="card card-pad">
            <form className="filters" onSubmit={(e) => { e.preventDefault(); setStack((s) => [...s.slice(0, -1), { id: def.id, params }]); void run(def.id, params); }}>
              {def.filters.map((f) => {
                if (f.kind === "range") return (
                  <div key="range" className="row" style={{ gap: 8 }}>
                    <DateField label="Başlangıç" value={params.from ?? ""} onChange={(e) => setParams({ ...params, from: e.target.value })} />
                    <DateField label="Bitiş" value={params.to ?? ""} onChange={(e) => setParams({ ...params, to: e.target.value })} />
                  </div>);
                const opts: [string, string][] = f.kind === "practitioner" ? [...(def.ownOnly ? [] : [["", "Tümü"] as [string, string]]), ...cat.options.practitioners.map((p) => [p.id, p.name] as [string, string])]
                  : f.kind === "procedure" ? [["", "Tümü"], ...cat.options.procedures.map((p) => [p.id, p.name] as [string, string])]
                  : f.kind === "supplier" ? [["", "Tümü"], ...cat.options.suppliers.filter((s) => f.key !== "supplierId" || def.id !== "laboratuvar" || s.kind === "lab").map((s) => [s.id, s.name] as [string, string])]
                  : f.options ?? [];
                if (f.kind === "text") return <TextField key={f.key} label={f.label} value={params[f.key] ?? ""} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })} />;
                return (
                  <SelectField key={f.key} label={f.label} value={params[f.key] ?? (f.key === "status" && def.id === "tedavi" ? "completed" : "")}
                    onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}>
                    {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </SelectField>
                );
              })}
              <button className="btn btn-primary" type="submit" disabled={busy}><Play size={15} aria-hidden />Çalıştır</button>
              {cat.canExport && <button type="button" className="btn" onClick={() => void exportCsv()} disabled={busy || !res}><Download size={15} aria-hidden />CSV</button>}
            </form>
            {def.ownOnly && <p className="small muted" style={{ marginTop: 8 }}>Hekim olarak yalnız kendi kayıtlarınız listelenir (sunucu tarafında uygulanır).</p>}
          </section>
          {err && <Alert kind="error">{err.message}</Alert>}
          {busy && !res ? <div className="card"><Loading /></div> : res && (
            <>
              {Object.keys(res.totalLabels).length > 0 && (
                <div className="totals" aria-label="Toplamlar">{Object.entries(res.totalLabels).map(([k, [label, type]]) => (
                  <div key={k} className="card stat"><div className="label">{label}</div><div className="value">{cell(res.totals[k], type, tz)}</div></div>))}</div>
              )}
              {res.notes?.map((n) => <Alert key={n} kind="info">{n}</Alert>)}
              {res.truncated && <Alert kind="warning">İlk {res.limit} satır gösteriliyor; toplamlar tüm kayıtları kapsar. Aralığı daraltın.</Alert>}
              <section className="card">
                {res.rows.length === 0 ? <EmptyState title="Bu süzgeçle kayıt yok" /> : (
                  <div className="table-wrap">
                    <table className="table table-wide">
                      <thead><tr>{res.columns.map((c) => <th key={c.key} className={["money", "int", "qty", "percent"].includes(c.type) ? "money" : undefined}>{c.label}</th>)}</tr></thead>
                      <tbody>{res.rows.map((r, i) => {
                        const d = r._drill;
                        const link = d?.labOrderId ? `/operasyon?is=${d.labOrderId}` : d?.patientId && !d.report ? `/hastalar/${d.patientId}${d.tab && TAB_FOR[d.tab] ? `?sekme=${TAB_FOR[d.tab]}` : ""}` : null;
                        return (
                          <tr key={i} className={d ? "drill" : undefined} onClick={d?.report ? () => open(d.report!, d.params ?? {}, true) : undefined}
                            tabIndex={d?.report ? 0 : undefined} onKeyDown={d?.report ? (e) => { if (e.key === "Enter") open(d.report!, d.params ?? {}, true); } : undefined}>
                            {res.columns.map((c, ci) => {
                              const t = c.key === "display" && r.valueType ? r.valueType : c.type;
                              const content = cell(r[c.key], t, tz);
                              return <td key={c.key} className={["money", "int", "qty", "percent"].includes(t) ? "money" : undefined}>
                                {ci === 0 && link ? <Link href={link} onClick={(e) => e.stopPropagation()}>{content}</Link> : content}</td>;
                            })}
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </div>
                )}
              </section>
              <p className="small muted">{fmtDate(res.from)} – {fmtDate(res.to)} · {res.rows.length} satır{res.rows.some((r) => r._drill?.report) ? " · satıra tıklayınca kaynak rapora inilir" : ""}</p>
            </>
          )}
        </div>
      )}
    </>
  );
}
