"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { Alert, Loading, TextField } from "@/components/ui";

interface Info { tenantName: string; email: string; fullName: string; roleLabel: string; expiresAt: string; userExists: boolean }

/** Davet kabulü (oturumsuz). Token yalnız sunucuda özetle doğrulanır; sayfa token'ı saklamaz. */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>() ?? { token: "" };
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState<ApiFailure | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Info>(`/invitations/${token}`).then(setInfo).catch((e) => setLoadErr(e as ApiFailure)); }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !info) return;
    if (!info.userExists && pw !== pw2) { setErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Parolalar eşleşmiyor.", field_errors: { password2: "Parolalar eşleşmiyor." } })); return; }
    setBusy(true); setErr(null);
    try { await api(`/invitations/${token}/accept`, { body: { password: pw } }); window.location.href = "/bugun"; }
    catch (e2) { setErr(e2 as ApiFailure); setBusy(false); }
  }

  return (
    <div className="login-wrap">
      <aside className="login-side">
        <div className="brand"><span className="brand-mark" aria-hidden>V</span><span>VİADENT</span></div>
        <div><h1>Ekibe hoş geldiniz.</h1><p style={{ marginTop: 12, opacity: 0.85, maxWidth: 420 }}>Davet bağlantısı tek kullanımlıktır.</p></div>
        <p className="small" style={{ opacity: 0.7 }}>Kliniğin akışı, tek yerde.</p>
      </aside>
      <div className="login-form">
        {!info && !loadErr ? <Loading /> : loadErr ? (
          <div style={{ width: "min(420px, 100%)" }} className="stack">
            <h1>Davet geçersiz</h1>
            <Alert kind="error">{loadErr.message}</Alert>
            <p className="muted">Klinik yöneticinizden yeni bir davet isteyin.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="stack" noValidate>
            <div>
              <h1>Daveti kabul et</h1>
              <p className="muted" style={{ marginTop: 4 }}><strong>{info!.tenantName}</strong> · {info!.roleLabel}</p>
              <p className="muted small">{info!.fullName} · {info!.email}</p>
            </div>
            {err && <Alert kind="error">{err.message}</Alert>}
            {info!.userExists ? (
              <>
                <Alert kind="info">Bu e-postayla bir VİADENT hesabınız var. Kabul etmek için mevcut parolanızı girin; klinik hesabınıza eklenir.</Alert>
                <TextField label="Mevcut parola" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} error={err?.fieldErrors.password} />
              </>
            ) : (
              <>
                <TextField label="Yeni parola" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} error={err?.fieldErrors.password} hint="En az 10 karakter" />
                <TextField label="Parola (tekrar)" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} error={err?.fieldErrors.password2} />
              </>
            )}
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ minHeight: 46 }}>{busy ? "Kaydediliyor…" : "Kabul et ve giriş yap"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
