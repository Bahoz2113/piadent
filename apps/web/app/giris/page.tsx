"use client";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { Alert, TextField } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { body: { email, password } });
      window.location.href = "/bugun";
    } catch (err) {
      setError(err as ApiFailure);
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
          <TextField label="E-posta" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} error={error?.fieldErrors.email} />
          <TextField label="Parola" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={error?.fieldErrors.password} />
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ minHeight: 46 }}>{busy ? "Giriş yapılıyor…" : "Giriş yap"}</button>
        </form>
      </div>
    </div>
  );
}
