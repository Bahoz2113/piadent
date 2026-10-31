"use client";
import { useState } from "react";
import { Copy, MailPlus, ShieldOff } from "lucide-react";
import { ROLE_LABELS, ROLES, type Role } from "@viadent/contracts";
import { api, ApiFailure } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Alert, Drawer, ErrorState, Loading, SelectField, TextField } from "@/components/ui";

interface Member { id: string; role: Role; roleLabel: string; status: string; fullName: string; email: string; createdAt: string; revokedAt: string | null; isSelf: boolean; mfaEnabled?: boolean }
interface Invitation { id: string; email: string; fullName: string; roleLabel: string; expiresAt: string; createdBy: string }

export function TeamPanel({ notify }: { notify: (k: "success" | "error", t: string) => void }) {
  const team = useData<{ items: Member[] }>("/team");
  const invites = useData<{ items: Invitation[] }>("/team/invitations");
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); notify("success", ok); await Promise.all([team.reload(), invites.reload()]); }
    catch (e) { notify("error", (e as ApiFailure).message); } finally { setBusy(null); }
  }
  function revoke(m: Member) {
    const reason = window.prompt(`${m.fullName} kullanıcısının bu klinikteki erişimi kaldırılacak. Açık oturumları bir sonraki işlemde reddedilir.\n\nGerekçe (isteğe bağlı):`);
    if (reason === null) return;
    void act(m.id, () => api(`/team/${m.id}/revoke`, { body: { reason } }), "Erişim kaldırıldı.");
  }

  function resetMfa(m: Member) {
    const reason = window.prompt(`${m.fullName} kullanıcısının iki adımlı doğrulaması sıfırlanacak; tüm oturumları kapanır ve yeniden kurması gerekir.\n\nKimliğini nasıl doğruladınız? (zorunlu)`);
    if (!reason || !reason.trim()) return;
    void act(m.id, () => api(`/team/${m.id}/mfa-reset`, { body: { reason } }), "İki adımlı doğrulama sıfırlandı.");
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div><h2>Ekip</h2><p className="muted small">Rol değişikliği kullanıcının bir sonraki işleminde geçerli olur.</p></div>
          <button className="btn btn-primary" onClick={() => setInviting(true)}><MailPlus size={17} aria-hidden />Ekibe davet et</button>
        </div>
        {team.loading && !team.data ? <Loading /> : team.error ? <ErrorState error={team.error} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Kullanıcı</th><th>Rol</th><th>Durum</th><th>İki adımlı</th><th className="desktop-only">Eklenme</th><th><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>
                {team.data!.items.map((m) => (
                  <tr key={m.id}>
                    <td><strong>{m.fullName}</strong><div className="muted small">{m.email}</div></td>
                    <td>
                      {m.status === "active" && !m.isSelf ? (
                        <select className="select" style={{ minHeight: 36, width: 170 }} value={m.role} disabled={busy === m.id} aria-label={`${m.fullName} rolü`}
                          onChange={(e) => void act(m.id, () => api(`/team/${m.id}/role`, { body: { role: e.target.value } }), "Rol güncellendi.")}>
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                      ) : m.roleLabel}
                    </td>
                    <td>{m.status === "active" ? <span className="badge badge-success">Etkin</span> : <span className="badge badge-neutral">Kaldırıldı {m.revokedAt ? fmtDate(m.revokedAt) : ""}</span>}</td>
                    <td>{m.mfaEnabled ? <span className="badge badge-success">Açık</span> : <span className="badge badge-neutral">Kapalı</span>}</td>
                    <td className="desktop-only">{fmtDate(m.createdAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      {m.status === "active" && !m.isSelf && m.mfaEnabled && <button className="btn btn-sm" disabled={busy === m.id} onClick={() => resetMfa(m)} style={{ marginRight: 6 }}>Doğrulayıcıyı sıfırla</button>}
                      {m.status === "active" && !m.isSelf && <button className="btn btn-sm btn-danger" disabled={busy === m.id} onClick={() => revoke(m)}><ShieldOff size={15} aria-hidden />Erişimi kaldır</button>}
                      {m.isSelf && <span className="muted small">Siz</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card">
        <div className="card-head"><h2>Bekleyen davetler</h2></div>
        {(invites.data?.items.length ?? 0) === 0 ? <p className="card-pad muted">Açık davet yok.</p> : (
          <ul className="list">
            {invites.data!.items.map((i) => (
              <li key={i.id} className="row" style={{ padding: "12px 20px", justifyContent: "space-between" }}>
                <div><strong>{i.fullName}</strong> <span className="muted small">· {i.email} · {i.roleLabel}</span><div className="muted small">Son geçerlilik: {fmtDateTime(i.expiresAt)} · Davet eden: {i.createdBy}</div></div>
                <button className="btn btn-sm btn-danger" disabled={busy === i.id} onClick={() => void act(i.id, () => api(`/team/invitations/${i.id}/revoke`, { body: {} }), "Davet iptal edildi.")}>İptal et</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {inviting && <InviteDrawer onClose={() => setInviting(false)} onDone={() => { void invites.reload(); }} />}
    </div>
  );
}

function InviteDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ email: "", fullName: "", role: "secretary" });
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function save() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ acceptPath: string }>("/team/invitations", { body: f });
      setLink(`${window.location.origin}${r.acceptPath}`);
      onDone();
    } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  return (
    <Drawer title="Ekibe davet et" subtitle="Bağlantı 72 saat geçerli ve tek kullanımlıktır." onClose={onClose} dirty={!link && !!(f.email || f.fullName)}
      footer={link ? <button className="btn btn-primary" onClick={onClose}>Tamam</button> : <><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Oluşturuluyor…" : "Davet bağlantısı oluştur"}</button></>}>
      {link ? (
        <div className="stack">
          <Alert kind="success" title="Davet oluşturuldu">E-posta gönderimi bağlı değil; bağlantıyı kişiye güvenli bir kanaldan iletin. Bu bağlantı yalnız şimdi gösterilir.</Alert>
          <TextField label="Davet bağlantısı" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)); }}><Copy size={16} aria-hidden />{copied ? "Kopyalandı" : "Bağlantıyı kopyala"}</button>
        </div>
      ) : (
        <div className="stack">
          {err && <Alert kind="error">{err.message}</Alert>}
          <TextField label="Ad soyad" required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} error={err?.fieldErrors.fullName} />
          <TextField label="E-posta" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={err?.fieldErrors.email} />
          <SelectField label="Rol" required value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </SelectField>
          <p className="small muted">Klinik yöneticisi rolü klinik notlara erişim vermez; sağlık içeriği hekim ve asistan rollerine açıktır.</p>
        </div>
      )}
    </Drawer>
  );
}
