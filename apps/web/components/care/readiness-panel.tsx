"use client";
import { useState } from "react";
import { CheckCircle2, CircleAlert, ShieldCheck } from "lucide-react";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { Alert, TextField } from "@/components/ui";

interface Item { key: string; label: string; status: "ok" | "missing" | "excepted"; detail: string }

/** VİA Hazır: ziyaret öncesi hazırlık. Durum metin + ikonla verilir (yalnız renk değil). Tıbbi uygunluk kararı vermez. */
export function ReadinessPanel({ appointmentId }: { appointmentId: string }) {
  const { can } = useSession();
  const d = useData<{ items: Item[]; ready: boolean; note: string }>(`/appointments/${appointmentId}/readiness`);
  const [exc, setExc] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  if (!d.data || d.data.items.length === 0) return null;
  async function save() {
    try { await api(`/appointments/${appointmentId}/readiness-exceptions`, { body: { itemKey: exc, reason } }); setExc(null); setReason(""); void d.reload(); }
    catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <section className="stack" style={{ gap: 6 }} aria-label="Ziyaret hazırlığı">
      <h3><ShieldCheck size={16} aria-hidden style={{ verticalAlign: "-3px" }} /> VİA Hazır {d.data.ready ? <span className="badge badge-success">Hazır</span> : <span className="badge badge-warning">Eksik var</span>}</h3>
      <ul className="readiness">
        {d.data.items.map((i) => (
          <li key={i.key} className={`readiness-${i.status}`}>
            {i.status === "missing" ? <CircleAlert size={15} aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}
            <span><strong>{i.label}</strong> — {i.status === "ok" ? "Tamam" : i.status === "excepted" ? "İstisna" : "Eksik"}: {i.detail}</span>
            {i.status === "missing" && can("readiness.exception") && exc !== i.key && <button className="btn btn-sm btn-ghost" onClick={() => { setExc(i.key); setErr(null); }}>Gerekçeli istisna</button>}
          </li>
        ))}
      </ul>
      {exc && (
        <div className="stack" style={{ gap: 6 }}>
          {err && <Alert kind="error">{err.message}</Alert>}
          <TextField label="İstisna gerekçesi" required value={reason} onChange={(e) => setReason(e.target.value)} error={err?.fieldErrors.reason} />
          <div className="row"><button className="btn btn-sm btn-primary" disabled={reason.trim().length < 5} onClick={() => void save()}>Kaydet</button><button className="btn btn-sm" onClick={() => setExc(null)}>Vazgeç</button></div>
        </div>
      )}
      <p className="small muted">{d.data.note}</p>
    </section>
  );
}
