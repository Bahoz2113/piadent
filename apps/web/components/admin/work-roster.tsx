"use client";
/**
 * ADR-110 (ürün sahibi 12.11.2026): Hekimler → Çalışma listesi. Yönetici hekim × gün aylık çalışma planını yazar.
 * Hücre: çalışıyor (saat + isteğe bağlı ünite) / çalışmıyor / haftalık şablon (kayıt yok, soluk gösterilir).
 * İzin, rapor ve resmî tatil hücrede etiketlenir. Kayıt, o gün için uygun saatleri ve "çalışma saati dışı" uyarısını belirler.
 */
import { useMemo, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { ROSTER_KIND_LABELS, WEEKDAY_LABELS, WEEKDAY_SHORT } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, todayIn } from "@/lib/format";
import { Alert, DateField, Drawer, EmptyState, ErrorState, Loading, SelectField, TextField } from "@/components/ui";

type Kind = "work" | "off";
interface Entry { practitionerId: string; date: string; kind: Kind; start: string | null; end: string | null; chairId: string | null; chairName: string | null; note: string | null; updatedAt: string; updatedBy: string }
interface Roster {
  month: string; today: string; days: { date: string; weekday: number }[];
  practitioners: { id: string; name: string; title: string | null; active: boolean; weekly: { weekday: number; start: string; end: string }[]; plannedMinutes: number; plannedDays: number }[];
  chairs: { id: string; name: string }[];
  entries: Entry[];
  marks: { practitionerId: string | null; date: string; kind: string; label: string; reason: string }[];
  appointments: { practitionerId: string; date: string; count: number }[];
}
type Notify = (k: "success" | "error", t: string) => void;
interface CellRef { practitionerId: string; practitionerName: string; date: string }

const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y!, mo! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthTitle = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y!, mo! - 1, 1)).toLocaleString("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" });
};
const short = (t: string) => (t.endsWith(":00") ? t.slice(0, 2) : t);
const hours = (min: number) => (min % 60 ? `${Math.floor(min / 60)} sa ${min % 60} dk` : `${min / 60} sa`);

export function WorkRoster({ notify }: { notify: Notify }) {
  const { can, tz } = useSession();
  const edit = can("schedule.manage");
  const [month, setMonth] = useState(() => todayIn(tz).slice(0, 7));
  const r = useData<Roster>(`/work-roster?month=${month}`);
  const [cell, setCell] = useState<CellRef | null>(null);
  const [bulk, setBulk] = useState(false);
  const data = r.data;
  const idx = useMemo(() => {
    const e = new Map<string, Entry>(), a = new Map<string, number>();
    for (const x of data?.entries ?? []) e.set(`${x.practitionerId}|${x.date}`, x);
    for (const x of data?.appointments ?? []) a.set(`${x.practitionerId}|${x.date}`, x.count);
    return { e, a };
  }, [data]);

  const done = (m: string) => { setCell(null); setBulk(false); notify("success", m); void r.reload(); };

  return (
    <section className="stack roster" aria-label="Aylık çalışma listesi">
      <div className="card card-pad roster-bar">
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <button className="btn btn-sm icon-btn" aria-label="Önceki ay" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} aria-hidden /></button>
          <h2 style={{ margin: 0, minWidth: 150, textAlign: "center" }}>{monthTitle(month)}</h2>
          <button className="btn btn-sm icon-btn" aria-label="Sonraki ay" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} aria-hidden /></button>
          <button className="btn btn-sm" onClick={() => setMonth(todayIn(tz).slice(0, 7))}>Bu ay</button>
        </div>
        <div className="row no-print" style={{ gap: 6, flexWrap: "wrap" }}>
          {edit && <button className="btn btn-sm btn-primary" onClick={() => setBulk(true)} disabled={!data?.practitioners.some((p) => p.active)}><CalendarRange size={15} aria-hidden />Toplu planla</button>}
          <button className="btn btn-sm" onClick={() => window.print()}><Printer size={15} aria-hidden />Yazdır</button>
        </div>
      </div>
      <p className="small muted no-print">
        {edit ? "Bir güne dokunarak o hekimin o günkü çalışma saatini, ünitesini veya çalışmadığını girin. " : ""}
        Kayıt girilmeyen günlerde haftalık çalışma saatleri geçerlidir (soluk yazı). Çalışma listesi, randevu verirken gösterilen uygun saatleri belirler.
      </p>
      {r.loading && !data ? <div className="card"><Loading /></div> : r.error ? <div className="card"><ErrorState error={r.error} onRetry={r.reload} /></div>
        : !data!.practitioners.length ? <div className="card"><EmptyState title="Hekim yok">Çalışma listesi için önce hekim ekleyin.</EmptyState></div> : (
        <div className="card roster-wrap" tabIndex={0} role="region" aria-label={`${monthTitle(month)} çalışma tablosu`}>
          <table className="roster-table">
            <caption className="sr-only">{monthTitle(month)} hekim çalışma listesi</caption>
            <thead>
              <tr>
                <th scope="col" className="roster-name">Hekim</th>
                {data!.days.map((d) => (
                  <th key={d.date} scope="col" className={`${d.weekday >= 6 ? "is-weekend" : ""} ${d.date === data!.today ? "is-today" : ""}`} title={`${WEEKDAY_LABELS[d.weekday]} ${fmtDate(d.date)}`}>
                    <span className="roster-dnum">{Number(d.date.slice(8))}</span><span className="roster-dname">{WEEKDAY_SHORT[d.weekday]}</span>
                  </th>))}
                <th scope="col" className="roster-total">Toplam</th>
              </tr>
            </thead>
            <tbody>
              {data!.practitioners.map((p) => (
                <tr key={p.id}>
                  <th scope="row" className="roster-name">{p.name}{!p.active && <span className="badge badge-neutral">Pasif</span>}</th>
                  {data!.days.map((d) => {
                    const k = `${p.id}|${d.date}`;
                    const e = idx.e.get(k);
                    const mark = data!.marks.find((m) => m.date === d.date && (m.practitionerId === p.id || m.practitionerId === null));
                    const tmpl = p.weekly.filter((w) => w.weekday === d.weekday);
                    const appts = idx.a.get(k) ?? 0;
                    let text: string, cls: string, desc: string;
                    if (e?.kind === "work") { text = `${short(e.start!)}–${short(e.end!)}`; cls = "is-work"; desc = `Çalışıyor ${e.start}–${e.end}${e.chairName ? `, ${e.chairName}` : ""}`; }
                    else if (e?.kind === "off") { text = "—"; cls = "is-off"; desc = "Çalışmıyor"; }
                    else if (tmpl.length) { text = tmpl.map((w) => `${short(w.start)}–${short(w.end)}`).join(" "); cls = "is-template"; desc = `Haftalık şablon ${tmpl.map((w) => `${w.start}–${w.end}`).join(", ")}`; }
                    else { text = "·"; cls = "is-empty"; desc = "Plan yok"; }
                    const label = `${p.name}, ${fmtDate(d.date)} ${WEEKDAY_LABELS[d.weekday]}: ${mark ? `${mark.label}; ` : ""}${desc}${appts ? `; ${appts} randevu` : ""}`;
                    const body = (<>
                      {mark && <span className={`roster-mark mark-${mark.kind}`}>{mark.label}</span>}
                      <span className="roster-time">{text}</span>
                      {e?.kind === "work" && e.chairName && <span className="roster-chair">{e.chairName.replace(/^Ünite\s*/i, "")}</span>}
                      {appts > 0 && <span className="roster-appts" aria-hidden>{appts}</span>}
                    </>);
                    const tdCls = `${cls} ${d.weekday >= 6 ? "is-weekend" : ""} ${d.date === data!.today ? "is-today" : ""} ${mark ? "is-marked" : ""}`;
                    return (
                      <td key={d.date} className={tdCls}>
                        {edit && p.active
                          ? <button className="roster-cell" aria-label={label} title={label} onClick={() => setCell({ practitionerId: p.id, practitionerName: p.name, date: d.date })}>{body}</button>
                          : <span className="roster-cell" aria-label={label} title={label} role="img">{body}</span>}
                      </td>);
                  })}
                  <td className="roster-total"><strong>{p.plannedDays} gün</strong><span className="small muted">{hours(p.plannedMinutes)}</span></td>
                </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <ul className="roster-legend small muted" aria-label="Açıklama">
          <li><span className="sw is-work" />Çalışma listesinde planlı</li>
          <li><span className="sw is-template" />Haftalık şablon (plan girilmemiş)</li>
          <li><span className="sw is-off" />Çalışmıyor</li>
          <li><span className="roster-mark mark-leave">İzin</span> <span className="roster-mark mark-public_holiday">Resmî tatil</span> İzin, rapor ve tatiller hekim kartından girilir; o gün randevu verilmez.</li>
          <li><span className="roster-appts">3</span> o günkü randevu sayısı</li>
        </ul>
      )}
      {cell && data && <CellDrawer cell={cell} data={data} entry={idx.e.get(`${cell.practitionerId}|${cell.date}`) ?? null} onClose={() => setCell(null)} onSaved={done} />}
      {bulk && data && <BulkDrawer data={data} onClose={() => setBulk(false)} onSaved={done} />}
    </section>
  );
}

/** Kaydet; plan dışında kalan randevu varsa sunucu 409 döner — kullanıcı bilerek onaylarsa yeniden gönderilir. */
function useSaver(onSaved: (m: string) => void) {
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<null | { cells: unknown[] }>(null);
  async function save(cells: unknown[], ack = false) {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ saved: number; unchanged: number }>("/work-roster", { body: { cells, acknowledgeAppointments: ack || undefined } });
      onSaved(r.saved ? `Çalışma listesi kaydedildi (${r.saved} gün).` : "Değişiklik yok.");
    } catch (e) {
      const f = e as ApiFailure;
      if (f.code === "ROSTER_APPOINTMENTS_OUTSIDE") setPending({ cells });
      setErr(f);
    } finally { setBusy(false); }
  }
  return { err, busy, pending, save, clearPending: () => setPending(null) };
}

function TimeInput({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return <TextField label={label} required type="time" step={900} value={value} onChange={(e) => onChange(e.target.value)} error={error} />;
}

function CellDrawer({ cell, data, entry, onClose, onSaved }: { cell: CellRef; data: Roster; entry: Entry | null; onClose: () => void; onSaved: (m: string) => void }) {
  const p = data.practitioners.find((x) => x.id === cell.practitionerId)!;
  const wd = data.days.find((d) => d.date === cell.date)!.weekday;
  const tmpl = p.weekly.filter((w) => w.weekday === wd);
  const mark = data.marks.find((m) => m.date === cell.date && (m.practitionerId === p.id || m.practitionerId === null));
  const appts = data.appointments.find((a) => a.practitionerId === p.id && a.date === cell.date)?.count ?? 0;
  const [kind, setKind] = useState<Kind | "template">(entry?.kind ?? "work");
  const [start, setStart] = useState(entry?.start ?? tmpl[0]?.start ?? "09:00");
  const [end, setEnd] = useState(entry?.end ?? tmpl.at(-1)?.end ?? "18:00");
  const [chair, setChair] = useState(entry?.chairId ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const s = useSaver(onSaved);
  const [clearing, setClearing] = useState(false);
  const cellBody = () => ({ practitionerId: p.id, date: cell.date, kind, ...(kind === "work" ? { start, end, chairId: chair || undefined } : {}), note: note || undefined });
  async function submit() {
    if (kind === "template") {
      setClearing(true);
      try { await api("/work-roster/clear", { body: { cells: [{ practitionerId: p.id, date: cell.date }] } }); onSaved("Gün haftalık şablona döndü."); }
      finally { setClearing(false); }
      return;
    }
    await s.save([cellBody()]);
  }
  return (
    <Drawer title="Çalışma planı" subtitle={`${p.name} · ${fmtDate(cell.date)} ${WEEKDAY_LABELS[wd]}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
        {s.pending
          ? <button className="btn btn-primary" disabled={s.busy} onClick={() => void s.save(s.pending!.cells, true)}>Randevuları bilerek kaydet</button>
          : <button className="btn btn-primary" disabled={s.busy || clearing} onClick={() => void submit()}>Kaydet</button>}</>}>
      <div className="stack">
        {s.err && <Alert kind={s.pending ? "warning" : "error"}>{s.err.message}</Alert>}
        {mark && <Alert kind="info">{mark.label}: {mark.reason}. Bu gün randevu verilmez; izin/tatil hekim kartından yönetilir.</Alert>}
        {appts > 0 && <p className="small">Bu gün <strong>{appts} randevu</strong> var. Plan dışında kalan randevular silinmez; kaydederken uyarılırsınız.</p>}
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
          <legend className="small" style={{ fontWeight: 650 }}>Bu gün</legend>
          {(["work", "off"] as Kind[]).map((k) => (
            <label key={k} className="row small" style={{ gap: 6 }}><input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />{ROSTER_KIND_LABELS[k]}</label>))}
          {entry && <label className="row small" style={{ gap: 6 }}><input type="radio" name="kind" checked={kind === "template"} onChange={() => setKind("template")} />
            Haftalık şablona dön{tmpl.length ? ` (${tmpl.map((w) => `${w.start}–${w.end}`).join(", ")})` : " (şablon yok)"}</label>}
        </fieldset>
        {kind === "work" && (
          <div className="form-grid">
            <TimeInput label="Başlangıç" value={start} onChange={setStart} error={s.err?.fieldErrors["cells.0.start"] ?? s.err?.fieldErrors.start} />
            <TimeInput label="Bitiş" value={end} onChange={setEnd} error={s.err?.fieldErrors["cells.0.end"] ?? s.err?.fieldErrors.end} />
            <SelectField label="Ünite (isteğe bağlı)" value={chair} onChange={(e) => setChair(e.target.value)} error={s.err?.fieldErrors.chairId}>
              <option value="">Ünite atanmadı</option>
              {data.chairs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
          </div>
        )}
        {kind !== "template" && <TextField label="Not (isteğe bağlı)" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ör. öğleden sonra cerrahi" />}
        {entry && <p className="small muted">Son değişiklik: {entry.updatedBy}.</p>}
      </div>
    </Drawer>
  );
}

function BulkDrawer({ data, onClose, onSaved }: { data: Roster; onClose: () => void; onSaved: (m: string) => void }) {
  const active = data.practitioners.filter((p) => p.active);
  const first = data.days[0]!.date, last = data.days.at(-1)!.date;
  const [pid, setPid] = useState(active[0]?.id ?? "");
  const [from, setFrom] = useState(data.today >= first && data.today <= last ? data.today : first);
  const [to, setTo] = useState(last);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [kind, setKind] = useState<Kind>("work");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [chair, setChair] = useState("");
  const s = useSaver(onSaved);
  const targets = data.days.filter((d) => d.date >= from && d.date <= to && days.includes(d.weekday));
  const cells = targets.map((d) => ({ practitionerId: pid, date: d.date, kind, ...(kind === "work" ? { start, end, chairId: chair || undefined } : {}) }));
  const toggle = (w: number) => setDays(days.includes(w) ? days.filter((x) => x !== w) : [...days, w].sort());
  return (
    <Drawer title="Toplu planla" subtitle={monthTitle(data.month)} onClose={onClose} dirty
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
        {s.pending
          ? <button className="btn btn-primary" disabled={s.busy} onClick={() => void s.save(s.pending!.cells, true)}>Randevuları bilerek kaydet</button>
          : <button className="btn btn-primary" disabled={s.busy || !pid || cells.length === 0} onClick={() => void s.save(cells)}>{cells.length} günü kaydet</button>}</>}>
      <div className="stack">
        {s.err && <Alert kind={s.pending ? "warning" : "error"}>{s.err.message}</Alert>}
        <SelectField label="Hekim" required value={pid} onChange={(e) => { setPid(e.target.value); s.clearPending(); }}>
          {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
        <div className="form-grid">
          <DateField label="Başlangıç günü" value={from} min={first} max={last} onChange={(e) => { setFrom(e.target.value || first); s.clearPending(); }} />
          <DateField label="Bitiş günü" value={to} min={from} max={last} onChange={(e) => { setTo(e.target.value || last); s.clearPending(); }} />
        </div>
        <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, gap: 10, flexWrap: "wrap" }}>
          <legend className="small" style={{ fontWeight: 650, marginBottom: 4 }}>Günler</legend>
          {[1, 2, 3, 4, 5, 6, 7].map((w) => (
            <label key={w} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={days.includes(w)} onChange={() => { toggle(w); s.clearPending(); }} />{WEEKDAY_SHORT[w]}</label>))}
        </fieldset>
        <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, gap: 12 }}>
          <legend className="small" style={{ fontWeight: 650, marginBottom: 4 }}>Plan</legend>
          {(["work", "off"] as Kind[]).map((k) => (
            <label key={k} className="row small" style={{ gap: 6 }}><input type="radio" name="bulk-kind" checked={kind === k} onChange={() => { setKind(k); s.clearPending(); }} />{ROSTER_KIND_LABELS[k]}</label>))}
        </fieldset>
        {kind === "work" && (
          <div className="form-grid">
            <TimeInput label="Başlangıç" value={start} onChange={(v) => { setStart(v); s.clearPending(); }} error={s.err?.fieldErrors["cells.0.start"]} />
            <TimeInput label="Bitiş" value={end} onChange={(v) => { setEnd(v); s.clearPending(); }} error={s.err?.fieldErrors["cells.0.end"]} />
            <SelectField label="Ünite (isteğe bağlı)" value={chair} onChange={(e) => { setChair(e.target.value); s.clearPending(); }}>
              <option value="">Ünite atanmadı</option>
              {data.chairs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
          </div>
        )}
        <p className="small muted">{cells.length ? `${cells.length} gün yazılacak: ${targets.map((d) => Number(d.date.slice(8))).join(", ")}.` : "Seçilen aralıkta gün yok."} Daha önce girilmiş plan bu günlerde değişir.</p>
      </div>
    </Drawer>
  );
}
