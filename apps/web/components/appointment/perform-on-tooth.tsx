"use client";
/**
 * Randevu ayrıntısı → "Yapılan işlemi dişe işle" (ADR-103). Hasta geldikten sonra (Geldi / Tedavide / Tamamlandı) hekim, randevunun
 * işlemini (ya da başka bir diş/yüzey işlemini) şemadan dişe ve yüzeye bağlayarak gerçekleşen işlem olarak kaydeder. Kayıt Tedavi
 * sekmesindeki ile aynı uçtur (POST /patients/:id/performed): hasta hesabına alacak, prim, sarf reçetesi aynı transaction'da işler;
 * odontogramda dişe kendiliğinden yansır. Sağlık verisi: yalnız `patient.health.read` + `procedure.complete`.
 */
import { useMemo, useState } from "react";
import { Stethoscope } from "lucide-react";
import { procedureToothEffects, TOOTH_EFFECT_LABELS, validSurfaces, type Surface, type ToothScope } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { Alert, Loading, SelectField } from "@/components/ui";
import { Odontogram, toothStates } from "@/components/treatment/odontogram";
import type { ChartLike } from "@/components/treatment/tooth-model";

interface Proc { id: string; code: string; name: string; toothScope: ToothScope; active?: boolean }

export function PerformOnTooth({ appointmentId, patientId, procedureId, onSaved }: { appointmentId: string; patientId: string; procedureId?: string | null; onSaved?: (m: string) => void }) {
  const { can } = useSession();
  const allowed = can("procedure.complete") && can("patient.health.read");
  const chart = useData<ChartLike>(allowed ? `/patients/${patientId}/chart` : null);
  const procs = useData<{ items: Proc[] }>(allowed ? "/procedures" : null);
  const toothProcs = useMemo(() => (procs.data?.items ?? []).filter((p) => p.toothScope === "tooth" || p.toothScope === "surface"), [procs.data]);
  const [procId, setProcId] = useState<string>("");
  const [tooth, setTooth] = useState<string | null>(null);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [dentition, setDentition] = useState<"permanent" | "mixed">("permanent");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const states = useMemo(() => toothStates(chart.data), [chart.data]);
  if (!allowed) return null;
  if ((chart.loading && !chart.data) || (procs.loading && !procs.data)) return <Loading rows={1} />;
  if (chart.error || procs.error) return null;

  const effectiveId = procId || (procedureId && toothProcs.some((p) => p.id === procedureId) ? procedureId : "");
  const proc = toothProcs.find((p) => p.id === effectiveId);
  const needSurface = proc?.toothScope === "surface";
  const effects = proc ? procedureToothEffects(proc.code, proc.name) : [];
  const ready = !!proc && !!tooth && (!needSurface || surfaces.length > 0);

  async function save() {
    if (!ready || busy) return;
    setBusy(true); setErr(null); setOk(null);
    try {
      await api(`/patients/${patientId}/performed`, { body: { appointmentId, procedureId: proc!.id, quantity: 1, location: { kind: "tooth", tooth, surfaces: needSurface ? surfaces : [] } } });
      const msg = `Diş ${tooth}${needSurface ? ` (${surfaces.join("")})` : ""} · ${proc!.code} ${proc!.name} kaydedildi`;
      setTooth(null); setSurfaces([]);
      await chart.reload();
      setOk(`${msg}. Hasta kartındaki diş şemasında görünür.`);
      onSaved?.(msg);
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }

  return (
    <section className="stack" style={{ gap: 8 }} aria-label="Yapılan işlemi dişe işle">
      <h3 className="row" style={{ gap: 6 }}><Stethoscope size={16} aria-hidden />Yapılan işlemi dişe işle</h3>
      <p className="small muted">İşlemi seçin, şemada dişe dokunun{needSurface ? ", sonra seçili dişte yüzey(ler)e dokunun" : ""}. Kayıt hasta kartındaki diş şemasına kendiliğinden yansır ve hasta hesabına işlenir.</p>
      {err && <Alert kind="error">{err.message}</Alert>}
      {ok && <Alert kind="success">{ok}</Alert>}
      <SelectField label="İşlem" value={effectiveId} onChange={(e) => { setProcId(e.target.value); setSurfaces([]); setErr(null); }}
        hint={proc ? (effects.length ? `Şemada: ${effects.map((x) => TOOTH_EFFECT_LABELS[x]).join(" + ")}` : "Şemada işaret yok; dişin işlem geçmişinde görünür.") : undefined}>
        <option value="">Seçin</option>
        {toothProcs.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}{p.toothScope === "surface" ? " (yüzey)" : ""}</option>)}
      </SelectField>
      <div className="row" role="group" aria-label="Diş dizisi">
        {(["permanent", "mixed"] as const).map((d) => (
          <button key={d} type="button" className={`btn btn-sm ${dentition === d ? "btn-primary" : ""}`} aria-pressed={dentition === d} onClick={() => setDentition(d)}>{d === "permanent" ? "Daimi" : "Karma (süt dişleriyle)"}</button>
        ))}
      </div>
      <Odontogram compact dentition={dentition} states={states} selected={tooth} selectedSurfaces={surfaces}
        onSelect={(t) => { setTooth(t === tooth ? null : t); setSurfaces([]); setErr(null); }}
        onSurface={needSurface ? (t, s) => { if (!validSurfaces(t).includes(s)) return; setSurfaces((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s])); } : undefined} />
      <p className="small" aria-live="polite">{tooth ? <>Seçili: <strong>Diş {tooth}</strong>{needSurface ? <> · yüzey: <strong>{surfaces.join("") || "seçilmedi"}</strong></> : null}</> : <span className="muted">Diş seçilmedi</span>}</p>
      <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} disabled={!ready || busy} onClick={() => void save()}>
        {busy ? "Kaydediliyor…" : "İşlemi dişe kaydet"}
      </button>
    </section>
  );
}

