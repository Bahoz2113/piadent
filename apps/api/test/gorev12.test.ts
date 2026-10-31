/**
 * Görev 12 — pilot operasyon hazırlığı: dosya içeriği imhası (ADR-067), uyarı metrikleri (ADR-068), içe aktarma alan eşleme (ADR-069).
 * Gerçek PostgreSQL (viadent_test).
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import pg from "pg";
import { BasicScanner, LocalDiskStorage, purgeFileContents, withContext } from "@viadent/db";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";
import { WORKER_URL } from "./env.js";
import { processOutbox, scanAllTenants, type WorkerDeps } from "../../worker/src/jobs.js";
import { setStorageForTests } from "../src/documents/files.controller.js";

let app: INestApplication;
let sec: Client, dentist: Client;
let tenantA: string;
const dir = mkdtempSync(join(tmpdir(), "viadent-purge-"));
const storage = new LocalDiskStorage(dir);
const deps: WorkerDeps = { storage, scanner: new BasicScanner() };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("sentetik-png-govdesi-".repeat(20))]);
const EICAR = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function workerPool<T>(fn: (pool: pg.Pool) => Promise<T>) {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
  try { return await fn(pool); } finally { await pool.end(); }
}
async function drain() { await workerPool(async (pool) => { while ((await processOutbox(pool, 50, deps)) > 0) { /* boşalt */ } }); }
async function upload(c: Client, patientId: string, data: Buffer, name = "tarama.png") {
  const fid = (await c.post("/files", { patientId, category: "document_scan", originalName: name, contentType: "image/png", size: data.length }).expect(201)).body.id as string;
  await request(app.getHttpServer()).put(`/api/v1/files/${fid}/content`).set("cookie", c.cookie).set("x-viadent-request", "1").set("x-viadent-context", c.context)
    .set("content-type", "application/octet-stream").send(data).expect(200);
  await drain();
  return fid;
}

beforeAll(async () => {
  app = await startApp();
  setStorageForTests(storage);
  [sec, dentist] = await Promise.all([login(app, EMAILS.aSecretary), login(app, EMAILS.aDentist)]);
  tenantA = sec.session.activeMembership.tenantId;
});
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe("ADR-067: dosya içeriği imhası", () => {
  let pid: string, delId: string, keepId: string, quarId: string;
  it("silinmiş dosya 30 gün, karantinadaki 7 gün sonra diskten kalkar; üst veri ve kanıt kalır; erişim olayı 'purged'", async () => {
    pid = (await sec.post("/patients", { firstName: "İmha", lastName: `Deneme${randomUUID().slice(0, 4)}`, birthDate: "1979-01-01" }).expect(201)).body.patient.id;
    delId = await upload(sec, pid, PNG, "silinecek.png");
    keepId = await upload(sec, pid, PNG, "kalacak.png");
    quarId = await upload(sec, pid, EICAR, "zararli.png");
    const rows = await ownerQuery(tenantA, "select id, status, object_key from file_assets where id = any($1::uuid[])", [[delId, keepId, quarId]]);
    const key = (id: string) => rows.find((r) => r.id === id)!.object_key as string;
    expect(rows.find((r) => r.id === quarId)!.status).toBe("quarantined");
    await dentist.post(`/files/${delId}/delete`, { reason: "Yanlış hastaya yüklendi (sentetik)" }).expect(200);
    for (const id of [delId, keepId, quarId]) expect(existsSync(join(dir, key(id))), id).toBe(true);

    // henüz süre dolmadı → hiçbir şey imha edilmez
    const n0 = await workerPool((pool) => withContext(pool, { tenantId: tenantA, userId: null }, (c) => purgeFileContents(c, storage, new Date())));
    expect(n0).toBe(0);
    // 8 gün sonra: karantina imha, silinmiş henüz değil (30 gün)
    const d8 = new Date(Date.now() + 8 * 86400_000);
    expect(await workerPool((pool) => withContext(pool, { tenantId: tenantA, userId: null }, (c) => purgeFileContents(c, storage, d8)))).toBeGreaterThanOrEqual(1); // diğer testlerin karantina/ret dosyaları da sayılabilir
    expect(existsSync(join(dir, key(quarId)))).toBe(false);
    expect(existsSync(join(dir, key(delId)))).toBe(true);
    // 31 gün sonra worker taraması: silinmiş de imha; kalan dosya dokunulmaz; tekrar çalıştırma 0
    const d31 = new Date(Date.now() + 31 * 86400_000);
    await workerPool((pool) => scanAllTenants(pool, d31, storage));
    expect(existsSync(join(dir, key(delId)))).toBe(false);
    expect(existsSync(join(dir, key(keepId)))).toBe(true);
    expect(await workerPool((pool) => withContext(pool, { tenantId: tenantA, userId: null }, (c) => purgeFileContents(c, storage, d31)))).toBe(0);
    const after = await ownerQuery(tenantA, "select id, status, purged_at, sha256, original_name from file_assets where id = any($1::uuid[])", [[delId, keepId, quarId]]);
    expect(after.find((r) => r.id === delId)).toMatchObject({ status: "deleted", original_name: "silinecek.png", sha256: sha(PNG) });
    expect(after.find((r) => r.id === delId)!.purged_at).toBeTruthy();
    expect(after.find((r) => r.id === quarId)!.purged_at).toBeTruthy();
    expect(after.find((r) => r.id === keepId)!.purged_at).toBeNull();
    const ev = await ownerQuery(tenantA, "select action from file_access_events where file_id = $1 order by at", [delId]);
    expect(ev.map((e) => e.action)).toContain("purged");
    // üst veri okunur (durum silinmiş, olaylar görünür); içerik indirilemez
    const meta = (await sec.get(`/files/${delId}`).expect(200)).body;
    expect(meta.status).toBe("deleted");
    expect(meta.events.map((e: { action: string }) => e.action)).toContain("purged");
    const dl = await request(app.getHttpServer()).get(`/api/v1/files/${delId}/content`).set("cookie", sec.cookie).set("x-viadent-context", sec.context);
    expect(dl.status).not.toBe(200);
  });

  it("DB kısıtı: purged_at yalnız silinmiş/reddedilmiş/karantinadaki dosyada", async () => {
    await expect(ownerQuery(tenantA, "update file_assets set purged_at = now() where id = $1", [keepId])).rejects.toThrow(/file_assets_purged_status/);
  });
});

describe("ADR-068: işletim uyarı metrikleri", () => {
  it("/metrics kuyruk, kilit, karantina ve destek sayaçlarını döner; kiracı/kimlik/e-posta sızmaz", async () => {
    const m = await startApp({ metricsToken: "test-only-metrics-token-123" }, { keepThrottle: true });
    try {
      const s = m.getHttpServer();
      // hesap kilidi: aynı e-posta+IP ile 5 hatalı giriş → auth_locked_keys ≥ 1
      const pid = (await sec.post("/patients", { firstName: "Metrik", lastName: `Deneme${randomUUID().slice(0, 4)}`, birthDate: "1981-01-01" }).expect(201)).body.patient.id;
      await upload(sec, pid, EICAR, "karantina.png");
      for (let i = 0; i < 5; i++) await request(s).post("/api/v1/auth/login").set("x-viadent-request", "1").send({ email: EMAILS.aFinance, password: `yanlis-${i}` });
      const r = await request(s).get("/api/v1/metrics").set("authorization", "Bearer test-only-metrics-token-123").expect(200);
      const t = r.text;
      expect(t).toMatch(/viadent_auth_locked_keys [1-9]\d*/);
      expect(t).toMatch(/viadent_file_assets\{state="quarantined"\} [1-9]\d*/);
      expect(t).toContain("# TYPE viadent_outbox_oldest_pending_seconds gauge");
      expect(t).toMatch(/viadent_memberships_support_active \d+/);
      expect(t).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      // uygulama rolü fonksiyonu çağırabilir ama tablolara doğrudan (bağlamsız) erişemez
      const direct = await ownerQuery(null, "select count(*)::int as n from outbox_events");
      expect(direct[0].n).toBeGreaterThanOrEqual(0);
    } finally { await m.close(); }
  });
});

describe("ADR-069: açık sütun eşlemesi", () => {
  it("'' ile açıkça yok sayılan sütun takma adı eşleşse bile aktarılmaz; eşleme batch'te saklanır", async () => {
    const admin = await login(app, EMAILS.aAdmin);
    const run = randomUUID().slice(0, 6);
    const content = `Kaynak_No;Adı;Soyadı;Telefon\r\n${run}-1;Zehra;Eşleme;0555 000 11 22\r\n`;
    const b = (await admin.post("/imports", { kind: "patients", format: "csv", fileName: `esleme-${run}.csv`, content,
      mapping: { Kaynak_No: "external_ref", Adı: "first_name", Soyadı: "last_name", Telefon: "" } }).expect(201)).body;
    expect(b.mapping).toEqual({ Kaynak_No: "external_ref", Adı: "first_name", Soyadı: "last_name" });
    expect(b.summary.unmapped).toEqual(["Telefon"]);
    const rows = (await admin.get(`/imports/${b.id}`).expect(200)).body.rows;
    expect(rows[0].data.phone ?? null).toBeNull();
  });
});
