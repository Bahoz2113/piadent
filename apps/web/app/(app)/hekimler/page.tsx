"use client";
/**
 * Hekimler modülü (ürün sahibi geri bildirimi 04.11.2026 madde 8, ADR-096): hekim listesi, çalışma saatleri, ücret modeli
 * (yalnız prim / sabit maaş / maaş + prim), prim kuralları, aylık hakediş ve ödemeler tek yerde.
 * Ücret ve hakediş yalnız finans okuma yetkisiyle görünür; model ve kural değişikliği finans ayarı, ödeme prim ödeme yetkisi ister.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { BriefcaseMedical, Clock, Pencil, Plus, Wallet } from "lucide-react";
import { COMMISSION_BASIS_LABELS, PAY_MODEL_LABELS, formatTRY, type PayModel } from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime, todayIn } from "@/lib/format";
import { Alert, DateField, Drawer, EmptyState, ErrorState, Loading, SelectField, TextField, useToast } from "@/components/ui";
import { PractitionerDrawer, ScheduleDrawer, useAdminResources, type Prac } from "@/components/admin/resources";
import { parseMoneyInput } from "@/components/finance/money-input";
import { alertDialog, promptDialog } from "@/components/dialogs";

interface Block { weekday: number; start: number; end: number }
interface Row {
  id: string; name: string; title: string | null; active: boolean; memberName: string | null; schedule: Block[]; weeklyMinutes: number;
  month: { appointments: number; completed: number; noShow: number };
  pay: null | { model: PayModel | null; monthlySalary: string | null; commissionPayable: string; salaryDue: string; salaryPaid: string };
}
interface Comp {
  practitioner: { id: string; name: string };
  current: null | { payModel: PayModel; monthlySalary: string | null; validFrom: string };
  versions: { id: string; payModel: PayModel; monthlySalary: string | null; validFrom: string; note: string | null; createdAt: string; by: string; state: "current" | "scheduled" | "superseded" }[];
  rules: { id: string; scope: "practitioner" | "clinic"; basis: keyof typeof COMMISSION_BASIS_LABELS; rate: string; validFrom: string; note: string | null }[];
  months: { month: string; salaryDue: string; salaryPaid: string; salaryRemaining: string; commissionAccrued: string; commissionPaid: string }[];
  totals: { commissionAccrued: string; commissionPaid: string; commissionPayable: string; salaryOutstanding: string };
  salaryPayments: { id: string; period: string; amount: string; paidAt: string; note: string | null; reversal: boolean; reason: string | null; reversed: boolean; account: string; by: string }[];
  commissionPayouts: { id: string; amount: string; paidAt: string; note: string | null; reversal: boolean; account: string }[];
}
type Notify = (k: "success" | "error", t: string) => void;

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" });
};
const modelLabel = (p: Row["pay"]) => (p?.model ? PAY_MODEL_LABELS[p.model] : "Tanımsız (prim kuralları)");
const toInput = (v: string) => v.replace(".", ",");
const positive = (v: string) => Number(v) > 0;

function Inner() {
  const { can } = useSession();
  const router = useRouter();
  const params = useSearchParams() ?? new URLSearchParams();
  const selected = params.get("hekim");
  const list = useData<{ month: string; items: Row[] }>("/practitioners/overview");
  const admin = useAdminResources(can("schedule.manage"));
  const toast = useToast();
  const [editing, setEditing] = useState<Prac | "new" | null>(null);
  const [schedule, setSchedule] = useState<Prac | null>(null);
  const finance = can("finance.read");
  const select = (id: string | null) => router.replace(id ? `/hekimler?hekim=${id}` : "/hekimler", { scroll: false });
  const pracFor = (id: string) => admin.data?.practitioners.find((p) => p.id === id) ?? null;
  const reloadAll = () => { void list.reload(); void admin.reload(); };

  if (list.loading && !list.data) return <div className="card"><Loading /></div>;
  if (list.error) return <div className="card"><ErrorState error={list.error} onRetry={list.reload} /></div>;
  const items = list.data!.items;
  const cur = items.find((r) => r.id === selected) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hekimler</h1>
          <p className="muted">Hekim kartları, ücret modeli, prim ve maaş hakedişi · {monthLabel(list.data!.month)}</p>
        </div>
        {can("schedule.manage") && <button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={17} aria-hidden />Hekim ekle</button>}
      </div>
      {toast.node}

      <section className="card" style={{ marginBottom: 16 }}>
        {items.length === 0 ? <EmptyState icon={<BriefcaseMedical size={28} />} title="Henüz hekim yok">Randevu verebilmek için önce hekim ekleyin.</EmptyState> : (
          <div className="table-wrap" tabIndex={0}>
            <table className="table table-wide">
              <thead><tr><th>Hekim</th>
                {finance && <><th>Ücret modeli</th><th className="money">Prim bakiyesi</th><th className="money">Bu ay kalan maaş</th></>}</tr></thead>
              <tbody>{items.map((r) => (
                <tr key={r.id} className={`row-click ${r.id === selected ? "is-selected" : ""}`} aria-selected={r.id === selected}
                  onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,input,select")) return; select(r.id === selected ? null : r.id); }}>
                  <td><button className="link-button" onClick={() => select(r.id)}><strong>{r.name}</strong></button>{!r.active && <> <span className="badge badge-neutral">Pasif</span></>}
                    <div className="small muted">{r.title ?? (r.memberName ? `Kullanıcı: ${r.memberName}` : "Kullanıcıya bağlı değil")}</div></td>
                  {finance && <>
                    <td>{modelLabel(r.pay)}{r.pay?.monthlySalary && <div className="small muted">{formatTRY(r.pay.monthlySalary)} / ay</div>}</td>
                    <td className="money">{formatTRY(r.pay?.commissionPayable ?? "0")}</td>
                    <td className="money">{formatTRY(String(Number(r.pay?.salaryDue ?? 0) - Number(r.pay?.salaryPaid ?? 0)))}</td>
                  </>}
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </section>

      {cur ? (
        <section className="stack" aria-label={`${cur.name} ayrıntısı`}>
          <div className="card">
            <div className="card-head">
              <div><h2>{cur.name}</h2><p className="muted small">{cur.title ?? "Unvan girilmemiş"}{cur.memberName ? ` · Kullanıcı: ${cur.memberName}` : ""}</p></div>
              {can("schedule.manage") && pracFor(cur.id) && (
                <div className="row">
                  <button className="btn btn-sm" onClick={() => setSchedule(pracFor(cur.id))}><Clock size={15} aria-hidden />Çalışma saatleri</button>
                  <button className="btn btn-sm" onClick={() => setEditing(pracFor(cur.id))}><Pencil size={15} aria-hidden />Düzenle</button>
                </div>
              )}
            </div>
          </div>
          {finance ? <Compensation id={cur.id} notify={toast.show} onChanged={() => void list.reload()} />
            : <Alert kind="info">Ücret, prim ve maaş bilgileri yalnız finans yetkisi olan kullanıcılara görünür.</Alert>}
        </section>
      ) : items.length > 0 && <p className="muted small">Ayrıntı, ücret modeli ve hakediş için listeden bir hekim seçin.</p>}

      {editing && <PractitionerDrawer p={editing === "new" ? null : editing} dentists={admin.data?.dentistMemberships ?? []} onClose={() => setEditing(null)}
        onSaved={(m) => { setEditing(null); toast.show("success", m); reloadAll(); }} />}
      {schedule && <ScheduleDrawer p={schedule} onClose={() => setSchedule(null)} onSaved={() => { setSchedule(null); toast.show("success", "Çalışma saatleri kaydedildi."); reloadAll(); }} />}
    </>
  );
}

function Compensation({ id, notify, onChanged }: { id: string; notify: Notify; onChanged: () => void }) {
  const { can, tz } = useSession();
  const d = useData<Comp>(`/practitioners/${id}/compensation`);
  const accts = useData<{ items: { id: string; name: string; active: boolean }[] }>(can("commission.payout") ? "/cash-accounts" : null);
  const [drawer, setDrawer] = useState<null | "model" | "rule" | "salary" | "commission">(null);
  if (d.loading && !d.data) return <div className="card"><Loading /></div>;
  if (d.error) return <div className="card"><ErrorState error={d.error} onRetry={d.reload} /></div>;
  const c = d.data!;
  const done = (m: string) => { setDrawer(null); notify("success", m); void d.reload(); onChanged(); };
  const thisMonth = c.months[c.months.length - 1]!;
  const payable = c.months.filter((m) => positive(m.salaryRemaining));
  const cash = accts.data?.items.filter((a) => a.active) ?? [];

  async function reverse(pid: string) {
    const reason = await promptDialog({ title: "Maaş ödemesini ters kayda al", message: "Ödeme silinmez; aynı tutarda ters kayıt oluşur ve kasa bakiyesi geri döner.",
      inputLabel: "Gerekçe", required: true, confirmLabel: "Ters kayda al", danger: true });
    if (!reason) return;
    try { await api(`/salary-payments/${pid}/reverse`, { body: { reason } }); done("Maaş ödemesi ters kayda alındı."); }
    catch (e) { await alertDialog({ title: "İşlem yapılamadı", message: (e as ApiFailure).message }); }
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div><h2>Ücret ve hakediş</h2><p className="muted small">Klinik içi hakediş takibidir; bordro, SGK ve stopaj hesabı yapılmaz — mali müşavirinizle doğrulayın.</p></div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {can("finance.settings") && <button className="btn btn-sm" onClick={() => setDrawer("model")}>Ücret modelini değiştir</button>}
            {can("finance.settings") && <button className="btn btn-sm" onClick={() => setDrawer("rule")}>Prim kuralı ekle</button>}
            {can("commission.payout") && payable.length > 0 && <button className="btn btn-sm btn-primary" onClick={() => setDrawer("salary")}><Wallet size={15} aria-hidden />Maaş öde</button>}
            {can("commission.payout") && positive(c.totals.commissionPayable) && <button className="btn btn-sm btn-primary" onClick={() => setDrawer("commission")}>Prim öde</button>}
          </div>
        </div>
        <div className="card-pad kpis" style={{ marginBottom: 0 }}>
          <div className="kpi card"><div className="kpi-top"><span className="kpi-label">Ücret modeli</span></div>
            <div className="kpi-value" style={{ fontSize: "1.2rem" }}>{c.current ? PAY_MODEL_LABELS[c.current.payModel] : "Tanımsız"}</div>
            <div className="kpi-sub">{c.current ? `${c.current.monthlySalary ? `${formatTRY(c.current.monthlySalary)} / ay · ` : ""}${fmtDate(c.current.validFrom)} itibarıyla` : "Prim kuralları uygulanır"}</div></div>
          <div className="kpi card"><div className="kpi-top"><span className="kpi-label">Bu ay maaş</span></div>
            <div className="kpi-value">{formatTRY(thisMonth.salaryRemaining)}</div><div className="kpi-sub">kalan · hakediş {formatTRY(thisMonth.salaryDue)}, ödenen {formatTRY(thisMonth.salaryPaid)}</div></div>
          <div className="kpi card"><div className="kpi-top"><span className="kpi-label">Ödenmemiş maaş (toplam)</span></div>
            <div className="kpi-value">{formatTRY(c.totals.salaryOutstanding)}</div><div className="kpi-sub">Modelin başladığı aydan bu aya</div></div>
          <div className="kpi card"><div className="kpi-top"><span className="kpi-label">Prim bakiyesi</span></div>
            <div className="kpi-value">{formatTRY(c.totals.commissionPayable)}</div><div className="kpi-sub">Net tahakkuk {formatTRY(c.totals.commissionAccrued)} − ödenen {formatTRY(c.totals.commissionPaid)}</div></div>
        </div>
        <h3 className="small muted" style={{ padding: "12px 20px 0", fontWeight: 600 }}>Aylık hakediş · son 12 ay (hareketsiz aylar gizli)</h3>
        <div className="table-wrap" tabIndex={0}>
          <table className="table table-wide">
            <caption className="sr-only">Son 12 ay hakediş (hareketsiz aylar gizli)</caption>
            <thead><tr><th>Ay</th><th className="money">Maaş hakedişi</th><th className="money">Ödenen maaş</th><th className="money">Kalan maaş</th><th className="money">Prim tahakkuku (net)</th><th className="money">Ödenen prim</th></tr></thead>
            <tbody>{[...c.months].reverse().filter((m, i) => i === 0 || [m.salaryDue, m.salaryPaid, m.commissionAccrued, m.commissionPaid].some((v) => Number(v) !== 0)).map((m) => (
              <tr key={m.month}><td>{monthLabel(m.month)}</td><td className="money">{formatTRY(m.salaryDue)}</td><td className="money">{formatTRY(m.salaryPaid)}</td>
                <td className="money"><strong>{formatTRY(m.salaryRemaining)}</strong></td><td className="money">{formatTRY(m.commissionAccrued)}</td><td className="money">{formatTRY(m.commissionPaid)}</td></tr>))}</tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-head"><h2>Ücret modeli geçmişi</h2></div>
          {c.versions.length === 0 ? <p className="card-pad muted small">Ücret modeli tanımlanmamış; hekim için geçerli prim kuralları uygulanır.</p> : (
            <ul className="list">{c.versions.map((v) => (
              <li key={v.id} className="row" style={{ padding: "10px 20px", justifyContent: "space-between", gap: 8 }}>
                <span><strong>{PAY_MODEL_LABELS[v.payModel]}</strong>{v.monthlySalary && ` · ${formatTRY(v.monthlySalary)} / ay`}
                  <span className="small muted"> · {fmtDate(v.validFrom)} · {v.by}{v.note ? ` · ${v.note}` : ""}</span></span>
                <span className={`badge ${v.state === "current" ? "badge-success" : v.state === "scheduled" ? "badge-info" : "badge-neutral"}`}>
                  {v.state === "current" ? "Geçerli" : v.state === "scheduled" ? "Planlı" : "Önceki"}</span>
              </li>))}</ul>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Prim kuralları</h2></div>
          {c.rules.length === 0 ? <p className="card-pad muted small">Prim kuralı yok.</p> : (
            <ul className="list">{c.rules.map((r) => (
              <li key={r.id} className="row" style={{ padding: "10px 20px", justifyContent: "space-between", gap: 8 }}>
                <span><strong>%{r.rate.replace(".00", "")}</strong> · {COMMISSION_BASIS_LABELS[r.basis]}<span className="small muted"> · {fmtDate(r.validFrom)} itibarıyla{r.note ? ` · ${r.note}` : ""}</span></span>
                <span className="badge badge-neutral">{r.scope === "practitioner" ? "Bu hekime özel" : "Tüm hekimler"}</span>
              </li>))}</ul>
          )}
          {c.current?.payModel === "salary" && <p className="card-pad small muted" style={{ paddingTop: 0 }}>Sabit maaş modelinde prim kuralları tahakkuk doğurmaz.</p>}
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Ödemeler</h2></div>
        {c.salaryPayments.length === 0 && c.commissionPayouts.length === 0 ? <p className="card-pad muted small">Henüz ödeme yok.</p> : (
          <ul className="list">
            {c.salaryPayments.map((p) => (
              <li key={p.id} className="row small" style={{ padding: "10px 20px", justifyContent: "space-between", gap: 8 }}>
                <span><strong>Maaş · {monthLabel(p.period)}</strong>{p.reversal && " (ters kayıt)"} · {fmtDateTime(p.paidAt, tz)} · {p.account} · {p.by}{p.reason ? ` · ${p.reason}` : ""}{p.note ? ` · ${p.note}` : ""}{p.reversed && " · ters kayda alındı"}</span>
                <span className="row" style={{ gap: 6 }}><strong>{formatTRY(p.amount)}</strong>
                  {can("commission.payout") && !p.reversal && !p.reversed && <button className="btn btn-sm btn-ghost" onClick={() => void reverse(p.id)}>Ters kayıt</button>}</span>
              </li>))}
            {c.commissionPayouts.map((p) => (
              <li key={p.id} className="row small" style={{ padding: "10px 20px", justifyContent: "space-between", gap: 8 }}>
                <span><strong>Prim</strong>{p.reversal && " (ters kayıt)"} · {fmtDateTime(p.paidAt, tz)} · {p.account}{p.note ? ` · ${p.note}` : ""}</span>
                <strong>{formatTRY(p.amount)}</strong>
              </li>))}
          </ul>
        )}
        {c.commissionPayouts.length > 0 && <p className="card-pad small muted" style={{ paddingTop: 0 }}>Prim ödemesinin ters kaydı Finans → Hekim primi sekmesindedir.</p>}
      </section>

      {drawer === "model" && <ModelDrawer id={id} name={c.practitioner.name} current={c.current} onClose={() => setDrawer(null)} onSaved={() => done("Ücret modeli kaydedildi.")} />}
      {drawer === "rule" && <RuleDrawer id={id} name={c.practitioner.name} onClose={() => setDrawer(null)} onSaved={() => done("Prim kuralı eklendi.")} />}
      {drawer === "salary" && <SalaryDrawer id={id} name={c.practitioner.name} months={payable} cash={cash} onClose={() => setDrawer(null)} onSaved={() => done("Maaş ödemesi kaydedildi.")} />}
      {drawer === "commission" && <CommissionDrawer id={id} name={c.practitioner.name} payable={c.totals.commissionPayable} cash={cash} onClose={() => setDrawer(null)} onSaved={() => done("Prim ödemesi kaydedildi.")} />}
    </>
  );
}

function ModelDrawer({ id, name, current, onClose, onSaved }: { id: string; name: string; current: Comp["current"]; onClose: () => void; onSaved: () => void }) {
  const { tz } = useSession();
  const today = todayIn(tz);
  const [f, setF] = useState({ payModel: (current?.payModel ?? "commission") as PayModel, salary: current?.monthlySalary ? toInput(current.monthlySalary) : "", validFrom: today, note: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const needsSalary = f.payModel !== "commission";
  const salary = needsSalary ? parseMoneyInput(f.salary) : null;
  async function save() {
    setBusy(true); setErr(null);
    try {
      await api(`/practitioners/${id}/compensation`, { body: { payModel: f.payModel, monthlySalary: needsSalary ? salary ?? f.salary : undefined, validFrom: f.validFrom, note: f.note || undefined } });
      onSaved();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Ücret modeli" subtitle={name} onClose={onClose} dirty={!!f.note || f.validFrom !== today}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || (needsSalary && !salary)} onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <Alert kind="info">Yeni model seçilen tarihten itibaren geçerlidir; geçmiş tahakkuk ve ödemeler değişmez. Aylık maaş, ayın son gününde geçerli modelden hesaplanır.</Alert>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Ücret modeli</legend>
          {(Object.keys(PAY_MODEL_LABELS) as PayModel[]).map((m) => (
            <label key={m} className="row"><input type="radio" name="pay-model" checked={f.payModel === m} onChange={() => setF({ ...f, payModel: m })} />
              {PAY_MODEL_LABELS[m]}<span className="small muted">{m === "commission" ? " — yalnız prim kurallarıyla" : m === "salary" ? " — prim tahakkuk etmez" : " — maaşa ek prim kuralları uygulanır"}</span></label>
          ))}
        </fieldset>
        {needsSalary && <TextField label="Aylık maaş (₺)" inputMode="decimal" required value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value })} error={err?.fieldErrors.monthlySalary} hint="Örn. 45.000,00" />}
        <DateField label="Geçerlilik başlangıcı" required min={today} today={today} value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} error={err?.fieldErrors.validFrom} />
        <TextField label="Not" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} />
      </div>
    </Drawer>
  );
}

function RuleDrawer({ id, name, onClose, onSaved }: { id: string; name: string; onClose: () => void; onSaved: () => void }) {
  const { tz } = useSession();
  const today = todayIn(tz);
  const [f, setF] = useState({ basis: "treatment" as keyof typeof COMMISSION_BASIS_LABELS, rate: "", validFrom: today, note: "" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr(null);
    try { await api("/commission-rules", { body: { practitionerId: id, basis: f.basis, rate: f.rate.replace(",", "."), validFrom: f.validFrom, note: f.note || undefined } }); onSaved(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Prim kuralı ekle" subtitle={name} onClose={onClose} dirty={!!f.rate}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !f.rate} onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <SelectField label="Prim esası" value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value as typeof f.basis })}>
          {(Object.keys(COMMISSION_BASIS_LABELS) as (keyof typeof COMMISSION_BASIS_LABELS)[]).map((b) => <option key={b} value={b}>{COMMISSION_BASIS_LABELS[b]}</option>)}
        </SelectField>
        <TextField label="Oran (%)" inputMode="decimal" required value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} error={err?.fieldErrors.rate} hint="Örn. 20 veya 12,5" />
        <DateField label="Geçerlilik başlangıcı" required min={today} today={today} value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} error={err?.fieldErrors.validFrom} />
        <TextField label="Not" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} />
      </div>
    </Drawer>
  );
}

function SalaryDrawer({ id, name, months, cash, onClose, onSaved }: { id: string; name: string; months: Comp["months"]; cash: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const last = months[months.length - 1]!;
  const [f, setF] = useState({ period: last.month, amount: toInput(last.salaryRemaining), cashAccountId: cash[0]?.id ?? "", note: "", key: newIdempotencyKey() });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const m = months.find((x) => x.month === f.period) ?? last;
  const amount = parseMoneyInput(f.amount);
  async function save() {
    setBusy(true); setErr(null);
    try { await api("/salary-payments", { idempotencyKey: f.key, body: { practitionerId: id, period: f.period, amount, cashAccountId: f.cashAccountId, note: f.note || undefined } }); onSaved(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Maaş ödemesi" subtitle={`${name} · ${monthLabel(m.month)} kalan ${formatTRY(m.salaryRemaining)}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !amount || !f.cashAccountId} onClick={() => void save()}>Ödemeyi kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <Alert kind="info">Ödeme kasadan çıkış olarak kaydedilir ve seçilen ayın ödenmemiş maaşını aşamaz. Yanlış ödeme silinmez, ters kayıtla düzeltilir.</Alert>
        <SelectField label="Dönem" value={f.period} onChange={(e) => { const x = months.find((y) => y.month === e.target.value)!; setF({ ...f, period: x.month, amount: toInput(x.salaryRemaining) }); }}>
          {[...months].reverse().map((x) => <option key={x.month} value={x.month}>{monthLabel(x.month)} · kalan {formatTRY(x.salaryRemaining)}</option>)}
        </SelectField>
        <TextField label="Tutar (₺)" inputMode="decimal" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} error={err?.fieldErrors.amount} />
        <SelectField label="Kasa / banka" required value={f.cashAccountId} onChange={(e) => setF({ ...f, cashAccountId: e.target.value })}>
          {cash.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</SelectField>
        <TextField label="Not" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} />
      </div>
    </Drawer>
  );
}

function CommissionDrawer({ id, name, payable, cash, onClose, onSaved }: { id: string; name: string; payable: string; cash: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ amount: toInput(payable), cashAccountId: cash[0]?.id ?? "", note: "", key: newIdempotencyKey() });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = parseMoneyInput(f.amount);
  async function save() {
    setBusy(true); setErr(null);
    try { await api("/commission-payouts", { idempotencyKey: f.key, body: { practitionerId: id, amount, cashAccountId: f.cashAccountId, note: f.note || undefined } }); onSaved(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Prim ödemesi" subtitle={`${name} · ödenecek bakiye ${formatTRY(payable)}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !amount || !f.cashAccountId} onClick={() => void save()}>Ödemeyi kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <Alert kind="info">Ödeme kasadan çıkış olarak kaydedilir ve ödenmemiş net tahakkuku aşamaz.</Alert>
        <TextField label="Tutar (₺)" inputMode="decimal" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} error={err?.fieldErrors.amount} />
        <SelectField label="Kasa / banka" required value={f.cashAccountId} onChange={(e) => setF({ ...f, cashAccountId: e.target.value })}>
          {cash.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</SelectField>
        <TextField label="Not" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} />
      </div>
    </Drawer>
  );
}

export default function HekimlerPage() {
  return <Suspense fallback={<div className="card"><Loading /></div>}><Inner /></Suspense>;
}
