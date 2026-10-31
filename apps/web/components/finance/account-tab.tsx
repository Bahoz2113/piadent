"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, CheckCircle2, FilePlus2, HandCoins, Info, ListTree, RotateCcw, Split, Undo2 } from "lucide-react";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, formatTRY, type PaymentMethod } from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime, todayIn } from "@/lib/format";
import { Alert, Drawer, EmptyState, ErrorState, Loading, SelectField, TextAreaField, TextField, DateField } from "@/components/ui";
import { minor, money, parseMoneyInput } from "./money-input";
import { OnlinePayments, ProviderRefundDrawer } from "./online-payments";

interface Receivable { id: string; source: string; description: string; amount: string; status: string; cancelReason: string | null; dueDate: string; createdAt: string;
  practitionerName: string | null; allocated: string; open: string }
interface Payment { id: string; amount: string; method: PaymentMethod | "online"; paidAt: string; note: string | null; accountName: string; receivedBy: string;
  allocated: string; refunded: string; available: string }
interface Allocation { id: string; paymentId: string; receivableId: string; amount: string; reversesId: string | null; reason: string | null; at: string; by: string }
interface LedgerRow { at: string; kind: string; ref: string; description: string; amount: string; openDebtAfter: string; advanceAfter: string }
export interface Account {
  currency: "TRY"; reconciled: boolean;
  totals: { receivable: string; allocated: string; openDebt: string; paid: string; refunded: string; advance: string; cancelledReceivable: string };
  receivables: Receivable[]; payments: Payment[]; allocations: Allocation[];
  refunds: { id: string; paymentId: string; amount: string; method: string; reason: string; at: string; by: string }[];
  ledger: LedgerRow[];
}
interface CashAccount { id: string; name: string; kind: "cash" | "bank" | "pos_manual"; active: boolean }

const KIND_LABEL: Record<string, string> = {
  receivable: "Borçlandırma", receivable_cancel: "Alacak iptali", payment: "Tahsilat", allocation: "Dağıtım", allocation_reverse: "Dağıtım ters kaydı", refund: "İade",
};
const METHOD_ACCOUNT: Record<PaymentMethod, CashAccount["kind"] | null> = { cash: "cash", card_manual: "pos_manual", bank_transfer: "bank", other: null };

const methodLabel = (m: PaymentMethod | "online") => (m === "online" ? "Online (sağlayıcı)" : PAYMENT_METHOD_LABELS[m]);

type Explain = "debt" | "advance" | "paid" | null;

export function AccountTab({ patientId, patientName }: { patientId: string; patientName: string }) {
  const { can } = useSession();
  const acc = useData<Account>(`/patients/${patientId}/account`);
  const [explain, setExplain] = useState<Explain>(null);
  const [drawer, setDrawer] = useState<null | { kind: "pay" } | { kind: "allocate"; paymentId?: string } | { kind: "refund"; payment: Payment } | { kind: "provider_refund"; payment: Payment }
    | { kind: "receivable" } | { kind: "cancel"; rec: Receivable } | { kind: "reverse"; alloc: Allocation }>(null);
  const [toast, setToast] = useState<string | null>(null);
  const done = (msg: string) => { setDrawer(null); setToast(msg); void acc.reload(); };

  if (acc.loading && !acc.data) return <div className="card"><Loading /></div>;
  if (acc.error) return <div className="card"><ErrorState error={acc.error} onRetry={() => void acc.reload()} /></div>;
  const a = acc.data!;
  const t = a.totals;
  const openRecs = a.receivables.filter((r) => r.status === "active" && minor(r.open) > 0n);
  const advPayments = a.payments.filter((p) => minor(p.available) > 0n);

  return (
    <div className="stack" style={{ gap: 16 }}>
      {toast && <Alert kind="success">{toast}</Alert>}
      <section className="card">
        <div className="card-head">
          <div><h2>Hesap · PİA Net</h2><p className="muted small">Borç ve avans ayrı tutulur; ödeme alacağa yalnız açık dağıtımla bağlanır. Her toplamın nasıl oluştuğunu görmek için kutuya tıklayın.</p></div>
          <div className="row">
            {can("receivable.write") && <button className="btn btn-sm" onClick={() => setDrawer({ kind: "receivable" })}><FilePlus2 size={15} aria-hidden />Elle alacak</button>}
            {can("payment.write") && advPayments.length > 0 && openRecs.length > 0 && <button className="btn btn-sm" onClick={() => setDrawer({ kind: "allocate" })}><Split size={15} aria-hidden />Avansı dağıt</button>}
            {can("payment.write") && <button className="btn btn-sm btn-primary" onClick={() => setDrawer({ kind: "pay" })}><HandCoins size={15} aria-hidden />Tahsilat al</button>}
          </div>
        </div>
        <div className="card-pad">
          <div className="net-tiles">
            <NetTile label="Açık borç" value={t.openDebt} tone={minor(t.openDebt) > 0n ? "warning" : "neutral"} active={explain === "debt"} onClick={() => setExplain(explain === "debt" ? null : "debt")} />
            <NetTile label="Kullanılabilir avans" value={t.advance} tone={minor(t.advance) > 0n ? "info" : "neutral"} active={explain === "advance"} onClick={() => setExplain(explain === "advance" ? null : "advance")} />
            <NetTile label="Toplam tahsilat" value={t.paid} sub={minor(t.refunded) > 0n ? `İade: ${formatTRY(t.refunded)}` : undefined} active={explain === "paid"} onClick={() => setExplain(explain === "paid" ? null : "paid")} />
            <NetTile label="Toplam borçlandırma" value={t.receivable} sub={minor(t.cancelledReceivable) > 0n ? `İptal edilen: ${formatTRY(t.cancelledReceivable)}` : undefined} />
          </div>
          {explain && <ExplainPanel kind={explain} a={a} />}
          <p className={`small ${a.reconciled ? "muted" : ""}`} style={{ marginTop: 10, color: a.reconciled ? undefined : "var(--error)" }}>
            {a.reconciled ? <><CheckCircle2 size={14} aria-hidden style={{ verticalAlign: "-2px", color: "var(--success)" }} /> Hareket defteri toplamlarla mutabık (alt kayıtların toplamı üst toplamı veriyor).</>
              : "Uyarı: hareket defteri toplamlarla mutabık değil. Destekle paylaşın."}
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Alacaklar</h2><p className="muted small">Gerçekleşen işlemden otomatik doğar; planlanan bedel alacak değildir. Tutar değişmez, iptal gerekçeyle yapılır.</p></div></div>
        {a.receivables.length === 0 ? <EmptyState title="Alacak yok" /> : (
          <div className="table-wrap" tabIndex={0}>
            <table className="table table-wide">
              <thead><tr><th>Tarih</th><th>Açıklama</th><th>Hekim</th><th>Vade</th><th className="money">Tutar</th><th className="money">Dağıtılan</th><th className="money">Açık</th><th>Durum</th><th><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>
                {a.receivables.map((r) => (
                  <tr key={r.id} style={r.status !== "active" ? { color: "var(--text-secondary)" } : undefined}>
                    <td>{fmtDate(r.createdAt)}</td>
                    <td>{r.description}<div className="small muted">{r.source === "performed_procedure" ? "Gerçekleşen işlem" : "Elle alacak"}</div></td>
                    <td>{r.practitionerName ?? "—"}</td>
                    <td>{fmtDate(r.dueDate)}</td>
                    <td className="money">{formatTRY(r.amount)}</td>
                    <td className="money">{formatTRY(r.allocated)}</td>
                    <td className="money"><strong>{formatTRY(r.open)}</strong></td>
                    <td>{r.status === "cancelled" ? <span className="badge badge-neutral" title={r.cancelReason ?? ""}>İptal</span>
                      : minor(r.open) === 0n ? <span className="badge badge-success">Kapandı</span> : minor(r.allocated) > 0n ? <span className="badge badge-info">Kısmi</span> : <span className="badge badge-warning">Açık</span>}</td>
                    <td>{r.status === "active" && r.source === "manual" && can("receivable.write") && <button className="btn btn-sm btn-ghost" onClick={() => setDrawer({ kind: "cancel", rec: r })}>İptal et</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Ödemeler</h2><p className="muted small">Ödeme silinmez. İade ayrı kayıttır; gerekirse dağıtımı ters kayıtla geri alır.</p></div></div>
        {a.payments.length === 0 ? <EmptyState title="Ödeme yok" /> : (
          <div className="table-wrap" tabIndex={0}>
            <table className="table table-wide">
              <thead><tr><th>Tarih</th><th>Yöntem</th><th>Kasa / banka</th><th className="money">Tutar</th><th className="money">Dağıtılan</th><th className="money">İade</th><th className="money">Kullanılabilir</th><th><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>
                {a.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDateTime(p.paidAt)}<div className="small muted">{p.receivedBy}</div></td>
                    <td>{p.method === "online" ? <>Online <span className="badge badge-warning">MOCK sağlayıcı</span></> : PAYMENT_METHOD_LABELS[p.method]}</td>
                    <td>{p.accountName}</td>
                    <td className="money">{formatTRY(p.amount)}</td>
                    <td className="money">{formatTRY(p.allocated)}</td>
                    <td className="money">{minor(p.refunded) > 0n ? `−${formatTRY(p.refunded)}` : "—"}</td>
                    <td className="money"><strong>{formatTRY(p.available)}</strong></td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      {can("payment.write") && minor(p.available) > 0n && openRecs.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setDrawer({ kind: "allocate", paymentId: p.id })}>Dağıt</button>}
                      {can("payment.refund") && minor(p.amount) - minor(p.refunded) > 0n && (p.method === "online"
                        ? <button className="btn btn-sm btn-ghost" onClick={() => setDrawer({ kind: "provider_refund", payment: p })}><Undo2 size={14} aria-hidden />Sağlayıcıdan iade</button>
                        : <button className="btn btn-sm btn-ghost" onClick={() => setDrawer({ kind: "refund", payment: p })}><Undo2 size={14} aria-hidden />İade</button>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <OnlinePayments patientId={patientId} onChanged={() => void acc.reload()} />

      {a.ledger.length > 0 && (
        <section className="card">
          <div className="card-head"><div><h2><ListTree size={18} aria-hidden style={{ verticalAlign: "-3px" }} /> Hareket defteri</h2><p className="muted small">Kronolojik; her satırdan sonra açık borç ve avans ayrı yürür.</p></div></div>
          <div className="table-wrap" tabIndex={0}>
            <table className="table table-wide">
              <thead><tr><th>Zaman</th><th>Hareket</th><th>Açıklama</th><th className="money">Tutar</th><th className="money">Açık borç</th><th className="money">Avans</th><th><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>
                {a.ledger.map((l, i) => {
                  const alloc = l.kind === "allocation" ? a.allocations.find((x) => x.id === l.ref) : undefined;
                  const reversed = alloc ? a.allocations.filter((x) => x.reversesId === alloc.id).reduce((s, x) => s + minor(x.amount), 0n) + minor(alloc.amount) <= 0n : false;
                  return (
                    <tr key={`${l.ref}-${l.kind}-${i}`}>
                      <td>{fmtDateTime(l.at)}</td>
                      <td>{KIND_LABEL[l.kind] ?? l.kind}</td>
                      <td>{l.description}</td>
                      <td className="money">{formatTRY(l.amount)}</td>
                      <td className="money">{formatTRY(l.openDebtAfter)}</td>
                      <td className="money">{formatTRY(l.advanceAfter)}</td>
                      <td>{alloc && !reversed && can("payment.write") && <button className="btn btn-sm btn-ghost" onClick={() => setDrawer({ kind: "reverse", alloc })}><RotateCcw size={14} aria-hidden />Geri al</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {drawer?.kind === "pay" && <PaymentDrawer patientId={patientId} patientName={patientName} openRecs={openRecs} onClose={() => setDrawer(null)}
        onSaved={(adv) => done(minor(adv) > 0n ? `Tahsilat kaydedildi. ${formatTRY(adv)} avans olarak kaldı.` : "Tahsilat kaydedildi ve dağıtıldı.")} />}
      {drawer?.kind === "allocate" && <AllocateDrawer payments={advPayments} initialPayment={drawer.paymentId} openRecs={openRecs} onClose={() => setDrawer(null)} onSaved={() => done("Dağıtım kaydedildi.")} />}
      {drawer?.kind === "provider_refund" && <ProviderRefundDrawer payment={drawer.payment} onClose={() => setDrawer(null)} onSaved={(note) => done(note)} />}
      {drawer?.kind === "refund" && <RefundDrawer payment={drawer.payment} onClose={() => setDrawer(null)} onSaved={() => done("İade kaydedildi.")} />}
      {drawer?.kind === "receivable" && <ReceivableDrawer patientId={patientId} onClose={() => setDrawer(null)} onSaved={() => done("Alacak eklendi.")} />}
      {drawer?.kind === "cancel" && <ReasonDrawer title="Alacağı iptal et" subtitle={`${drawer.rec.description} · ${formatTRY(drawer.rec.amount)}. Dağıtılmış tahsilat varsa ters kayıtla avansa döner.`}
        submit={(reason) => api(`/receivables/${drawer.rec.id}/cancel`, { body: { reason } })} onClose={() => setDrawer(null)} onSaved={() => done("Alacak iptal edildi.")} />}
      {drawer?.kind === "reverse" && <ReasonDrawer title="Dağıtımı geri al" subtitle={`${formatTRY(drawer.alloc.amount)} — ters kayıt oluşturulur; tutar ödemeye (avans) döner, alacak yeniden açılır.`}
        idempotent submit={(reason, key) => api(`/allocations/${drawer.alloc.id}/reverse`, { body: { reason }, idempotencyKey: key })} onClose={() => setDrawer(null)} onSaved={() => done("Dağıtım ters kayda alındı.")} />}
    </div>
  );
}

function NetTile({ label, value, sub, tone = "neutral", active, onClick }: { label: string; value: string; sub?: string; tone?: "warning" | "info" | "neutral"; active?: boolean; onClick?: () => void }) {
  const inner = (<><span className="small muted">{label}</span><span className={`kpi net-${tone}`}>{formatTRY(value)}</span>{sub && <span className="small muted">{sub}</span>}</>);
  return onClick
    ? <button type="button" className={`net-tile ${active ? "is-active" : ""}`} aria-expanded={!!active} onClick={onClick}>{inner}<span className="small net-why"><Info size={12} aria-hidden /> Nasıl oluştu?</span></button>
    : <div className="net-tile">{inner}</div>;
}

function ExplainPanel({ kind, a }: { kind: Exclude<Explain, null>; a: Account }) {
  const t = a.totals;
  if (kind === "debt") return (
    <div className="explain">
      <p><strong>Açık borç = etkin alacaklar − dağıtılan ödemeler</strong> = {formatTRY(t.receivable)} − {formatTRY(t.allocated)} = <strong>{formatTRY(t.openDebt)}</strong></p>
      <ul>{a.receivables.filter((r) => r.status === "active").map((r) => <li key={r.id}>{r.description}: {formatTRY(r.amount)} − {formatTRY(r.allocated)} = {formatTRY(r.open)}</li>)}</ul>
      <p className="small muted">Avans borçtan otomatik düşülmez; dağıtım yapıldığında düşer.</p>
    </div>
  );
  if (kind === "advance") return (
    <div className="explain">
      <p><strong>Avans = ödemeler − iadeler − dağıtılan</strong> = {formatTRY(t.paid)} − {formatTRY(t.refunded)} − {formatTRY(money(minor(t.paid) - minor(t.refunded) - minor(t.advance)))} = <strong>{formatTRY(t.advance)}</strong></p>
      <ul>{a.payments.map((p) => <li key={p.id}>{fmtDate(p.paidAt)} {methodLabel(p.method)}: {formatTRY(p.amount)} − iade {formatTRY(p.refunded)} − dağıtım {formatTRY(p.allocated)} = {formatTRY(p.available)}</li>)}</ul>
    </div>
  );
  return (
    <div className="explain">
      <p><strong>Toplam tahsilat</strong> = {a.payments.map((p) => formatTRY(p.amount)).join(" + ") || "0"} = <strong>{formatTRY(t.paid)}</strong>; iadeler ayrı: {formatTRY(t.refunded)}.</p>
      <p className="small muted">Tahsilat tedavi geliri değildir; önceki dönem borcunu veya avansı içerebilir.</p>
    </div>
  );
}

// ------------------------------------------------------------------ çekmeceler
function useCashAccounts() {
  return useData<{ items: CashAccount[] }>("/cash-accounts");
}

function AllocationLines({ recs, lines, setLines, budget }: { recs: Receivable[]; lines: Record<string, string>; setLines: (l: Record<string, string>) => void; budget: bigint }) {
  const used = Object.values(lines).reduce((s, v) => s + (parseMoneyInput(v) ? minor(parseMoneyInput(v)!) : 0n), 0n);
  function autofill() {
    let left = budget;
    const next: Record<string, string> = {};
    for (const r of [...recs].sort((x, y) => x.dueDate.localeCompare(y.dueDate) || x.createdAt.localeCompare(y.createdAt))) {
      if (left <= 0n) break;
      const take = minor(r.open) < left ? minor(r.open) : left;
      next[r.id] = money(take);
      left -= take;
    }
    setLines(next);
  }
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
      <legend className="small" style={{ fontWeight: 600 }}>Dağıtım (açık alacaklar)</legend>
      {recs.length === 0 ? <p className="small muted">Açık alacak yok; ödemenin tamamı avans olarak kalır.</p> : (
        <>
          <button type="button" className="btn btn-sm" onClick={autofill} disabled={budget <= 0n}>Vadesi eski olandan başlayarak dağıt</button>
          {recs.map((r) => (
            <div key={r.id} className="alloc-line">
              <span className="small"><strong>{r.description}</strong><br /><span className="muted">vade {fmtDate(r.dueDate)} · açık {formatTRY(r.open)}</span></span>
              <input className="input" inputMode="decimal" aria-label={`${r.description} için dağıtım tutarı`} placeholder="0,00" value={lines[r.id] ?? ""}
                onChange={(e) => setLines({ ...lines, [r.id]: e.target.value })} />
            </div>
          ))}
          <p className="small" aria-live="polite">Dağıtılan: <strong>{formatTRY(money(used))}</strong> · {used > budget ? <span style={{ color: "var(--error)" }}>Tutarı aşıyor</span> : <>Avans olarak kalacak: <strong>{formatTRY(money(budget - used))}</strong></>}</p>
        </>
      )}
    </fieldset>
  );
}

function toAllocations(lines: Record<string, string>) {
  return Object.entries(lines).map(([receivableId, v]) => ({ receivableId, amount: parseMoneyInput(v) })).filter((x): x is { receivableId: string; amount: string } => !!x.amount && minor(x.amount) > 0n);
}

function PaymentDrawer({ patientId, patientName, openRecs, onClose, onSaved }: { patientId: string; patientName: string; openRecs: Receivable[]; onClose: () => void; onSaved: (advance: string) => void }) {
  const accts = useCashAccounts();
  const [key] = useState(newIdempotencyKey);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [account, setAccount] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Record<string, string>>({});
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parseMoneyInput(amount);
  const options = (accts.data?.items ?? []).filter((x) => x.active);
  useEffect(() => {
    const want = METHOD_ACCOUNT[method];
    const pick = options.find((x) => x.kind === want) ?? options[0];
    if (pick) setAccount(pick.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, accts.data]);
  async function save() {
    if (!parsed) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Tutarı 1.250,00 biçiminde girin.", field_errors: { amount: "Geçerli tutar girin." } })); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api<{ advance: string }>("/payments", { body: { patientId, amount: parsed, method, cashAccountId: account, note: note || undefined, allocations: toAllocations(lines) }, idempotencyKey: key });
      onSaved(r.advance);
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Tahsilat al" subtitle={`${patientName} · TRY`} onClose={onClose} dirty={!!amount}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !account} onClick={() => void save()}><ArrowDownLeft size={15} aria-hidden />Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <TextField label="Tutar (₺)" required inputMode="decimal" placeholder="1.250,00" value={amount} onChange={(e) => setAmount(e.target.value)} error={err?.fieldErrors.amount}
          hint={parsed ? `Kaydedilecek: ${formatTRY(parsed)}` : "Para birimi: TRY (ilk kapsam)"} />
        <SelectField label="Yöntem" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
        </SelectField>
        {method === "card_manual" && <Alert kind="info">Bu, kartla alınmış bir ödemenin <strong>manuel kaydıdır</strong>. PİA-DENT sanal POS'a bağlı değildir; karttan çekim yapmaz ve sonucu doğrulamaz.</Alert>}
        <SelectField label="Kasa / banka" required value={account} onChange={(e) => setAccount(e.target.value)} error={err?.fieldErrors.cashAccountId}>
          {options.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </SelectField>
        <TextField label="Not" value={note} onChange={(e) => setNote(e.target.value)} />
        <AllocationLines recs={openRecs} lines={lines} setLines={setLines} budget={parsed ? minor(parsed) : 0n} />
      </div>
    </Drawer>
  );
}

function AllocateDrawer({ payments, initialPayment, openRecs, onClose, onSaved }: { payments: Payment[]; initialPayment?: string; openRecs: Receivable[]; onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState(newIdempotencyKey);
  const [pid, setPid] = useState(initialPayment ?? payments[0]?.id ?? "");
  const p = payments.find((x) => x.id === pid);
  const [lines, setLines] = useState<Record<string, string>>({});
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const allocations = useMemo(() => toAllocations(lines), [lines]);
  async function save() {
    setBusy(true); setErr(null);
    try { await api(`/payments/${pid}/allocations`, { body: { allocations }, idempotencyKey: key }); onSaved(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Avansı dağıt" subtitle="Dağıtılmamış ödeme tutarı seçilen alacaklara bağlanır." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || allocations.length === 0} onClick={() => void save()}>Dağıt</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <SelectField label="Ödeme" value={pid} onChange={(e) => { setPid(e.target.value); setLines({}); setKey(newIdempotencyKey()); }}>
          {payments.map((x) => <option key={x.id} value={x.id}>{fmtDate(x.paidAt)} · {methodLabel(x.method)} · kullanılabilir {formatTRY(x.available)}</option>)}
        </SelectField>
        {p && <AllocationLines recs={openRecs} lines={lines} setLines={setLines} budget={minor(p.available)} />}
      </div>
    </Drawer>
  );
}

function RefundDrawer({ payment, onClose, onSaved }: { payment: Payment; onClose: () => void; onSaved: () => void }) {
  const accts = useCashAccounts();
  const [key] = useState(newIdempotencyKey);
  const refundable = money(minor(payment.amount) - minor(payment.refunded));
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(payment.method === "online" ? "other" : payment.method);
  const [account, setAccount] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parseMoneyInput(amount);
  const needReverse = parsed ? minor(parsed) - minor(payment.available) : 0n;
  useEffect(() => {
    const opts = (accts.data?.items ?? []).filter((x) => x.active);
    const pick = opts.find((x) => x.kind === METHOD_ACCOUNT[method]) ?? opts[0];
    if (pick) setAccount(pick.id);
  }, [method, accts.data]);
  async function save() {
    if (!parsed) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Tutarı girin.", field_errors: { amount: "Geçerli tutar girin." } })); return; }
    setBusy(true); setErr(null);
    try { await api(`/payments/${payment.id}/refunds`, { body: { amount: parsed, method, cashAccountId: account, reason }, idempotencyKey: key }); onSaved(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="İade" subtitle={`${fmtDate(payment.paidAt)} tarihli ${formatTRY(payment.amount)} ödemeden · en çok ${formatTRY(refundable)}`} onClose={onClose} dirty={!!amount || !!reason}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !account || reason.trim().length < 3} onClick={() => void save()}>İadeyi kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <Alert kind="info">İade ticari indirim değildir; alacak tutarı değişmez. Önce ödemenin dağıtılmamış kısmı ({formatTRY(payment.available)}) kullanılır; yetmezse en son dağıtım ters kayda alınır ve borç yeniden açılır.</Alert>
        <TextField label="İade tutarı (₺)" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={err?.fieldErrors.amount} />
        {needReverse > 0n && <p className="small">Bu iade, {formatTRY(money(needReverse))} tutarında dağıtımı geri alacak; hastanın açık borcu bu kadar artacak.</p>}
        <SelectField label="Yöntem" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
        </SelectField>
        <SelectField label="Kasa / banka (çıkış)" required value={account} onChange={(e) => setAccount(e.target.value)}>
          {(accts.data?.items ?? []).filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </SelectField>
        <TextAreaField label="Gerekçe" required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} error={err?.fieldErrors.reason} />
      </div>
    </Drawer>
  );
}

function ReceivableDrawer({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: () => void }) {
  const { tz } = useSession();
  const res = useData<{ practitioners: { id: string; name: string }[] }>("/resources");
  const [key] = useState(newIdempotencyKey);
  const [f, setF] = useState({ description: "", amount: "", practitionerId: "", dueDate: todayIn(tz) });
  const [err, setErr] = useState<ApiFailure | null>(null);
  async function save() {
    const amount = parseMoneyInput(f.amount);
    if (!amount) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Tutarı girin.", field_errors: { amount: "Geçerli tutar girin." } })); return; }
    try { await api("/receivables", { body: { patientId, description: f.description, amount, practitionerId: f.practitionerId || undefined, dueDate: f.dueDate }, idempotencyKey: key }); onSaved(); }
    catch (e) { setErr(e as ApiFailure); }
  }
  return (
    <Drawer title="Elle alacak" subtitle="İşlem dışı borçlandırma (ör. ön ödeme anlaşması). Tedavi bedeli için gerçekleşen işlem kaydını kullanın." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <TextField label="Açıklama" required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} error={err?.fieldErrors.description} />
        <TextField label="Tutar (₺)" required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} error={err?.fieldErrors.amount} />
        <SelectField label="Hekim (prim için)" value={f.practitionerId} onChange={(e) => setF({ ...f, practitionerId: e.target.value })}>
          <option value="">Yok</option>
          {res.data?.practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
        <DateField label="Vade" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
      </div>
    </Drawer>
  );
}

function ReasonDrawer({ title, subtitle, submit, onClose, onSaved, idempotent }: { title: string; subtitle: string; idempotent?: boolean;
  submit: (reason: string, key: string) => Promise<unknown>; onClose: () => void; onSaved: () => void }) {
  const [key] = useState(newIdempotencyKey);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  void idempotent;
  async function save() {
    setBusy(true); setErr(null);
    try { await submit(reason, key); onSaved(); } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title={title} subtitle={subtitle} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || reason.trim().length < 3} onClick={() => void save()}>Onayla</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <TextAreaField label="Gerekçe" required value={reason} onChange={(e) => setReason(e.target.value)} rows={3} error={err?.fieldErrors.reason} />
      </div>
    </Drawer>
  );
}
