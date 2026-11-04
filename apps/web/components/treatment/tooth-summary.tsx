"use client";
/**
 * Hasta kartı Özet: diş şeması (madde 4). İşlem yapılan dişler işaretli; dişe tıklayınca o dişe uygulanan, planlanan işlemler ve
 * bulgular görünür. Salt okunur — kayıt işlemleri Tedavi sekmesinde. Sağlık verisi olduğundan yalnız `patient.health.read` (ADR-085).
 */
import { useMemo, useState } from "react";
import { FINDING_LABELS, type FindingType } from "@viadent/contracts";
import { useData } from "@/lib/use-data";
import { useSession } from "@/lib/session";
import { fmtDate } from "@/lib/format";
import { Alert, ErrorState, Loading } from "@/components/ui";
import { Odontogram, toothStates } from "./odontogram";

type Loc = { kind: string; tooth?: string | null; surfaces?: string[] };
interface Chart {
  findings: { id: string; tooth: string; surfaces: string[]; type: FindingType; status: string }[];
  diagnoses: { id: string; location: Loc; description: string; status: string }[];
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
  if (!health) return null;
  const doneTeeth = Object.entries(states).filter(([, s]) => s.done > 0).map(([t]) => t).sort();
  const sel = chart.data && tooth ? {
    done: chart.data.performed.filter((x) => x.location.tooth === tooth && x.status === "completed"),
    planned: chart.data.planned.filter((x) => x.location.tooth === tooth && x.performedQty < x.quantity),
    findings: chart.data.findings.filter((x) => x.tooth === tooth && x.status === "current"),
  } : null;
  return (
    <section className="card" aria-label="Diş şeması">
      <div className="card-head">
        <div>
          <h2>Diş şeması</h2>
          <p className="muted small">{doneTeeth.length ? `İşlem yapılan dişler: ${doneTeeth.join(", ")}` : "Henüz dişe bağlı tamamlanmış işlem yok."} Ayrıntı için dişe tıklayın.</p>
        </div>
        <div className="row">
          <div className="row" role="group" aria-label="Diş dizisi">
            {(["permanent", "primary", "mixed"] as const).map((d) => (
              <button key={d} className={`btn btn-sm ${dentition === d ? "btn-primary" : ""}`} aria-pressed={dentition === d} onClick={() => setDentition(d)}>
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
          {sel && (
            <div className="tooth-detail" aria-live="polite">
              <h3>Diş {tooth}</h3>
              {sel.done.length + sel.planned.length + sel.findings.length === 0 ? <p className="muted small">Bu dişe ait kayıt yok.</p> : (
                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                  <div><h4 className="small muted">Uygulanan işlemler</h4>{sel.done.length ? sel.done.map((x) => <p key={x.id} className="small"><strong>{x.code}</strong> {x.name}{x.location.surfaces?.length ? ` (${x.location.surfaces.join("")})` : ""} · {fmtDate(x.at)} · {x.practitioner}</p>) : <p className="small muted">Yok</p>}</div>
                  <div><h4 className="small muted">Planlanan</h4>{sel.planned.length ? sel.planned.map((x) => <p key={x.id} className="small"><strong>{x.code}</strong> {x.name} · {x.performedQty}/{x.quantity}</p>) : <p className="small muted">Yok</p>}</div>
                  <div><h4 className="small muted">Mevcut durum</h4>{sel.findings.length ? sel.findings.map((x) => <p key={x.id} className="small">{FINDING_LABELS[x.type]}{x.surfaces.length ? ` (${x.surfaces.join("")})` : ""}</p>) : <p className="small muted">Yok</p>}</div>
                </div>
              )}
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
