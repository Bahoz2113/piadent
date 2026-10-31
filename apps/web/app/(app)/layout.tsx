"use client";
import { SessionProvider } from "@/lib/session";
import { Shell } from "@/components/shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<div className="state" role="status" style={{ minHeight: "100vh", justifyContent: "center" }}><div className="brand-mark" aria-hidden /><p>PİA-DENT yükleniyor…</p></div>}>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
