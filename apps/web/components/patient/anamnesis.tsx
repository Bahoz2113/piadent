"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { ANAMNESIS_VALUE_LABELS, questionLabel, type AnamnesisAnswers, type AnamnesisQuestion, type AnamnesisValue } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime } from "@/lib/format";
import { Alert, ErrorState, Loading } from "@/components/ui";

interface Data {
  questionnaire: { version: string; demo: boolean; title: string; templateId: string | null; questions: AnamnesisQuestion[] };
  current: { version: number; answers: AnamnesisAnswers; criticalFlags: string[]; createdAt: string; recordedBy: string; reviewedAt: string | null; reviewedBy: string | null; questions: AnamnesisQuestion[]; outdated: boolean; questionnaireVersion: string } | null;
  history: { version: number; createdAt: string; recordedBy: string; reviewedAt: string | null; reviewedBy: string | null; criticalFlags: string[] }[];
}

/** Sürümlü anamnez: yanıtsız/hayır/evet/bilmiyor ayrı; her kayıt yeni sürüm; hekim onayı ayrı kayıt. */
export function AnamnesisPanel({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const { can, tz } = useSession();
  const d = useData<Data>(`/patients/${patientId}/anamnesis`);
  const [answers, setAnswers] = useState<AnamnesisAnswers>({});
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewVersion, setViewVersion] = useState<{ version: number; answers: AnamnesisAnswers; questions?: AnamnesisQuestion[] } | null>(null);
  useEffect(() => { if (d.data) setAnswers(d.data.current?.answers ?? {}); }, [d.data]);

  if (d.loading && !d.data) return <div className="card"><Loading /></div>;
  if (d.error) return <div className="card"><ErrorState error={d.error} /></div>;
  const data = d.data!;
  const cur = data.current;
  const dirty = JSON.stringify(answers) !== JSON.stringify(cur?.answers ?? {});
  const canWrite = can("anamnesis.write");

  function setVal(key: string, value: AnamnesisValue | null) {
    const next = { ...answers };
    if (value === null) delete next[key]; else next[key] = { value, detail: value === "yes" ? answers[key]?.detail : undefined };
    setAnswers(next);
  }
  async function save() {
    setBusy(true); setErr(null);
    try {
      await api(`/patients/${patientId}/anamnesis`, { body: { basedOnVersion: cur?.version ?? 0, answers } });
      setEditing(false); await d.reload(); onSaved();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  async function review() {
    if (!cur) return;
    setBusy(true); setErr(null);
    try { await api(`/patients/${patientId}/anamnesis/${cur.version}/review`, { body: {} }); await d.reload(); onSaved(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  async function openVersion(v: number) {
    const r = await api<{ version: number; answers: AnamnesisAnswers; questions: AnamnesisQuestion[] }>(`/patients/${patientId}/anamnesis/${v}`);
    setViewVersion(r);
  }

  const shown = viewVersion?.answers ?? answers;
  const questions: AnamnesisQuestion[] = editing ? data.questionnaire.questions : (viewVersion?.questions ?? cur?.questions ?? data.questionnaire.questions);
  return (
    <div className="grid grid-2">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Anamnez {cur ? `· sürüm ${cur.version}` : ""}{viewVersion ? ` (görüntülenen: sürüm ${viewVersion.version})` : ""}</h2>
            <p className="muted small">{cur ? `${cur.recordedBy} · ${fmtDateTime(cur.createdAt, tz)}` : "Henüz kayıt yok"}</p>
          </div>
          <div className="row">
            {cur && !cur.reviewedAt && can("anamnesis.review") && !editing && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void review()}><CheckCircle2 size={15} aria-hidden />Gözden geçirdim, onayla</button>}
            {canWrite && !editing && !viewVersion && <button className="btn btn-sm" onClick={() => setEditing(true)}>{cur ? "Güncelle" : "Anamnez gir"}</button>}
            {viewVersion && <button className="btn btn-sm" onClick={() => setViewVersion(null)}>Güncel sürüme dön</button>}
          </div>
        </div>
        <div className="card-pad stack" style={{ gap: 8 }}>
          {data.questionnaire.demo && <Alert kind="info">Soru seti yerleşik DEMO settir ({data.questionnaire.version}); Yönetim → Anamnez şablonu bölümünden kliniğin formu yayınlanabilir. Kritik işaretler tıbbi karar değildir.</Alert>}
          {!data.questionnaire.demo && <p className="small muted">Form: {data.questionnaire.title} ({data.questionnaire.version})</p>}
          {cur?.outdated && !editing && !viewVersion && <Alert kind="warning">Bu kayıt eski bir soru setiyle alındı ({cur.questionnaireVersion}); yanıtlar o sorularla gösteriliyor. Güncelleme yürürlükteki formla alınır.</Alert>}
          {err && <Alert kind="error">{err.message}{err.code === "VERSION_CONFLICT" && <div><button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => { void d.reload(); setEditing(false); }}>Son sürümü yükle</button></div>}</Alert>}
          {cur && (cur.reviewedAt
            ? <p className="small" style={{ color: "var(--success)" }}><CheckCircle2 size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Hekim onayı: {cur.reviewedBy}, {fmtDateTime(cur.reviewedAt, tz)}</p>
            : <p className="small" style={{ color: "var(--warning)" }}><AlertTriangle size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Hekim onayı bekliyor</p>)}
          <div>
            {questions.map((q) => {
              const a = shown[q.key];
              const val: AnamnesisValue | "unanswered" = a?.value ?? "unanswered";
              return (
                <div key={q.key} className="q-row">
                  <div>
                    <span>{q.label}</span> {q.critical && <span className="small muted">(kritik)</span>}
                    {!editing && a?.detail && <div className="small muted">{a.detail}</div>}
                  </div>
                  {editing ? (
                    <div className="tri" role="group" aria-label={q.label}>
                      {(["yes", "no", "unknown"] as const).map((v) => (
                        <button key={v} type="button" className={`v-${v}`} aria-pressed={val === v} onClick={() => setVal(q.key, val === v ? null : v)}>{ANAMNESIS_VALUE_LABELS[v]}</button>
                      ))}
                    </div>
                  ) : (
                    <span className={`badge ${val === "yes" ? (q.critical ? "badge-error" : "badge-warning") : val === "no" ? "badge-success" : "badge-neutral"}`}>{ANAMNESIS_VALUE_LABELS[val]}</span>
                  )}
                  {editing && val === "yes" && (
                    <input className="input detail" aria-label={`${q.label} ayrıntı`} placeholder={q.detailHint ?? "Ayrıntı"} value={a?.detail ?? ""}
                      onChange={(e) => setAnswers({ ...answers, [q.key]: { value: "yes", detail: e.target.value || undefined } })} />
                  )}
                </div>
              );
            })}
          </div>
          {editing && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Kaydediliyor…" : `Sürüm ${(cur?.version ?? 0) + 1} olarak kaydet`}</button>
              <button className="btn" onClick={() => { setAnswers(cur?.answers ?? {}); setEditing(false); }}>Vazgeç</button>
              {!can("anamnesis.review") && <span className="small muted">Kaydınız hekim onayına düşecek.</span>}
            </div>
          )}
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Sürüm geçmişi</h2></div>
        {data.history.length === 0 ? <p className="card-pad muted">Kayıt yok.</p> : (
          <ul className="list">
            {data.history.map((h) => (
              <li key={h.version} style={{ padding: "10px 20px" }} className="row">
                <div style={{ flex: 1 }}>
                  <strong>Sürüm {h.version}</strong> <span className="muted small">· {h.recordedBy} · {fmtDateTime(h.createdAt, tz)}</span>
                  <div className="small">{h.criticalFlags.length ? h.criticalFlags.map((f) => questionLabel(f, cur?.questions ?? data.questionnaire.questions)).join(", ") : "Kritik işaret yok"} · {h.reviewedAt ? `Onay: ${h.reviewedBy}` : "Onay bekliyor"}</div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => void openVersion(h.version)}>Görüntüle</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
