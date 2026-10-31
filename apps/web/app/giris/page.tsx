"use client";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { Alert, TextField } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (challenge) {
        await api("/auth/mfa", { body: { challenge, code } });
        window.location.href = "/bugun";
        return;
      }
      const r = await api<{ ok: boolean; mfaRequired?: boolean; challenge?: string }>("/auth/login", { body: { email, password } });
      if (r.mfaRequired && r.challenge) { setChallenge(r.challenge); setPassword(""); setBusy(false); return; }
      window.location.href = "/bugun";
    } catch (err) {
      const f = err as ApiFailure;
      // Süresi dolmuş/çok denenmiş doğrulama: parola adımına dön.
      if (challenge && (f.code === "MFA_CHALLENGE_INVALID" || f.code === "TOO_MANY_ATTEMPTS")) { setChallenge(null); setCode(""); }
      setError(f);
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <aside className="login-side">
        <div className="brand"><span className="brand-mark" aria-hidden>V</span><span>VİADENT</span></div>
        <div>
          <h1>Kliniğin akışı, tek yerde.</h1>
          <p style={{ marginTop: 12, opacity: 0.85, maxWidth: 420 }}>Bugün ne yapılacağı, hastanın sıradaki adımı ve hesabın nerede olduğu — tek bakışta.</p>
        </div>
        <p className="small" style={{ opacity: 0.7 }}>Demo ortamı yalnız sentetik veri içerir.</p>
      </aside>
      <div className="login-form">
        <form onSubmit={submit} className="stack" noValidate>
          <div>
            <h1>Giriş yap</h1>
            <p className="muted" style={{ marginTop: 4 }}>Klinik hesabınızla devam edin.</p>
          </div>
          {error && <Alert kind="error">{error.message}</Alert>}
          {challenge ? (
            <>
              <p className="muted">İki adımlı doğrulama açık. Doğrulayıcı uygulamanızdaki 6 haneli kodu girin.</p>
              <TextField label="Doğrulama kodu" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} error={error?.fieldErrors.code} />
              <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6} style={{ minHeight: 46 }}>{busy ? "Doğrulanıyor…" : "Doğrula ve giriş yap"}</button>
              <button className="btn btn-ghost" type="button" onClick={() => { setChallenge(null); setCode(""); setError(null); }}>Farklı hesapla giriş yap</button>
              <p className="small muted">Telefonunuzu kaybettiyseniz klinik yöneticiniz doğrulayıcınızı kimliğinizi doğruladıktan sonra sıfırlayabilir.</p>
            </>
          ) : (
            <>
              <TextField label="E-posta" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} error={error?.fieldErrors.email} />
              <TextField label="Parola" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={error?.fieldErrors.password} />
              <button className="btn btn-primary" type="submit" disabled={busy} style={{ minHeight: 46 }}>{busy ? "Giriş yapılıyor…" : "Giriş yap"}</button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
