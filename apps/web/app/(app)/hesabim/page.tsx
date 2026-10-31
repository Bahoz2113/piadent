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
  const pwForced = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("parola") === "1";
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", newPassword2: "", code: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<ApiFailure | null>(null);
  async function changePassword() {
    if (pwBusy) return;
    if (pw.newPassword !== pw.newPassword2) { setPwErr(new ApiFailure(422, { code: "VALIDATION_FAILED", message: "Yeni parolalar aynı değil.", field_errors: { newPassword2: "Parolalar eşleşmiyor." } })); return; }
    setPwBusy(true); setPwErr(null);
    try {
      await api("/me/password", { body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword, ...(pw.code ? { code: pw.code } : {}) } });
      setPw({ currentPassword: "", newPassword: "", newPassword2: "", code: "" });
      toast.show("success", "Parola değiştirildi. Diğer oturumlarınız kapatıldı.");
      if (pwForced) { window.location.href = "/bugun"; return; }
    } catch (e) { setPwErr(e as ApiFailure); } finally { setPwBusy(false); }
  }

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
      {pwForced && (
        <Alert kind="warning" title="Devam etmek için yeni parola belirleyin">Geçici parolayla giriş yaptınız. Kendi parolanızı belirleyene kadar diğer ekranlar kapalıdır.</Alert>
      )}
      {forced && (!s || !s.enabled) && (
        <Alert kind="warning" title="Devam etmek için iki adımlı doğrulamayı açın">Kliniğiniz rolünüz için iki adımlı doğrulamayı zorunlu kılmıştır. Kurulum birkaç dakika sürer.</Alert>
      )}
      <section className="card card-pad stack" style={{ maxWidth: 720, marginTop: 16 }}>
        <div className="row" style={{ gap: 10 }}><KeyRound size={20} aria-hidden /><h2>Parola</h2></div>
        <p className="muted small">Yeni parola en az 10 karakter olmalıdır. Değişiklikten sonra bu cihaz dışındaki tüm oturumlarınız kapatılır.{s?.enabled ? " İki adımlı doğrulama açık olduğu için güncel kodunuz da istenir." : ""}</p>
        {pwErr && <Alert kind="error">{pwErr.message}</Alert>}
        <div className="stack" style={{ maxWidth: 360 }}>
          <TextField label="Mevcut parola" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} error={pwErr?.fieldErrors.currentPassword} />
          <TextField label="Yeni parola" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} error={pwErr?.fieldErrors.newPassword} />
          <TextField label="Yeni parola (tekrar)" type="password" autoComplete="new-password" value={pw.newPassword2} onChange={(e) => setPw({ ...pw, newPassword2: e.target.value })} error={pwErr?.fieldErrors.newPassword2} />
          {s?.enabled && <TextField label="İki adımlı doğrulama kodu" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pw.code} onChange={(e) => setPw({ ...pw, code: e.target.value.replace(/\D/g, "") })} error={pwErr?.fieldErrors.code} />}
          <div><button className="btn btn-primary" disabled={pwBusy || pw.currentPassword.length < 1 || pw.newPassword.length < 10} onClick={() => void changePassword()}>{pwBusy ? "Değiştiriliyor…" : "Parolayı değiştir"}</button></div>
        </div>
      </section>
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
