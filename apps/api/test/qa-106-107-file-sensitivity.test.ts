/**
 * QA-106 (S2) — KVKK hasta dışa aktarımı (`POST /patients/:id/export`): `patient.health.read` olmayan dışa aktaranda
 * `sections.files` içinde `sensitivity = 'clinical'` dosya (radyograf vb.: ad, kategori, SHA-256) yer almaz; `omitted` içinde
 * `files:clinical` işareti ve not; counts/checksums kalan içerikle tutarlı; `patient.export` denetimi işareti taşır; idari dosyalar
 * kalır; sağlık yetkili dışa aktarım tamdır.
 *
 * QA-107 (S3) — Klinik çıktı belgesine (`patient_document_id` → `document_types.category = 'clinical_output'`, ADR-085) bağlı
 * dosya, kategorisinden (ör. `document_scan`) bağımsız olarak sağlık yetkisi olmayan rol için klinik sayılır (ADR-089): hasta dosya
 * listesinde yok; `GET /files/:id`, `GET /files/:id/content`, `PUT /files/:id/content` (yükleme tamamlama), `POST /files/:id/delete`
 * ve dosyayı kanıt olarak bağlayan `POST /documents/:id/decision` (fileId) var olmayan dosyayla **aynı** yanıtı verir ve yan etki
 * üretmez (dosya satırı, erişim olayı, denetim, kanıt, onay durumu değişmez). Hekim mevcut davranışı korur (200).
 *
 * Sağlık yetkili dışa aktaran: varsayılan rollerde `export.patient` + `patient.health.read` birlikte yok; test yalnız ilgili üyeliğin
 * bağlamına `patient.health.read` ekler (qa-104-105 ile aynı kanca; ürün rol matrisi değişmez).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import pg from "pg";
import { BasicScanner, LocalDiskStorage } from "@viadent/db";
import { AuthService } from "../src/auth/auth.service.js";
import { setStorageForTests } from "../src/documents/files.controller.js";
import { processOutbox, type WorkerDeps } from "../../worker/src/jobs.js";
import { WORKER_URL } from "./env.js";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";

let app: INestApplication;
let dentist: Client, sec: Client, admin: Client;
let tenantA: string;
let patientId: string;
let clinicalDocId: string;
/** Görünür kalması gereken idari dosya (belgeye bağlı değil). */
let adminFileId: string;
/** Sağlık yetkisizden gizli dosyalar: klinik hassasiyetli (QA-106) ve klinik çıktıya bağlı idari kategorili (QA-107). */
let radioAvail: string, linkedAvail: string, radioInit: string, linkedInit: string;
/** Hekimin silme/yükleme 200 sınaması için ayrı dosyalar. */
let linkedForDentistDelete: string;
const RADIO_NAME = `panoramik-QA106-${Math.random().toString(36).slice(2, 8)}.png`;
const LINKED_NAME = `epikriz-imzali-QA107-${Math.random().toString(36).slice(2, 8)}.png`;

const dir = mkdtempSync(join(tmpdir(), "viadent-qa106-"));
const storage = new LocalDiskStorage(dir);
const deps: WorkerDeps = { storage, scanner: new BasicScanner() };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("sentetik-qa106-png-".repeat(20))]);
const sha = (rows: unknown) => createHash("sha256").update(JSON.stringify(rows), "utf8").digest("hex");
type Rows = Record<string, unknown>[];

async function worker() {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
  try { while ((await processOutbox(pool, 50, deps)) > 0) { /* tarama kuyruğunu boşalt */ } } finally { await pool.end(); }
}
const put = (c: Client, fid: string, data: Buffer) =>
  request(app.getHttpServer()).put(`/api/v1/files/${fid}/content`).set("cookie", c.cookie).set("x-viadent-request", "1").set("x-viadent-context", c.context)
    .set("content-type", "application/octet-stream").send(data);
const download = (c: Client, fid: string) =>
  request(app.getHttpServer()).get(`/api/v1/files/${fid}/content`).set("cookie", c.cookie).set("x-viadent-context", c.context)
    .buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on("data", (d: Buffer) => ch.push(d)); res.on("end", () => cb(null, Buffer.concat(ch))); });
async function initiate(c: Client, category: string, name: string, patientDocumentId?: string) {
  return (await c.post("/files", { patientId, category, originalName: name, contentType: "image/png", size: PNG.length, ...(patientDocumentId ? { patientDocumentId } : {}) }).expect(201)).body.id as string;
}
async function uploadAvailable(c: Client, category: string, name: string, patientDocumentId?: string) {
  const fid = await initiate(c, category, name, patientDocumentId);
  await put(c, fid, PNG).expect(200);
  return fid;
}
/** Yanıtın karşılaştırılabilir hâli (istek kimliği hariç). */
const norm = (r: request.Response) => ({ status: r.status, code: r.body?.code, message: r.body?.message, field_errors: r.body?.field_errors, details: r.body?.details });

/** Yan etki ölçümü: dosya satırları, erişim olayları, denetim, kanıt, onay durumu. */
async function snapshot(ids: string[], consentDocId?: string) {
  const files = await ownerQuery(tenantA, "select id, status, status_reason, upload_failures, deleted_at, deleted_by, sha256, size_bytes from file_assets where id = any($1::uuid[]) order by id", [ids]);
  const events = await ownerQuery(tenantA, "select file_id, count(*)::int as n from file_access_events where file_id = any($1::uuid[]) group by file_id order by file_id", [ids]);
  const audits = await ownerQuery(tenantA, "select count(*)::int as n from audit_events where entity_id = any($1::uuid[])", [ids]);
  const evidence = await ownerQuery(tenantA, "select count(*)::int as n from evidence_events where file_id = any($1::uuid[])", [ids]);
  const consent = consentDocId ? await ownerQuery(tenantA,
    "select r.status, (select count(*)::int from evidence_events e where e.patient_document_id = r.patient_document_id) as ev from consent_requests r where r.patient_document_id = $1", [consentDocId]) : [];
  return JSON.stringify({ files, events, audits, evidence, consent });
}

async function withHealth<T>(membershipId: string, fn: () => Promise<T>): Promise<T> {
  const auth = app.get(AuthService);
  const orig = auth.buildContext.bind(auth);
  const spy = vi.spyOn(auth, "buildContext").mockImplementation((s, m, corr) => {
    const ctx = orig(s, m, corr);
    if (m.id === membershipId) ctx.permissions = new Set([...ctx.permissions, "patient.health.read"]);
    return ctx;
  });
  try { return await fn(); } finally { spy.mockRestore(); }
}
async function newConsentDoc() {
  const types = (await sec.get("/document-types").expect(200)).body.items as { category: string; requiresAcceptance: boolean; issuerRole: string | null; active: boolean; approvedTemplates: { versionId: string }[] }[];
  const consent = types.find((t) => t.category !== "clinical_output" && t.requiresAcceptance && !t.issuerRole && t.active && t.approvedTemplates.length > 0);
  expect(consent, "seed'de onaylı şablonlu onam türü olmalı").toBeTruthy();
  return (await sec.post("/documents", { patientId, templateVersionId: consent!.approvedTemplates[0]!.versionId }).expect(201)).body.id as string;
}
const exportOf = async (c: Client) => {
  const r = await c.post(`/patients/${patientId}/export`, { reason: "Veri sahibi talebi (sentetik QA-106)" }).expect(200);
  return { text: r.text, doc: JSON.parse(r.text) };
};

beforeAll(async () => {
  setStorageForTests(storage);
  app = await startApp();
  [dentist, sec, admin] = await Promise.all([login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  patientId = (await sec.post("/patients", { firstName: "Dosya", lastName: `QA106 Sentetik ${Math.random().toString(36).slice(2, 7)}`, birthDate: "1981-08-08" }).expect(201)).body.patient.id;
  const epi = (await dentist.get("/document-types").expect(200)).body.items.find((t: { code: string }) => t.code === "EPIKRIZ");
  expect(epi.category).toBe("clinical_output");
  clinicalDocId = (await dentist.post("/documents", { patientId, templateVersionId: epi.approvedTemplates[0].versionId }).expect(201)).body.id;

  adminFileId = await uploadAvailable(sec, "identity", "kimlik-QA106.png");
  radioAvail = await uploadAvailable(dentist, "radiograph", RADIO_NAME);
  linkedAvail = await uploadAvailable(dentist, "document_scan", LINKED_NAME, clinicalDocId);
  linkedForDentistDelete = await uploadAvailable(dentist, "document_scan", "epikriz-silinecek.png", clinicalDocId);
  radioInit = await initiate(dentist, "radiograph", "bekleyen-radyograf.png");
  linkedInit = await initiate(dentist, "document_scan", "bekleyen-epikriz-taramasi.png", clinicalDocId);
  await worker();
  const st = await ownerQuery(tenantA, "select id, status from file_assets where id = any($1::uuid[])", [[adminFileId, radioAvail, linkedAvail, linkedForDentistDelete, radioInit, linkedInit]]);
  const byId = Object.fromEntries(st.map((r) => [r.id, r.status]));
  expect([byId[adminFileId], byId[radioAvail], byId[linkedAvail], byId[linkedForDentistDelete]]).toEqual(["available", "available", "available", "available"]);
  expect([byId[radioInit], byId[linkedInit]]).toEqual(["initiated", "initiated"]);
});
afterAll(async () => app.close());

describe("QA-107 klinik çıktıya bağlı / klinik hassasiyetli dosya: sağlık yetkisizde var olmayanla aynı", () => {
  const hidden = () => [radioAvail, linkedAvail, radioInit, linkedInit];

  it("hasta dosya listesi: sekreter ve yönetici gizli dosyaları ve klinik belge kimliğini görmez, idari dosyayı görür; hekim hepsini görür", async () => {
    for (const c of [sec, admin]) {
      const r = await c.get(`/patients/${patientId}/files`).expect(200);
      const ids = (r.body.items as { id: string }[]).map((f) => f.id);
      expect(ids).toContain(adminFileId);
      for (const h of hidden()) expect(ids).not.toContain(h);
      expect(r.text).not.toContain(clinicalDocId);
      expect(r.text).not.toContain(LINKED_NAME);
      expect(r.text).not.toContain(RADIO_NAME);
    }
    const all = ((await dentist.get(`/patients/${patientId}/files`).expect(200)).body.items as { id: string; patientDocumentId: string | null }[]);
    expect(all.map((f) => f.id)).toEqual(expect.arrayContaining([adminFileId, ...hidden()]));
    expect(all.find((f) => f.id === linkedAvail)!.patientDocumentId).toBe(clinicalDocId);
  });

  it("GET /files/:id ve GET /files/:id/content: sekreter/yönetici = var olmayan (404), erişim olayı yazılmaz; idari dosya 200", async () => {
    for (const c of [sec, admin]) {
      const ghost = randomUUID();
      const nd = norm(await c.get(`/files/${ghost}`));
      const nc = norm(await download(c, ghost));
      expect(nd.status).toBe(404);
      expect(nc.status).toBe(404);
      for (const h of hidden()) {
        const before = await snapshot(hidden());
        expect(norm(await c.get(`/files/${h}`)), `detail ${h}`).toEqual(nd);
        expect(norm(await download(c, h)), `content ${h}`).toEqual(nc);
        expect(await snapshot(hidden()), `yan etki ${h}`).toBe(before);
      }
      await c.get(`/files/${adminFileId}`).expect(200);
      expect((await download(c, adminFileId).expect(200)).body).toEqual(PNG);
    }
  });

  it("PUT /files/:id/content (yükleme tamamlama) ve POST /files/:id/delete: sekreter/yönetici = var olmayan, yan etkisiz", async () => {
    for (const c of [sec, admin]) {
      const ghost = randomUUID();
      const nPut = norm(await put(c, ghost, Buffer.from("x")));
      const nDel = norm(await c.post(`/files/${ghost}/delete`, { reason: "Sınama gerekçesi" }));
      for (const h of hidden()) {
        const before = await snapshot(hidden());
        expect(norm(await put(c, h, Buffer.from("x"))), `put eksik ${h}`).toEqual(nPut);
        expect(norm(await put(c, h, PNG)), `put tam ${h}`).toEqual(nPut);
        expect(norm(await c.post(`/files/${h}/delete`, { reason: "Sınama gerekçesi" })), `delete ${h}`).toEqual(nDel);
        expect(await snapshot(hidden()), `yan etki ${h}`).toBe(before);
      }
    }
    // Rol yetkisi olan için var olmayan dosya yanıtı 404'tür (kapı bilgi vermez): sekreter yükleyebilir, yönetici silebilir.
    expect(norm(await put(sec, randomUUID(), Buffer.from("x"))).status).toBe(404);
    expect(norm(await admin.post(`/files/${randomUUID()}/delete`, { reason: "Sınama gerekçesi" })).status).toBe(404);
  });

  it("POST /documents/:id/decision fileId: sekreter gizli dosyayı onam kanıtı olarak bağlayamaz (var olmayan dosyayla aynı 422), onay açık kalır", async () => {
    const consentDocId = await newConsentDoc();
    const body = (fileId: string) => ({ decision: "accepted", method: "wet_signature_on_paper", attestation: true, fileId });
    const nx = norm(await sec.post(`/documents/${consentDocId}/decision`, body(randomUUID())));
    expect(nx.status).toBe(422);
    for (const h of [radioAvail, linkedAvail]) {
      const before = await snapshot(hidden(), consentDocId);
      expect(norm(await sec.post(`/documents/${consentDocId}/decision`, body(h))), `decision ${h}`).toEqual(nx);
      expect(await snapshot(hidden(), consentDocId), `yan etki ${h}`).toBe(before);
    }
    // İdari dosya ile karar mümkün (aşırı engelleme yok).
    await sec.post(`/documents/${consentDocId}/decision`, body(adminFileId)).expect(200);
  });

  it("hekim (sağlık yetkili): ayrıntı, içerik, yükleme tamamlama, karar ve silme 200", async () => {
    const d = (await dentist.get(`/files/${linkedAvail}`).expect(200)).body;
    expect(d.name).toBe(LINKED_NAME);
    await dentist.get(`/files/${radioAvail}`).expect(200);
    expect((await download(dentist, linkedAvail).expect(200)).body).toEqual(PNG);
    expect((await download(dentist, radioAvail).expect(200)).body).toEqual(PNG);
    await put(dentist, linkedInit, PNG).expect(200);
    await put(dentist, radioInit, PNG).expect(200);
    const consentDocId = await newConsentDoc();
    await dentist.post(`/documents/${consentDocId}/decision`, { decision: "accepted", method: "wet_signature_on_paper", attestation: true, fileId: linkedAvail }).expect(200);
    await dentist.post(`/files/${linkedForDentistDelete}/delete`, { reason: "Hekim sınaması" }).expect(200);
    expect((await ownerQuery(tenantA, "select status from file_assets where id = $1", [linkedForDentistDelete]))[0].status).toBe("deleted");
  });
});

describe("QA-106 hasta dışa aktarımı: klinik hassasiyetli dosyalar yalnız sağlık yetkisiyle", () => {
  it("yönetici (sağlık yetkisiz): files bölümünde klinik hassasiyetli ve klinik çıktıya bağlı dosya yok, idari dosya var; omitted files:clinical + not", async () => {
    const { text, doc } = await exportOf(admin);
    const files = doc.sections.files as Rows;
    expect(files.map((f) => f.id)).toContain(adminFileId);
    expect(files.every((f) => f.sensitivity === "administrative")).toBe(true);
    expect(files.every((f) => f.patient_document_id !== clinicalDocId)).toBe(true);
    for (const h of [radioAvail, linkedAvail, radioInit, linkedInit, linkedForDentistDelete]) expect(files.map((f) => f.id)).not.toContain(h);
    // Dosya metaverisi (ad) yanıtın hiçbir yerinde yok. Not: hekimin onam belgesine kanıt olarak bağladığı dosyanın yalnız kimliği
    // onam kanıt olayında (evidence_events.file_id) kalır — fix3.md "bilinen riskler".
    expect(text).not.toContain(RADIO_NAME);
    expect(text).not.toContain(LINKED_NAME);
    expect(doc.omitted).toEqual(expect.arrayContaining(["files:clinical", "files:clinical_output"]));
    expect((doc.notes as string[]).some((n) => /files:clinical\b/.test(n) && /sağlık/i.test(n))).toBe(true);
    expect(Object.keys(doc.counts).sort()).toEqual(Object.keys(doc.sections).sort());
    for (const [k, rows] of Object.entries(doc.sections) as [string, unknown[]][]) {
      expect(doc.counts[k], k).toBe(rows.length);
      expect(doc.checksums[k], k).toBe(sha(rows));
    }
    const a = await ownerQuery(tenantA, "select changes from audit_events where action = 'patient.export' and entity_id = $1 order by id desc limit 1", [patientId]);
    expect(a[0].changes.omitted.to).toEqual(expect.arrayContaining(["files:clinical"]));
  });

  it("sağlık yetkili dışa aktaran (test için yetki verilmiş yönetici): tüm dosyalar var, omitted boş; kanca kalkınca yine yok", async () => {
    const { doc } = await withHealth(admin.context, () => exportOf(admin));
    const ids = (doc.sections.files as Rows).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([adminFileId, radioAvail, linkedAvail, radioInit, linkedInit, linkedForDentistDelete]));
    expect(doc.omitted).toEqual([]);
    expect(doc.checksums.files).toBe(sha(doc.sections.files));
    expect(((await exportOf(admin)).doc.sections.files as Rows).map((f) => f.id)).not.toContain(radioAvail);
  });
});
