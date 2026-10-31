"use client";
/** Hesabım: iki adımlı doğrulama (TOTP) kurulumu ve yönetimi. Sır yalnız kurulumda bir kez gösterilir; QR yerelde üretilir. */
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { api, ApiFailure } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { useSession } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";
import { Alert, ErrorState, Loading, TextField, useToast } from "@/components/ui";

interface Status { enabled: boolean; enabledAt: string | null; pending: boolean; required: boolean }

export default function AccountPage() {
  const { session } = useSession();
  const st = useData<Status>("/me/mfa");
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const forced = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("zorunlu") === "1";

  useEffect(() => {
    if (!setup) { setQr(null); return; }
    QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 360, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(null));
  }, [setup]);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e as ApiFailure); } finally { setBusy(false); }
  }
  const start = () => run(async () => { setSetup(await api<{ secret: string; otpauthUri: string }>("/me/mfa/setup", { body: {} })); setCode(""); });
  const enable = () => run(async () => {
    await api("/me/mfa/enable", { body: { code } });
    setSetup(null); setCode("");
    toast.show("success", "İki adımlı doğrulama açıldı. Sonraki girişlerde kod istenecek.");
    if (forced) { window.location.href = "/bugun"; return; }
    await st.reload();
  });
  const disable = () => run(async () => {
    await api("/me/mfa/disable", { body: { code } });
    setCode(""); toast.show("success", "İki adımlı doğrulama kapatıldı."); await st.reload();
  });

  const s = st.data;
  return (
    <>
      <div className="page-head"><div><h1>Hesabım</h1><p>{session.user.fullName} · {session.user.email}</p></div></div>
      {forced && (!s || !s.enabled) && (
        <Alert kind="warning" title="Devam etmek için iki adımlı doğrulamayı açın">Kliniğiniz rolünüz için iki adımlı doğrulamayı zorunlu kılmıştır. Kurulum birkaç dakika sürer.</Alert>
      )}
      <section className="card card-pad stack" style={{ maxWidth: 720, marginTop: 16 }}>
        <div className="row" style={{ gap: 10 }}><KeyRound size={20} aria-hidden /><h2>İki adımlı doğrulama</h2>
          {s && (s.enabled ? <span className="badge badge-success">Açık</span> : <span className="badge badge-neutral">Kapalı</span>)}
          {s?.required && <span className="badge badge-info">Rolünüz için zorunlu</span>}
        </div>
        <p className="muted small">Parolanıza ek olarak telefonunuzdaki doğrulayıcı uygulamanın (ör. Google Authenticator, Microsoft Authenticator, 1Password) ürettiği
          6 haneli kod istenir. Parolanız ele geçse bile hesabınız korunur. SMS kullanılmaz.</p>
        {st.loading && !s ? <Loading /> : st.error ? <ErrorState error={st.error} onRetry={st.reload} /> : s && (
          <>
            {err && <Alert kind="error">{err.message}</Alert>}
            {s.enabled && !setup && (
              <div className="stack">
                <p>Açılış: <b>{fmtDateTime(s.enabledAt)}</b></p>
                {!s.required && (
                  <details>
                    <summary className="small">Kapat</summary>
                    <div className="stack" style={{ marginTop: 8, maxWidth: 320 }}>
                      <TextField label="Güncel 6 haneli kod" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} error={err?.fieldErrors.code} />
                      <div><button className="btn btn-danger" disabled={busy || code.length !== 6} onClick={() => void disable()}><ShieldOff size={16} aria-hidden />İki adımlı doğrulamayı kapat</button></div>
                    </div>
                  </details>
                )}
              </div>
            )}
            {!s.enabled && !setup && <div><button className="btn btn-primary" disabled={busy} onClick={() => void start()}><ShieldCheck size={17} aria-hidden />Kurulumu başlat</button></div>}
            {setup && (
              <div className="stack">
                <ol className="stack small" style={{ paddingLeft: 18 }}>
                  <li>Doğrulayıcı uygulamada “hesap ekle” deyin ve aşağıdaki karekodu okutun.</li>
                  <li>Karekod okutamıyorsanız anahtarı elle girin (zamana dayalı, 6 hane, 30 saniye).</li>
                  <li>Uygulamanın gösterdiği kodu girip etkinleştirin.</li>
                </ol>
                <div className="row" style={{ gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
                  {qr ? <img src={qr} alt="Doğrulayıcı uygulamada okutulacak karekod" width={180} height={180}
                    style={{ background: "#fff", padding: 6, borderRadius: 8, border: "1px solid var(--border)" }} /> : <div style={{ width: 180, height: 180 }}><Loading rows={2} /></div>}
                  <div className="stack" style={{ minWidth: 220 }}>
                    <TextField label="Kurulum anahtarı" readOnly value={setup.secret.replace(/(.{4})/g, "$1 ").trim()} onFocus={(e) => e.currentTarget.select()} />
                    <p className="small muted">Bu anahtar yalnız şimdi gösterilir; kimseyle paylaşmayın.</p>
                    <TextField label="Uygulamadaki 6 haneli kod" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} error={err?.fieldErrors.code} />
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn btn-primary" disabled={busy || code.length !== 6} onClick={() => void enable()}>Etkinleştir</button>
                      <button className="btn" onClick={() => { setSetup(null); setCode(""); }}>Vazgeç</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>
      {toast.node}
    </>
  );
}
