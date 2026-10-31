import { loadEnv, requireEnv } from "@viadent/db";

export interface AppConfig {
  databaseUrl: string;
  port: number;
  sessionTtlHours: number;
  webOrigin: string;
  production: boolean;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadEnv();
  return {
    databaseUrl: overrides.databaseUrl ?? requireEnv("DATABASE_URL"),
    port: overrides.port ?? Number(process.env.API_PORT ?? 4000),
    sessionTtlHours: overrides.sessionTtlHours ?? Number(process.env.SESSION_TTL_HOURS ?? 12),
    webOrigin: overrides.webOrigin ?? process.env.WEB_ORIGIN ?? "http://localhost:3000",
    production: overrides.production ?? process.env.NODE_ENV === "production",
  };
}

export const CONFIG = Symbol("CONFIG");
