"use client";
/**
 * Hasta kartı Özet: diş şeması (madde 4). İşlem yapılan dişler işaretli; dişe tıklayınca o dişe uygulanan, planlanan işlemler ve
 * bulgular görünür. Salt okunur — kayıt işlemleri Tedavi sekmesinde. Sağlık verisi olduğundan yalnız `patient.health.read` (ADR-085).
 */
import { useEffect, useMemo, useState } from "react";
import { type FindingType } from "@viadent/contracts";
import { useData } from "@/lib/use-data";
import { useSession } from "@/lib/session";
import { Alert, ErrorState, Loading } from "@/components/ui";
import { Odontogram, ToothRecords, toothStates, toothTitle } from "./odontogram";
import { visualLabels } from "./tooth-model";

type Loc = { kind: string; tooth?: string | null; surfaces?: string[] };
interface Chart {
  findings: { id: string; tooth: string; surfaces: string[]; type: FindingType; status: string; at: string; by: string }[];
  diagnoses: { id: string; location: Loc; code: string | null; description: string; status: string; at: string; by: string }[];
  planned: { id: string; code: string; name: string; location: Loc; quantity: number; performedQty: number }[];
  performed: { id: string; code: string; name: string; location: Loc; status: string; at: string; practitioner: string }[];
}

export function ToothSummaryCard({ patientId, onOpenTreatment }: { patientId: string; onOpenTreatment: () => void }) {
  const { can } = useSession();
  const health = can("patient.health.read");
  const chart = useData<Chart>(health ? `/patients/${patientId}/chart` : null);
  const [tooth, setTooth] = useState<string | null>(null);
  const [dentition, setDentition] = useState<"permanent" | "primary" | "mixed">("permanent");
  const states = useMemo(() => toothStates(chart.data), [chart.data]);
  // Süt dişinde kayıt varsa karma diziyle aç (çocuk hasta); kullanıcı değiştirdiyse dokunma.
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched && Object.keys(states).some((t) => /^[5-8]/.test(t))) setDentition("mixed"); }, [states, touched]);
  if (!health) return null;
  const doneTeeth = Object.entries(states).filter(([, s]) => s.done > 0).map(([t]) => t).sort();
  const sel = tooth ? states[tooth] : undefined;
  return (
    <section className="card" aria-label="Diş şeması">
      <div className="card-head">
        <div>
          <h2>Diş şeması</h2>
          <p className="muted small">{doneTeeth.length ? `İşlem yapılan dişler: ${doneTeeth.join(", ")}` : "Henüz dişe bağlı tamamlanmış işlem yok."} Dişin üstüne gelin ya da dokunun: yapılan işlemler tarih ve hekimle görünür.</p>
        </div>
        <div className="row">
          <div className="row" role="group" aria-label="Diş dizisi">
            {(["permanent", "primary", "mixed"] as const).map((d) => (
              <button key={d} className={`btn btn-sm ${dentition === d ? "btn-primary" : ""}`} aria-pressed={dentition === d} onClick={() => { setDentition(d); setTouched(true); }}>
                {{ permanent: "Daimi", primary: "Süt", mixed: "Karma" }[d]}
              </button>
            ))}
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onOpenTreatment}>Tedavi sekmesi</button>
        </div>
      </div>
      {chart.loading && !chart.data ? <Loading /> : chart.error ? <ErrorState error={chart.error} /> : (
        <div className="card-pad">
          <Odontogram dentition={dentition} states={states} selected={tooth} onSelect={(t) => setTooth(t === tooth ? null : t)} />
          {tooth && (
            <div className="tooth-detail" aria-live="polite">
              <h3>{toothTitle(tooth)}</h3>
              {sel && visualLabels(sel.visual).length > 0 && <div className="tooth-tip-state" style={{ marginBottom: 8 }}>{visualLabels(sel.visual).map((x) => <span key={x} className="badge badge-neutral">{x}</span>)}</div>}
              <ToothRecords state={sel} />
            </div>
          )}
        </div>
      )}
      {chart.data && chart.data.performed.some((x) => x.status === "completed" && !x.location.tooth) && (
        <div className="card-pad" style={{ paddingTop: 0 }}><Alert kind="info">Dişe bağlı olmayan (tüm ağız / çene) işlemler Tedavi sekmesindeki “Gerçekleşen işlemler” listesinde.</Alert></div>
      )}
    </section>
  );
}
