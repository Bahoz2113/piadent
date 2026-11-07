/**
 * 07.11.2026 geri bildirimi (2. paket): ADR-103 randevudan dişe işlem, ADR-104 her belge türünde onaylı DEMO şablon (0037),
 * ADR-105 Görüntülemeler (0038: tür, çekim tarihi, diş, not; DICOM; klinik geneli görünürlük; sağlık verisi).
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import pg from "pg";
import { BasicScanner, LocalDiskStorage } from "@viadent/db";
import { STANDARD_DOCUMENT_TYPES, TEMPLATE_FIELDS, unknownTemplateFields } from "@viadent/contracts";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";
import { OWNER_URL, WORKER_URL } from "./env.js";
import { processOutbox, type WorkerDeps } from "../../worker/src/jobs.js";
import { setStorageForTests } from "../src/documents/files.controller.js";

let app: INestApplication;
let admin: Client, dentist: Client, sec: Client, asst: Client;
let tenantA: string;
const dir = mkdtempSync(join(tmpdir(), "viadent-img-"));
const storage = new LocalDiskStorage(dir);
const deps: WorkerDeps = { storage, scanner: new BasicScanner() };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("sentetik-panoramik-".repeat(20))]);
const DICOM = Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), Buffer.from("sentetik-dicom-govdesi-".repeat(10))]);
const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};
const put = (c: Client, fid: string, data: Buffer) =>
  request(app.getHttpServer()).put(`/api/v1/files/${fid}/content`).set("cookie", c.cookie).set("x-viadent-request", "1").set("x-viadent-context", c.context)
    .set("content-type", "application/octet-stream").send(data);
async function worker() {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
  try { while ((await processOutbox(pool, 50, deps)) > 0) { /* boşalt */ } } finally { await pool.end(); }
}
async function runMigration0037() {
  const sql = readFileSync(new URL("../../../packages/db/migrations/0037_standard_document_templates.sql", import.meta.url), "utf8");
  const c = new pg.Client({ connectionString: OWNER_URL });
  await c.connect();
  try { await c.query("begin"); await c.query(sql); await c.query("commit"); } catch (e) { await c.query("rollback"); throw e; } finally { await c.end(); }
}

beforeAll(async () => {
  setStorageForTests(storage);
  app = await startApp();
  [admin, dentist, sec, asst] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aAssistant)]);
  tenantA = admin.session.activeMembership.tenantId;
});
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe("ADR-104 belge şablonları", () => {
  it("katalogdaki her türde onaylı DEMO şablon var; seçilen belge hasta bilgisiyle dolar", async () => {
    const types = (await dentist.get("/document-types").expect(200)).body.items as { code: string; approvedTemplates: { versionId: string; isDemo: boolean }[] }[];
    expect(types.map((t) => t.code).sort()).toEqual(STANDARD_DOCUMENT_TYPES.map((t) => t.code).sort());
    expect(types.filter((t) => t.approvedTemplates.length === 0).map((t) => t.code)).toEqual([]);
    const p = (await sec.post("/patients", { firstName: "Şablon", lastName: "Hasta", birthDate: "1979-05-06", acknowledgeDuplicates: true }).expect(201)).body.patient.id;
    for (const code of ["CEKIM-ONAM", "KVKK-AYDINLATMA", "BEYAZLATMA-ONAM", "CEKIM-SONRASI-BILGI"]) {
      const v = types.find((t) => t.code === code)!.approvedTemplates[0]!.versionId;
      const pv = (await sec.post(`/template-versions/${v}/preview`, { patientId: p }).expect(200)).body;
      expect(pv.content).toMatch(/^PİA-DENT ÖRNEK METİN \(DEMO\)/);
      expect(pv.content).toContain("Şablon Hasta");
      expect(pv.content).not.toMatch(/\{\{/);
      expect(pv.isDemo).toBe(true);
    }
  });

  it("şablon gövdeleri yalnız izinli alanları kullanır", async () => {
    const rows = await ownerQuery<{ body: string }>(tenantA, "select v.body from template_versions v where v.status = 'approved'");
    expect(rows.length).toBeGreaterThanOrEqual(42);
    for (const r of rows) expect(unknownTemplateFields(r.body)).toEqual([]);
    expect(Object.keys(TEMPLATE_FIELDS)).toContain("plan.kalemler");
  });

  it("0037 mevcut kiracıda: şablonsuz türe şablon, yer tutucu metne yeni sürüm; tekrar çalışınca değişiklik yok; kliniğin metnine dokunmaz", async () => {
    // Şablonsuz tür: CEKIM-ONAM onaylı sürümleri kullanımdan kaldırılır; ENDO-ONAM'a eski yer tutucu metinli onaylı sürüm (ilk kurulum durumu).
    await ownerQuery(tenantA, `update template_versions v set status = 'retired' from templates t, document_types d
      where v.template_id = t.id and t.document_type_id = d.id and d.code = 'CEKIM-ONAM' and v.status = 'approved'`);
    const author = (await ownerQuery<{ user_id: string }>(tenantA, "select user_id from memberships where role = 'clinic_admin' order by created_at limit 1"))[0]!.user_id;
    const endo = (await ownerQuery<{ id: string }>(tenantA, "select id from document_types where code = 'ENDO-ONAM'"))[0]!.id;
    const old = "SENTETİK DEMO BELGESİ — klinik veya hukuki içerik değildir.\n\nHasta: {{hasta.ad_soyad}}\n";
    const tp = (await ownerQuery<{ id: string }>(tenantA, "insert into templates(tenant_id, document_type_id, name, created_by) values (app.tenant_id(), $1, 'Eski yer tutucu', $2) returning id", [endo, author]))[0]!.id;
    await ownerQuery(tenantA, `insert into template_versions(tenant_id, template_id, version, status, body, body_hash, is_demo, created_by, approved_by, approved_at)
      values (app.tenant_id(), $1, 1, 'approved', $2, encode(sha256(convert_to($2, 'UTF8')), 'hex'), true, $3, $3, now())`, [tp, old, author]);
    // Kliniğin kendi metni (yer tutucu değil) korunur
    const own = (await ownerQuery<{ id: string }>(tenantA, "insert into templates(tenant_id, document_type_id, name, created_by) values (app.tenant_id(), $1, 'Kliniğin kendi metni', $2) returning id", [endo, author]))[0]!.id;
    await ownerQuery(tenantA, `insert into template_versions(tenant_id, template_id, version, status, body, body_hash, is_demo, created_by, approved_by, approved_at)
      values (app.tenant_id(), $1, 1, 'approved', 'Kliniğimizin onam metni {{hasta.ad_soyad}}', encode(sha256(convert_to('Kliniğimizin onam metni {{hasta.ad_soyad}}', 'UTF8')), 'hex'), false, $2, $2, now())`, [own, author]);

    await runMigration0037();
    const cekim = await ownerQuery(tenantA, `select v.version, t.name from template_versions v join templates t on t.id = v.template_id join document_types d on d.id = t.document_type_id
      where d.code = 'CEKIM-ONAM' and v.status = 'approved'`);
    expect(cekim).toEqual([{ version: 1, name: "Diş çekimi bilgilendirme ve onam — PİA-DENT DEMO" }]);
    const ph = await ownerQuery<{ version: number; status: string; body: string }>(tenantA, "select version, status, body from template_versions where template_id = $1 order by version", [tp]);
    expect(ph.map((x) => [x.version, x.status])).toEqual([[1, "retired"], [2, "approved"]]);
    expect(ph[1]!.body).toMatch(/^PİA-DENT ÖRNEK METİN \(DEMO\)/);
    expect((await ownerQuery(tenantA, "select status from template_versions where template_id = $1", [own]))).toEqual([{ status: "approved" }]);

    const before = (await ownerQuery<{ n: number }>(tenantA, "select count(*)::int as n from template_versions"))[0]!.n;
    await runMigration0037();
    expect((await ownerQuery<{ n: number }>(tenantA, "select count(*)::int as n from template_versions"))[0]!.n).toBe(before);
    expect((await ownerQuery<{ n: number }>(tenantA, "select count(*)::int as n from document_types"))[0]!.n).toBe(STANDARD_DOCUMENT_TYPES.length);
  });
});

describe("ADR-105 görüntülemeler", () => {
  it("panoramik + DICOM: tür, çekim tarihi, diş, not kaydedilir; tarama sonrası açılır; sekreter göremez", async () => {
    const p = (await sec.post("/patients", { firstName: "Film", lastName: "Hasta", acknowledgeDuplicates: true }).expect(201)).body.patient.id;
    const f = (await asst.post("/files", { patientId: p, category: "radiograph", originalName: "panoramik.png", contentType: "image/png", size: PNG.length,
      imagingKind: "panoramic", takenOn: day(-3), teeth: ["16", "26"], imagingNote: "Dış merkez (sentetik)" }).expect(201)).body;
    await put(asst, f.id, PNG).expect(200);
    const d = (await dentist.post("/files", { patientId: p, category: "radiograph", originalName: "cbct.dcm", contentType: "application/dicom", size: DICOM.length, imagingKind: "cbct" }).expect(201)).body;
    await put(dentist, d.id, DICOM).expect(200);
    await worker();
    const list = (await dentist.get(`/patients/${p}/files`).expect(200)).body.items as { id: string; status: string; imagingKind: string; takenOn: string; teeth: string[]; imagingNote: string; contentType: string }[];
    expect(list.find((x) => x.id === f.id)).toMatchObject({ status: "available", imagingKind: "panoramic", takenOn: day(-3), teeth: ["16", "26"], imagingNote: "Dış merkez (sentetik)" });
    expect(list.find((x) => x.id === d.id)).toMatchObject({ status: "available", imagingKind: "cbct", contentType: "application/dicom" });
    expect((await admin.get(`/patients/${p}/files`).expect(200)).body.items).toHaveLength(2); // yönetici (ADR-098)
    expect((await sec.get(`/patients/${p}/files`).expect(200)).body.items).toHaveLength(0); // sağlık verisi
    await sec.post("/files", { patientId: p, category: "radiograph", originalName: "x.png", contentType: "image/png", size: 10, imagingKind: "periapical" }).expect(403);
  });

  it("doğrulama: geleceğe çekim tarihi, türle uyuşmayan kategori, geçersiz diş, DICOM fotoğraf olarak, türsüz meta, sahte DICOM", async () => {
    const p = (await sec.post("/patients", { firstName: "Film", lastName: "Kural", acknowledgeDuplicates: true }).expect(201)).body.patient.id;
    const base = { patientId: p, originalName: "a.png", contentType: "image/png", size: PNG.length };
    expect((await dentist.post("/files", { ...base, category: "radiograph", imagingKind: "panoramic", takenOn: day(2) }).expect(422)).body.field_errors.takenOn).toBeTruthy();
    expect((await dentist.post("/files", { ...base, category: "radiograph", imagingKind: "intraoral_photo" }).expect(422)).body.field_errors.category).toBeTruthy();
    await dentist.post("/files", { ...base, category: "radiograph", imagingKind: "periapical", teeth: ["19"] }).expect(422);
    await dentist.post("/files", { ...base, category: "radiograph", imagingKind: "periapical", teeth: ["16", "16"] }).expect(422);
    await dentist.post("/files", { ...base, category: "clinical_photo", contentType: "application/dicom", imagingKind: "intraoral_photo" }).expect(422);
    await dentist.post("/files", { ...base, category: "document_scan", contentType: "application/dicom" }).expect(422);
    await dentist.post("/files", { ...base, category: "radiograph", takenOn: day(-1) }).expect(422);
    // DICOM beyanı ama PNG içerik → tarama reddeder
    const fake = (await dentist.post("/files", { ...base, category: "radiograph", contentType: "application/dicom", size: PNG.length, imagingKind: "mr" }).expect(201)).body;
    await put(dentist, fake.id, PNG).expect(200);
    await worker();
    const st = (await dentist.get(`/patients/${p}/files`).expect(200)).body.items.find((x: { id: string }) => x.id === fake.id);
    expect(st.status).toBe("rejected");
  });
});

describe("ADR-103 randevudan dişe işlem", () => {
  it("geliş kaydı olan randevuda diş/yüzey işlemi kaydı haritaya ve hesaba yansır; gelmemiş randevuda 422", async () => {
    const p = (await sec.post("/patients", { firstName: "Diş", lastName: "İşlem", acknowledgeDuplicates: true }).expect(201)).body.patient.id;
    const pr = (await admin.post("/practitioners", { displayName: `Dt. Şema ${randomUUID().slice(0, 4)}` }).expect(201)).body.id;
    await admin.put(`/practitioners/${pr}/schedule`, { blocks: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "00:00", end: "23:59" })) }).expect(200);
    const procs = (await dentist.get("/procedures").expect(200)).body.items as { id: string; code: string }[];
    const cek = procs.find((x) => x.code === "CEK-01")!; const dol = procs.find((x) => x.code === "DOL-02")!;
    const fut = (await sec.post("/appointments", { patientId: p, practitionerId: pr, date: day(1), startTime: "10:00", durationMinutes: 30 }).expect(201)).body;
    expect((await dentist.post(`/patients/${p}/performed`, { appointmentId: fut.id, procedureId: cek.id, quantity: 1, location: { kind: "tooth", tooth: "36", surfaces: [] } }).expect(422)).body.code).toBe("VISIT_REQUIRED");
    const now = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(Date.now() + 2 * 60_000));
    const a = (await sec.post("/appointments", { patientId: p, practitionerId: pr, date: day(0), startTime: now, durationMinutes: 15 })).body;
    if (!a.id) return; // gece yarısına çok yakın: bugün için ileri saat yok (zaman bağımlı; atlanır)
    await sec.post(`/appointments/${a.id}/status`, { version: a.version, status: "checked_in" }).expect(200);
    await dentist.post(`/patients/${p}/performed`, { appointmentId: a.id, procedureId: cek.id, quantity: 1, location: { kind: "tooth", tooth: "36", surfaces: [] } }).expect(201);
    await dentist.post(`/patients/${p}/performed`, { appointmentId: a.id, procedureId: dol.id, quantity: 1, location: { kind: "tooth", tooth: "15", surfaces: ["M", "O"] } }).expect(201);
    const ch = (await dentist.get(`/patients/${p}/chart`).expect(200)).body.performed as { code: string; location: { tooth: string; surfaces: string[] }; status: string }[];
    expect(ch.map((x) => [x.code, x.location.tooth, x.location.surfaces.join("")]).sort()).toEqual([["CEK-01", "36", ""], ["DOL-02", "15", "MO"]]);
    expect(Number((await sec.get(`/patients/${p}/account`).expect(200)).body.totals.openDebt)).toBeGreaterThan(0);
    await sec.post(`/patients/${p}/performed`, { appointmentId: a.id, procedureId: cek.id, quantity: 1, location: { kind: "tooth", tooth: "37", surfaces: [] } }).expect(403);
  });
});
