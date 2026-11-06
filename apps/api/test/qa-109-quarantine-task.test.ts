/**
 * QA-109 (S3) — Gizli dosyanın karantina görevi (ADR-091; görünürlük kuralı ADR-089 `nonClinicalFileSql`).
 * Gizli dosya = klinik hassasiyetli (ör. `clinical_document`) veya klinik çıktı belgesine bağlı dosya. Böyle bir dosya karantinaya
 * düşünce açılan `file_quarantined` görevi:
 *  1. `sensitivity = 'clinical'`: `patient.health.read` olmayan rol (sekreter, yönetici) `GET /tasks` (açık/kapalı, hasta süzgeci)
 *     yanıtında görmez; `POST /tasks/:id/status` var olmayan görevle aynı yanıtı verir ve görev değişmez; hasta kartı
 *     `openTaskCount` sayacı da görmediği görevi saymaz.
 *  2. Atanan rol `dentist` (sağlık yetkili + `file.delete`): hekim görevi görür (`mine`), dosya ayrıntısını açar, dosyayı gerekçeyle
 *     silince görev kendiliğinden kapanır ya da görevi doğrudan kapatır.
 *  3. SLA yükseltmesi (ADR-087) görevi kopyalamaz; hassasiyet korunur, yönetici kuyruğuna gizli görev düşmez.
 *  4. İdari dosyanın karantina görevi değişmez (`general`, `clinic_admin`; yönetici ve sekreter görür, yönetici dosyayı açar).
 *  5. Migration 0030 eski biçimdeki (`general`/`clinic_admin`) gizli dosya görevlerini sınıflandırır; idari görev değişmez; tekrar güvenli.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import pg from "pg";
import { BasicScanner, LocalDiskStorage } from "@viadent/db";
import { setStorageForTests } from "../src/documents/files.controller.js";
import { processOutbox, type WorkerDeps } from "../../worker/src/jobs.js";
import { WORKER_URL } from "./env.js";
import { EMAILS, login, ownerQuery, startApp, useLegacyAdmin, type Client } from "./helpers.js";

let app: INestApplication;
let dentist: Client, sec: Client, admin: Client;
let tenantA: string;
let patientId: string;
/** Gizli: hekimin klinik belgesi (silinerek çözülür), epikrize bağlı tarama (görev kapatılarak çözülür), eski kayıt sınaması. */
let clinicalQ: string, linkedQ: string, legacyQ: string;
/** İdari: sekreterin yüklediği tarama (bugünkü davranış). */
let adminQ: string;
const taskOf: Record<string, string> = {};

const dir = mkdtempSync(join(tmpdir(), "viadent-qa109-"));
const storage = new LocalDiskStorage(dir);
const deps: WorkerDeps = { storage, scanner: new BasicScanner() };
const tag = Math.random().toString(36).slice(2, 8);
/** Zararsız sentetik PDF; yalnız `/JavaScript` anahtar sözcüğü temel tarayıcının karantina kuralını tetikler. Her dosya farklı bayt. */
const pdfJs = (s: string) => Buffer.from(`%PDF-1.4\n% sentetik-qa109-${tag}-${s}\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF\n`);
type Task = { id: string; kind: string; sensitivity: string; sourceId: string | null; patientId: string | null; assigneeRole: string | null; mine: boolean; status: string };

async function worker() {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
  try { while ((await processOutbox(pool, 50, deps)) > 0) { /* tarama kuyruğunu boşalt */ } } finally { await pool.end(); }
}
const put = (c: Client, fid: string, data: Buffer) =>
  request(app.getHttpServer()).put(`/api/v1/files/${fid}/content`).set("cookie", c.cookie).set("x-viadent-request", "1").set("x-viadent-context", c.context)
    .set("content-type", "application/octet-stream").send(data);
async function upload(c: Client, category: string, name: string, patientDocumentId?: string) {
  const data = pdfJs(name);
  const fid = (await c.post("/files", { patientId, category, originalName: name, contentType: "application/pdf", size: data.length, ...(patientDocumentId ? { patientDocumentId } : {}) }).expect(201)).body.id as string;
  await put(c, fid, data).expect(200);
  return fid;
}
const norm = (r: request.Response) => ({ status: r.status, code: r.body?.code, message: r.body?.message, field_errors: r.body?.field_errors, details: r.body?.details });
const tasks = async (c: Client, q = "") => (await c.get(`/tasks${q}`).expect(200));
const allTaskTexts = async (c: Client) => [await tasks(c), await tasks(c, "?status=closed"), await tasks(c, `?patientId=${patientId}`), await tasks(c, `?status=closed&patientId=${patientId}`)].map((r) => r.text);
const hiddenFiles = () => [clinicalQ, linkedQ, legacyQ];
const hiddenTasks = () => hiddenFiles().map((f) => taskOf[f]!);
const taskRow = async (id: string) => (await ownerQuery(tenantA, "select status, sensitivity, assignee_role, escalated_to_role, closed_reason, updated_at from tasks where id = $1", [id]))[0]!;
/** Görünmemesi gereken: gizli dosya kimliği ve gizli görev kimliği. */
const leaks = (text: string) => [...hiddenFiles(), ...hiddenTasks()].filter((s) => text.includes(s));

beforeAll(async () => {
  setStorageForTests(storage);
  app = await startApp();
  // ADR-098: yönetici artık her şeyi görür; bu dosya sağlık yetkisiz rolün süzgecini sınadığından eski yönetici kümesi kullanılır.
  await useLegacyAdmin(app);
  [dentist, sec, admin] = await Promise.all([login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  patientId = (await sec.post("/patients", { firstName: "Karantina", lastName: `QA109 Sentetik ${tag}`, birthDate: "1981-04-04" }).expect(201)).body.patient.id;
  const epi = (await dentist.get("/document-types").expect(200)).body.items.find((t: { code: string }) => t.code === "EPIKRIZ");
  expect(epi.category).toBe("clinical_output");
  const epikriz = (await dentist.post("/documents", { patientId, templateVersionId: epi.approvedTemplates[0].versionId }).expect(201)).body.id as string;

  clinicalQ = await upload(dentist, "clinical_document", `dis-rapor-QA109-${tag}.pdf`);
  linkedQ = await upload(dentist, "document_scan", `epikriz-tarama-QA109-${tag}.pdf`, epikriz);
  legacyQ = await upload(dentist, "clinical_document", `eski-kayit-QA109-${tag}.pdf`);
  adminQ = await upload(sec, "document_scan", `idari-tarama-QA109-${tag}.pdf`);
  await worker();
  const files = await ownerQuery(tenantA, "select id, status, sensitivity from file_assets where id = any($1::uuid[])", [[...hiddenFiles(), adminQ]]);
  expect(files.every((f) => f.status === "quarantined")).toBe(true);
  expect(files.find((f) => f.id === adminQ)!.sensitivity).toBe("administrative");
  const rows = await ownerQuery(tenantA, "select id, source_id from tasks where kind = 'file_quarantined' and source_id = any($1::uuid[])", [[...hiddenFiles(), adminQ]]);
  for (const r of rows) taskOf[r.source_id] = r.id;
  expect(Object.keys(taskOf).sort()).toEqual([...hiddenFiles(), adminQ].sort());
});
afterAll(async () => { await app.close(); });

describe("QA-109: gizli dosyanın karantina görevi sağlık yetkisi olmayana görünmez", () => {
  it("sekreter ve yönetici: GET /tasks (açık/kapalı, hasta süzgeci) gizli dosyanın görevini ve dosya kimliğini içermez", async () => {
    for (const c of [sec, admin]) {
      for (const text of await allTaskTexts(c)) expect(leaks(text)).toEqual([]);
      const items = (await tasks(c, `?patientId=${patientId}`)).body.items as Task[];
      expect(items.filter((t) => t.kind === "file_quarantined").map((t) => t.sourceId)).toEqual([adminQ]);
    }
  });

  it("sekreter ve yönetici: POST /tasks/:id/status gizli görevde var olmayan görevle aynı yanıt; görev değişmez", async () => {
    for (const c of [sec, admin]) {
      for (const body of [{ status: "done" }, { status: "in_progress" }, { status: "cancelled", closedReason: "Sınama" }]) {
        const missing = norm(await c.post(`/tasks/${randomUUID()}/status`, body));
        expect(missing.status).toBe(404);
        for (const id of hiddenTasks()) {
          const before = await taskRow(id);
          expect(norm(await c.post(`/tasks/${id}/status`, body))).toEqual(missing);
          expect(await taskRow(id)).toEqual(before);
        }
      }
    }
  });

  it("hasta kartı openTaskCount sağlık yetkisizde gizli görevi saymaz; görev listesiyle tutarlı", async () => {
    const count = async (c: Client) => (await c.get(`/patients/${patientId}`).expect(200)).body.openTaskCount as number;
    const listed = async (c: Client) => ((await tasks(c, `?patientId=${patientId}`)).body.items as Task[]).length;
    for (const c of [sec, admin]) expect(await count(c)).toBe(await listed(c));
    expect(await count(dentist)).toBe(await listed(dentist));
    expect(await count(dentist)).toBe((await count(sec)) + hiddenTasks().length);
  });
});

describe("QA-109: görev dosyayı ele alabilecek role (hekim) yönlenir", () => {
  it("hekim gizli görevleri `clinical`, atanan `dentist`, `mine` ile görür ve dosya ayrıntısını açar", async () => {
    const items = (await tasks(dentist, `?patientId=${patientId}`)).body.items as Task[];
    for (const f of hiddenFiles()) {
      const t = items.find((x) => x.sourceId === f);
      expect(t).toMatchObject({ id: taskOf[f], kind: "file_quarantined", sensitivity: "clinical", assigneeRole: "dentist", mine: true, patientId });
      expect((await dentist.get(`/files/${f}`).expect(200)).body).toMatchObject({ id: f, status: "quarantined" });
    }
    // Yönetici ve sekreter aynı dosyada var olmayanla aynı yanıt (ADR-089; değişmedi).
    for (const c of [sec, admin]) expect(norm(await c.get(`/files/${clinicalQ}`))).toEqual(norm(await c.get(`/files/${randomUUID()}`)));
  });

  it("SLA yükseltmesi gizli görevi kopyalamaz; hassasiyet korunur, yönetici kuyruğuna düşmez", async () => {
    const id = taskOf[linkedQ]!;
    await ownerQuery(tenantA, "update tasks set due_at = now() - interval '72 hours' where id = $1", [id]);
    await dentist.post("/via-akis/refresh", {}).expect(200);
    expect(await taskRow(id)).toMatchObject({ status: "open", sensitivity: "clinical", assignee_role: "dentist", escalated_to_role: "clinic_admin" });
    expect((await ownerQuery(tenantA, "select count(*)::int as n from tasks where source_id = $1", [linkedQ]))[0]!.n).toBe(1);
    for (const c of [sec, admin]) for (const text of await allTaskTexts(c)) expect(leaks(text)).toEqual([]);
  });

  it("hekim dosyayı gerekçeyle siler → görev kendiliğinden kapanır; diğer gizli görevi doğrudan kapatır", async () => {
    await dentist.post(`/files/${clinicalQ}/delete`, { reason: "Zararlı içerik; kaynağı doğrulanamadı (sentetik QA-109)" }).expect(200);
    await dentist.post("/via-akis/refresh", {}).expect(200);
    expect(await taskRow(taskOf[clinicalQ]!)).toMatchObject({ status: "done", closed_reason: "Dosya gerekçeyle silindi", sensitivity: "clinical" });
    await dentist.post(`/tasks/${taskOf[linkedQ]}/status`, { status: "done", closedReason: "Yükleyen hekimle doğrulandı" }).expect(200);
    expect(await taskRow(taskOf[linkedQ]!)).toMatchObject({ status: "done", sensitivity: "clinical" });
    const closed = (await tasks(dentist, `?status=closed&patientId=${patientId}`)).body.items as Task[];
    expect(closed.map((t) => t.id)).toEqual(expect.arrayContaining([taskOf[clinicalQ], taskOf[linkedQ]]));
    // Kapanmış gizli görevler de sağlık yetkisize görünmez.
    for (const c of [sec, admin]) for (const text of await allTaskTexts(c)) expect(leaks(text)).toEqual([]);
  });

  it("gizli görevin `task.status` olayı sağlık yetkisizin geçmişinde, dışa aktarım access_log'unda ve LOG raporunda yok; idari görevinki var; hekim görür", async () => {
    await admin.post(`/tasks/${taskOf[adminQ]}/status`, { status: "in_progress" }).expect(200);
    const hist = async (c: Client) => (await c.get(`/patients/${patientId}/history`).expect(200));
    const taskEvents = (r: request.Response) => (r.body.items ?? r.body).filter((e: { entityType: string }) => e.entityType === "task").map((e: { entityId: string }) => e.entityId);
    const dHist = await hist(dentist);
    expect(taskEvents(dHist)).toEqual(expect.arrayContaining([taskOf[linkedQ], taskOf[adminQ]]));
    for (const c of [sec, admin]) {
      const h = await hist(c);
      expect(leaks(h.text)).toEqual([]);
      expect(taskEvents(h)).toEqual([taskOf[adminQ]]);
    }
    const exp = JSON.parse((await admin.post(`/patients/${patientId}/export`, { reason: "Veri sahibi talebi (sentetik QA-109)" }).expect(200)).text);
    expect(leaks(JSON.stringify(exp))).toEqual([]);
    expect((exp.sections.access_log as { entity_type: string }[]).filter((e) => e.entity_type === "task")).toHaveLength(1);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
    const rows = (await admin.get(`/reports/log?from=${day}&to=${day}&entityType=task`).expect(200)).body.rows as { entity: string }[];
    expect(rows.some((r) => r.entity === `Görev · ${taskOf[adminQ]!.slice(0, 8)}`)).toBe(true);
    for (const id of hiddenTasks()) expect(rows.some((r) => r.entity === `Görev · ${id.slice(0, 8)}`)).toBe(false);
  });
});

describe("QA-109: idari dosyanın karantina görevi değişmez", () => {
  it("`general` + `clinic_admin`; yönetici (mine) ve sekreter görür; yönetici dosyayı açar", async () => {
    const forAdmin = ((await tasks(admin, `?patientId=${patientId}`)).body.items as Task[]).find((t) => t.sourceId === adminQ);
    expect(forAdmin).toMatchObject({ id: taskOf[adminQ], kind: "file_quarantined", sensitivity: "general", assigneeRole: "clinic_admin", mine: true, patientId });
    const forSec = ((await tasks(sec, `?patientId=${patientId}`)).body.items as Task[]).find((t) => t.sourceId === adminQ);
    expect(forSec).toMatchObject({ id: taskOf[adminQ], sensitivity: "general", assigneeRole: "clinic_admin", mine: false });
    expect((await admin.get(`/files/${adminQ}`).expect(200)).body).toMatchObject({ id: adminQ, status: "quarantined" });
  });
});

describe("QA-109: migration 0030 eski görev kayıtlarını sınıflandırır", () => {
  it("eski biçimdeki gizli dosya görevi `clinical`/`dentist` olur (kapalıda atanan korunur); idari görev değişmez; tekrar güvenli", async () => {
    const name = readdirSync(join(__dirname, "../../../packages/db/migrations")).find((f) => /^0030_.*\.sql$/.test(f));
    expect(name, "packages/db/migrations/0030_*.sql olmalı").toBeTruthy();
    const sql = readFileSync(join(__dirname, "../../../packages/db/migrations", name!), "utf8");
    // 0030 öncesi worker'ın yazdığı biçim: açık gizli görev + kapanmış gizli görev.
    await ownerQuery(tenantA, "update tasks set sensitivity = 'general', assignee_role = 'clinic_admin' where id = any($1::uuid[])", [[taskOf[legacyQ], taskOf[clinicalQ]]]);
    expect(((await tasks(sec, `?patientId=${patientId}`)).body.items as Task[]).some((t) => t.sourceId === legacyQ)).toBe(true); // eski biçim sızıyordu
    const adminBefore = await taskRow(taskOf[adminQ]!);
    await ownerQuery(null, sql);
    expect(await taskRow(taskOf[legacyQ]!)).toMatchObject({ status: "open", sensitivity: "clinical", assignee_role: "dentist" });
    expect(await taskRow(taskOf[clinicalQ]!)).toMatchObject({ status: "done", sensitivity: "clinical", assignee_role: "clinic_admin" });
    expect(await taskRow(taskOf[adminQ]!)).toEqual(adminBefore);
    const after = await Promise.all(hiddenTasks().map(taskRow));
    await ownerQuery(null, sql);
    expect(await Promise.all(hiddenTasks().map(taskRow))).toEqual(after);
    for (const c of [sec, admin]) for (const text of await allTaskTexts(c)) expect(leaks(text)).toEqual([]);
  });
});
