"use client";
/**
 * Randevu ayrıntısı → "Tanılar" (ADR-107, 08.11.2026). Tanı randevu verilirken girilmez (sekreter hekim muayenesinden önce bilemez);
 * hasta geldikten sonra hekim bu ziyarete BİRDEN FAZLA tanı ekler. Aynı tanı birkaç dişe birden kaydedilebilir (diş başına bir kayıt),
 * diş seçilmezse "tüm ağız / genel" konumludur. Kayıt Tedavi sekmesindeki ile aynı uçtur (POST /patients/:id/diagnoses, appointmentId ile);
 * diş şemasında "Tn" işareti olarak görünür. Sağlık verisi: yalnız `diagnosis.write` + `patient.health.read`.
 */
import { useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { Alert, Loading, TextAreaField, TextField } from "@/components/ui";
import { Odontogram, toothStates } from "@/components/treatment/odontogram";
import type { ChartLike } from "@/components/treatment/tooth-model";

type Diag = { id: string; location: { tooth?: string | null; kind?: string }; code: string | null; description: string; status: string; appointmentId?: string | null };

export function VisitDiagnoses({ appointmentId, patientId }: { appointmentId: string; patientId: string }) {
  const { can } = useSession();
  const allowed = can("diagnosis.write") && can("patient.health.read");
  const chart = useData<ChartLike>(allowed ? `/patients/${patientId}/chart` : null);
  const [teeth, setTeeth] = useState<string[]>([]);
  const [dentition, setDentition] = useState<"permanent" | "mixed">("permanent");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const states = useMemo(() => toothStates(chart.data), [chart.data]);
  if (!allowed) return null;
  if (chart.loading && !chart.data) return <Loading rows={1} />;
  if (chart.error) return null;
  const visit = ((chart.data?.diagnoses ?? []) as unknown as Diag[]).filter((d) => d.appointmentId === appointmentId && d.status === "active");

  async function save() {
    if (busy) return;
    if (description.trim().length < 2) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Tanı açıklaması girin.", field_errors: { description: "Açıklama gerekli" } })); return; }
    setBusy(true); setErr(null); setOk(null);
    const targets = teeth.length ? teeth : [null];
    let saved = 0;
    try {
      for (const t of targets) {
        await api(`/patients/${patientId}/diagnoses`, { body: {
          appointmentId, description: description.trim(), code: code.trim() || undefined,
          location: t ? { kind: "tooth", tooth: t, surfaces: [] } : { kind: "mouth" },
        } });
        saved++;
      }
      setOk(`Tanı kaydedildi${teeth.length ? `: diş ${teeth.join(", ")}` : " (tüm ağız / genel)"}. Başka tanı ekleyebilirsiniz.`);
      setTeeth([]); setDescription(""); setCode("");
    } catch (e) {
      const f = e as ApiFailure;
      setErr(saved ? new ApiFailure(f.status, { code: f.code, message: `${saved} diş için kaydedildi, sonrakiler kaydedilemedi: ${f.message}` }) : f);
      if (saved) setTeeth(targets.slice(saved).filter((x): x is string => !!x));
    } finally {
      setBusy(false);
      await chart.reload();
    }
  }

  return (
    <section className="stack" style={{ gap: 8 }} aria-label="Tanılar">
      <h3 className="row" style={{ gap: 6 }}><ClipboardList size={16} aria-hidden />Tanılar</h3>
      <p className="small muted">Bu ziyarete birden fazla tanı eklenebilir. Dişe bağlı tanı için şemada bir ya da birkaç dişe dokunun; diş seçmezseniz tanı tüm ağız / genel kaydedilir.</p>
      {visit.length > 0 && (
        <ul className="chosen-list" aria-label="Bu ziyaretin tanıları">
          {visit.map((d) => (
            <li key={d.id}><span className="grow">{d.description}{d.code ? <span className="muted small"> · {d.code}</span> : null}</span>
              <span className="small muted">{d.location.tooth ? `Diş ${d.location.tooth}` : "Tüm ağız / genel"}</span></li>))}
        </ul>
      )}
      {err && <Alert kind="error">{err.message}</Alert>}
      {ok && <Alert kind="success">{ok}</Alert>}
      <div className="row" role="group" aria-label="Diş dizisi (tanı)">
        {(["permanent", "mixed"] as const).map((d) => (
          <button key={d} type="button" className={`btn btn-sm ${dentition === d ? "btn-primary" : ""}`} aria-pressed={dentition === d} onClick={() => setDentition(d)}>{d === "permanent" ? "Daimi" : "Karma (süt dişleriyle)"}</button>
        ))}
      </div>
      <Odontogram compact dentition={dentition} states={states} selected={null} multiSelected={teeth}
        onSelect={(t) => { setTeeth((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t])); setErr(null); setOk(null); }} />
      <p className="small" aria-live="polite">{teeth.length ? <>Seçili dişler: <strong>{teeth.join(", ")}</strong> <button type="button" className="btn btn-sm" onClick={() => setTeeth([])}>Temizle</button></> : <span className="muted">Diş seçilmedi — tüm ağız / genel</span>}</p>
      <TextAreaField label="Tanı açıklaması" required value={description} onChange={(e) => { setDescription(e.target.value); setErr(null); }} error={err?.fieldErrors.description} rows={2} />
      <TextField label="Kod (isteğe bağlı)" value={code} onChange={(e) => setCode(e.target.value)} hint="Kliniğin kendi kısaltması ya da ICD kodu girilebilir." />
      <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => void save()}>
        {busy ? "Kaydediliyor…" : teeth.length > 1 ? `Tanıyı ${teeth.length} dişe kaydet` : "Tanıyı kaydet"}
      </button>
    </section>
  );
}
