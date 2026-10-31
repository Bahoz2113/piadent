"use client";
import { useState } from "react";
import { FlaskConical, Plus, Printer } from "lucide-react";
import { LAB_ACTION_LABELS, LAB_COST_STAGE_LABELS, LAB_STATUS_LABELS, LAB_TRANSITIONS, formatTRY, type LabAction, type LabStatus } from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime, todayIn } from "@/lib/format";
import { Alert, Drawer, EmptyState, ErrorState, Loading, SelectField, TextAreaField, TextField, DateField } from "@/components/ui";
import { parseMoneyInput } from "@/components/finance/money-input";

export interface LabOrder {
  id: string; orderNo: number; patientId: string; patient: string; practitionerId: string; practitioner: string; supplierId: string; supplier: string;
  workType: string; teeth: string[]; shade: string | null; instructions: string | null; targetDate: string | null; status: LabStatus; revisionCount: number;
  sentAt: string | null; receivedAt: string | null; acceptedAt: string | null; cancelReason: string | null; appointmentId: string | null; appointmentAt: string | null;
  version: number; createdAt: string; overdue: boolean; cost?: string;
}
interface LabDetail extends LabOrder {
  events: { id: string; kind: string; from: string | null; to: string | null; note: string | null; at: string; by: string }[];
  costs?: { id: string; stage: keyof typeof LAB_COST_STAGE_LABELS; revisionNo: number; amount: string; description: string; reversal: boolean; reversed: boolean; reason: string | null; at: string; by: string }[];
}
const EVENT_LABELS: Record<string, string> = {
  created: "İş emri açıldı", sent: "Laboratuvara gönderildi", in_production: "Üretimde", received: "Klinikte teslim alındı", revision_requested: "Revizyon istendi",
  accepted: "Hekim kabul etti", cancelled: "İptal edildi", note: "Not", cost_added: "Maliyet eklendi", cost_reversed: "Maliyet ters kayda alındı",
  target_changed: "Hedef teslim değişti", updated: "Bilgiler güncellendi",
};
const TONE: Record<LabStatus, string> = { draft: "neutral", sent: "info", in_production: "info", received: "warning", revision: "warning", accepted: "success", cancelled: "neutral" };

export function LabBadge({ o }: { o: Pick<LabOrder, "status" | "overdue"> }) {
  return <span className={`badge badge-${o.overdue ? "danger" : TONE[o.status]}`}>{LAB_STATUS_LABELS[o.status]}{o.overdue ? " · gecikmiş" : ""}</span>;
}

export function LabOrdersTable({ items, onOpen, showPatient = true }: { items: LabOrder[]; onOpen: (o: LabOrder) => void; showPatient?: boolean }) {
  const withCost = items.some((o) => o.cost !== undefined);
  return (
    <div className="table-wrap">
      <table className="table table-wide">
        <thead><tr><th>No</th>{showPatient && <th>Hasta</th>}<th>İş</th><th>Laboratuvar</th><th>Aşama</th><th>Hedef teslim</th>{withCost && <th className="money">Maliyet</th>}<th><span className="sr-only">Aç</span></th></tr></thead>
        <tbody>{items.map((o) => (
          <tr key={o.id}>
            <td>{o.orderNo}</td>
            {showPatient && <td>{o.patient}</td>}
            <td><strong>{o.workType}</strong>{o.teeth.length > 0 && <div className="small muted">Diş {o.teeth.join(", ")}{o.shade ? ` · renk ${o.shade}` : ""}</div>}</td>
            <td>{o.supplier}</td>
            <td><LabBadge o={o} />{o.revisionCount > 0 && <div className="small muted">{o.revisionCount}. revizyon</div>}</td>
            <td>{o.targetDate ? fmtDate(o.targetDate) : "—"}{o.appointmentAt && <div className="small muted">Randevu {fmtDateTime(o.appointmentAt)}</div>}</td>
            {withCost && <td className="money">{o.cost ? formatTRY(o.cost) : "—"}</td>}
            <td><button className="btn btn-sm" onClick={() => onOpen(o)}>Aç</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Hasta 360 → Laboratuvar sekmesi. */
export function PatientLabTab({ patientId }: { patientId: string }) {
  const { can } = useSession();
  const list = useData<{ items: LabOrder[] }>(`/patients/${patientId}/lab-orders`);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (list.loading && !list.data) return <div className="card"><Loading /></div>;
  if (list.error) return <div className="card"><ErrorState error={list.error} /></div>;
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Laboratuvar işleri</h2><p className="muted small">Gönderim, üretim, teslim ve hekim kabulü ayrı aşamalardır; revizyon yeni aşama ve (varsa) yeni maliyettir.</p></div>
        {can("lab.write") && <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}><Plus size={15} aria-hidden />Yeni iş emri</button>}
      </div>
      {msg && <div style={{ padding: "0 20px" }}><Alert kind="success">{msg}</Alert></div>}
      {list.data!.items.length === 0 ? <EmptyState icon={<FlaskConical size={28} />} title="Laboratuvar işi yok" /> : <LabOrdersTable items={list.data!.items} showPatient={false} onOpen={(o) => setOpen(o.id)} />}
      {creating && <NewLabOrderDrawer patientId={patientId} onClose={() => setCreating(false)} onSaved={(no, id) => { setCreating(false); setMsg(`İş emri ${no} taslak olarak açıldı.`); void list.reload(); setOpen(id); }} />}
      {open && <LabOrderDrawer id={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()} />}
    </section>
  );
}

/** İş föyünü yeni pencerede düz metin olarak yazdırır (hasta kimliği/iletişim içermez). */
function printSheet(sheet: Record<string, unknown>) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.title = `İş föyü ${String(sheet.orderNo)}`;
  const pre = w.document.createElement("pre");
  pre.style.cssText = "white-space:pre-wrap;font:14px/1.6 system-ui;margin:32px";
  pre.textContent = [`LABORATUVAR İŞ FÖYÜ · ${String(sheet.clinic)}`, "", `Laboratuvar: ${String(sheet.supplier)}`, `Hasta / iş: ${String(sheet.patientRef)}`,
    `Hekim: ${String(sheet.practitioner)}`, `İş: ${String(sheet.workType)}`, `Dişler: ${(sheet.teeth as string[]).join(", ") || "—"}`, `Renk: ${String(sheet.shade ?? "—")}`,
    `Hedef teslim: ${sheet.targetDate ? fmtDate(String(sheet.targetDate)) : "—"}`, `Revizyon: ${String(sheet.revision)}`, "", `Talimat: ${String(sheet.instructions ?? "—")}`, "",
    String(sheet.notice)].join("\n");
  w.document.body.appendChild(pre);
  w.print();
}

function parseTeeth(s: string) { return s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean); }

export function NewLabOrderDrawer({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: (no: number, id: string) => void }) {
  const { tz, can } = useSession();
  const labs = useData<{ items: { id: string; name: string; active: boolean }[] }>("/suppliers?kind=lab");
  const res = useData<{ practitioners: { id: string; name: string }[] }>("/resources");
  const appts = useData<{ items: { id: string; startsAt: string; status: string; practitionerName?: string }[] }>(`/patients/${patientId}/appointments`);
  const [f, setF] = useState({ supplierId: "", practitionerId: "", workType: "", teeth: "", shade: "", instructions: "", targetDate: "", appointmentId: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const upcoming = (appts.data?.items ?? []).filter((a) => ["planned", "confirmed"].includes(a.status) && a.startsAt >= new Date().toISOString());
  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ id: string; orderNo: number }>("/lab-orders", { body: { patientId, supplierId: f.supplierId, practitionerId: f.practitionerId || undefined,
        workType: f.workType, teeth: parseTeeth(f.teeth), shade: f.shade, instructions: f.instructions, targetDate: f.targetDate || undefined, appointmentId: f.appointmentId || undefined } });
      onSaved(r.orderNo, r.id);
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Yeni laboratuvar iş emri" subtitle="Taslak açılır; laboratuvara gönderim ayrı adımdır." onClose={onClose} dirty={!!f.workType}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !f.supplierId || f.workType.trim().length < 2} onClick={() => void save()}>Taslak oluştur</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        {labs.data && labs.data.items.filter((l) => l.active).length === 0 && <Alert kind="warning">Tanımlı laboratuvar yok. {can("supplier.manage") ? "Operasyon → Tedarikçiler'den ekleyin." : "Yöneticiden laboratuvar tanımlamasını isteyin."}</Alert>}
        <SelectField label="Laboratuvar" required value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} error={err?.fieldErrors.supplierId}>
          <option value="">Seçin</option>{labs.data?.items.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </SelectField>
        <SelectField label="Hekim" value={f.practitionerId} onChange={(e) => setF({ ...f, practitionerId: e.target.value })} error={err?.fieldErrors.practitionerId}
          hint="Boş bırakırsanız hekim kullanıcısı kendisi atanır.">
          <option value="">{can("lab.decide") ? "Ben" : "Seçin"}</option>{res.data?.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
        <TextField label="İş tanımı" required placeholder="Örn. Zirkonyum kron" value={f.workType} onChange={(e) => setF({ ...f, workType: e.target.value })} error={err?.fieldErrors.workType} />
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <TextField label="Dişler (FDI)" placeholder="16, 17" value={f.teeth} onChange={(e) => setF({ ...f, teeth: e.target.value })} error={err?.fieldErrors.teeth ?? err?.fieldErrors["teeth.0"]} />
          <TextField label="Renk" placeholder="A2" value={f.shade} onChange={(e) => setF({ ...f, shade: e.target.value })} />
          <DateField label="Hedef teslim" min={todayIn(tz)} value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} error={err?.fieldErrors.targetDate} />
        </div>
        <TextAreaField label="Teknik talimat (laboratuvara gider)" rows={3} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })}
          hint="Yalnız teknik bilgi yazın; tanı, sağlık öyküsü veya iletişim bilgisi yazmayın." />
        <SelectField label="Prova / teslim randevusu (isteğe bağlı)" value={f.appointmentId} onChange={(e) => setF({ ...f, appointmentId: e.target.value })}
          hint="Bağlanırsa randevudan bir gün önce iş klinikte değilse sekreterliğe görev düşer.">
          <option value="">Bağlama</option>{upcoming.map((a) => <option key={a.id} value={a.id}>{fmtDateTime(a.startsAt, tz)}{a.practitionerName ? ` · ${a.practitionerName}` : ""}</option>)}
        </SelectField>
      </div>
    </Drawer>
  );
}

export function LabOrderDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can, tz } = useSession();
  const d = useData<LabDetail>(`/lab-orders/${id}`);
  const [action, setAction] = useState<LabAction | null>(null);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | Record<string, unknown>>(null);
  const [cost, setCost] = useState<null | { stage: keyof typeof LAB_COST_STAGE_LABELS; amount: string; description: string; key: string }>(null);
  const [reverse, setReverse] = useState<null | { id: string; reason: string }>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); setAction(null); setNote(""); setTarget(""); setCost(null); setReverse(null); await d.reload(); onChanged(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  if (d.loading && !d.data) return <Drawer title="İş emri" onClose={onClose}><Loading /></Drawer>;
  if (d.error) return <Drawer title="İş emri" onClose={onClose}><ErrorState error={d.error} /></Drawer>;
  const o = d.data!;
  const actions = (Object.keys(LAB_TRANSITIONS) as LabAction[]).filter((a) => LAB_TRANSITIONS[a].from.includes(o.status))
    .filter((a) => (a === "accept" || a === "revision" ? can("lab.decide") : can("lab.write")));
  const needsNote = action === "revision" || action === "cancel";
  const needsTarget = action === "send" || action === "revision";
  return (
    <Drawer title={`İş emri ${o.orderNo} · ${o.workType}`} subtitle={<>{o.patient} · {o.supplier} · <LabBadge o={o} /></>} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        {err && <Alert kind="error">{err.message}</Alert>}
        <dl className="kv">
          <dt>Hekim</dt><dd>{o.practitioner}</dd>
          <dt>Dişler</dt><dd>{o.teeth.length ? o.teeth.join(", ") : "—"}{o.shade ? ` · renk ${o.shade}` : ""}</dd>
          <dt>Hedef teslim</dt><dd>{o.targetDate ? fmtDate(o.targetDate) : "—"}{o.overdue && <span className="badge badge-danger" style={{ marginLeft: 6 }}>Gecikmiş</span>}</dd>
          <dt>Randevu</dt><dd>{o.appointmentAt ? fmtDateTime(o.appointmentAt, tz) : "—"}</dd>
          {o.instructions && <><dt>Talimat</dt><dd>{o.instructions}</dd></>}
          {o.cancelReason && <><dt>İptal gerekçesi</dt><dd>{o.cancelReason}</dd></>}
        </dl>
        {actions.length > 0 && !action && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {actions.map((a) => <button key={a} className={`btn btn-sm ${a === "accept" || a === "send" || a === "receive" ? "btn-primary" : ""}`} onClick={() => { setAction(a); setTarget(o.targetDate ?? ""); }}>{LAB_ACTION_LABELS[a]}</button>)}
          </div>
        )}
        {action && (
          <div className="card card-pad stack" style={{ gap: 10 }}>
            <strong>{LAB_ACTION_LABELS[action]}</strong>
            {action === "receive" && <p className="small muted">Teslim alındı, kabul demek değildir; hekim prova/kontrol sonrası kabul eder veya revizyon ister.</p>}
            {needsTarget && <DateField label={action === "revision" ? "Yeni hedef teslim" : "Hedef teslim"} required value={target} onChange={(e) => setTarget(e.target.value)} error={err?.fieldErrors.targetDate} />}
            <TextAreaField label={needsNote ? (action === "revision" ? "Revizyon gerekçesi" : "İptal gerekçesi") : "Not (isteğe bağlı)"} required={needsNote} rows={2} value={note} onChange={(e) => setNote(e.target.value)} error={err?.fieldErrors.note} />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm" onClick={() => setAction(null)}>Vazgeç</button>
              <button className="btn btn-sm btn-primary" disabled={busy || (needsNote && note.trim().length < 3) || (needsTarget && !target)}
                onClick={() => void run(() => api(`/lab-orders/${o.id}/transition`, { body: { action, note: note || undefined, targetDate: target || undefined } }))}>Kaydet</button>
            </div>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={() => void api<Record<string, unknown>>(`/lab-orders/${o.id}/work-sheet`).then(setSheet, (e) => setErr(e as ApiFailure))}><Printer size={14} aria-hidden />İş föyü</button>
        </div>
        {sheet && (
          <div className="card card-pad" aria-label="Laboratuvar iş föyü">
            <h3>Laboratuvar iş föyü · {String(sheet.clinic)}</h3>
            <dl className="kv">
              <dt>Laboratuvar</dt><dd>{String(sheet.supplier)}</dd><dt>Hasta / iş</dt><dd>{String(sheet.patientRef)}</dd><dt>Hekim</dt><dd>{String(sheet.practitioner)}</dd>
              <dt>İş</dt><dd>{String(sheet.workType)}</dd><dt>Dişler</dt><dd>{(sheet.teeth as string[]).join(", ") || "—"}</dd><dt>Renk</dt><dd>{String(sheet.shade ?? "—")}</dd>
              <dt>Hedef teslim</dt><dd>{sheet.targetDate ? fmtDate(String(sheet.targetDate)) : "—"}</dd><dt>Talimat</dt><dd>{String(sheet.instructions ?? "—")}</dd>
            </dl>
            <p className="small muted">{String(sheet.notice)}</p>
            <button className="btn btn-sm" onClick={() => printSheet(sheet)}>Yazdır</button>
          </div>
        )}
        {o.costs && (
          <section>
            <div className="row" style={{ justifyContent: "space-between" }}><h3>Maliyet</h3><strong>{formatTRY(o.cost ?? "0")}</strong></div>
            <p className="small muted">Her maliyet satırı laboratuvar carisine borç yazar; düzeltme ters kayıtla yapılır.</p>
            {o.costs.length === 0 ? <p className="muted small">Maliyet girilmedi.</p> : (
              <ul className="list">{o.costs.map((c) => (
                <li key={c.id} className="row small" style={{ justifyContent: "space-between", padding: "6px 0", gap: 8 }}>
                  <span>{LAB_COST_STAGE_LABELS[c.stage]}{c.stage === "revision" ? ` ${c.revisionNo}` : ""} · {c.description}{c.reversal && <span className="muted"> (ters kayıt: {c.reason})</span>}<div className="muted">{fmtDateTime(c.at, tz)} · {c.by}</div></span>
                  <span className="row" style={{ gap: 6 }}><strong>{formatTRY(c.amount)}</strong>
                    {!c.reversal && !c.reversed && can("lab.cost") && <button className="btn btn-sm btn-ghost" onClick={() => setReverse({ id: c.id, reason: "" })}>Ters kayıt</button>}</span>
                </li>))}</ul>)}
            {can("lab.cost") && o.status !== "draft" && !cost && <button className="btn btn-sm" onClick={() => setCost({ stage: o.revisionCount > 0 ? "revision" : "initial", amount: "", description: o.workType, key: newIdempotencyKey() })}>Maliyet ekle</button>}
            {cost && (
              <div className="card card-pad stack" style={{ gap: 8 }}>
                <SelectField label="Aşama" value={cost.stage} onChange={(e) => setCost({ ...cost, stage: e.target.value as typeof cost.stage })}>
                  {Object.entries(LAB_COST_STAGE_LABELS).filter(([k]) => k !== "revision" || o.revisionCount > 0).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </SelectField>
                <TextField label="Tutar (₺)" inputMode="decimal" required value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} error={err?.fieldErrors.amount} />
                <TextField label="Açıklama" required value={cost.description} onChange={(e) => setCost({ ...cost, description: e.target.value })} />
                <div className="row" style={{ gap: 8 }}><button className="btn btn-sm" onClick={() => setCost(null)}>Vazgeç</button>
                  <button className="btn btn-sm btn-primary" disabled={busy || !parseMoneyInput(cost.amount)}
                    onClick={() => void run(() => api(`/lab-orders/${o.id}/costs`, { body: { stage: cost.stage, amount: parseMoneyInput(cost.amount), description: cost.description }, idempotencyKey: cost.key }))}>Kaydet</button></div>
              </div>
            )}
            {reverse && (
              <div className="card card-pad stack" style={{ gap: 8 }}>
                <TextAreaField label="Ters kayıt gerekçesi" required rows={2} value={reverse.reason} onChange={(e) => setReverse({ ...reverse, reason: e.target.value })} />
                <div className="row" style={{ gap: 8 }}><button className="btn btn-sm" onClick={() => setReverse(null)}>Vazgeç</button>
                  <button className="btn btn-sm btn-primary" disabled={busy || reverse.reason.trim().length < 3} onClick={() => void run(() => api(`/lab-costs/${reverse.id}/reverse`, { body: { reason: reverse.reason } }))}>Ters kayda al</button></div>
              </div>
            )}
          </section>
        )}
        <section>
          <h3>Olaylar</h3>
          <ol className="lab-events">{o.events.map((e) => (
            <li key={e.id} className="small"><strong>{EVENT_LABELS[e.kind] ?? e.kind}</strong> · {fmtDateTime(e.at, tz)} · {e.by}{e.note && <div className="muted">{e.note}</div>}</li>
          ))}</ol>
        </section>
      </div>
    </Drawer>
  );
}
