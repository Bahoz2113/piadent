"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { normalizeAppearance } from "@viadent/contracts";
import { applyAppearance, saveLocalAppearance } from "@/lib/appearance";
import type { Permission } from "@viadent/contracts";
import { api, ApiFailure, onApiFailure, setPageContext } from "./api";

export interface SessionInfo {
  user: { id: string; fullName: string; email: string; appearance?: unknown };
  activeMembership: { id: string; tenantId: string; tenantName: string; timezone: string; role: string; roleLabel: string } | null;
  memberships: { id: string; tenantName: string; role: string; roleLabel: string }[];
  permissions: Permission[];
  mfa?: { enabled: boolean; required: boolean };
  mustChangePassword?: boolean;
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
        // Görünüm: sunucudaki tercih (başka cihazda değiştirilmiş olabilir) bu cihaza uygulanır.
        if (s.user?.appearance) { const a = normalizeAppearance(s.user.appearance); applyAppearance(a); saveLocalAppearance(a); }
        // Geçici parola veya zorunlu MFA kurulmamış: yalnız Hesabım açılır.
        if (s.mustChangePassword && window.location.pathname !== "/hesabim") { window.location.href = "/hesabim?parola=1"; return; }
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
      if (f.code === "PASSWORD_CHANGE_REQUIRED" && window.location.pathname !== "/hesabim") window.location.href = "/hesabim?parola=1";
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
