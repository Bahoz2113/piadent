"use client";
import { useState } from "react";
import { ShieldOff } from "lucide-react";
import { api, ApiFailure } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useData } from "@/lib/use-data";
import { fmtDate } from "@/lib/format";
import { Alert, EmptyState, ErrorState, Loading, useToast } from "@/components/ui";

interface Member { id: string; roleLabel: string; status: string; fullName: string; email: string; createdAt: string; revokedAt: string | null; isSelf: boolean }

export default function AdminPage() {
  const { can, session } = useSession();
  const team = useData<{ items: Member[] }>(can("team.manage") ? "/team" : null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  async function revoke(m: Member) {
    const reason = window.prompt(`${m.fullName} kullanıcısının bu klinikteki erişimi kaldırılacak. Açık oturumları bir sonraki işlemde reddedilir.\n\nGerekçe (isteğe bağlı):`);
    if (reason === null) return;
    setBusy(m.id);
    try { await api(`/team/${m.id}/revoke`, { body: { reason } }); toast.show("success", "Erişim kaldırıldı."); await team.reload(); }
    catch (e) { toast.show("error", (e as ApiFailure).message); } finally { setBusy(null); }
  }

  return (
    <>
      <div className="page-head"><div><h1>Yönetim</h1><p>{session.activeMembership?.tenantName}</p></div></div>
      {!can("team.manage") ? (
        <div className="card"><EmptyState title="Yönetim bölümü klinik yöneticilerine açıktır" /></div>
      ) : (
        <section className="card">
          <div className="card-head"><div><h2>Ekip ve erişim</h2><p className="muted small">Rol değişikliği ve davet Görev 1 kapsamında eklenecek.</p></div></div>
          {team.loading && !team.data ? <Loading /> : team.error ? <ErrorState error={team.error} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Kullanıcı</th><th>Rol</th><th>Durum</th><th className="desktop-only">Eklenme</th><th><span className="sr-only">İşlem</span></th></tr></thead>
                <tbody>
                  {team.data!.items.map((m) => (
                    <tr key={m.id}>
                      <td><strong>{m.fullName}</strong><div className="muted small">{m.email}</div></td>
                      <td>{m.roleLabel}</td>
                      <td>{m.status === "active" ? <span className="badge badge-success">Etkin</span> : <span className="badge badge-neutral">Kaldırıldı {m.revokedAt ? fmtDate(m.revokedAt) : ""}</span>}</td>
                      <td className="desktop-only">{fmtDate(m.createdAt)}</td>
                      <td style={{ textAlign: "right" }}>
                        {m.status === "active" && !m.isSelf && <button className="btn btn-sm btn-danger" disabled={busy === m.id} onClick={() => void revoke(m)}><ShieldOff size={15} aria-hidden />Erişimi kaldır</button>}
                        {m.isSelf && <span className="muted small">Siz</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <div style={{ marginTop: 16 }}><Alert kind="info" title="Klinik ayarları">Çalışma saatleri, kapatmalar, hizmet/tarife ve şablon tanımları sonraki görevlerde (T01–T20, A01–A03) bu bölüme eklenecek.</Alert></div>
      {toast.node}
    </>
  );
}
