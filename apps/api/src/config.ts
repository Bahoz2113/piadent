import { loadEnv, requireEnv } from "@viadent/db";

export interface AppConfig {
  databaseUrl: string;
  port: number;
  sessionTtlHours: number;
  /** Boşta kalma süresi (dk): bu kadar süre istek gelmeyen oturum düşer (klinikte açık bırakılan ekran). 0 = kapalı. */
  sessionIdleMinutes: number;
  webOrigin: string;
  production: boolean;
  /** Bu rollerde iki adımlı doğrulama zorunlu (VIADENT_REQUIRE_MFA_ROLES, örn. "clinic_admin,finance"). */
  requireMfaRoles: string[];
  /** /metrics erişim belirteci; boşsa uç kapalı (404). */
  metricsToken: string;
  /** Express "trust proxy": yerelde loopback; konteynerde ters vekilin ağı (ör. "10.0.0.0/8" veya hop sayısı "1"). */
  trustProxy: string;
  version: string;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadEnv();
  return {
    databaseUrl: overrides.databaseUrl ?? requireEnv("DATABASE_URL"),
    port: overrides.port ?? Number(process.env.API_PORT ?? 4000),
    sessionTtlHours: overrides.sessionTtlHours ?? Number(process.env.SESSION_TTL_HOURS ?? 12),
    sessionIdleMinutes: overrides.sessionIdleMinutes ?? Number(process.env.SESSION_IDLE_MINUTES ?? 90),
    webOrigin: overrides.webOrigin ?? process.env.WEB_ORIGIN ?? "http://localhost:3000",
    production: overrides.production ?? process.env.NODE_ENV === "production",
    requireMfaRoles: overrides.requireMfaRoles ?? (process.env.VIADENT_REQUIRE_MFA_ROLES ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    metricsToken: overrides.metricsToken ?? process.env.METRICS_TOKEN ?? "",
    trustProxy: overrides.trustProxy ?? process.env.TRUST_PROXY ?? "loopback",
    version: overrides.version ?? process.env.VIADENT_VERSION ?? "dev",
  };
}

export const CONFIG = Symbol("CONFIG");
