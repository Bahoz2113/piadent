"use client";
import { useState } from "react";
import { CalendarOff, Plus } from "lucide-react";
import { CLOSURE_KIND_LABELS, FIXED_PUBLIC_HOLIDAYS, addDays, type ClosureKind } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, todayIn } from "@/lib/format";
import { Alert, DateField, Drawer, EmptyState, ErrorState, Loading, SelectField, TextField } from "@/components/ui";
import { confirmDialog } from "@/components/dialogs";

type Notify = (k: "success" | "error", t: string) => void;
interface Closure { id: string; kind: ClosureKind; kindLabel: string; scope: string; practitionerId: string | null; targetName: string; startsAt: string; endsAt: string; reason: string; createdBy: string }

/** Bitişi gece yarısı olan (tam gün) aralığın son gününü verir. */
function lastDay(endsAt: string, tz: string) {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(new Date(endsAt).getTime() - 60_000));
  return d;
}

/**
 * 07.11.2026: Yönetim → Kapatmalar kaldırıldı. Hekimin çalışma saatleri altında izin, rapor ve resmî tatil tarihleriyle girilir.
 * Resmî tatil tüm kliniği kapatır; izin ve rapor yalnız bu hekimi. Kapalı güne randevu verilmez; mevcut randevular silinmez, PİA Akış'a takip düşer.
 */
export function LeavesCard({ practitionerId, practitionerName, notify }: { practitionerId: string; practitionerName: string; notify: Notify }) {
  const { tz, can } = useSession();
  const list = useData<{ items: Closure[] }>("/closures");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const manage = can("schedule.manage");
  const items = (list.data?.items ?? []).filter((c) => c.scope === "clinic" || c.practitionerId === practitionerId);
  async function cancel(c: Closure) {
    if (!(await confirmDialog({ title: `${c.kindLabel} kaydını iptal et`, message: `“${c.reason}” (${fmtDate(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(c.startsAt)))}) iptal edilsin mi?`, confirmLabel: "İptal et", cancelLabel: "Vazgeç", danger: true }))) return;
    setBusy(c.id);
    try { await api(`/closures/${c.id}/cancel`, { body: {} }); notify("success", "Kayıt iptal edildi."); await list.reload(); }
    catch (e) { notify("error", (e as ApiFailure).message); } finally { setBusy(null); }
  }
  return (
    <section className="card" aria-labelledby={`izin-${practitionerId}`}>
      <div className="card-head">
        <div><h2 id={`izin-${practitionerId}`}>İzin, rapor ve resmî tatiller</h2><p className="muted small">Kapalı günlere randevu verilmez. Resmî tatil tüm hekimler için geçerlidir.</p></div>
        {manage && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus size={15} aria-hidden />Ekle</button>}
      </div>
      {list.loading && !list.data ? <Loading /> : list.error ? <ErrorState error={list.error} /> : items.length === 0 ? (
        <EmptyState icon={<CalendarOff size={28} aria-hidden />} title="Planlı izin veya tatil yok" />
      ) : (
        <ul className="list">
          {items.map((c) => {
            const s = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(c.startsAt));
            const e = lastDay(c.endsAt, tz);
            return (
              <li key={c.id} className="row" style={{ padding: "10px 20px", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <span className={`badge ${c.kind === "public_holiday" ? "badge-info" : c.kind === "sick_leave" ? "badge-warning" : "badge-neutral"}`}>{c.kindLabel}</span>{" "}
                  <strong>{fmtDate(s)}{e !== s ? ` – ${fmtDate(e)}` : ""}</strong>
                  <div className="small">{c.reason} <span className="muted">· {c.scope === "clinic" ? "tüm klinik" : c.targetName} · {c.createdBy}</span></div>
                </div>
                {manage && <button className="btn btn-sm btn-ghost" disabled={busy === c.id} onClick={() => void cancel(c)}>İptal et</button>}
              </li>
            );
          })}
        </ul>
      )}
      {adding && <LeaveDrawer practitionerId={practitionerId} practitionerName={practitionerName} onClose={() => setAdding(false)} onSaved={() => void list.reload()} />}
    </section>
  );
}

function LeaveDrawer({ practitionerId, practitionerName, onClose, onSaved }: { practitionerId: string; practitionerName: string; onClose: () => void; onSaved: () => void }) {
  const { tz } = useSession();
  const today = todayIn(tz);
  const year = Number(today.slice(0, 4));
  const [kind, setKind] = useState<"leave" | "sick_leave" | "public_holiday">("leave");
  const [holiday, setHoliday] = useState("");
  const [f, setF] = useState({ startDate: today, endDate: today, note: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [affected, setAffected] = useState<{ id: string; startsAt: string; patientName: string }[] | null>(null);
  // Sabit resmî tatiller için bu yıl ve gelecek yıl seçenekleri (geçmiş tarih gösterilmez); dinî bayramlar elle girilir.
  const holidayOptions = [year, year + 1].flatMap((y) => FIXED_PUBLIC_HOLIDAYS.map(([md, name]) => [`${y}-${md}`, `${name} · ${fmtDate(`${y}-${md}`)}`] as [string, string]))
    .filter(([d]) => d >= today);
  function pickHoliday(v: string) {
    setHoliday(v);
    if (v && v !== "other") setF({ ...f, startDate: v, endDate: v, note: FIXED_PUBLIC_HOLIDAYS.find(([md]) => v.endsWith(md))?.[1] ?? "" });
    if (v === "other") setF({ ...f, note: "" });
  }
  const label = CLOSURE_KIND_LABELS[kind];
  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ affected: { id: string; startsAt: string; patientName: string }[] }>("/closures", { body: {
        kind, scope: kind === "public_holiday" ? "clinic" : "practitioner", practitionerId: kind === "public_holiday" ? undefined : practitionerId,
        startDate: f.startDate, startTime: "00:00", endDate: f.endDate, endTime: "24:00",
        reason: f.note.trim() || (kind === "public_holiday" ? "Resmî tatil" : `${practitionerName} · ${label}`),
      } });
      setAffected(r.affected); onSaved();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="İzin, rapor veya resmî tatil ekle" subtitle={kind === "public_holiday" ? "Tüm klinik kapanır" : practitionerName} onClose={onClose}
      dirty={!affected && (f.note !== "" || f.startDate !== today || f.endDate !== today || kind !== "leave")}
      footer={affected ? <button className="btn btn-primary" onClick={onClose}>Tamam</button> : <><button className="btn" onClick={onClose}>Vazgeç</button>
        <button className="btn btn-primary" disabled={busy || (kind === "public_holiday" && !holiday) || (kind === "public_holiday" && holiday === "other" && f.note.trim().length < 2)} onClick={() => void save()}>Kaydet</button></>}>
      {affected ? (
        <Alert kind={affected.length ? "warning" : "success"} title={`${label} kaydedildi`}>
          {affected.length ? `${affected.length} randevu bu günlerle çakışıyor. Randevular silinmedi; PİA Akış'ta sekreterya için takip görevi oluşturuldu.` : "Çakışan randevu yok."}
          {affected.length > 0 && <ul style={{ marginTop: 6 }}>{affected.map((a) => <li key={a.id}>{a.patientName}</li>)}</ul>}
        </Alert>
      ) : (
        <div className="stack">
          {err && <Alert kind="error">{err.message}</Alert>}
          <SelectField label="Tür" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setHoliday(""); }}>
            <option value="leave">İzin</option><option value="sick_leave">Rapor</option><option value="public_holiday">Resmî tatil (tüm klinik)</option>
          </SelectField>
          {kind === "public_holiday" && (
            <SelectField label="Resmî tatil" required value={holiday} onChange={(e) => pickHoliday(e.target.value)} hint="Dinî bayramların tarihi her yıl değişir; “Diğer” ile tarih ve adı girin.">
              <option value="">Seçin</option>
              {holidayOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              <option value="other">Diğer (Ramazan Bayramı, Kurban Bayramı, arife vb.)</option>
            </SelectField>
          )}
          <div className="form-grid">
            <DateField label="Başlangıç günü" required min={today} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} error={err?.fieldErrors.startDate} />
            <DateField label="Bitiş günü" required min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} error={err?.fieldErrors.endDate} />
          </div>
          <TextField label={kind === "public_holiday" ? "Tatil adı" : "Açıklama (isteğe bağlı)"} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })}
            placeholder={kind === "public_holiday" ? "Ör. Kurban Bayramı" : `Boşsa “${label}” yazılır`} error={err?.fieldErrors.reason} />
          <p className="small muted">{f.startDate === f.endDate ? fmtDate(f.startDate) : `${fmtDate(f.startDate)} – ${fmtDate(f.endDate)}`} · {Math.round((Date.parse(addDays(f.endDate, 1)) - Date.parse(f.startDate)) / 86_400_000)} gün, tüm gün kapalı.</p>
        </div>
      )}
    </Drawer>
  );
}
