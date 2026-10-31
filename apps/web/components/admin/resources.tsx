"use client";
import { useState } from "react";
import { Clock, Plus } from "lucide-react";
import { WEEKDAY_LABELS, WEEKDAY_SHORT } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { Alert, Drawer, ErrorState, Loading, SelectField, TextField } from "@/components/ui";

interface Block { weekday: number; start: number; end: number }
interface Prac { id: string; name: string; title: string | null; active: boolean; membershipId: string | null; memberName: string | null; schedule: Block[] }
interface Admin {
  practitioners: Prac[]; chairs: { id: string; name: string; active: boolean }[];
  appointmentTypes: { id: string; name: string; defaultMinutes: number; active: boolean }[]; dentistMemberships: { id: string; name: string }[];
}
const hhmm = (m: number) => (m === 1440 ? "24:00" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
export function scheduleSummary(s: Block[]) {
  if (!s.length) return "Tanımsız (kısıt yok)";
  const byDay = new Map<number, string[]>();
  for (const b of s) byDay.set(b.weekday, [...(byDay.get(b.weekday) ?? []), `${hhmm(b.start)}–${hhmm(b.end)}`]);
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, r]) => `${WEEKDAY_SHORT[d]} ${r.join(", ")}`).join(" · ");
}

export function useAdminResources() { return useData<Admin>("/admin/resources"); }

export function ResourcesPanel({ notify }: { notify: (k: "success" | "error", t: string) => void }) {
  const data = useAdminResources();
  const [editing, setEditing] = useState<Prac | "new" | null>(null);
  const [schedule, setSchedule] = useState<Prac | null>(null);
  const [chairName, setChairName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); notify("success", ok); await data.reload(); } catch (e) { notify("error", (e as ApiFailure).message); } finally { setBusy(null); }
  }
  if (data.loading && !data.data) return <div className="card"><Loading /></div>;
  if (data.error) return <div className="card"><ErrorState error={data.error} /></div>;
  const d = data.data!;
  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div><h2>Hekimler ve çalışma saatleri</h2><p className="muted small">Çalışma saati dışı randevu uyarı verir; kapatmalar engeller.</p></div>
          <button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={17} aria-hidden />Hekim ekle</button>
        </div>
        <ul className="list">
          {d.practitioners.map((p) => (
            <li key={p.id} className="row" style={{ padding: "12px 20px", justifyContent: "space-between" }}>
              <div style={{ minWidth: 0 }}>
                <strong>{p.name}</strong> {!p.active && <span className="badge badge-neutral">Pasif</span>}
                <div className="muted small">{p.memberName ? `Kullanıcı: ${p.memberName}` : "Kullanıcıya bağlı değil"}</div>
                <div className="small" style={{ marginTop: 2 }}><Clock size={13} aria-hidden style={{ verticalAlign: "-2px" }} /> {scheduleSummary(p.schedule)}</div>
              </div>
              <div className="row">
                <button className="btn btn-sm" onClick={() => setSchedule(p)}>Çalışma saatleri</button>
                <button className="btn btn-sm" onClick={() => setEditing(p)}>Düzenle</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <div className="card-head"><h2>Koltuklar / ünitler</h2></div>
        <ul className="list">
          {d.chairs.map((c) => (
            <li key={c.id} className="row" style={{ padding: "10px 20px", justifyContent: "space-between" }}>
              <span><strong>{c.name}</strong> {!c.active && <span className="badge badge-neutral">Pasif</span>}</span>
              <button className="btn btn-sm" disabled={busy === c.id} onClick={() => void act(c.id, () => api(`/chairs/${c.id}`, { method: "PATCH", body: { name: c.name, active: !c.active } }), c.active ? "Koltuk pasifleştirildi." : "Koltuk etkinleştirildi.")}>{c.active ? "Pasifleştir" : "Etkinleştir"}</button>
            </li>
          ))}
        </ul>
        <form className="row card-pad" onSubmit={(e) => { e.preventDefault(); if (chairName.trim()) void act("chair", () => api("/chairs", { body: { name: chairName } }), "Koltuk eklendi.").then(() => setChairName("")); }}>
          <TextField label="Yeni koltuk adı" value={chairName} onChange={(e) => setChairName(e.target.value)} className="grow" />
          <button className="btn" type="submit" disabled={busy === "chair"} style={{ alignSelf: "flex-end" }}>Ekle</button>
        </form>
      </section>
      {editing && <PractitionerDrawer p={editing === "new" ? null : editing} dentists={d.dentistMemberships} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); notify("success", m); void data.reload(); }} />}
      {schedule && <ScheduleDrawer p={schedule} onClose={() => setSchedule(null)} onSaved={() => { setSchedule(null); notify("success", "Çalışma saatleri kaydedildi."); void data.reload(); }} />}
    </div>
  );
}

function PractitionerDrawer({ p, dentists, onClose, onSaved }: { p: Prac | null; dentists: { id: string; name: string }[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [f, setF] = useState({ displayName: p?.name ?? "", title: p?.title ?? "", membershipId: p?.membershipId ?? "", active: p?.active ?? true });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr(null);
    const body = { displayName: f.displayName, title: f.title || undefined, membershipId: f.membershipId || undefined, active: f.active };
    try { if (p) await api(`/practitioners/${p.id}`, { method: "PATCH", body }); else await api("/practitioners", { body }); onSaved(p ? "Hekim güncellendi." : "Hekim eklendi."); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title={p ? "Hekimi düzenle" : "Hekim ekle"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <TextField label="Görünen ad" required value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} error={err?.fieldErrors.displayName} hint="Örn. Dt. Ayşe Yılmaz" />
        <TextField label="Unvan / uzmanlık" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <SelectField label="Bağlı kullanıcı (hekim)" value={f.membershipId} onChange={(e) => setF({ ...f, membershipId: e.target.value })} error={err?.fieldErrors.membershipId}>
          <option value="">Bağlı değil</option>
          {dentists.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </SelectField>
        {p && (
          <label className="row"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Etkin (pasif hekime yeni randevu verilemez; mevcut randevular korunur)</label>
        )}
      </div>
    </Drawer>
  );
}

function ScheduleDrawer({ p, onClose, onSaved }: { p: Prac; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState(() => {
    const out: { weekday: number; on: boolean; start: string; end: string }[] = [];
    for (let d = 1; d <= 7; d++) {
      const b = p.schedule.find((x) => x.weekday === d);
      out.push({ weekday: d, on: !!b, start: b ? hhmm(b.start) : "09:00", end: b ? hhmm(b.end) : "18:00" });
    }
    return out;
  });
  const extra = p.schedule.filter((b, i, arr) => arr.findIndex((x) => x.weekday === b.weekday) !== i);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr(null);
    const blocks = rows.filter((r) => r.on).map((r) => ({ weekday: r.weekday, start: r.start, end: r.end }));
    try {
      await api(`/practitioners/${p.id}/schedule`, { method: "PUT", body: { blocks } });
      onSaved();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Çalışma saatleri" subtitle={p.name} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        {extra.length > 0 && <Alert kind="info">Bu hekimin aynı güne ait birden fazla bloğu var; bu ekran gün başına tek blok düzenler ve kaydedince tek bloğa indirir.</Alert>}
        {rows.map((r, i) => (
          <div key={r.weekday} className="row" style={{ gap: 12 }}>
            <label className="row" style={{ width: 130 }}><input type="checkbox" checked={r.on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} /> {WEEKDAY_LABELS[r.weekday]}</label>
            <input className="input" type="time" step={900} style={{ width: 120 }} aria-label={`${WEEKDAY_LABELS[r.weekday]} başlangıç`} disabled={!r.on} value={r.start} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
            <span aria-hidden>–</span>
            <input className="input" type="time" step={900} style={{ width: 120 }} aria-label={`${WEEKDAY_LABELS[r.weekday]} bitiş`} disabled={!r.on} value={r.end} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
          </div>
        ))}
        <p className="small muted">Hiç gün seçilmezse hekim için çalışma saati kısıtı uygulanmaz.</p>
      </div>
    </Drawer>
  );
}
