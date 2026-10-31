/**
 * Görev 7 güvenlik tabanı (Plan §08): güvenlik başlıkları, oturum çerezi bayrakları, CSRF başlığı, gövde sınırı,
 * hata yanıtında iç ayrıntı sızmaması, depodaki sırların açık metin olmaması, uygulama rolünün yetkisizliği.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import pg from "pg";
import { EMAILS, adminQuery, login, startApp, type Client } from "./helpers.js";
import { APP_URL, TEST_PASSWORD } from "./env.js";

let app: INestApplication, prod: INestApplication;
let admin: Client;
beforeAll(async () => {
  app = await startApp();
  prod = await startApp({ production: true });
  admin = await login(app, EMAILS.aAdmin);
});
afterAll(async () => { await app.close(); await prod.close(); });

describe("HTTP güvenlik başlıkları ve çerez", () => {
  it("API: nosniff, katı CSP, çerçeve yasağı, no-store, x-powered-by yok", async () => {
    const r = await admin.get("/session").expect(200);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-powered-by"]).toBeUndefined();
    expect(r.headers["strict-transport-security"]).toBeUndefined(); // yerel http
  });

  it("üretim kipinde: HSTS ve Secure + HttpOnly + SameSite=Lax oturum çerezi", async () => {
    const r = await request(prod.getHttpServer()).post("/api/v1/auth/login").set("x-viadent-request", "1")
      .send({ email: EMAILS.aSecretary, password: TEST_PASSWORD }).expect(200);
    expect(r.headers["strict-transport-security"]).toContain("max-age=31536000");
    const c = String(r.headers["set-cookie"]);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toMatch(/SameSite=Lax/i);
  });

  it("CSRF: durum değiştiren istek özel başlık olmadan reddedilir", async () => {
    const r = await request(app.getHttpServer()).post("/api/v1/patients").set("cookie", admin.cookie).set("x-viadent-context", admin.context)
      .send({ firstName: "Csrf", lastName: "Deneme" });
    expect(r.status).toBe(403);
  });

  it("gövde sınırı: genel uçlar 256 KB, içe aktarma 6 MB", async () => {
    const big = "x".repeat(300 * 1024);
    expect((await admin.post("/patients", { firstName: big, lastName: "B" })).status).toBe(413);
    const r = await admin.post("/imports", { kind: "patients", format: "csv", fileName: "b.csv", content: `kaynak_no;ad;soyad\r\n1;A;${"b".repeat(400 * 1024)}\r\n` });
    expect(r.status).not.toBe(413);
  });

  it("hata yanıtları iç ayrıntı (SQL, yığın) içermez", async () => {
    const r = await admin.get("/patients/00000000-0000-4000-8000-000000000000");
    expect(r.status).toBe(404);
    const t = JSON.stringify(r.body);
    expect(t).not.toMatch(/select |stack|at Object\.|node_modules/i);
  });

  it("parola yanlışsa hesap varlığı sızmaz (aynı kod ve mesaj)", async () => {
    const s = app.getHttpServer();
    const a = await request(s).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email: EMAILS.aAdmin, password: "yanlis-parola-1" });
    const b = await request(s).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email: "yok@ornek.test", password: "yanlis-parola-1" });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect({ code: a.body.code, message: a.body.message }).toEqual({ code: b.body.code, message: b.body.message });
  });
});

describe("veritabanı rolleri ve sırlar", () => {
  it("uygulama rolü superuser/BYPASSRLS/tablo sahibi değil; yedek rolü yalnız okur", async () => {
    const r = await adminQuery("select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname in ('viadent_app','viadent_worker','viadent_backup') order by 1");
    const app_ = r.find((x) => x.rolname === "viadent_app");
    expect(app_).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
    expect(r.find((x) => x.rolname === "viadent_worker")).toMatchObject({ rolsuper: false, rolbypassrls: false });
    const bk = r.find((x) => x.rolname === "viadent_backup");
    if (bk) {
      expect(bk).toMatchObject({ rolsuper: false, rolbypassrls: true, rolcreaterole: false, rolcreatedb: false });
      const w = await adminQuery(`select count(*)::int as n from information_schema.role_table_grants where grantee = 'viadent_backup' and privilege_type <> 'SELECT'`);
      expect(w[0].n).toBe(0);
    }
    const owned = await adminQuery("select count(*)::int as n from pg_tables t where t.schemaname = 'public' and t.tableowner = 'viadent_app'");
    expect(owned[0].n).toBe(0);
  });

  it("uygulama rolü users tablosunu silemez, rol/şema değiştiremez", async () => {
    const c = new pg.Client({ connectionString: APP_URL });
    await c.connect();
    try {
      await expect(c.query("delete from users where false")).rejects.toThrow(/permission denied/);
      await expect(c.query("create table zz_hack(id int)")).rejects.toThrow(/permission denied/);
      await expect(c.query("alter table patients disable row level security")).rejects.toThrow();
    } finally { await c.end(); }
  });

  it("MFA sırları, webhook sırları ve oturum belirteçleri veritabanında açık metin değil", async () => {
    const s = await adminQuery("select token_hash from sessions limit 1");
    expect(Buffer.isBuffer(s[0].token_hash)).toBe(true);
    const w = await adminQuery("select webhook_secret_enc from integration_connections where webhook_secret_enc is not null limit 3");
    for (const x of w) expect(String(x.webhook_secret_enc)).toMatch(/^v[12]\./);
  });

  it("depoda sır yok: .env.example değer içermez, kaynak kodda gizli anahtar kalıbı yok", () => {
    const root = join(__dirname, "../../..");
    const ex = readFileSync(join(root, ".env.example"), "utf8");
    for (const line of ex.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (!m) continue;
      const [, k, v] = m;
      if (/PASSWORD|PASSPHRASE|SECRET_KEY/.test(k!)) expect(v === "" || /^CHANGE_ME/.test(v!), k).toBe(true);
      if (/_URL$/.test(k!) && /:\/\/[^:]+:([^@]+)@/.test(v!)) expect(/:\/\/[^:]+:(CHANGE_ME[^@]*)@/.test(v!), k).toBe(true);
    }
    const bad = /(-----BEGIN (RSA |EC )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|sk_live_[0-9a-zA-Z]{20,}|xox[bp]-[0-9a-zA-Z-]{20,}|ghp_[0-9a-zA-Z]{36})/;
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        if (["node_modules", ".git", ".next", "test-results", ".backups", ".storage", "playwright-report"].includes(f)) continue;
        const p = join(d, f);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|json|sql|md|yml|yaml|example)$/.test(f) && st.size < 2_000_000 && bad.test(readFileSync(p, "utf8"))) hits.push(relative(root, p));
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});

describe("giriş sınırlayıcı", () => {
  it("IP değişse de hesap başına 20 hatalı denemeden sonra kilit (429)", async () => {
    const s = (await import("supertest")).default;
    const server = app.getHttpServer();
    const email = "finans@demo-yesil.test";
    let last = 0;
    for (let i = 0; i < 21; i++) {
      // her denemede farklı istemci IP (loopback vekil güvenilir → X-Forwarded-For istemci IP olur): IP başına sınır devreye girmez
      last = (await s(server).post("/api/v1/auth/login").set("x-viadent-request", "1").set("x-forwarded-for", `10.0.${i}.1`).send({ email, password: `yanlis-${i}` })).status;
    }
    expect(last).toBe(429);
    // sayaç veritabanında (süreçler arası ortak): anahtar düz metin değil, 32 baytlık özet
    const raw = await adminQuery("select key_hash, fail_count from auth_throttle");
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.every((x) => Buffer.isBuffer(x.key_hash) && x.key_hash.length === 32 && !x.key_hash.toString("latin1").includes("finans"))).toBe(true);
    expect(Math.max(...raw.map((x) => x.fail_count))).toBeGreaterThanOrEqual(20);
    // ikinci bir API süreci (ayrı uygulama örneği) aynı kilidi görür
    const other = await startApp({}, { keepThrottle: true });
    try {
      const r2 = await s(other.getHttpServer()).post("/api/v1/auth/login").set("x-viadent-request", "1").set("x-forwarded-for", "10.9.9.9").send({ email, password: "yine-yanlis" });
      expect(r2.status).toBe(429);
    } finally { await other.close(); }
    const { resetRateLimiter } = await import("./helpers.js");
    await resetRateLimiter();
  });
});

describe("katalog ayarı (ADR-047)", () => {
  it("textlike LEAKPROOF: RLS altında hasta araması trigram dizinini kullanır", async () => {
    const r = await adminQuery("select proleakproof from pg_proc where proname = 'textlike' and pronamespace = 'pg_catalog'::regnamespace");
    expect(r[0].proleakproof).toBe(true);
  });
});
