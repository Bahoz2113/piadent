"use client";
/** Yönetim → Güvenlik (Görev 10): klinik MFA politikası (ADR-060) ve süreli destek erişimi (ADR-061). */
import { useEffect, useState } from "react";
import { LifeBuoy, ShieldCheck, Workflow } from "lucide-react";
import { api, ApiFailure } from "@/lib/api";
import { AKIS_SETTING_LABELS, type AkisSettingsT } from "@viadent/contracts";
import { useData } from "@/lib/use-data";
import { fmtDateTime } from "@/lib/format";
import { Alert, ErrorState, Loading, SelectField, TextAreaField, TextField } from "@/components/ui";

type Notify = (k: "success" | "error", t: string) => void;
interface Policy { requireMfaRoles: string[]; platformRequireMfaRoles: string[]; roles: { id: string; label: string }[] }
interface Grant { id: string; email: string; fullName: string; createdAt: string; expiresAt: string; revokedAt: string | null; reason: string; active: boolean; status: "pending" | "active" | "revoked"; createdBy: string | null; approvedBy: string | null; canApprove: boolean }

export function SecurityPanel({ notify }: { notify: Notify }) {
  const pol = useData<Policy>("/security/policy");
  const grants = useData<{ items: Grant[]; fourEyes: boolean }>("/security/support-grants");
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [g, setG] = useState({ email: "", hours: "4", reason: "" });
  useEffect(() => { if (pol.data) setSel(pol.data.requireMfaRoles); }, [pol.data]);

  async function save() {
    setBusy(true); setErr(null);
    try { await api("/security/policy", { method: "PUT", body: { requireMfaRoles: sel } }); notify("success", "Güvenlik politikası kaydedildi."); await pol.reload(); }
    catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  async function grant() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ status: string }>("/security/support-grants", { body: { email: g.email, hours: Number(g.hours), reason: g.reason } });
      notify("success", r.status === "pending" ? "Destek talebi açıldı; başka bir yönetici onaylayınca etkinleşir." : "Destek erişimi verildi; süre dolunca kendiliğinden kapanır."); setG({ email: "", hours: "4", reason: "" }); await grants.reload();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  async function approve(id: string) {
    setBusy(true);
    try { await api(`/security/support-grants/${id}/approve`, { body: {} }); notify("success", "Destek erişimi onaylandı ve etkinleşti."); await grants.reload(); }
    catch (e) { notify("error", (e as ApiFailure).message); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    const reason = window.prompt("Destek erişimi erken sonlandırılacak. Gerekçe (isteğe bağlı):");
    if (reason === null) return;
    setBusy(true);
    try { await api(`/team/${id}/revoke`, { body: { reason } }); notify("success", "Destek erişimi kaldırıldı."); await grants.reload(); }
    catch (e) { notify("error", (e as ApiFailure).message); } finally { setBusy(false); }
  }

  if (pol.loading && !pol.data) return <div className="card"><Loading /></div>;
  if (pol.error) return <div className="card"><ErrorState error={pol.error} onRetry={pol.reload} /></div>;
  const p = pol.data!;
  return (
    <div className="stack">
      <section className="card card-pad stack">
        <div className="row" style={{ gap: 10 }}><ShieldCheck size={20} aria-hidden /><h2>İki adımlı doğrulama politikası</h2></div>
        <p className="muted small">Seçili rollerdeki kullanıcılar iki adımlı doğrulamayı kurmadan klinik verisine erişemez (yalnız Hesabım açılır). Kendi rolünüzü seçmeden önce kendi doğrulamanızı açın.
          {p.platformRequireMfaRoles.length > 0 && <> Platform tabanı (her klinikte zorunlu): <b>{p.platformRequireMfaRoles.join(", ")}</b>.</>}</p>
        {err && err.code !== "VALIDATION_FAILED" && <Alert kind="error">{err.message}</Alert>}
        <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
          {p.roles.filter((r) => r.id !== "support").map((r) => (
            <label key={r.id} className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={sel.includes(r.id) || p.platformRequireMfaRoles.includes(r.id)} disabled={p.platformRequireMfaRoles.includes(r.id)}
                onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} /> {r.label}
            </label>
          ))}
        </div>
        <div><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Politikayı kaydet</button></div>
      </section>

      <section className="card card-pad stack">
        <div className="row" style={{ gap: 10 }}><LifeBuoy size={20} aria-hidden /><h2>Süreli destek erişimi</h2></div>
        <p className="muted small">VİADENT destek ekibine (var olan bir kullanıcı hesabı) en çok 72 saatlik, <b>salt okunur</b> erişim verir: hasta kimlikleri maskeli, sağlık içeriği ve finans kapalı, hiçbir kayıt değiştirilemez.
          Süre dolunca kendiliğinden kapanır; her işlem denetim izinde görünür. Erken kaldırmak için listeden “Kaldır”.</p>
        {err && err.code === "VALIDATION_FAILED" && <Alert kind="error">{err.message}</Alert>}
        <div className="form-grid">
          <TextField label="Destek hesabı e-postası" type="email" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} error={err?.fieldErrors.email} />
          <SelectField label="Süre" value={g.hours} onChange={(e) => setG({ ...g, hours: e.target.value })}>
            {["1", "4", "8", "24", "72"].map((h) => <option key={h} value={h}>{h} saat</option>)}
          </SelectField>
          <TextAreaField className="full" label="Gerekçe (destek talebi / sorun)" required value={g.reason} onChange={(e) => setG({ ...g, reason: e.target.value })} error={err?.fieldErrors.reason} />
        </div>
        <div><button className="btn" disabled={busy || !g.email || g.reason.trim().length < 10} onClick={() => void grant()}>Destek erişimi ver</button>
          {grants.data?.fourEyes && <span className="muted small" style={{ marginLeft: 12 }}>Dört göz kuralı: klinikte birden fazla yönetici var; talep ikinci bir yöneticinin onayıyla etkinleşir.</span>}</div>
        {grants.data && grants.data.items.length > 0 && (
          <div className="table-wrap" tabIndex={0}><table className="table"><thead><tr><th>Hesap</th><th>Gerekçe</th><th>Bitiş</th><th>Durum</th><th /></tr></thead>
            <tbody>{grants.data.items.map((x) => (
              <tr key={x.id}>
                <td><strong>{x.fullName}</strong><div className="muted small">{x.email}</div></td>
                <td className="small">{x.reason}</td>
                <td className="small">{fmtDateTime(x.expiresAt)}</td>
                <td>{x.status === "pending" && new Date(x.expiresAt) > new Date() ? <span className="badge badge-warning" title={x.createdBy ? `Talep: ${x.createdBy}` : undefined}>Onay bekliyor</span> : x.active ? <span className="badge badge-success" title={x.approvedBy ? `Onaylayan: ${x.approvedBy}` : undefined}>Etkin</span> : <span className="badge badge-neutral">{x.revokedAt ? "Kaldırıldı" : "Süresi doldu"}</span>}</td>
                <td style={{ textAlign: "right" }}>
                  {x.canApprove && new Date(x.expiresAt) > new Date() && <button className="btn btn-sm" disabled={busy} onClick={() => void approve(x.id)}>Onayla</button>}
                  {x.status === "pending" && !x.canApprove && new Date(x.expiresAt) > new Date() && <span className="muted small">Başka bir yönetici onaylamalı</span>}
                  {x.active && <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void revoke(x.id)}>Kaldır</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <AkisSettingsPanel notify={notify} />
    </div>
  );
}

/** VİA Akış eşikleri (ADR-073): klinik kendi uyarı sürelerini belirler; boş bırakılan alan varsayılana döner. */
function AkisSettingsPanel({ notify }: { notify: Notify }) {
  const d = useData<{ settings: AkisSettingsT; defaults: AkisSettingsT }>("/security/akis");
  const [f, setF] = useState<Record<keyof AkisSettingsT, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiFailure | null>(null);
  useEffect(() => { if (d.data && !f) setF(Object.fromEntries(Object.entries(d.data.settings).map(([k, v]) => [k, String(v)])) as Record<keyof AkisSettingsT, string>); }, [d.data, f]);
  if (d.loading && !d.data) return <section className="card"><Loading /></section>;
  if (d.error || !d.data || !f) return <section className="card"><ErrorState error={d.error ?? new ApiFailure(500, { code: "UNKNOWN", message: "Yüklenemedi" })} onRetry={d.reload} /></section>;
  const keys = Object.keys(AKIS_SETTING_LABELS) as (keyof AkisSettingsT)[];
  async function save() {
    setBusy(true); setErr(null);
    try {
      const body = Object.fromEntries(keys.map((k) => [k, f![k] === "" ? d.data!.defaults[k] : Number(f![k])]));
      const r = await api<{ settings: AkisSettingsT }>("/security/akis", { method: "PUT", body });
      setF(Object.fromEntries(Object.entries(r.settings).map(([k, v]) => [k, String(v)])) as Record<keyof AkisSettingsT, string>);
      notify("success", "VİA Akış eşikleri kaydedildi; görevler bir sonraki taramada yeni eşiklerle üretilir.");
      await d.reload();
    } catch (e) { setErr(e as ApiFailure); notify("error", (e as ApiFailure).message); } finally { setBusy(false); }
  }
  return (
    <section className="card card-pad stack" aria-labelledby="akis-h">
      <div className="row" style={{ gap: 10 }}><Workflow size={20} aria-hidden /><h2 id="akis-h">VİA Akış eşikleri</h2></div>
      <p className="muted small">Görev üretim kuralları için bekleme süreleri. Varsayılanlar parantezde; boş bırakırsanız varsayılan kullanılır. Değişiklik denetim kaydına yazılır.</p>
      <div className="form-grid">
        {keys.map((k) => {
          const m = AKIS_SETTING_LABELS[k];
          return <TextField key={k} label={`${m.label} (${m.unit}, varsayılan ${d.data!.defaults[k]})`} type="number" inputMode="numeric" min={m.min} max={m.max} step={1}
            value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} hint={m.hint} error={err?.fieldErrors[k]} />;
        })}
      </div>
      <div><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Eşikleri kaydet</button></div>
    </section>
  );
}
