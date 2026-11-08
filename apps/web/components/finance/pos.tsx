"use client";
/**
 * ADR-109: POS — Faz 0 arayüzü.
 *  - PosIntentPanel: tutarı cihaza gönderilen işlemin canlı durumu (yoklama), DENEME benzetimi, iptal ve "sonuç bilinmiyor" çözümü.
 *  - PosDayPanel: terminal bazında günün POS işlemleri ve gün sonu mutabakatı (sistem ↔ POS fişi); terminal tanımı.
 * Kart verisi girilmez: yalnız son 4 hane ve onay kodu.
 */
import { useEffect, useRef, useState } from "react";
import { CreditCard, Plus, Printer, RefreshCw } from "lucide-react";
import {
  POS_DRIVERS, POS_DRIVER_LABELS, POS_INTENT_STATUS_LABELS, POS_MAX_INSTALLMENTS, POS_MODE_LABELS, formatTRY, type PosDriver, type PosIntentStatus,
} from "@viadent/contracts";
import { api, ApiFailure, newIdempotencyKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDateTime, todayIn } from "@/lib/format";
import { Alert, DateField, Drawer, EmptyState, ErrorState, Loading, SelectField, TextField } from "@/components/ui";
import { minor, money, parseMoneyInput } from "./money-input";
import { printReceipt } from "./receipt-print";

export interface PosTerminal {
  id: string; name: string; driver: PosDriver; sendsAmount: boolean; cashAccountId: string; cashAccountName: string; branchId: string | null; branchName: string | null;
  bankName: string | null; terminalRef: string | null; active: boolean; openIntentId: string | null; dayClosed: boolean;
}
export interface PosIntent {
  id: string; intentNo: number; terminalId: string; terminalName: string; driver: PosDriver; patientId: string; patientName: string; amount: string; installments: number;
  mode: "device" | "manual"; status: PosIntentStatus; authCode: string | null; cardMasked: string | null; providerRef: string | null; failureReason: string | null;
  paymentId: string | null; receiptId: string | null; receiptNo: string | null; createdAt: string; sentAt: string | null; completedAt: string | null; createdBy: string; expiresAt: string | null;
}

export function usePosTerminals(enabled = true) {
  return useData<{ items: PosTerminal[] }>(enabled ? "/pos/terminals" : null);
}

export const installmentOptions = Array.from({ length: POS_MAX_INSTALLMENTS }, (_, i) => i + 1);
export const installmentLabel = (n: number) => (n === 1 ? "Tek çekim" : `${n} taksit`);

/** POS ile alınan karttaki tek kişisel veri: son 4 hane. Fazla rakam yazılamaz (tam kart no girişi engellenir). */
export function Last4Field({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  return <TextField label="Kartın son 4 hanesi" required inputMode="numeric" maxLength={4} autoComplete="off" placeholder="1234" value={value}
    onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))} error={error}
    hint="Yalnız son 4 hane. Kart numarasının tamamı, son kullanma tarihi veya CVV girilmez ve saklanmaz." />;
}
export function AuthCodeField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  return <TextField label="Onay (provizyon) kodu" required autoComplete="off" maxLength={12} placeholder="POS fişindeki onay kodu" value={value}
    onChange={(e) => onChange(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12))} error={error} />;
}

function StatusBadge({ s }: { s: PosIntentStatus }) {
  const tone = s === "approved" ? "success" : s === "declined" || s === "unknown" ? "warning" : s === "cancelled" ? "neutral" : "info";
  return <span className={`badge badge-${tone}`}>{POS_INTENT_STATUS_LABELS[s]}</span>;
}

/** Cihaza gönderilmiş işlem: yoklama ile izlenir. Onaylanınca `onApproved`, kapatılınca `onClose`. */
export function PosIntentPanel({ intentId, onApproved, onRetry }: { intentId: string; onApproved?: (i: PosIntent) => void; onRetry?: () => void }) {
  const [it, setIt] = useState<PosIntent | null>(null);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [resolveAs, setResolveAs] = useState<"" | "approved" | "declined">("");
  const [authCode, setAuthCode] = useState("");
  const [last4, setLast4] = useState("");
  const [inst, setInst] = useState(1);
  const [resolveKey] = useState(newIdempotencyKey);
  const approvedSent = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const d = await api<PosIntent>(`/pos/intents/${intentId}`);
        if (!alive) return;
        setIt(d);
        if (d.status === "awaiting_card" || d.status === "created") timer = setTimeout(() => void tick(), 2000);
      } catch (e) { if (alive) setErr(e as ApiFailure); }
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [intentId]);
  useEffect(() => { if (it) setInst(it.installments); }, [it?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (it?.status === "approved" && !approvedSent.current) { approvedSent.current = true; onApproved?.(it); }
  }, [it, onApproved]);

  async function act(path: string, body: unknown, idempotencyKey?: string) {
    setBusy(true); setErr(null);
    try { setIt(await api<PosIntent>(`/pos/intents/${intentId}/${path}`, { body, idempotencyKey })); setCancelling(false); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }

  if (!it) return err ? <ErrorState error={err} /> : <Loading />;
  const mock = it.driver === "mock";
  return (
    <section className="stack pos-intent" aria-label={`POS işlem ${it.intentNo}`} aria-live="polite">
      <div className="pos-intent-head">
        <CreditCard size={22} aria-hidden />
        <div>
          <strong>POS işlem {it.intentNo} · {formatTRY(it.amount)}</strong>
          <div className="small muted">{it.terminalName} · {installmentLabel(it.installments)} · {it.patientName}</div>
        </div>
        <StatusBadge s={it.status} />
      </div>
      {err && <Alert kind="error">{err.message}</Alert>}

      {it.status === "awaiting_card" && (
        <>
          <Alert kind="info" title="Tutar cihaza gönderildi">
            Hastadan kartını cihaza okutmasını isteyin. Sonuç cihazdan gelince bu ekran kendiliğinden güncellenir.
            {it.expiresAt && <> Yanıt gelmezse {fmtDateTime(it.expiresAt)} sonrasında işlem “sonuç bilinmiyor” olur.</>}
          </Alert>
          {mock && (
            <div className="pos-sim" role="group" aria-label="DENEME cihazı benzetimi">
              <p className="small"><span className="badge badge-warning">DENEME</span> Gerçek cihaz yok: kart okutma sonucunu benzetin. Gerçek çekim yapılmaz.</p>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void act("simulate", { outcome: "approved" })}>Kart onaylandı (deneme)</button>
                <button className="btn btn-sm" disabled={busy} onClick={() => void act("simulate", { outcome: "declined" })}>Kart reddedildi (deneme)</button>
                <button className="btn btn-sm" disabled={busy} onClick={() => void act("simulate", { outcome: "no_response" })}>Cihaz yanıt vermedi (deneme)</button>
              </div>
            </div>
          )}
          {!cancelling ? <button className="btn btn-sm btn-ghost" onClick={() => setCancelling(true)}>İşlemi iptal et</button> : (
            <div className="stack" style={{ gap: 6 }}>
              <TextField label="İptal gerekçesi" required value={reason} onChange={(e) => setReason(e.target.value)} error={err?.fieldErrors.reason} />
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm" onClick={() => setCancelling(false)}>Vazgeç</button>
                <button className="btn btn-sm btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => void act("cancel", { reason })}>İptal et</button>
              </div>
            </div>
          )}
        </>
      )}

      {it.status === "unknown" && (
        <>
          <Alert kind="warning" title="Sonuç bilinmiyor">
            {it.failureReason ?? "Cihazdan yanıt gelmedi."} Kart çekilmiş olabilir; çift çekim olmasın diye bu terminalde yeni işlem açılmaz.
            POS cihazının son fişine veya işlem listesine bakıp sonucu girin.
          </Alert>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
            <legend className="small" style={{ fontWeight: 600 }}>POS fişinde bu çekim var mı?</legend>
            <label className="row small" style={{ gap: 6 }}><input type="radio" name={`res-${it.id}`} checked={resolveAs === "approved"} onChange={() => setResolveAs("approved")} />Evet, çekim yapılmış</label>
            <label className="row small" style={{ gap: 6 }}><input type="radio" name={`res-${it.id}`} checked={resolveAs === "declined"} onChange={() => setResolveAs("declined")} />Hayır, çekim yok</label>
          </fieldset>
          {resolveAs === "approved" && (
            <>
              <AuthCodeField value={authCode} onChange={setAuthCode} error={err?.fieldErrors.authCode} />
              <Last4Field value={last4} onChange={setLast4} error={err?.fieldErrors.cardLast4} />
              <SelectField label="Taksit (fişteki)" value={inst} onChange={(e) => setInst(Number(e.target.value))}>
                {installmentOptions.map((n) => <option key={n} value={n}>{installmentLabel(n)}</option>)}
              </SelectField>
              <button className="btn btn-primary" disabled={busy || authCode.length < 4 || last4.length !== 4}
                onClick={() => void act("resolve", { outcome: "approved", authCode, cardLast4: last4, installments: inst }, resolveKey)}>Çekimi onayla ve tahsilatı kaydet</button>
            </>
          )}
          {resolveAs === "declined" && (
            <>
              <TextField label="Açıklama" required placeholder="Örn. fişte çekim yok, cihaz bağlantısı koptu" value={reason} onChange={(e) => setReason(e.target.value)} error={err?.fieldErrors.reason} />
              <button className="btn" disabled={busy || reason.trim().length < 3} onClick={() => void act("resolve", { outcome: "declined", reason }, resolveKey)}>Çekim yok olarak kapat</button>
            </>
          )}
        </>
      )}

      {it.status === "approved" && (
        <Alert kind="success" title="Çekim onaylandı, tahsilat kaydedildi">
          Onay kodu {it.authCode} · kart {it.cardMasked} · {installmentLabel(it.installments)}{it.receiptNo && <> · makbuz {it.receiptNo}</>}
          {it.receiptId && <div style={{ marginTop: 6 }}><button className="btn btn-sm" onClick={() => void printReceipt(it.receiptId!)}><Printer size={14} aria-hidden />Makbuzu yazdır</button></div>}
        </Alert>
      )}
      {(it.status === "declined" || it.status === "cancelled") && (
        <Alert kind="warning" title={it.status === "declined" ? "Çekim reddedildi — tahsilat kaydedilmedi" : "İşlem iptal edildi — tahsilat kaydedilmedi"}>
          {it.failureReason}
          {onRetry && <div style={{ marginTop: 6 }}><button className="btn btn-sm" onClick={onRetry}><RefreshCw size={14} aria-hidden />Yeniden dene</button></div>}
        </Alert>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ gün sonu (Finans → POS ve gün sonu)
interface DayRow {
  terminalId: string; terminalName: string; driver: PosDriver; active: boolean; bankName: string | null; terminalRef: string | null;
  approvedCount: number; approvedTotal: string; openCount: number; intents: PosIntent[];
  settlement: null | { systemCount: number; systemTotal: string; slipCount: number; slipTotal: string; note: string | null; closedAt: string; closedBy: string; matched: boolean };
}

export function PosDayPanel({ notify }: { notify: (m: string) => void }) {
  const { can, tz } = useSession();
  const today = todayIn(tz);
  const [date, setDate] = useState(today);
  const day = useData<{ date: string; today: string; items: DayRow[] }>(`/pos/day?date=${date}`);
  const terms = usePosTerminals(can("finance.settings"));
  const [drawer, setDrawer] = useState<null | { kind: "intent"; id: string } | { kind: "settle"; row: DayRow } | { kind: "terminal"; t?: PosTerminal }>(null);
  const close = () => { setDrawer(null); void day.reload(); void terms.reload(); };

  return (
    <div className="stack">
      <Alert kind="info">
        Faz 0: bağımsız banka POS'unda çekim cihazda yapılır, sonuç (onay kodu, son 4 hane) elle eşleştirilir. Tutarı cihaza gönderen akış yalnız
        <strong> DENEME cihazı</strong> ile denenir; gerçek ÖKC/Android POS sürücüsü sağlayıcı sözleşmesi ve test cihazıyla eklenecek. Para doğrudan bankanın üye işyeri hesabına geçer; PİA-DENT para tutmaz.
      </Alert>
      <div className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <DateField label="Gün" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        <button className="btn btn-sm" onClick={() => setDate(today)}>Bugün</button>
        <button className="btn btn-sm" onClick={() => void day.reload()}><RefreshCw size={14} aria-hidden />Yenile</button>
        {can("finance.settings") && <button className="btn btn-sm" onClick={() => setDrawer({ kind: "terminal" })}><Plus size={14} aria-hidden />Terminal ekle</button>}
      </div>
      {day.loading && !day.data ? <Loading /> : day.error ? <ErrorState error={day.error} /> : !day.data?.items.length ? (
        <div className="card"><EmptyState icon={<CreditCard size={28} aria-hidden />} title="Tanımlı POS terminali yok">Yönetici “Terminal ekle” ile banka POS'unu tanımlar.</EmptyState></div>
      ) : day.data.items.map((r) => (
        <section key={r.terminalId} className="card stack" aria-label={`${r.terminalName} gün sonu`}>
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <h3 style={{ margin: 0 }}>{r.terminalName} {r.driver === "mock" && <span className="badge badge-warning">DENEME</span>} {!r.active && <span className="badge">Pasif</span>}</h3>
              <p className="small muted" style={{ margin: 0 }}>{POS_DRIVER_LABELS[r.driver]}{r.bankName && ` · ${r.bankName}`}{r.terminalRef && ` · terminal ${r.terminalRef}`}</p>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {can("finance.settings") && terms.data && (() => { const t = terms.data.items.find((x) => x.id === r.terminalId); return t ? <button className="btn btn-sm btn-ghost" onClick={() => setDrawer({ kind: "terminal", t })}>Düzenle</button> : null; })()}
              {!r.settlement && <button className="btn btn-sm btn-primary" onClick={() => setDrawer({ kind: "settle", row: r })}>Gün sonunu kapat</button>}
            </div>
          </div>
          <div className="pos-tiles">
            <div className="pos-tile"><span className="small muted">Onaylı çekim</span><strong>{r.approvedCount} adet · {formatTRY(r.approvedTotal)}</strong></div>
            <div className="pos-tile"><span className="small muted">Sonuçlanmamış</span><strong>{r.openCount}</strong></div>
            <div className="pos-tile"><span className="small muted">Gün sonu</span><strong>{r.settlement ? (r.settlement.matched ? "Eşleşti" : "Fark var") : "Alınmadı"}</strong></div>
          </div>
          {r.settlement && (
            <Alert kind={r.settlement.matched ? "success" : "warning"} title={r.settlement.matched ? "Gün sonu eşleşti" : "Gün sonu farkla kapandı"}>
              Sistem {r.settlement.systemCount} adet · {formatTRY(r.settlement.systemTotal)} — POS fişi {r.settlement.slipCount} adet · {formatTRY(r.settlement.slipTotal)}.
              {r.settlement.note && <> Açıklama: {r.settlement.note}.</>} {r.settlement.closedBy}, {fmtDateTime(r.settlement.closedAt)}.
            </Alert>
          )}
          {r.intents.length === 0 ? <p className="small muted">Bu gün işlem yok.</p> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>No</th><th>Saat</th><th>Hasta</th><th>Tutar</th><th>Taksit</th><th>Durum</th><th>Onay · kart</th><th><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>{r.intents.map((x) => (
                <tr key={x.id}>
                  <td>{x.intentNo}</td><td>{fmtDateTime(x.createdAt)}</td><td>{x.patientName}</td><td className="num">{formatTRY(x.amount)}</td>
                  <td>{installmentLabel(x.installments)}</td><td><StatusBadge s={x.status} /><div className="small muted">{POS_MODE_LABELS[x.mode]}</div></td>
                  <td>{x.authCode ? `${x.authCode} · ${x.cardMasked}` : "—"}</td>
                  <td>{["created", "awaiting_card", "unknown"].includes(x.status) && <button className="btn btn-sm" onClick={() => setDrawer({ kind: "intent", id: x.id })}>Sonuçlandır</button>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      ))}
      {drawer?.kind === "intent" && (
        <Drawer title="POS işlemini sonuçlandır" onClose={close} footer={<button className="btn" onClick={close}>Kapat</button>}>
          <PosIntentPanel intentId={drawer.id} onApproved={() => notify("POS çekimi onaylandı, tahsilat kaydedildi.")} />
        </Drawer>
      )}
      {drawer?.kind === "settle" && <SettleDrawer row={drawer.row} date={date} onClose={() => setDrawer(null)} onSaved={(m) => { notify(m); close(); }} />}
      {drawer?.kind === "terminal" && <TerminalDrawer t={drawer.t} onClose={() => setDrawer(null)} onSaved={(m) => { notify(m); close(); }} />}
    </div>
  );
}

function SettleDrawer({ row, date, onClose, onSaved }: { row: DayRow; date: string; onClose: () => void; onSaved: (m: string) => void }) {
  const [key] = useState(newIdempotencyKey);
  const [count, setCount] = useState("");
  const [total, setTotal] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parseMoneyInput(total);
  const n = count === "" ? null : Number(count);
  const diff = parsed ? minor(parsed) - minor(row.approvedTotal) : null;
  const mismatch = n !== null && diff !== null && (n !== row.approvedCount || diff !== 0n);
  async function save() {
    if (!parsed || n === null || !Number.isInteger(n)) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Fiş adedini ve toplamını girin.", field_errors: {} })); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api<{ matched: boolean }>("/pos/settlements", { body: { terminalId: row.terminalId, date, slipCount: n, slipTotal: parsed, note: note || undefined }, idempotencyKey: key });
      onSaved(r.matched ? "Gün sonu kapatıldı: sistem ile POS fişi eşleşti." : "Gün sonu farkla kapatıldı; açıklama kaydedildi.");
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Gün sonunu kapat" subtitle={`${row.terminalName} · sistemde ${row.approvedCount} onaylı çekim · ${formatTRY(row.approvedTotal)}`} onClose={onClose} dirty={!!count || !!total}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !parsed || n === null || (mismatch && note.trim().length < 3)} onClick={() => void save()}>Gün sonunu kapat</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        {row.openCount > 0 && <Alert kind="warning">Bu terminalde {row.openCount} sonuçlanmamış işlem var; gün sonundan önce sonuçlandırın.</Alert>}
        <p className="small">POS cihazından gün sonu (Z / batch) raporunu alın ve fişteki satış adedini ve toplamını girin.</p>
        <TextField label="Fişteki satış adedi" required inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} error={err?.fieldErrors.slipCount} />
        <TextField label="Fişteki satış toplamı (₺)" required inputMode="decimal" placeholder="0,00" value={total} onChange={(e) => setTotal(e.target.value)} error={err?.fieldErrors.slipTotal}
          hint={parsed ? `Kaydedilecek: ${formatTRY(parsed)}` : undefined} />
        {n !== null && diff !== null && (mismatch
          ? <Alert kind="warning" title="Sistem ile fiş tutmuyor">Adet farkı {n - row.approvedCount} · tutar farkı {formatTRY(money(diff))}. Farkın nedenini yazın (ör. sisteme girilmemiş çekim, iptal edilen satış).</Alert>
          : <Alert kind="success">Sistem ile POS fişi eşleşiyor.</Alert>)}
        <TextField label={mismatch ? "Fark açıklaması" : "Not"} required={mismatch} value={note} onChange={(e) => setNote(e.target.value)} error={err?.fieldErrors.note} />
      </div>
    </Drawer>
  );
}

function TerminalDrawer({ t, onClose, onSaved }: { t?: PosTerminal; onClose: () => void; onSaved: (m: string) => void }) {
  const accts = useData<{ items: { id: string; name: string; kind: string; active: boolean }[] }>("/cash-accounts");
  const posAccts = (accts.data?.items ?? []).filter((a) => a.kind === "pos_manual" && a.active);
  const [name, setName] = useState(t?.name ?? "");
  const [driver, setDriver] = useState<PosDriver>(t?.driver ?? "manual");
  const [acct, setAcct] = useState(t?.cashAccountId ?? "");
  const [bank, setBank] = useState(t?.bankName ?? "");
  const [ref, setRef] = useState(t?.terminalRef ?? "");
  const [active, setActive] = useState(t?.active ?? true);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!acct && posAccts[0]) setAcct(posAccts[0].id); }, [accts.data]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    setBusy(true); setErr(null);
    const body = { name, driver, cashAccountId: acct, bankName: bank || undefined, terminalRef: ref || undefined, active };
    try {
      if (t) await api(`/pos/terminals/${t.id}`, { method: "PATCH", body }); else await api("/pos/terminals", { body });
      onSaved(t ? "Terminal güncellendi." : "Terminal eklendi.");
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title={t ? "POS terminalini düzenle" : "POS terminali ekle"} onClose={onClose} dirty={!t && !!name}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy || !name.trim() || !acct} onClick={() => void save()}>Kaydet</button></>}>
      <div className="stack">
        {err && <Alert kind="error">{err.message}</Alert>}
        <TextField label="Ad" required value={name} onChange={(e) => setName(e.target.value)} error={err?.fieldErrors.name} />
        <SelectField label="Bağlantı" value={driver} disabled={!!t} onChange={(e) => setDriver(e.target.value as PosDriver)}
          hint={t ? "Bağlantı türü ve kasa hesabı sonradan değişmez." : undefined}>
          {POS_DRIVERS.map((d) => <option key={d} value={d}>{POS_DRIVER_LABELS[d]}</option>)}
        </SelectField>
        <SelectField label="Kasa hesabı (POS)" required value={acct} disabled={!!t} onChange={(e) => setAcct(e.target.value)} error={err?.fieldErrors.cashAccountId}>
          {!posAccts.length && <option value="">POS türünde kasa hesabı yok (Finans → Ayarlar)</option>}
          {posAccts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </SelectField>
        <TextField label="Banka" value={bank} onChange={(e) => setBank(e.target.value)} error={err?.fieldErrors.bankName} />
        <TextField label="Terminal no" value={ref} onChange={(e) => setRef(e.target.value)} error={err?.fieldErrors.terminalRef} hint="Bankanın verdiği terminal (TID) numarası; gizli bilgi değildir." />
        {t && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Aktif</label>}
      </div>
    </Drawer>
  );
}

