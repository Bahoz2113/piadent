import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import pg from "pg";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/config.js";
import { ADMIN_URL, APP_URL, OWNER_URL, TEST_DB, TEST_PASSWORD } from "./env.js";

export const EMAILS = {
  aAdmin: "yonetici@demo-yesil.test",
  aDentist: "elif.aras@demo-yesil.test",
  aSecretary: "sekreter@demo-yesil.test",
  aAssistant: "asistan@demo-yesil.test",
  aFinance: "finans@demo-yesil.test",
  bAdmin: "yonetici@demo-mavi.test",
  bDentist: "hekim@demo-mavi.test",
  multi: "coklu@demo.test",
} as const;

export async function startApp(overrides: Partial<import("../src/config.js").AppConfig> = {}, opts: { keepThrottle?: boolean } = {}): Promise<INestApplication> {
  if (!opts.keepThrottle) await resetRateLimiter();
  const app = await createApp(loadConfig({ databaseUrl: APP_URL, port: 0, loginBackoffMaxMs: 0, ...overrides }), { logger: process.env.DEBUG_API ? undefined : false });
  await app.init();
  return app;
}

export interface Client {
  get(path: string): request.Test;
  post(path: string, body?: unknown): request.Test;
  patch(path: string, body?: unknown): request.Test;
  put(path: string, body?: unknown): request.Test;
  cookie: string;
  context: string;
  session: any;
  setContext(id: string): void;
}

/** Oturum açar; çerez + sayfa bağlam başlığıyla istek atan istemci döner. */
export async function login(app: INestApplication, email: string, password = TEST_PASSWORD): Promise<Client> {
  const server = app.getHttpServer();
  const res = await request(server).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} → ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
  const session = (await request(server).get("/api/v1/session").set("cookie", cookie)).body;
  const client: Client = {
    cookie,
    context: session.activeMembership?.id ?? "",
    session,
    setContext(id) { client.context = id; },
    get: (path) => request(server).get(`/api/v1${path}`).set("cookie", cookie).set("x-viadent-context", client.context),
    post: (path, body) => request(server).post(`/api/v1${path}`).set("cookie", cookie).set("x-viadent-request", "1")
      .set("x-viadent-context", client.context).send((body ?? {}) as object),
    patch: (path, body) => request(server).patch(`/api/v1${path}`).set("cookie", cookie).set("x-viadent-request", "1")
      .set("x-viadent-context", client.context).send((body ?? {}) as object),
    put: (path, body) => request(server).put(`/api/v1${path}`).set("cookie", cookie).set("x-viadent-request", "1")
      .set("x-viadent-context", client.context).send((body ?? {}) as object),
  };
  return client;
}

/** Test doğrulaması için sahip rolüyle tenant bağlamında sorgu (uygulama yolu DEĞİL). */
export async function ownerQuery<T = any>(tenantId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: OWNER_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId ?? ""]);
    const r = await c.query(sql, params);
    await c.query("commit");
    return r.rows;
  } finally {
    await c.end();
  }
}

export function tomorrowIstanbul(offsetDays = 1): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offsetDays)).toISOString().slice(0, 10);
}

/** Tüm tenant'ları kapsayan doğrulama (superuser; yalnız testte "hiçbir yerde yok" kontrolü için). */
export async function adminQuery<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const u = new URL(ADMIN_URL);
  u.pathname = "/" + TEST_DB;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

/** Test dosyaları arasında giriş deneme sayacını sıfırlar (sayaç artık veritabanında, ADR-053). */
export async function resetRateLimiter() {
  await ownerQuery(null, "delete from auth_throttle");
}
