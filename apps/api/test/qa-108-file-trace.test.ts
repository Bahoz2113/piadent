/**
 * QA-108 (S3) — Gizli klinik dosyanın izleri (ADR-090; görünürlük kuralı ADR-089 `nonClinicalFileSql`).
 * `patient.health.read` olmayan rol (sekreter, yönetici) için gizli dosya = klinik hassasiyetli (radyograf) veya klinik çıktı
 * belgesine bağlı dosya:
 *  1. `GET /patients/:id/history` gizli dosyanın `file.*` denetim olaylarını (kimlik, `changes.sha256`) içermez; idari dosya olayları kalır.
 *  2. `POST /patients/:id/export` `access_log` aynı kuralla süzülür (gizli dosya olayı sayıca da görünmez).
 *  3. `GET /documents/:id` kanıt listesinde ve dışa aktarım `evidence_events` içinde gizli dosyanın kimliği `null`; kanıt satırı kalır.
 *     İdari dosya kimliği görünür kalır.
 *  4. Denetim (log) raporu aynı kural (QA-102 ile aynı yüzey).
 * Hekim hepsini görür ve klinik dosyayı onam nüshası olarak bağlayabilir (kategori kısıtı getirilmedi; ADR-090).
 * Sağlık yetkili dışa aktaran: qa-104-105 / qa-106-107 ile aynı test kancası (ürün rol matrisi değişmez).
 */
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
import { EMAILS, login, ownerQuery, startApp, useLegacyAdmin, grantExtra, clearExtra, type Client } from "./helpers.js";

let app: INestApplication;
let dentist: Client, sec: Client, admin: Client;
let tenantA: string;
let patientId: string;
let clinicalDocId: string;
/** Görünür kalması gereken idari dosyalar. */
let identityFile: string, adminScan: string;
/** Sağlık yetkisizden gizli: radyograf (klinik hassasiyet), epikrize bağlı tarama, hekimin sildiği radyograf (file.delete olayı). */
let radio: string, linked: string, radioDeleted: string;
/** Onam belgeleri: hekim radyografı bağlar (gizli kimlik), sekreter idari taramayı bağlar (görünür kimlik). */
let consentHidden: string, consentVisible: string;

const dir = mkdtempSync(join(tmpdir(), "viadent-qa108-"));
const storage = new LocalDiskStorage(dir);
const deps: WorkerDeps = { storage, scanner: new BasicScanner() };
const tag = Math.random().toString(36).slice(2, 8);
/** Her dosyaya farklı bayt → farklı SHA-256 (gizli dosyanın özeti yanıtta aranabilsin). */
const png = (s: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`sentetik-qa108-${tag}-${s}-`.repeat(20))]);
const sha256: Record<string, string> = {};
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
type Ev = { id: string; action: string; entityType: string; entityId: string | null; changes: Record<string, unknown> };
type EvidenceRow = { kind: string; fileId: string | null };

async function worker() {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
  try { while ((await processOutbox(pool, 50, deps)) > 0) { /* tarama kuyruğunu boşalt */ } } finally { await pool.end(); }
}
const put = (c: Client, fid: string, data: Buffer) =>
  request(app.getHttpServer()).put(`/api/v1/files/${fid}/content`).set("cookie", c.cookie).set("x-viadent-request", "1").set("x-viadent-context", c.context)
    .set("content-type", "application/octet-stream").send(data);
async function upload(c: Client, category: string, name: string, patientDocumentId?: string) {
  const data = png(name);
  const fid = (await c.post("/files", { patientId, category, originalName: name, contentType: "image/png", size: data.length, ...(patientDocumentId ? { patientDocumentId } : {}) }).expect(201)).body.id as string;
  await put(c, fid, data).expect(200);
  sha256[fid] = (await ownerQuery(tenantA, "select sha256 from file_assets where id = $1", [fid]))[0]!.sha256;
  return fid;
}
async function newConsentDoc() {
  const types = (await sec.get("/document-types").expect(200)).body.items as { category: string; requiresAcceptance: boolean; issuerRole: string | null; active: boolean; approvedTemplates: { versionId: string }[] }[];
  const consent = types.find((t) => t.category !== "clinical_output" && t.requiresAcceptance && !t.issuerRole && t.active && t.approvedTemplates.length > 0);
  expect(consent, "seed'de onaylı şablonlu onam türü olmalı").toBeTruthy();
  return (await sec.post("/documents", { patientId, templateVersionId: consent!.approvedTemplates[0]!.versionId }).expect(201)).body.id as string;
}
async function withHealth<T>(membershipId: string, fn: () => Promise<T>): Promise<T> {
  // ADR-098: kanca, useLegacyAdmin ile kurulan tek buildContext casusuna ek yetki olarak bağlanır.
  grantExtra(membershipId, "patient.health.read");
  try { return await fn(); } finally { clearExtra(membershipId); }
}
const hist = async (c: Client) => (await c.get(`/patients/${patientId}/history`).expect(200));
const exportOf = async (c: Client) => {
  const r = await c.post(`/patients/${patientId}/export`, { reason: "Veri sahibi talebi (sentetik QA-108)" }).expect(200);
  return { text: r.text, doc: JSON.parse(r.text) };
};
const hidden = () => [radio, linked, radioDeleted];
const visible = () => [identityFile, adminScan];
/** Yanıt metninde gizli dosyanın kimliği veya SHA-256 özeti var mı. */
const leaks = (text: string) => hidden().flatMap((f) => [f, sha256[f]!]).filter((s) => text.includes(s));

beforeAll(async () => {
  setStorageForTests(storage);
  app = await startApp();
  // ADR-098: yönetici artık her şeyi görür; bu dosya sağlık yetkisiz rolün süzgecini sınadığından eski yönetici kümesi kullanılır.
  await useLegacyAdmin(app);
  [dentist, sec, admin] = await Promise.all([login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  patientId = (await sec.post("/patients", { firstName: "İz", lastName: `QA108 Sentetik ${tag}`, birthDate: "1979-03-03" }).expect(201)).body.patient.id;
  const epi = (await dentist.get("/document-types").expect(200)).body.items.find((t: { code: string }) => t.code === "EPIKRIZ");
  expect(epi.category).toBe("clinical_output");
  clinicalDocId = (await dentist.post("/documents", { patientId, templateVersionId: epi.approvedTemplates[0].versionId }).expect(201)).body.id;

  identityFile = await upload(sec, "identity", `kimlik-QA108-${tag}.png`);
  adminScan = await upload(sec, "document_scan", `onam-tarama-QA108-${tag}.png`);
  radio = await upload(dentist, "radiograph", `panoramik-QA108-${tag}.png`);
  linked = await upload(dentist, "document_scan", `epikriz-tarama-QA108-${tag}.png`, clinicalDocId);
  radioDeleted = await upload(dentist, "radiograph", `silinecek-radyograf-QA108-${tag}.png`);
  await worker();
  const st = await ownerQuery(tenantA, "select id, status, sensitivity from file_assets where id = any($1::uuid[])", [[...visible(), ...hidden()]]);
  expect(st.every((r) => r.status === "available")).toBe(true);
  expect(st.filter((r) => [identityFile, adminScan].includes(r.id)).every((r) => r.sensitivity === "administrative")).toBe(true);
  await dentist.post(`/files/${radioDeleted}/delete`, { reason: "Sınama: yanlış hastaya yüklendi" }).expect(200);

  consentHidden = await newConsentDoc();
  consentVisible = await newConsentDoc();
  // Hekim (sağlık yetkili) radyografı onam nüshası olarak bağlayabilir — ADR-090: kategori kısıtı yok, hekim akışı değişmedi.
  await dentist.post(`/documents/${consentHidden}/decision`, { decision: "accepted", method: "wet_signature_on_paper", attestation: true, fileId: radio }).expect(200);
  await sec.post(`/documents/${consentVisible}/decision`, { decision: "accepted", method: "wet_signature_on_paper", attestation: true, fileId: adminScan }).expect(200);
  const ev = await ownerQuery(tenantA, "select patient_document_id, file_id from evidence_events where kind = 'scan_attached' and patient_document_id = any($1::uuid[])", [[consentHidden, consentVisible]]);
  expect(Object.fromEntries(ev.map((e) => [e.patient_document_id, e.file_id]))).toEqual({ [consentHidden]: radio, [consentVisible]: adminScan });
});
afterAll(async () => app.close());

describe("QA-108 hasta geçmişi (PİA İz)", () => {
  it("sekreter ve yönetici: gizli dosyanın file.* olayı, kimliği ve SHA-256 özeti yok; idari dosyaların file.upload olayı var", async () => {
    for (const c of [sec, admin]) {
      const r = await hist(c);
      const items = r.body.items as Ev[];
      const fileEv = items.filter((e) => e.entityType === "file");
      expect(fileEv.map((e) => e.entityId)).toEqual(expect.arrayContaining(visible()));
      expect(fileEv.filter((e) => hidden().includes(e.entityId!))).toHaveLength(0);
      expect(fileEv.every((e) => visible().includes(e.entityId!))).toBe(true);
      expect(leaks(r.text)).toEqual([]);
      // Klinik olmayan diğer olaylar (hasta, onam belgesi) kalır.
      expect(items.some((e) => e.action === "patient.create")).toBe(true);
      expect(items.some((e) => e.entityType === "patient_document" && e.entityId === consentHidden)).toBe(true);
    }
  });

  it("hekim: gizli dosyaların file.upload ve file.delete olaylarını (kimlik + özet) görür", async () => {
    const items = (await hist(dentist)).body.items as Ev[];
    const fileEv = items.filter((e) => e.entityType === "file");
    for (const f of [...visible(), ...hidden()]) expect(fileEv.some((e) => e.action === "file.upload" && e.entityId === f)).toBe(true);
    expect(fileEv.some((e) => e.action === "file.delete" && e.entityId === radioDeleted)).toBe(true);
    const up = fileEv.find((e) => e.action === "file.upload" && e.entityId === radio)!;
    expect(JSON.stringify(up.changes)).toContain(sha256[radio]!);
  });
});

describe("QA-108 onam kanıtı (GET /documents/:id)", () => {
  it("sekreter ve yönetici: gizli dosyayı bağlayan kanıt satırı kalır, fileId null; idari dosya kimliği görünür", async () => {
    for (const c of [sec, admin]) {
      const r = await c.get(`/documents/${consentHidden}`).expect(200);
      const ev = r.body.evidence as EvidenceRow[];
      const scan = ev.filter((e) => e.kind === "scan_attached");
      expect(scan).toHaveLength(1);
      expect(scan[0]!.fileId).toBeNull();
      expect(ev.some((e) => e.kind === "accepted")).toBe(true);
      expect(leaks(r.text)).toEqual([]);
      const v = (await c.get(`/documents/${consentVisible}`).expect(200)).body.evidence as EvidenceRow[];
      expect(v.find((e) => e.kind === "scan_attached")!.fileId).toBe(adminScan);
    }
  });

  it("hekim: gizli dosyanın kimliğini kanıtta görür", async () => {
    const ev = (await dentist.get(`/documents/${consentHidden}`).expect(200)).body.evidence as EvidenceRow[];
    expect(ev.find((e) => e.kind === "scan_attached")!.fileId).toBe(radio);
  });
});

describe("QA-108 KVKK hasta dışa aktarımı (POST /patients/:id/export)", () => {
  it("yönetici (sağlık yetkisiz): access_log gizli dosya olayını sayıca da taşımaz; evidence_events file_id null; yanıtta gizli kimlik/özet yok", async () => {
    const { text, doc } = await exportOf(admin);
    expect(leaks(text)).toEqual([]);
    // access_log entity_id vermez; dosya olayı sayısı yalnız görünür dosyaların denetim olaylarına eşit olmalı.
    const visibleFileEvents = (await ownerQuery(tenantA, "select count(*)::int as n from audit_events where entity_type = 'file' and patient_id = $1 and entity_id = any($2::uuid[])", [patientId, visible()]))[0]!.n;
    const allFileEvents = (await ownerQuery(tenantA, "select count(*)::int as n from audit_events where entity_type = 'file' and patient_id = $1", [patientId]))[0]!.n;
    expect(allFileEvents).toBeGreaterThan(visibleFileEvents);
    const log = doc.sections.access_log as { entity_type: string }[];
    expect(log.filter((e) => e.entity_type === "file")).toHaveLength(visibleFileEvents);
    expect(log.some((e) => e.entity_type === "patient")).toBe(true);
    const ev = doc.sections.evidence_events as { patient_document_id: string; kind: string; file_id: string | null }[];
    const scanHidden = ev.filter((e) => e.patient_document_id === consentHidden && e.kind === "scan_attached");
    expect(scanHidden).toHaveLength(1);
    expect(scanHidden[0]!.file_id).toBeNull();
    expect(ev.find((e) => e.patient_document_id === consentVisible && e.kind === "scan_attached")!.file_id).toBe(adminScan);
    // Bölüm sütunları değişmez (file_id anahtarı kalır, yalnız değeri null); counts/checksums süzülmüş içerikle tutarlı.
    expect(Object.keys(scanHidden[0]!)).toContain("file_id");
    expect(doc.counts.access_log).toBe(log.length);
    expect(doc.counts.evidence_events).toBe(ev.length);
    const { createHash } = await import("node:crypto");
    const sha = (rows: unknown) => createHash("sha256").update(JSON.stringify(rows), "utf8").digest("hex");
    expect(doc.checksums.access_log).toBe(sha(log));
    expect(doc.checksums.evidence_events).toBe(sha(ev));
  });

  it("sağlık yetkili dışa aktaran (test kancası): tüm dosya olayları ve kanıttaki gizli dosya kimliği var", async () => {
    const { doc } = await withHealth(admin.session.activeMembership.id, () => exportOf(admin));
    const allFileEvents = (await ownerQuery(tenantA, "select count(*)::int as n from audit_events where entity_type = 'file' and patient_id = $1", [patientId]))[0]!.n;
    expect((doc.sections.access_log as { entity_type: string }[]).filter((e) => e.entity_type === "file")).toHaveLength(allFileEvents);
    const ev = doc.sections.evidence_events as { patient_document_id: string; kind: string; file_id: string | null }[];
    expect(ev.find((e) => e.patient_document_id === consentHidden && e.kind === "scan_attached")!.file_id).toBe(radio);
    // Kanca kalkınca yine gizli.
    expect(leaks((await exportOf(admin)).text)).toEqual([]);
  });
});

describe("QA-108 denetim (log) raporu", () => {
  it("yönetici: gizli dosyanın olayları listelenmez; idari dosya olayları listelenir", async () => {
    const rows = (await admin.get(`/reports/log?from=${day()}&to=${day()}&entityType=file`).expect(200)).body.rows as { entity: string }[];
    for (const f of visible()) expect(rows.some((r) => r.entity.includes(f.slice(0, 8)))).toBe(true);
    for (const f of hidden()) expect(rows.filter((r) => r.entity.includes(f.slice(0, 8)))).toHaveLength(0);
  });
});
