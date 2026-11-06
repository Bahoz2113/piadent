/**
 * Görev 4: belge (tür/şablon sürümü/hasta belgesi/onay isteği/kanıt), özel depo + tarama (AT-11), iletişim tercihi ve
 * mesaj (AT-12), şablon değişince imzalı eski sürüm (AT-14), kontrol görevi ve PİA Hazır. Gerçek PostgreSQL, uygulama rolü.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import pg from "pg";
import { ClamdScanner, BasicScanner, LocalDiskStorage, documentsMaintenance, processIntegrationJobs, withContext } from "@viadent/db";
import { EMAILS, adminQuery, login, ownerQuery, startApp, useLegacyAdmin, type Client } from "./helpers.js";
import { Db } from "../src/infra/db.service.js";
import { APP_URL, WORKER_URL } from "./env.js";
import { processOutbox, scanAllTenants, type WorkerDeps } from "../../worker/src/jobs.js";
import { setStorageForTests } from "../src/documents/files.controller.js";

let app: INestApplication;
let admin: Client, dentist: Client, sec: Client, assistant: Client, fin: Client, bDentist: Client;
let tenantA: string;
let pracId: string;
const dir = mkdtempSync(join(tmpdir(), "viadent-files-"));
const storage = new LocalDiskStorage(dir);
const deps: WorkerDeps = { storage, scanner: new BasicScanner() };
const key = () => `t-${randomUUID()}`;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("sentetik-png-govdesi-".repeat(20))]);
const PDF = Buffer.from("%PDF-1.4\n% sentetik\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n");
const PDF_JS = Buffer.from("%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF\n");
const EICAR = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");

const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};
async function worker() {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
  try { while ((await processOutbox(pool, 50, deps)) + (await processIntegrationJobs(pool)) > 0) { /* kuyrukları boşalt */ } } finally { await pool.end(); }
}
async function scan(now = new Date()) {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
  try { await scanAllTenants(pool, now); } finally { await pool.end(); }
}
async function newPatient(first: string, extra: Record<string, unknown> = {}) {
  return (await sec.post("/patients", { firstName: first, lastName: "Belge", birthDate: "1980-03-03", ...extra }).expect(201)).body.patient.id as string;
}
async function uploadFile(c: Client, patientId: string, data: Buffer, opts: { category?: string; contentType?: string; name?: string } = {}) {
  const f = (await c.post("/files", { patientId, category: opts.category ?? "document_scan", originalName: opts.name ?? "tarama.png", contentType: opts.contentType ?? "image/png", size: data.length }).expect(201)).body;
  return f.id as string;
}
const put = (c: Client, fid: string, data: Buffer | string, type = "application/octet-stream") =>
  request(app.getHttpServer()).put(`/api/v1/files/${fid}/content`).set("cookie", c.cookie).set("x-viadent-request", "1").set("x-viadent-context", c.context)
    .set("content-type", type).send(data);
const download = (c: Client, fid: string) =>
  request(app.getHttpServer()).get(`/api/v1/files/${fid}/content`).set("cookie", c.cookie).set("x-viadent-context", c.context)
    .buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on("data", (d: Buffer) => ch.push(d)); res.on("end", () => cb(null, Buffer.concat(ch))); });
async function approvedVersion(code: string) {
  const types = (await dentist.get("/document-types").expect(200)).body.items;
  const t = types.find((x: { code: string }) => x.code === code);
  return { type: t, versionId: t.approvedTemplates[0]?.versionId as string | undefined };
}

beforeAll(async () => {
  setStorageForTests(storage);
  app = await startApp();
  // ADR-098: yönetici artık her şeyi görür; bu dosya sağlık yetkisiz rolün süzgecini sınadığından eski yönetici kümesi kullanılır.
  await useLegacyAdmin(app);
  [admin, dentist, sec, assistant, fin, bDentist] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary),
    login(app, EMAILS.aAssistant), login(app, EMAILS.aFinance), login(app, EMAILS.bDentist)]);
  tenantA = sec.session.activeMembership.tenantId;
  pracId = (await sec.get("/resources").expect(200)).body.practitioners[0].id;
});
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe("belge kataloğu ve şablon", () => {
  it("PİA-DENT kataloğu DEMO/incelenmemiş; sentetik onaylı şablonlar var; finans belge göremez", async () => {
    const types = (await dentist.get("/document-types").expect(200)).body.items;
    expect(types.length).toBe(20); // 17 + 3 klinik çıktı türü (ADR-085)
    expect(types.every((t: { reviewStatus: string }) => t.reviewStatus === "demo_unreviewed")).toBe(true);
    const withTpl = types.filter((t: { approvedTemplates: unknown[] }) => t.approvedTemplates.length > 0);
    expect(withTpl.map((t: { code: string }) => t.code).sort()).toEqual(["ENDO-ONAM", "EPIKRIZ", "GENEL-ONAM", "HASTA-FOYU", "RECETE"]);
    expect(withTpl.every((t: { approvedTemplates: { isDemo: boolean }[] }) => t.approvedTemplates[0]!.isDemo)).toBe(true);
    expect((await fin.get("/document-types")).status).toBe(403);
  });

  it("şablonda tanımsız alan reddedilir; onaylı sürüm düzenlenemez (API + DB)", async () => {
    const { type } = await approvedVersion("ISLEM-SONRASI");
    const bad = await admin.post("/templates", { documentTypeId: type.id, name: "Kötü", body: "Merhaba {{hasta.tc_kimlik}} sentetik" });
    expect(bad.status).toBe(422);
    expect(bad.body.field_errors.body).toMatch(/hasta\.tc_kimlik/);
    const t = (await admin.post("/templates", { documentTypeId: type.id, name: "Bakım (sentetik)", body: "SENTETİK DEMO bakım bilgisi: {{hasta.ad_soyad}} {{belge.tarih}}" }).expect(201)).body;
    await admin.post(`/template-versions/${t.versionId}/approve`).expect(200);
    expect((await admin.patch(`/template-versions/${t.versionId}`, { body: "değiştirilmiş sentetik metin" })).status).toBe(409);
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("update template_versions set body = 'x deneme metni' where id = $1", [t.versionId])))
        .rejects.toThrow(/template_version_frozen/);
    } finally { await pool.end(); }
    expect((await sec.post("/templates", { documentTypeId: type.id, name: "x", body: "SENTETİK metin örneği" })).status).toBe(403);
  });
});

describe("AT-14 belge üretimi, kanıt ve şablon sürümü", () => {
  let patientId: string, docId: string, hash1: string, v1: string;

  it("önizleme = üretim; metin snapshot + SHA-256; DEMO işaretli; onay isteği açılır", async () => {
    patientId = await newPatient("Asude");
    v1 = (await approvedVersion("ENDO-ONAM")).versionId!;
    const pv = (await sec.post(`/template-versions/${v1}/preview`, { patientId }).expect(200)).body;
    expect(pv.content).toMatch(/SENTETİK DEMO BELGESİ/);
    expect(pv.content).toMatch(/Asude Belge/);
    expect(pv.isDemo).toBe(true);
    const d = (await sec.post("/documents", { patientId, templateVersionId: v1 }).expect(201)).body;
    docId = d.id; hash1 = d.contentHash;
    expect(hash1).toBe(pv.contentHash);
    const det = (await sec.get(`/documents/${docId}`).expect(200)).body;
    expect(det).toMatchObject({ requestStatus: "issued", templateVersion: 1, integrityOk: true, contentHash: hash1 });
    expect(sha(det.content)).toBe(hash1);
    expect(det.title).toMatch(/DEMO/);
    expect(det.evidence.map((e: { kind: string }) => e.kind)).toEqual(["issued"]);
  });

  it("kabul yöntem + personel beyanı ister; kanıt belge hash'ini taşır; karar bir kez verilir", async () => {
    const noAttest = await dentist.post(`/documents/${docId}/decision`, { decision: "accepted", method: "wet_signature_on_paper" });
    expect(noAttest.status).toBe(422);
    await sec.post(`/documents/${docId}/print`).expect(200);
    await dentist.post(`/documents/${docId}/decision`, { decision: "accepted", method: "wet_signature_on_paper", attestation: true, note: "Sentetik test" }).expect(200);
    const again = await dentist.post(`/documents/${docId}/decision`, { decision: "declined" });
    expect(again.body.code).toBe("DECISION_CLOSED");
    const det = (await sec.get(`/documents/${docId}`).expect(200)).body;
    expect(det.requestStatus).toBe("accepted");
    expect(det.evidence.map((e: { kind: string }) => e.kind)).toEqual(["issued", "printed", "accepted"]);
    expect(det.evidence.every((e: { documentHash: string }) => e.documentHash === hash1)).toBe(true);
    expect(det.evidence[2].method).toBe("wet_signature_on_paper");
    expect((await assistant.post(`/documents/${docId}/decision`, { decision: "declined" })).status).toBe(403);
  });

  it("şablon değişince imzalanmış eski belge v1 ve hash'ini korur; yeni belge v2'ye bağlanır", async () => {
    const tpl = (await admin.get("/templates").expect(200)).body.items.find((t: { typeCode: string }) => t.typeCode === "ENDO-ONAM");
    const nv = (await admin.post(`/templates/${tpl.id}/versions`, { body: "SENTETİK DEMO v2 — değiştirilmiş metin {{hasta.ad_soyad}} {{belge.tarih}}\nPlan:\n{{plan.kalemler}}", changeNote: "AT-14 testi" }).expect(201)).body;
    await admin.post(`/template-versions/${nv.id}/approve`).expect(200);
    await admin.post(`/template-versions/${v1}/retire`).expect(200);
    const old = (await sec.get(`/documents/${docId}`).expect(200)).body;
    expect(old).toMatchObject({ templateVersion: 1, contentHash: hash1, integrityOk: true, requestStatus: "accepted", templateStatus: "retired" });
    expect(old.content).not.toMatch(/v2/);
    const retiredIssue = await sec.post("/documents", { patientId, templateVersionId: v1 });
    expect(retiredIssue.body.code).toBe("TEMPLATE_NOT_APPROVED");
    const d2 = (await sec.post("/documents", { patientId, templateVersionId: nv.id }).expect(201)).body;
    expect(d2.contentHash).not.toBe(hash1);
    expect((await sec.get(`/documents/${d2.id}`).expect(200)).body.templateVersion).toBe(2);
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("update patient_documents set content = 'x' where id = $1", [docId]))).rejects.toThrow(/patient_document_immutable/);
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("delete from evidence_events where patient_document_id = $1", [docId]))).rejects.toThrow(/permission denied/);
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) => c.query("update consent_requests set status = 'declined' where patient_document_id = $1", [docId]))).rejects.toThrow(/consent_request_closed/);
    } finally { await pool.end(); }
  });

  it("iptal gerekçe ister; iptal edilen belgeye karar ve yazdırma yok; liste durumları ayrı", async () => {
    const pid = await newPatient("Berrak");
    const v = (await approvedVersion("GENEL-ONAM")).versionId!;
    const d = (await sec.post("/documents", { patientId: pid, templateVersionId: v }).expect(201)).body;
    expect((await sec.post(`/documents/${d.id}/revoke`, { reason: "x" })).status).toBe(403); // sekreter iptal edemez
    expect((await dentist.post(`/documents/${d.id}/revoke`, { reason: "" })).status).toBe(422);
    await dentist.post(`/documents/${d.id}/revoke`, { reason: "Yanlış hastaya hazırlandı" }).expect(200);
    expect((await dentist.post(`/documents/${d.id}/decision`, { decision: "declined" })).body.code).toBe("DECISION_CLOSED");
    expect((await sec.post(`/documents/${d.id}/print`)).body.code).toBe("DOCUMENT_REVOKED");
    const list = (await sec.get(`/patients/${pid}/documents`).expect(200)).body.items;
    expect(list[0]).toMatchObject({ status: "revoked", requestStatus: "revoked", revokeReason: "Yanlış hastaya hazırlandı" });
  });

  it("hekime özel belge türünü sekreter hazırlayamaz; bilgilendirme türü karar gerektirmez", async () => {
    const { type } = await approvedVersion("ISTIRAHAT");
    const t = (await admin.post("/templates", { documentTypeId: type.id, name: "İstirahat (sentetik)", body: "SENTETİK DEMO durum belgesi {{hasta.ad_soyad}} {{hekim.ad}}" }).expect(201)).body;
    await admin.post(`/template-versions/${t.versionId}/approve`).expect(200);
    const pid = await newPatient("Cemre");
    expect((await sec.post("/documents", { patientId: pid, templateVersionId: t.versionId })).status).toBe(403);
    const d = (await dentist.post("/documents", { patientId: pid, templateVersionId: t.versionId }).expect(201)).body;
    expect(d.requiresAcceptance).toBe(false);
    expect((await dentist.post(`/documents/${d.id}/decision`, { decision: "accepted", method: "verbal_in_person", attestation: true })).body.code).toBe("NO_DECISION_REQUIRED");
  });
});

describe("AT-11 dosya: yükleme, tarama, erişim", () => {
  let pid: string;
  it("eksik yükleme başarı sayılmaz, tekrar yolu açık; tarama bitmeden indirilemez; temiz dosya hash'iyle iner", async () => {
    pid = await newPatient("Dilek");
    const fid = await uploadFile(sec, pid, PNG);
    const partial = await put(sec, fid, PNG.subarray(0, 40));
    expect(partial.status).toBe(422);
    expect(partial.body.code).toBe("UPLOAD_INCOMPLETE");
    expect(partial.body.details).toMatchObject({ attempts: 1, status: "initiated" });
    expect((await download(sec, fid)).status).toBe(409);
    const ok = await put(sec, fid, PNG);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "uploaded", sha256: sha(PNG) });
    const notYet = await download(sec, fid);
    expect(notYet.status).toBe(409);
    expect(notYet.body.toString()).toMatch(/FILE_NOT_AVAILABLE/);
    await worker();
    const list = (await sec.get(`/patients/${pid}/files`).expect(200)).body.items;
    expect(list.find((f: { id: string }) => f.id === fid)).toMatchObject({ status: "available", scanEngine: "viadent-basic-1", sha256: sha(PNG) });
    const dl = await download(sec, fid);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0);
    expect(dl.headers["x-content-sha256"]).toBe(sha(PNG));
    expect(dl.headers["content-disposition"]).toMatch(/^attachment/);
    const ev = (await sec.get(`/files/${fid}`).expect(200)).body.events.map((e: { action: string }) => e.action);
    expect(ev).toEqual(["upload_initiated", "upload_failed", "access_denied", "uploaded", "access_denied", "scan_clean", "downloaded"]);
    // İçerik DB'de değil, özel depoda
    const files = readdirSync(join(dir, tenantA), { recursive: true }).map(String);
    expect(files.some((f) => f.endsWith(fid))).toBe(true);
  });

  it("zararlı dosya karantinaya alınır, açılamaz, yöneticiye görev düşer; gerekçeyle silinince görev kapanır", async () => {
    const fid = await uploadFile(sec, pid, EICAR, { name: "test.png" });
    await put(sec, fid, EICAR).expect(200);
    await worker();
    const f = (await sec.get(`/patients/${pid}/files`).expect(200)).body.items.find((x: { id: string }) => x.id === fid);
    expect(f).toMatchObject({ status: "quarantined", statusReason: "EICAR test imzası" });
    const dl = await download(sec, fid);
    expect(dl.status).toBe(409);
    expect(dl.body.toString()).toMatch(/karantinada/);
    const task = (await admin.get("/tasks").expect(200)).body.items.find((t: { kind: string; sourceId: string }) => t.kind === "file_quarantined" && t.sourceId === fid);
    expect(task).toBeTruthy();
    await dentist.post(`/files/${fid}/delete`, { reason: "Zararlı içerik; kaynağı doğrulanamadı" }).expect(200);
    await scan();
    const open = (await admin.get("/tasks").expect(200)).body.items;
    expect(open.find((t: { id: string }) => t.id === task.id)).toBeUndefined();
  });

  it("tür uyuşmazlığı reddedilir; PDF içinde etkin içerik karantinaya alınır; temiz PDF kullanılabilir", async () => {
    const mismatch = await uploadFile(sec, pid, PNG, { contentType: "application/pdf", name: "sahte.pdf" });
    await put(sec, mismatch, PNG).expect(200);
    const js = await uploadFile(sec, pid, PDF_JS, { contentType: "application/pdf", name: "aktif.pdf" });
    await put(sec, js, PDF_JS).expect(200);
    const clean = await uploadFile(sec, pid, PDF, { contentType: "application/pdf", name: "temiz.pdf" });
    await put(sec, clean, PDF).expect(200);
    await worker();
    const list = (await sec.get(`/patients/${pid}/files`).expect(200)).body.items;
    const st = (id: string) => list.find((x: { id: string }) => x.id === id);
    expect(st(mismatch)).toMatchObject({ status: "rejected" });
    expect(st(mismatch).statusReason).toMatch(/uyuşmuyor/);
    expect(st(js)).toMatchObject({ status: "quarantined" });
    expect(st(clean)).toMatchObject({ status: "available" });
  });

  it("5 başarısız yükleme denemesinden sonra dosya reddedilir; JSON gövdesi içerik sayılmaz", async () => {
    const fid = await uploadFile(sec, pid, PNG);
    for (let i = 0; i < 4; i++) expect((await put(sec, fid, "{}", "application/json")).body.details.status).toBe("initiated");
    const last = await put(sec, fid, PNG.subarray(1));
    expect(last.body.details).toMatchObject({ attempts: 5, status: "rejected" });
    expect((await put(sec, fid, PNG)).status).toBe(409);
  });

  it("klinik dosya yalnız sağlık yetkili rollere görünür; tarama bitmeden available olamaz (DB)", async () => {
    expect((await sec.post("/files", { patientId: pid, category: "radiograph", originalName: "r.png", contentType: "image/png", size: PNG.length })).status).toBe(403);
    const fid = await uploadFile(dentist, pid, PNG, { category: "radiograph", name: "periapikal.png" });
    await put(dentist, fid, PNG).expect(200);
    const pool = new pg.Pool({ connectionString: APP_URL, max: 1 });
    try {
      await expect(withContext(pool, { tenantId: tenantA, userId: null }, (c) =>
        c.query("update file_assets set status = 'available', available_at = now() where id = $1", [fid]))).rejects.toThrow(/file_not_scanned/);
    } finally { await pool.end(); }
    await worker();
    expect((await sec.get(`/patients/${pid}/files`).expect(200)).body.items.some((f: { id: string }) => f.id === fid)).toBe(false);
    expect((await sec.get(`/files/${fid}`)).status).toBe(404);
    expect((await download(sec, fid)).status).toBe(404);
    expect((await download(assistant, fid)).status).toBe(200);
    expect((await admin.get(`/patients/${pid}/files`).expect(200)).body.items.some((f: { id: string }) => f.id === fid)).toBe(false);
  });

  it("ClamAV (clamd) istemcisi: INSTREAM çerçevesi ve FOUND/OK yanıtı (sahte clamd ile sözleşme testi)", async () => {
    const server = createServer((sock) => {
      const chunks: Buffer[] = [];
      sock.on("data", (d) => {
        chunks.push(d);
        const all = Buffer.concat(chunks);
        if (!all.subarray(0, 10).equals(Buffer.from("zINSTREAM\0"))) return;
        let off = 10; const body: Buffer[] = [];
        while (off + 4 <= all.length) {
          const len = all.readUInt32BE(off);
          if (len === 0) { sock.end(Buffer.concat(body).toString("latin1").includes("EICAR") ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0"); return; }
          if (off + 4 + len > all.length) return;
          body.push(all.subarray(off + 4, off + 4 + len)); off += 4 + len;
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const s = new ClamdScanner("127.0.0.1", port);
      expect(await s.scan(EICAR, "image/png")).toMatchObject({ verdict: "infected", engine: "clamav", reason: "Eicar-Test-Signature FOUND" });
      expect(await s.scan(PNG, "image/png")).toMatchObject({ verdict: "clean", engine: "clamav+viadent-basic-1" });
      await expect(new ClamdScanner("127.0.0.1", 1).scan(PNG, "image/png")).rejects.toThrow(); // clamd yoksa dosya "temiz" sayılmaz
    } finally { server.close(); }
  });
});

describe("AT-12 iletişim tercihi ve mesaj", () => {
  it("izin yoksa mesaj reddedilir; izinle MOCK sağlayıcıya iletilir, teslim uydurulmaz, süre aşımında 'bilinmiyor' olur", async () => {
    const pid = await newPatient("Ebru", { phone: "+905551112233" });
    const body = { patientId: pid, purpose: "appointment_reminder", channel: "sms", body: "Sentetik randevu hatırlatması" };
    const denied = await sec.post("/messages", body).set("idempotency-key", key());
    expect(denied.body.code).toBe("CONSENT_MISSING");
    await sec.post(`/patients/${pid}/communication-preferences`, { purpose: "appointment_reminder", channel: "sms", status: "granted", source: "in_person" }).expect(201);
    const k = key();
    const m = (await sec.post("/messages", body).set("idempotency-key", k).expect(201)).body;
    await sec.post("/messages", body).set("idempotency-key", k).expect(201); // çift tıklama → tek mesaj
    expect((await ownerQuery(tenantA, "select count(*)::int as n from messages where patient_id = $1", [pid]))[0].n).toBe(1);
    await worker();
    let com = (await sec.get(`/patients/${pid}/communication`).expect(200)).body;
    expect(com.messages[0]).toMatchObject({ id: m.id, status: "submitted", provider: "mock", recipient: expect.stringMatching(/\*/) });
    expect(com.provider.label).toMatch(/DENEME/); // 07.11.2026: Türkçe etiket
    // 25 saat sonra bakım taraması: teslim bilgisi yok → unknown (delivered asla yazılmaz)
    const pool = new pg.Pool({ connectionString: WORKER_URL, max: 1 });
    try { await withContext(pool, { tenantId: tenantA, userId: null }, (c) => documentsMaintenance(c, tenantA, new Date(Date.now() + 25 * 3600_000))); } finally { await pool.end(); }
    com = (await sec.get(`/patients/${pid}/communication`).expect(200)).body;
    expect(com.messages[0].status).toBe("unknown");
    expect(com.messages[0].events.map((e: { status: string }) => e.status)).toEqual(["queued", "submitted", "unknown"]);
    expect(com.messages[0].events.some((e: { status: string }) => e.status === "delivered")).toBe(false);
  });

  it("izin kuyruktayken geri çekilirse gönderim iptal olur; amaçlar ayrı (randevu izni kampanyayı kapsamaz)", async () => {
    const pid = await newPatient("Feride", { phone: "+905551112244" });
    await sec.post(`/patients/${pid}/communication-preferences`, { purpose: "appointment_reminder", channel: "sms", status: "granted", source: "paper_form" }).expect(201);
    expect((await sec.post("/messages", { patientId: pid, purpose: "marketing", channel: "sms", body: "Sentetik kampanya" }).set("idempotency-key", key())).body.code).toBe("CONSENT_MISSING");
    await sec.post("/messages", { patientId: pid, purpose: "appointment_reminder", channel: "sms", body: "Sentetik hatırlatma" }).set("idempotency-key", key()).expect(201);
    await sec.post(`/patients/${pid}/communication-preferences`, { purpose: "appointment_reminder", channel: "sms", status: "withdrawn", source: "phone" }).expect(201);
    await worker();
    const com = (await sec.get(`/patients/${pid}/communication`).expect(200)).body;
    expect(com.messages[0]).toMatchObject({ status: "cancelled", statusReason: "Gönderim anında iletişim izni yok" });
    expect(com.current["appointment_reminder:sms"].status).toBe("withdrawn");
    expect(com.history).toHaveLength(2); // geçmiş korunur
    // ADR-102 (07.11.2026): hekim artık bilgi mesajı gönderebilir; izin geri çekildiği için yine gönderilmez (422 izin yok).
    const dm = await dentist.post("/messages", { patientId: pid, purpose: "appointment_reminder", channel: "sms", body: "x deneme" }).set("idempotency-key", key());
    expect(dm.status).toBe(422); expect(dm.body.code).toBe("CONSENT_MISSING");
  });
});

describe("kontrol (follow-up) ve PİA Hazır", () => {
  it("hekim kontrol ister → sekretere görev; randevu verilince bağlanır ve görev kapanır", async () => {
    const pid = await newPatient("Gaye");
    expect((await sec.post("/follow-ups", { patientId: pid, dueDate: day(7), reason: "Kontrol" })).status).toBe(403);
    expect((await dentist.post("/follow-ups", { patientId: pid, dueDate: day(0), reason: "Kontrol" })).status).toBe(422);
    const f = (await dentist.post("/follow-ups", { patientId: pid, dueDate: day(7), reason: "Dolgu sonrası kontrol" }).expect(201)).body;
    await scan();
    const task = (await sec.get("/tasks").expect(200)).body.items.find((t: { kind: string; sourceId: string }) => t.kind === "follow_up" && t.sourceId === f.id);
    expect(task).toMatchObject({ assigneeRole: "secretary" });
    const a = (await sec.post("/appointments", { patientId: pid, practitionerId: pracId, date: day(7), startTime: "06:30", durationMinutes: 30, allowOutsideHours: true }).expect(201)).body;
    await scan();
    const list = (await sec.get(`/patients/${pid}/follow-ups`).expect(200)).body.items;
    expect(list[0]).toMatchObject({ status: "scheduled" });
    expect(list[0].appointmentAt).toBe(a.startsAt);
    const closed = (await sec.get("/tasks?status=closed").expect(200)).body.items.find((t: { id: string }) => t.id === task.id);
    expect(closed.closedReason).toBe("Kontrol randevusu verildi");
  });

  it("yarınki randevuda eksik anamnez/belge görünür ve görev açar; belge kabulü ve hekim istisnasıyla kapanır", async () => {
    // ADR-100: anamnez kuralı seed'de pasif; kural motorunun anamnez kalemini sınamak için bu senaryoda etkinleştirilir (afterAll'dan önce geri alınır).
    await ownerQuery(tenantA, "update readiness_rules set active = true where kind = 'anamnesis_reviewed'");
    onTestFinished(async () => { await ownerQuery(tenantA, "update readiness_rules set active = false where kind = 'anamnesis_reviewed'"); });
    const pid = await newPatient("Hande");
    const procs = (await dentist.get("/procedures").expect(200)).body.items;
    const kan = procs.find((p: { code: string }) => p.code === "KAN-01");
    const plan = (await dentist.post(`/patients/${pid}/plans`, { title: "Hazırlık testi", practitionerId: pracId }).expect(201)).body;
    await dentist.post(`/plan-versions/${plan.versionId}/items`, { procedureId: kan.id, location: { kind: "tooth", tooth: "16" }, quantity: 1 }).expect(201);
    await dentist.post(`/plan-versions/${plan.versionId}/propose`, {}).expect(200);
    await sec.post(`/plan-versions/${plan.versionId}/decision`, { decision: "accepted" }).expect(200);
    const a = (await sec.post("/appointments", { patientId: pid, practitionerId: pracId, date: day(1), startTime: "06:00", durationMinutes: 30, allowOutsideHours: true }).expect(201)).body;
    let r = (await sec.get(`/appointments/${a.id}/readiness`).expect(200)).body;
    expect(r.ready).toBe(false);
    expect(r.items.map((i: { key: string; status: string }) => [i.key.split(":")[0], i.status])).toEqual([["anamnesis", "missing"], ["document", "missing"]]);
    await scan();
    const task = (await sec.get("/tasks").expect(200)).body.items.find((t: { kind: string; sourceId: string }) => t.kind === "readiness_missing" && t.sourceId === a.id);
    expect(task.reason).toMatch(/Kanal tedavisi bilgilendirme/);

    const v = (await approvedVersion("ENDO-ONAM")).versionId!;
    const d = (await sec.post("/documents", { patientId: pid, templateVersionId: v, planVersionId: plan.versionId }).expect(201)).body;
    expect((await sec.get(`/documents/${d.id}`).expect(200)).body.content).toMatch(/KAN-01/);
    r = (await sec.get(`/appointments/${a.id}/readiness`).expect(200)).body;
    expect(r.items.find((i: { key: string }) => i.key.startsWith("document")).detail).toMatch(/kararı kaydedilmedi/);
    await sec.post(`/documents/${d.id}/decision`, { decision: "accepted", method: "wet_signature_on_paper", attestation: true }).expect(200);
    expect((await sec.post(`/appointments/${a.id}/readiness-exceptions`, { itemKey: "anamnesis", reason: "Hekim telefonda değerlendirdi" })).status).toBe(403);
    await dentist.post(`/appointments/${a.id}/readiness-exceptions`, { itemKey: "anamnesis", reason: "Acil başvuru; anamnez ziyarette alınacak" }).expect(201);
    r = (await sec.get(`/appointments/${a.id}/readiness`).expect(200)).body;
    expect(r.ready).toBe(true);
    expect(r.items.map((i: { status: string }) => i.status)).toEqual(["excepted", "ok"]);
    await scan();
    const closed = (await sec.get("/tasks?status=closed").expect(200)).body.items.find((t: { id: string }) => t.id === task.id);
    expect(closed.closedReason).toMatch(/Hazırlık tamamlandı|istisna/);
  });
});

describe("tenant izolasyonu (Görev 4)", () => {
  it("B kliniği A'nın belgesine, dosyasına, iletişimine, kontrolüne, hazırlığına erişemez", async () => {
    const pid = await newPatient("Irmak");
    const v = (await approvedVersion("GENEL-ONAM")).versionId!;
    const d = (await sec.post("/documents", { patientId: pid, templateVersionId: v }).expect(201)).body;
    const fid = await uploadFile(sec, pid, PNG);
    await put(sec, fid, PNG).expect(200);
    await worker();
    const appt = (await sec.post("/appointments", { patientId: pid, practitionerId: pracId, date: day(2), startTime: "06:00", durationMinutes: 30, allowOutsideHours: true }).expect(201)).body;
    for (const path of [`/documents/${d.id}`, `/patients/${pid}/documents`, `/files/${fid}`, `/patients/${pid}/files`, `/patients/${pid}/communication`,
      `/patients/${pid}/follow-ups`, `/appointments/${appt.id}/readiness`]) {
      expect([path, (await bDentist.get(path)).status]).toEqual([path, 404]);
    }
    expect((await download(bDentist, fid)).status).toBe(404);
    expect((await bDentist.post(`/documents/${d.id}/decision`, { decision: "declined" })).status).toBe(404);
    expect((await bDentist.post("/documents", { patientId: pid, templateVersionId: v })).status).toBe(422);
    expect((await bDentist.post(`/files/${fid}/delete`, { reason: "deneme" })).status).toBe(404);
  });
});

describe("dayanıklılık", () => {
  it("DB boştaki bağlantıları kapatınca (yeniden başlatma/failover) API çökmez ve sonraki istek çalışır", async () => {
    const pool = app.get(Db).pool;
    await Promise.all([pool.query("select 1"), pool.query("select 1"), pool.query("select 1")]);
    expect(pool.idleCount).toBeGreaterThan(0);
    // QA-007: yalnız bu test veritabanının bağlantıları; aynı kümedeki başka ortam (canlı demo API) etkilenmez.
    const killed = await adminQuery("select count(pg_terminate_backend(pid))::int as n from pg_stat_activity where application_name = 'viadent-api' and state = 'idle' and datname = current_database()");
    expect(killed[0].n).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    expect((await sec.get("/patients?q=a")).status).toBe(200);
  });

  it("QA-006: eşzamanlı trafik sürerken idle ve aktif bağlantılar kesilince süreç yaşar, istekler 200/5xx döner, sonrası 200", async () => {
    // Havuzdan alınmış (checked-out) ama o an sorgu çalıştırmayan pg istemcisine 57P01 gelirse dinleyicisiz 'error' → uncaughtException.
    // Süreç düzeyinde yakalayıp sayıyoruz: eski kodda bu sayaç > 0 (vitest koşucusu da "Unhandled error" raporlar).
    const uncaught: string[] = [];
    const onUncaught = (e: unknown) => { uncaught.push(String((e as Error)?.message ?? e).slice(0, 120)); };
    process.on("uncaughtException", onUncaught);
    try {
      const N = 24;
      const inflight = Array.from({ length: N }, () => sec.get("/patients?q=a").then((r) => r.status, () => -1));
      // İstekler başlasın (bağlantılar alınıp sorgular/transaction adımları sürerken) ve 3 dalga hâlinde hem idle hem aktif bağlantı kesilsin.
      let killed = 0;
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 25));
        const k = await adminQuery("select count(pg_terminate_backend(pid))::int as n from pg_stat_activity where application_name = 'viadent-api' and datname = current_database()");
        killed += k[0].n;
      }
      expect(killed).toBeGreaterThan(0);
      const statuses = await Promise.all(inflight);
      // Sahte başarı yok: her istek ya gerçek 200 ya da 5xx; yanıtsız kalan (-1) istek olmaz.
      expect(statuses.filter((s) => s !== 200 && !(s >= 500 && s < 600))).toEqual([]);
      expect(uncaught).toEqual([]);
      await new Promise((r) => setTimeout(r, 300));
      expect((await sec.get("/patients?q=a")).status).toBe(200);
      expect((await request(app.getHttpServer()).get("/api/v1/health/ready")).status).toBe(200);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  }, 60_000);
});
