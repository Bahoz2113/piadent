"use client";
import { useState } from "react";
import { CalendarCheck2 } from "lucide-react";
import { FOLLOW_UP_STATUS_LABELS, addDays } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime, todayIn } from "@/lib/format";
import { Alert, Drawer, EmptyState, TextField, DateField } from "@/components/ui";
import { alertDialog, promptDialog } from "@/components/dialogs";

interface FollowUp { id: string; dueDate: string; reason: string; status: string; cancelReason: string | null; practitioner: string | null; by: string; appointmentAt: string | null }

/** Kontrol (Akış E): hekim tarih + gerekçe girer → sekreterya görevi → randevu bağlanır → kontrol gerçekleşince kapanır. */
export function FollowUpsCard({ patientId }: { patientId: string }) {
  const { can, tz } = useSession();
  const d = useData<{ items: FollowUp[] }>(`/patients/${patientId}/follow-ups`);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ dueDate: addDays(todayIn(tz), 180), reason: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function save() {
    try { await api("/follow-ups", { body: { patientId, ...f } }); setAdding(false); setF({ dueDate: addDays(todayIn(tz), 180), reason: "" }); void d.reload(); }
    catch (e) { setErr(e as ApiFailure); }
  }
  async function cancel(id: string) {
    const reason = await promptDialog({ title: "Kontrolü iptal et", inputLabel: "İptal gerekçesi", required: true, confirmLabel: "İptal et", danger: true });
    if (!reason) return;
    try { await api(`/follow-ups/${id}/cancel`, { body: { reason } }); void d.reload(); } catch (e) { await alertDialog({ title: "İşlem yapılamadı", message: (e as ApiFailure).message }); }
  }
  const items = d.data?.items ?? [];
  return (
    <section className="card">
      <div className="card-head">
        <div><h2><CalendarCheck2 size={18} aria-hidden style={{ verticalAlign: "-3px" }} /> Kontroller</h2><p className="muted small">Kontrol tarihi yaklaşınca sekreteryaya görev düşer; verilen ilk randevu kontrole bağlanır.</p></div>
        {can("followup.write") && <button className="btn btn-sm" onClick={() => { setAdding(true); setErr(null); }}>Kontrol planla</button>}
      </div>
      {items.length === 0 ? <EmptyState title="Planlı kontrol yok" /> : (
        <ul className="list">{items.map((x) => (
          <li key={x.id} className="row" style={{ padding: "10px 20px", justifyContent: "space-between" }}>
            <span><strong>{fmtDate(x.dueDate)}</strong> · {x.reason}
              <span className="small muted"> · {x.by}{x.appointmentAt ? ` · randevu ${fmtDateTime(x.appointmentAt, tz)}` : ""}{x.cancelReason ? ` · ${x.cancelReason}` : ""}</span></span>
            <span className="row" style={{ gap: 6 }}>
              <span className={`badge badge-${x.status === "open" ? "warning" : x.status === "cancelled" ? "neutral" : "success"}`}>{FOLLOW_UP_STATUS_LABELS[x.status]}</span>
              {can("followup.write") && ["open", "scheduled"].includes(x.status) && <button className="btn btn-sm btn-ghost" onClick={() => void cancel(x.id)}>İptal</button>}
            </span>
          </li>
        ))}</ul>
      )}
      {adding && (
        <Drawer title="Kontrol planla" subtitle="Gerekçeyi genel yazın (ör. “6 aylık kontrol”); klinik ayrıntı klinik notta kalır — görev sekreteryaya görünür." onClose={() => setAdding(false)}
          footer={<><button className="btn" onClick={() => setAdding(false)}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Kaydet</button></>}>
          <div className="stack">
            {err && <Alert kind="error">{err.message}</Alert>}
            <DateField label="Kontrol tarihi" required min={addDays(todayIn(tz), 1)} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} error={err?.fieldErrors.dueDate} />
            <TextField label="Gerekçe" required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={err?.fieldErrors.reason} />
          </div>
        </Drawer>
      )}
    </section>
  );
}
