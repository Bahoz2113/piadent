"use client";
import { useState } from "react";
import { Plus, Truck } from "lucide-react";
import { SUPPLIER_KIND_LABELS, formatTRY, type SupplierKind } from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime } from "@/lib/format";
import { Alert, Drawer, EmptyState, ErrorState, Loading, SelectField, TextAreaField, TextField } from "@/components/ui";
import { parseMoneyInput } from "@/components/finance/money-input";

interface Supplier { id: string; kind: SupplierKind; name: string; active: boolean; contactName?: string | null; phone?: string | null; email?: string | null; taxNo?: string | null; note?: string | null }
interface Balance { id: string; kind: SupplierKind; name: string; active: boolean; billed: string; paid: string; balance: string }

/** Tedarikçi / laboratuvar tanımı (T15, T16) ve cari (T18). */
export function SuppliersPanel({ notify }: { notify: (k: "success" | "error", t: string) => void }) {
  const { can } = useSession();
  const list = useData<{ items: Supplier[] }>("/suppliers");
  const bal = useData<{ items: Balance[]; totals: { billed: string; paid: string; balance: string } }>(can("finance.read") ? "/supplier-balances" : null);
  const [edit, setEdit] = useState<Supplier | "new" | null>(null);
  const [ledger, setLedger] = useState<Supplier | null>(null);
  if (list.loading && !list.data) return <div className="card"><Loading /></div>;
  if (list.error) return <div className="card"><ErrorState error={list.error} /></div>;
  const b = new Map((bal.data?.items ?? []).map((x) => [x.id, x]));
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Tedarikçiler ve laboratuvarlar</h2><p className="muted small">Cari bakiye hareketlerden (fatura/maliyet borcu − ödeme) hesaplanır; düzeltme ters kayıtla yapılır. Pozitif bakiye kliniğin borcudur.</p></div>
        {can("supplier.manage") && <button className="btn btn-sm btn-primary" onClick={() => setEdit("new")}><Plus size={15} aria-hidden />Yeni kayıt</button>}
      </div>
      {list.data!.items.length === 0 ? <EmptyState icon={<Truck size={28} />} title="Kayıt yok" /> : (
        <div className="table-wrap" tabIndex={0}>
          <table className="table table-wide">
            <thead><tr><th>Ad</th><th>Tür</th>{bal.data && <><th className="money">Borç</th><th className="money">Ödeme</th><th className="money">Bakiye</th></>}<th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>{list.data!.items.map((s) => {
              const x = b.get(s.id);
              return (
                <tr key={s.id} style={!s.active ? { color: "var(--text-secondary)" } : undefined}>
                  <td><strong>{s.name}</strong>{!s.active && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>Pasif</span>}{s.contactName && <div className="small muted">{s.contactName}{s.phone ? ` · ${s.phone}` : ""}</div>}</td>
                  <td>{SUPPLIER_KIND_LABELS[s.kind]}</td>
                  {bal.data && <><td className="money">{x ? formatTRY(x.billed) : "—"}</td><td className="money">{x ? formatTRY(x.paid) : "—"}</td><td className="money"><strong>{x ? formatTRY(x.balance) : "—"}</strong></td></>}
                  <td><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    {can("finance.read") && <button className="btn btn-sm" onClick={() => setLedger(s)}>Cari</button>}
                    {can("supplier.manage") && <button className="btn btn-sm btn-ghost" onClick={() => setEdit(s)}>Düzenle</button>}
                  </div></td>
                </tr>
              );
            })}</tbody>
            {bal.data && <tfoot><tr><th colSpan={2}>Toplam</th><th className="money">{formatTRY(bal.data.totals.billed)}</th><th className="money">{formatTRY(bal.data.totals.paid)}</th><th className="money">{formatTRY(bal.data.totals.balance)}</th><th /></tr></tfoot>}
          </table>
        </div>
      )}
      {edit && <SupplierDrawer s={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); notify("success", m); void list.reload(); void bal.reload(); }} />}
      {ledger && <LedgerDrawer s={ledger} onClose={() => setLedger(null)} onChanged={() => void bal.reload()} />}
    </section>
  );
}

function SupplierDrawer({ s, onClose, onSaved }: { s: Supplier | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [f, setF] = useState({ kind: s?.kind ?? "lab" as SupplierKind, name: s?.name ?? "", contactName: s?.contactName ?? "", phone: s?.phone ?? "", email: s?.email ?? "",
    taxNo: s?.taxNo ?? "", note: s?.note ?? "", active: s?.active ?? true });
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function save() {
    setErr(null);
    try {
      if (s) await api(`/suppliers/${s.id}`, { method: "PATCH", body: f }); else await api("/suppliers", { body: f });
      onSaved(s ? "Kayıt güncellendi." : "Kayıt eklendi.");
    } catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title={s ? "Tedarikçiyi düzenle" : "Yeni tedarikçi / laboratuvar"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <SelectField label="Tür" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as SupplierKind })}>
          {Object.entries(SUPPLIER_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </SelectField>
        <TextField label="Ad / unvan" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={err?.fieldErrors.name} />
        <TextField label="Yetkili" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <TextField label="Telefon" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <TextField label="E-posta" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={err?.fieldErrors.email} />
        </div>
        <TextField label="Vergi / TC no" inputMode="numeric" value={f.taxNo} onChange={(e) => setF({ ...f, taxNo: e.target.value })} error={err?.fieldErrors.taxNo} />
        <TextAreaField label="Not" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        {s && <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Etkin</label>}
      </div>
    </Drawer>
  );
}

function LedgerDrawer({ s, onClose, onChanged }: { s: Supplier; onClose: () => void; onChanged: () => void }) {
  const { can, tz } = useSession();
  const d = useData<{ opening: string; billed: string; paid: string; closing: string; from: string; to: string;
    entries: { id: string; kind: "bill" | "payment"; amount: string; description: string; documentNo: string | null; source: string; at: string; reversal: boolean; reversed: boolean;
      reason: string | null; account: string | null; by: string; labOrderNo: number | null; balanceAfter: string }[] }>(`/suppliers/${s.id}/ledger`);
  const accts = useData<{ items: { id: string; name: string; active: boolean }[] }>(can("supplier.ledger") ? "/cash-accounts" : null);
  const [form, setForm] = useState<null | { kind: "bill" | "payment"; amount: string; description: string; documentNo: string; cashAccountId: string; key: string }>(null);
  const [rev, setRev] = useState<null | { id: string; reason: string }>(null);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const reload = () => { setForm(null); setRev(null); setErr(null); void d.reload(); onChanged(); };
  async function save() {
    if (!form) return;
    const amount = parseMoneyInput(form.amount);
    if (!amount) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Tutarı girin.", field_errors: { amount: "Geçerli tutar girin." } })); return; }
    try {
      if (form.kind === "bill") await api("/supplier-bills", { idempotencyKey: form.key, body: { supplierId: s.id, amount, description: form.description, documentNo: form.documentNo } });
      else await api("/supplier-payments", { idempotencyKey: form.key, body: { supplierId: s.id, amount, description: form.description, documentNo: form.documentNo, cashAccountId: form.cashAccountId } });
      reload();
    } catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title={`Cari · ${s.name}`} subtitle={d.data ? `Son 90 gün · açılış ${formatTRY(d.data.opening)} · kapanış ${formatTRY(d.data.closing)}` : undefined} onClose={onClose}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        {can("supplier.ledger") && !form && <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={() => setForm({ kind: "bill", amount: "", description: "", documentNo: "", cashAccountId: "", key: newIdempotencyKey() })}>Fatura / borç ekle</button>
          <button className="btn btn-sm btn-primary" onClick={() => setForm({ kind: "payment", amount: "", description: "Tedarikçi ödemesi", documentNo: "", cashAccountId: accts.data?.items.find((a) => a.active)?.id ?? "", key: newIdempotencyKey() })}>Ödeme yap</button>
        </div>}
        {form && (
          <div className="card card-pad stack" style={{ gap: 8 }}>
            <strong>{form.kind === "bill" ? "Fatura / borç" : "Ödeme (kasadan çıkış)"}</strong>
            <TextField label="Tutar (₺)" required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} error={err?.fieldErrors.amount} />
            <TextField label="Açıklama" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={err?.fieldErrors.description} />
            <TextField label="Belge no" value={form.documentNo} onChange={(e) => setForm({ ...form, documentNo: e.target.value })} />
            {form.kind === "payment" && <SelectField label="Kasa / banka" required value={form.cashAccountId} onChange={(e) => setForm({ ...form, cashAccountId: e.target.value })}>
              {accts.data?.items.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</SelectField>}
            <div className="row" style={{ gap: 8 }}><button className="btn btn-sm" onClick={() => setForm(null)}>Vazgeç</button><button className="btn btn-sm btn-primary" onClick={() => void save()}>Kaydet</button></div>
          </div>
        )}
        {d.loading && !d.data ? <Loading /> : d.error ? <ErrorState error={d.error} /> : (
          <>
            <div className="totals">
              {[["Açılış", d.data!.opening], ["Borç", d.data!.billed], ["Ödeme", d.data!.paid], ["Kapanış", d.data!.closing]].map(([l, v]) => (
                <div key={l} className="card stat"><div className="label">{l}</div><div className="value">{formatTRY(v!)}</div></div>))}
            </div>
            {d.data!.entries.length === 0 ? <p className="muted">Bu aralıkta hareket yok.</p> : (
              <ul className="list">{d.data!.entries.map((e) => (
                <li key={e.id} className="row small" style={{ justifyContent: "space-between", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <span><strong>{e.kind === "bill" ? "Borç" : "Ödeme"}</strong>{e.reversal && " (ters kayıt)"} · {e.description}
                    <div className="muted">{fmtDateTime(e.at, tz)} · {e.by}{e.documentNo ? ` · ${e.documentNo}` : ""}{e.account ? ` · ${e.account}` : ""}{e.labOrderNo ? ` · iş emri ${e.labOrderNo}` : ""}{e.reason ? ` · ${e.reason}` : ""}</div></span>
                  <span style={{ textAlign: "right" }}><strong>{formatTRY(e.kind === "payment" ? (e.amount.startsWith("-") ? e.amount.slice(1) : `-${e.amount}`) : e.amount)}</strong><div className="muted">bakiye {formatTRY(e.balanceAfter)}</div>
                    {can("supplier.ledger") && !e.reversal && !e.reversed && e.source === "manual" && <button className="btn btn-sm btn-ghost" onClick={() => setRev({ id: e.id, reason: "" })}>Ters kayıt</button>}</span>
                </li>))}</ul>)}
          </>
        )}
        {rev && (
          <div className="card card-pad stack" style={{ gap: 8 }}>
            <TextAreaField label="Ters kayıt gerekçesi" required rows={2} value={rev.reason} onChange={(e) => setRev({ ...rev, reason: e.target.value })} />
            <div className="row" style={{ gap: 8 }}><button className="btn btn-sm" onClick={() => setRev(null)}>Vazgeç</button>
              <button className="btn btn-sm btn-primary" disabled={rev.reason.trim().length < 3}
                onClick={() => void api(`/supplier-entries/${rev.id}/reverse`, { body: { reason: rev.reason } }).then(reload, (e) => setErr(e as ApiFailure))}>Ters kayda al</button></div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
