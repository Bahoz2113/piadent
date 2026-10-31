/**
 * Görev 8 — pilot altyapısı: sürümlü sır anahtarı ve döndürme (eski v1 verisi dahil), sağlık/hazır olma/metrik uçları,
 * Türkçe doğrulama mesajları. Gerçek PostgreSQL (viadent_test).
 */
import { createCipheriv, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { currentKeyId, decryptSecret, encryptSecret, keyId, needsRotation, totpAt, totpStep } from "@viadent/db";
import { rotateSecrets } from "../../../packages/db/src/rotate-keys.js";
import { EMAILS, adminQuery, login, ownerQuery, startApp, type Client } from "./helpers.js";
import { OWNER_URL, TEST_PASSWORD } from "./env.js";

let app: INestApplication;
let admin: Client;
let tenantA: string;
const K0 = process.env.VIADENT_SECRET_KEY!;
const OLD0 = process.env.VIADENT_SECRET_KEYS_OLD;

function legacyV1(plain: string, keyB64: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

beforeAll(async () => {
  app = await startApp();
  admin = await login(app, EMAILS.aAdmin);
  tenantA = admin.session.activeMembership.tenantId;
});
afterAll(async () => {
  process.env.VIADENT_SECRET_KEY = K0;
  if (OLD0 === undefined) delete process.env.VIADENT_SECRET_KEYS_OLD; else process.env.VIADENT_SECRET_KEYS_OLD = OLD0;
  await app.close();
});

describe("sır anahtarı halkası ve döndürme (ADR-052)", () => {
  it("yeni şifreleme v2 + anahtar kimliği; eski v1 biçimi okunur ve döndürme gerektirir", () => {
    const b = encryptSecret("gizli-deger");
    expect(b.startsWith(`v2.${currentKeyId()}.`)).toBe(true);
    expect(b).not.toContain("gizli");
    expect(decryptSecret(b)).toBe("gizli-deger");
    expect(needsRotation(b)).toBe(false);
    const v1 = legacyV1("eski-deger", K0);
    expect(decryptSecret(v1)).toBe("eski-deger");
    expect(needsRotation(v1)).toBe(true);
  });

  it("uçtan uca: MFA'lı kullanıcı + v1 webhook sırrı → yeni anahtar → önizleme yazmaz → uygula → eski anahtar çıkarılınca her şey çalışır", async () => {
    // 1) MFA'lı kullanıcı (sır eski anahtarla) ve eski biçimde bir webhook sırrı
    const email = EMAILS.aFinance;
    const me = await login(app, email);
    const secret = (await me.post("/me/mfa/setup").expect(200)).body.secret as string;
    await me.post("/me/mfa/enable", { code: totpAt(secret, totpStep()) }).expect(200);
    const conn = (await ownerQuery(tenantA, "select id from integration_connections where webhook_secret_enc is not null order by id limit 1"))[0];
    expect(conn, "seed'de webhook sırrı olan bağlantı olmalı").toBeTruthy();
    const plainWebhook = decryptSecret((await ownerQuery(tenantA, "select webhook_secret_enc as s from integration_connections where id = $1", [conn.id]))[0].s);
    await ownerQuery(tenantA, "update integration_connections set webhook_secret_enc = $2 where id = $1", [conn.id, legacyV1(plainWebhook, K0)]);

    // 2) yeni anahtar devrede, eski anahtar yalnız çözmek için
    const K1 = randomBytes(32).toString("base64");
    process.env.VIADENT_SECRET_KEY = K1;
    process.env.VIADENT_SECRET_KEYS_OLD = K0;
    expect(currentKeyId()).toBe(keyId(Buffer.from(K1, "base64")));

    const before = await adminQuery("select mfa_secret_enc from users where email = $1", [email]);
    const preview = await rotateSecrets(OWNER_URL, false);
    expect(preview.apply).toBe(false);
    expect(preview.integrationSecrets).toBeGreaterThanOrEqual(1);
    expect(preview.mfaSecrets).toBeGreaterThanOrEqual(1);
    expect(preview.failed).toBe(0);
    expect((await adminQuery("select mfa_secret_enc from users where email = $1", [email]))[0].mfa_secret_enc).toBe(before[0].mfa_secret_enc); // önizleme yazmadı

    const applied = await rotateSecrets(OWNER_URL, true);
    expect(applied.integrationSecrets).toBe(preview.integrationSecrets);
    expect(applied.failed).toBe(0);
    const after = await rotateSecrets(OWNER_URL, false);
    expect(after.integrationSecrets + after.mfaSecrets + after.mfaPending).toBe(0);
    const all = await adminQuery("select webhook_secret_enc as s from integration_connections where webhook_secret_enc is not null union all select mfa_secret_enc from users where mfa_secret_enc is not null");
    expect(all.every((r) => String(r.s).startsWith(`v2.${keyId(Buffer.from(K1, "base64"))}.`))).toBe(true);
    const audit = await ownerQuery(tenantA, "select changes from audit_events where action = 'system.secret_key_rotated' order by id desc limit 1");
    expect(audit[0].changes.keyId.to).toBe(applied.keyId);
    expect(JSON.stringify(audit[0])).not.toContain(plainWebhook);

    // 3) eski anahtar halkadan çıkarıldı: sırlar yalnız yeni anahtarla çözülür, MFA'lı giriş çalışır
    process.env.VIADENT_SECRET_KEYS_OLD = "";
    expect(decryptSecret((await ownerQuery(tenantA, "select webhook_secret_enc as s from integration_connections where id = $1", [conn.id]))[0].s)).toBe(plainWebhook);
    const server = app.getHttpServer();
    const ch = (await request(server).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email, password: TEST_PASSWORD }).expect(200)).body.challenge;
    await request(server).post("/api/v1/auth/mfa").set("x-viadent-request", "1").send({ challenge: ch, code: totpAt(secret, totpStep() + 1) }).expect(200);
    // eski anahtarla yazılmış bir sır artık açık hata verir (sessizce bozulmaz)
    expect(() => decryptSecret(legacyV1("x", K0))).toThrow(/çözülemedi/);

    // 4) temizlik: test veritabanını önceki anahtara geri döndür (sonraki test dosyaları için)
    process.env.VIADENT_SECRET_KEY = K0;
    process.env.VIADENT_SECRET_KEYS_OLD = K1;
    expect((await rotateSecrets(OWNER_URL, true)).failed).toBe(0);
    process.env.VIADENT_SECRET_KEYS_OLD = OLD0 ?? "";
    const team = (await admin.get("/team").expect(200)).body.items;
    await admin.post(`/team/${team.find((x: { email: string }) => x.email === email).id}/mfa-reset`, { reason: "Test temizliği (sentetik)" }).expect(200);
  });
});

describe("sağlık, hazır olma, metrikler (ADR-055)", () => {
  it("canlılık ve hazır olma herkese açık, kişisel veri yok", async () => {
    const s = app.getHttpServer();
    const h = await request(s).get("/api/v1/health").expect(200);
    expect(h.body).toMatchObject({ status: "ok" });
    const r = await request(s).get("/api/v1/health/ready").expect(200);
    expect(r.body).toMatchObject({ status: "ready", db: "ok" });
  });

  it("hazır olma: veritabanına ulaşılamazsa 503", async () => {
    const broken = await startApp({ databaseUrl: "postgres://viadent_app:x@127.0.0.1:1/yok" });
    try {
      const r = await request(broken.getHttpServer()).get("/api/v1/health/ready");
      expect(r.status).toBe(503);
      expect(r.body.status).toBe("not_ready");
    } finally { await broken.close(); }
  });

  it("metrikler: belirteç yoksa uç kapalı, yanlış belirteç 401, doğru belirteçle Prometheus metni (yol/kişisel veri etiketi yok)", async () => {
    expect((await request(app.getHttpServer()).get("/api/v1/metrics")).status).toBe(404);
    const m = await startApp({ metricsToken: "test-only-metrics-token-123" });
    try {
      const s = m.getHttpServer();
      await request(s).get("/api/v1/health");
      await request(s).get("/api/v1/patients/00000000-0000-4000-8000-000000000000");
      expect((await request(s).get("/api/v1/metrics").set("authorization", "Bearer yanlis")).status).toBe(401);
      const r = await request(s).get("/api/v1/metrics").set("authorization", "Bearer test-only-metrics-token-123").expect(200);
      expect(r.text).toContain('viadent_http_requests_total{method="GET",status="2xx"}');
      expect(r.text).toContain("viadent_http_request_duration_seconds_bucket");
      expect(r.text).toContain('viadent_db_pool_connections{state="total"}');
      expect(r.text).not.toMatch(/patients|00000000|@/);
    } finally { await m.close(); }
  });
});

describe("Türkçe doğrulama mesajları", () => {
  it("eksik zorunlu alan ve geçersiz kimlik İngilizce mesaj döndürmez", async () => {
    const sec = await login(app, EMAILS.aSecretary);
    const r = await sec.post("/patients", { firstName: "Mesaj" });
    expect(r.status).toBe(422);
    expect(r.body.field_errors.lastName).toBe("Bu alan zorunlu.");
    expect(JSON.stringify(r.body)).not.toMatch(/Invalid|expected|received/);
  });
});

describe("içe aktarma satır verisi saklama (ADR-054)", () => {
  it("süre dolunca satır içeriği ve hata metinleri temizlenir; özet, durumlar ve hedef kayıtlar kalır; süresi dolmayan dokunulmaz", async () => {
    const { withContext, purgeImportRows } = await import("@viadent/db");
    const pg = (await import("pg")).default;
    const { WORKER_URL } = await import("./env.js");
    const run = randomBytes(3).toString("hex").toUpperCase();
    const content = `kaynak_no;ad;soyad;dogum_tarihi\r\n${run}-1;Saklama;Denemesi;01.01.1980\r\n${run}-2;Hatali;;99.99.1980\r\n`;
    const b = (await admin.post("/imports", { kind: "patients", format: "csv", fileName: "saklama.csv", content }).expect(201)).body;
    await admin.post(`/imports/${b.id}/commit`).expect(200);
    const pool = new pg.Pool({ connectionString: WORKER_URL, max: 1 });
    try {
      const now = new Date();
      // süresi dolmamış: dokunulmaz
      expect(await withContext(pool, { tenantId: tenantA, userId: null }, (c) => purgeImportRows(c, 30, now))).toBe(0);
      // 31 gün sonrası: temizlenir (worker rolüyle, RLS bağlamında)
      const later = new Date(now.getTime() + 31 * 86400_000);
      const n = await withContext(pool, { tenantId: tenantA, userId: null }, (c) => purgeImportRows(c, 30, later));
      expect(n).toBeGreaterThanOrEqual(1);
      // tekrar çalıştırma idempotent
      const again = await withContext(pool, { tenantId: tenantA, userId: null }, (c) => purgeImportRows(c, 30, later));
      expect(again).toBe(0);
    } finally { await pool.end(); }
    const rows = await ownerQuery(tenantA, "select status, data, errors, target_id from import_rows where batch_id = $1 order by row_no", [b.id]);
    expect(rows.map((r) => r.status)).toEqual(["imported", "error"]);
    expect(rows.every((r) => JSON.stringify(r.data) === "{}" && JSON.stringify(r.errors) === "[]")).toBe(true);
    expect(rows[0].target_id).toBeTruthy();
    expect(JSON.stringify(rows)).not.toContain("99.99.1980");
    const d = (await admin.get(`/imports/${b.id}`).expect(200)).body;
    expect(d.rowsPurgedAt).toBeTruthy();
    expect(d.summary).toMatchObject({ rows: 2, valid: 1, errors: 1, imported: 1 });
    // aktarılan hasta kaydı yerinde (yalnız aktarım satırının kopyası silindi)
    expect((await ownerQuery(tenantA, "select count(*)::int as n from patients where external_ref = $1", [`${run}-1`]))[0].n).toBe(1);
  });

  it("worker rolü giriş sayacını temizleyebilir ama içe aktarma satırını başka sütunda değiştiremez", async () => {
    const pg = (await import("pg")).default;
    const { WORKER_URL } = await import("./env.js");
    const c = new pg.Client({ connectionString: WORKER_URL });
    await c.connect();
    try {
      await c.query("delete from auth_throttle where first_at < now() - interval '1 day'");
      await expect(c.query("update import_rows set status = 'imported' where false")).rejects.toThrow(/permission denied/);
    } finally { await c.end(); }
  });
});
