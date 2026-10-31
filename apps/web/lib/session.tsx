"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Permission } from "@viadent/contracts";
import { api, ApiFailure, onApiFailure, setPageContext } from "./api";

export interface SessionInfo {
  user: { id: string; fullName: string; email: string };
  activeMembership: { id: string; tenantId: string; tenantName: string; timezone: string; role: string; roleLabel: string } | null;
  memberships: { id: string; tenantName: string; role: string; roleLabel: string }[];
  permissions: Permission[];
  mfa?: { enabled: boolean; required: boolean };
}

interface Ctx {
  session: SessionInfo;
  can: (p: Permission) => boolean;
  tz: string;
  switchTo: (membershipId: string) => Promise<void>;
  logout: () => Promise<void>;
  contextChanged: boolean;
}

const SessionCtx = createContext<Ctx | null>(null);

export function useSession(): Ctx {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("SessionProvider eksik");
  return c;
}

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [contextChanged, setContextChanged] = useState(false);

  useEffect(() => {
    api<SessionInfo>("/session")
      .then((s) => {
        setPageContext(s.activeMembership?.id ?? "");
        // Rolü için iki adımlı doğrulama zorunlu ama kurulmamış: yalnız Hesabım sayfası açılır.
        if (s.mfa?.required && !s.mfa.enabled && window.location.pathname !== "/hesabim") { window.location.href = "/hesabim?zorunlu=1"; return; }
        setSession(s);
      })
      .catch((e) => {
        if (e instanceof ApiFailure && e.status === 401) window.location.href = "/giris";
      });
    return onApiFailure((f) => {
      if (f.status === 401) window.location.href = "/giris";
      if (f.code === "CONTEXT_CHANGED" || f.code === "MEMBERSHIP_REVOKED") setContextChanged(true);
      if (f.code === "MFA_ENROLLMENT_REQUIRED" && window.location.pathname !== "/hesabim") window.location.href = "/hesabim?zorunlu=1";
    });
  }, []);

  const switchTo = useCallback(async (membershipId: string) => {
    await api("/session/switch", { body: { membershipId } });
    // Önceki kliniğin bellekteki verisi yeni bağlama karışmasın: tam yeniden yükleme.
    window.location.href = "/bugun";
  }, []);
  const logout = useCallback(async () => {
    await api("/auth/logout", { body: {} }).catch(() => undefined);
    window.location.href = "/giris";
  }, []);

  if (!session) return <>{fallback}</>;
  const perms = new Set(session.permissions);
  return (
    <SessionCtx.Provider value={{ session, can: (p) => perms.has(p), tz: session.activeMembership?.timezone ?? "Europe/Istanbul", switchTo, logout, contextChanged }}>
      {children}
    </SessionCtx.Provider>
  );
}
