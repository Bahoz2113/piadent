"use client";
import { useState } from "react";
import { Ban, Plus } from "lucide-react";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime, todayIn } from "@/lib/format";
import { Alert, Drawer, EmptyState, ErrorState, Loading, SelectField, TextField } from "@/components/ui";
import { useAdminResources } from "./resources";

export function TypesPanel({ notify }: { notify: (k: "success" | "error", t: string) => void }) {
  const data = useAdminResources();
  const [f, setF] = useState({ name: "", defaultMinutes: "30" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key); setErr(null);
    try { await fn(); notify("success", ok); await data.reload(); return true; } catch (e) { setErr(e as ApiFailure); notify("error", (e as ApiFailure).message); return false; } finally { setBusy(null); }
  }
  if (data.loading && !data.data) return <div className="card"><Loading /></div>;
  if (data.error) return <div className="card"><ErrorState error={data.error} /></div>;
  return (
    <section className="card">
      <div className="card-head"><div><h2>İşlem türleri</h2><p className="muted small">Randevu verirken seçilir; süreyi varsayılana ayarlar. Fiyat/tarife Görev 2'de.</p></div></div>
      <ul className="list">
        {data.data!.appointmentTypes.map((t) => (
          <li key={t.id} className="row" style={{ padding: "10px 20px", justifyContent: "space-between" }}>
            <span><strong>{t.name}</strong> <span className="muted small">· {t.defaultMinutes} dk</span> {!t.active && <span className="badge badge-neutral">Pasif</span>}</span>
            <button className="btn btn-sm" disabled={busy === t.id} onClick={() => void act(t.id, () => api(`/appointment-types/${t.id}`, { method: "PATCH", body: { name: t.name, defaultMinutes: t.defaultMinutes, active: !t.active } }), "Güncellendi.")}>{t.active ? "Pasifleştir" : "Etkinleştir"}</button>
          </li>
        ))}
      </ul>
      <form className="form-grid card-pad" onSubmit={(e) => { e.preventDefault(); void act("new", () => api("/appointment-types", { body: { name: f.name, defaultMinutes: Number(f.defaultMinutes) } }), "İşlem türü eklendi.").then((ok) => ok && setF({ name: "", defaultMinutes: "30" })); }}>
        <TextField label="Yeni işlem türü" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={err?.fieldErrors.name} />
        <TextField label="Varsayılan süre (dk)" type="number" min={5} max={720} step={5} value={f.defaultMinutes} onChange={(e) => setF({ ...f, defaultMinutes: e.target.value })} error={err?.fieldErrors.defaultMinutes} />
        <button className="btn" type="submit" disabled={busy === "new" || !f.name.trim()} style={{ justifySelf: "start" }}><Plus size={16} aria-hidden />Ekle</button>
      </form>
    </section>
  );
}

interface Closure { id: string; scope: string; targetName: string; startsAt: string; endsAt: string; reason: string; createdBy: string }

export function ClosuresPanel({ notify }: { notify: (k: "success" | "error", t: string) => void }) {
  const { tz } = useSession();
  const list = useData<{ items: Closure[] }>("/closures");
  const res = useAdminResources();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  async function cancel(c: Closure) {
    if (!window.confirm(`“${c.reason}” kapatması iptal edilsin mi?`)) return;
    setBusy(c.id);
    try { await api(`/closures/${c.id}/cancel`, { body: {} }); notify("success", "Kapatma iptal edildi."); await list.reload(); }
    catch (e) { notify("error", (e as ApiFailure).message); } finally { setBusy(null); }
  }
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Kapatmalar</h2><p className="muted small">Tatil, izin, bakım. Kapalı aralığa randevu verilemez; mevcut randevular silinmez, VİA Akış'a takip düşer.</p></div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={17} aria-hidden />Kapatma ekle</button>
      </div>
      {list.loading && !list.data ? <Loading /> : list.error ? <ErrorState error={list.error} /> : list.data!.items.length === 0 ? (
        <EmptyState icon={<Ban size={28} aria-hidden />} title="Planlı kapatma yok" />
      ) : (
        <ul className="list">
          {list.data!.items.map((c) => (
            <li key={c.id} className="row" style={{ padding: "12px 20px", justifyContent: "space-between" }}>
              <div><strong>{c.targetName}</strong> <span className="muted small">· {fmtDateTime(c.startsAt, tz)} – {fmtDateTime(c.endsAt, tz)}</span><div className="small">{c.reason} <span className="muted">· {c.createdBy}</span></div></div>
              <button className="btn btn-sm btn-danger" disabled={busy === c.id} onClick={() => void cancel(c)}>İptal et</button>
            </li>
          ))}
        </ul>
      )}
      {creating && res.data && <ClosureDrawer res={res.data} onClose={() => setCreating(false)} onSaved={() => { void list.reload(); }} />}
    </section>
  );
}

function ClosureDrawer({ res, onClose, onSaved }: { res: { practitioners: { id: string; name: string; active: boolean }[]; chairs: { id: string; name: string; active: boolean }[] }; onClose: () => void; onSaved: () => void }) {
  const { tz } = useSession();
  const today = todayIn(tz);
  const [f, setF] = useState({ scope: "practitioner", practitionerId: res.practitioners[0]?.id ?? "", chairId: res.chairs[0]?.id ?? "", startDate: today, startTime: "00:00", endDate: today, endTime: "24:00", reason: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [affected, setAffected] = useState<{ id: string; startsAt: string; patientName: string }[] | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ affected: { id: string; startsAt: string; patientName: string }[] }>("/closures", { body: {
        scope: f.scope, practitionerId: f.scope === "practitioner" ? f.practitionerId : undefined, chairId: f.scope === "chair" ? f.chairId : undefined,
        startDate: f.startDate, startTime: f.startTime, endDate: f.endDate, endTime: f.endTime, reason: f.reason,
      } });
      setAffected(r.affected);
      onSaved();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Kapatma ekle" onClose={onClose} dirty={!affected && !!f.reason}
      footer={affected ? <button className="btn btn-primary" onClick={onClose}>Tamam</button> : <><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Kapatmayı kaydet</button></>}>
      {affected ? (
        <div className="stack">
          <Alert kind={affected.length ? "warning" : "success"} title="Kapatma kaydedildi">
            {affected.length ? `${affected.length} randevu bu aralıkla çakışıyor. Randevular silinmedi; VİA Akış'ta sekreterya için takip görevi oluşturuldu.` : "Çakışan randevu yok."}
          </Alert>
          {affected.length > 0 && <ul className="list">{affected.map((a) => <li key={a.id} style={{ padding: "8px 0" }}>{fmtDateTime(a.startsAt, tz)} · {a.patientName}</li>)}</ul>}
        </div>
      ) : (
        <div className="stack">
          {err && <Alert kind="error">{err.message}</Alert>}
          <SelectField label="Kapsam" value={f.scope} onChange={set("scope")}>
            <option value="clinic">Tüm klinik</option>
            <option value="practitioner">Hekim</option>
            <option value="chair">Koltuk</option>
          </SelectField>
          {f.scope === "practitioner" && <SelectField label="Hekim" value={f.practitionerId} onChange={set("practitionerId")} error={err?.fieldErrors.practitionerId}>{res.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField>}
          {f.scope === "chair" && <SelectField label="Koltuk" value={f.chairId} onChange={set("chairId")} error={err?.fieldErrors.chairId}>{res.chairs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>}
          <div className="form-grid">
            <TextField label="Başlangıç tarihi" type="date" required value={f.startDate} onChange={set("startDate")} />
            <TextField label="Başlangıç saati" type="time" required value={f.startTime} onChange={set("startTime")} hint="Tam gün için 00:00" />
            <TextField label="Bitiş tarihi" type="date" required value={f.endDate} onChange={set("endDate")} error={err?.fieldErrors.endDate} />
            <SelectField label="Bitiş saati" value={f.endTime} onChange={set("endTime")} error={err?.fieldErrors.endTime}>
              <option value="24:00">Gün sonu (24:00)</option>
              {Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`).map((t) => <option key={t} value={t}>{t}</option>)}
            </SelectField>
          </div>
          <TextField label="Neden" required value={f.reason} onChange={set("reason")} error={err?.fieldErrors.reason} hint="Örn. Resmî tatil, kongre, cihaz bakımı" />
        </div>
      )}
    </Drawer>
  );
}
