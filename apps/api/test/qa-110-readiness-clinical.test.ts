/**
 * QA-110 (S3) — PİA Hazır kuralı klinik çıktı belge türüne bağlanamaz (ADR-092; klinik çıktı ADR-085).
 * Klinik çıktı belgesi (`document_types.category = 'clinical_output'`: EPIKRIZ, HASTA-FOYU, RECETE) hekimin işlem sonrası ürettiği
 * sağlık verisidir; ziyaret öncesi idari hazırlık önkoşulu olamaz. Böyle bir kural sekretere "Belge hazırlanmamış → Hazır" geçişiyle
 * belgenin varlığını açık ediyordu.
 *  1. `POST /readiness-rules` klinik çıktı türünü 422 (`documentTypeId`) ile reddeder; satır ve denetim kaydı yazılmaz.
 *     `POST /readiness-rules/:id/active` böyle bir kuralı etkinleştirmeyi 422 ile reddeder (pasifleştirme serbest).
 *  2. Değerlendirme (`readinessFor`) etkin kalmış eski kuralları yok sayar: `GET /appointments/:id/readiness` hiçbir rolde
 *     (sekreter, yönetici, hekim) klinik çıktı kalemi göstermez, `ready` yalnız kalan kalemlerden hesaplanır; hekim epikriz düzenleyince
 *     sekreterin yanıtı bayt bayt aynı kalır. `readiness_missing` görevi (Bugün/PİA Akış) bu kalemi içermez; kalem için istisna
 *     var olmayan kalemle aynı 409'u alır.
 *  3. Onam kuralları (seed KAN-01 → ENDO-ONAM) ve anamnez kuralı bugünkü davranışı korur; onam türüyle yeni kural 201.
 *  4. Migration 0031: etkin klinik çıktı kurallarını pasifleştirir; adında klinik çıktı türü geçen eski `readiness_missing` görevlerini
 *     `clinical` yapar (açıksa kapatır, PİA Akış temiz görevi yeniden açar); diğer görev ve kurallar değişmez; tekrar güvenli.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type request from "supertest";
import pg from "pg";
import { scanAllTenants } from "../../worker/src/jobs.js";
import { WORKER_URL } from "./env.js";
import { EMAILS, login, ownerQuery, startApp, tomorrowIstanbul, useLegacyAdmin, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, dentist: Client, sec: Client;
let tenantA: string, pracId: string;
type DocType = { id: string; code: string; name: string; category: string; approvedTemplates: { versionId: string }[] };
let types: DocType[];
let epi: DocType, kanId: string, patientId: string, apptId: string, planVersionId: string;
/** Testin doğrudan eklediği (0031 öncesi biçim) kurallar ve görevler; afterAll siler. */
const legacyRules: string[] = [];
const legacyTasks: string[] = [];
const tag = Math.random().toString(36).slice(2, 8);
type Item = { key: string; label: string; status: string; detail: string };

async function scan() {
  const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
  try { await scanAllTenants(pool, new Date()); } finally { await pool.end(); }
}
const norm = (r: request.Response) => ({ status: r.status, code: r.body?.code, message: r.body?.message, field_errors: r.body?.field_errors });
const readiness = async (c: Client, id = apptId) => (await c.get(`/appointments/${id}/readiness`).expect(200));
const clinicalTypes = () => types.filter((t) => t.category === "clinical_output");
/** Yanıt metninde klinik çıktı izi: tür kimliği veya adı. */
const clinicalLeaks = (text: string) => clinicalTypes().flatMap((t) => [t.id, t.name]).filter((s) => text.includes(s) || text.includes(JSON.stringify(s).slice(1, -1)));
const tasksText = async (c: Client) => [(await c.get("/tasks").expect(200)).text, (await c.get("/tasks?status=closed").expect(200)).text,
  (await c.get(`/tasks?patientId=${patientId}`).expect(200)).text, (await c.get(`/tasks?status=closed&patientId=${patientId}`).expect(200)).text];
async function insertLegacyRule(docTypeId: string, procedureId = kanId) {
  const id = (await ownerQuery(tenantA, "insert into readiness_rules(tenant_id, kind, procedure_id, document_type_id, created_by) values ($1,'document_for_procedure',$2,$3,$4) returning id",
    [tenantA, procedureId, docTypeId, (await ownerQuery(tenantA, "select created_by from readiness_rules order by created_at limit 1"))[0].created_by]))[0].id as string;
  legacyRules.push(id);
  return id;
}

beforeAll(async () => {
  app = await startApp();
  // ADR-098: yönetici artık klinik içeriği görür; sızıntı süzgeci sağlık yetkisiz yönetici kümesiyle sınanır.
  await useLegacyAdmin(app);
  [admin, dentist, sec] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary)]);
  tenantA = admin.session.activeMembership.tenantId;
  pracId = (await sec.get("/resources").expect(200)).body.practitioners[0].id;
  types = (await dentist.get("/document-types").expect(200)).body.items;
  epi = types.find((t) => t.code === "EPIKRIZ")!;
  expect(epi.category).toBe("clinical_output");
  expect(clinicalTypes().map((t) => t.code).sort()).toEqual(["EPIKRIZ", "HASTA-FOYU", "RECETE"]);
  kanId = (await dentist.get("/procedures").expect(200)).body.items.find((p: { code: string }) => p.code === "KAN-01").id;

  patientId = (await sec.post("/patients", { firstName: "Hazırlık", lastName: `QA110 Sentetik ${tag}`, birthDate: "1979-05-05" }).expect(201)).body.patient.id;
  const plan = (await dentist.post(`/patients/${patientId}/plans`, { title: "QA-110 hazırlık", practitionerId: pracId }).expect(201)).body;
  planVersionId = plan.versionId;
  await dentist.post(`/plan-versions/${plan.versionId}/items`, { procedureId: kanId, location: { kind: "tooth", tooth: "26" }, quantity: 1 }).expect(201);
  await dentist.post(`/plan-versions/${plan.versionId}/propose`, {}).expect(200);
  await sec.post(`/plan-versions/${plan.versionId}/decision`, { decision: "accepted" }).expect(200);
  apptId = (await sec.post("/appointments", { patientId, practitionerId: pracId, date: tomorrowIstanbul(1), startTime: "22:10", durationMinutes: 30, allowOutsideHours: true }).expect(201)).body.id;
});

afterAll(async () => {
  if (legacyTasks.length) await ownerQuery(tenantA, "delete from tasks where id = any($1::uuid[])", [legacyTasks]);
  if (legacyRules.length) await ownerQuery(tenantA, "delete from readiness_rules where id = any($1::uuid[])", [legacyRules]);
  await app.close();
});

describe("QA-110: kural tanımı klinik çıktı türünü reddeder", () => {
  it("POST /readiness-rules klinik çıktı türüyle 422 (documentTypeId); kural ve denetim yazılmaz", async () => {
    for (const t of clinicalTypes()) {
      const rules = await ownerQuery(tenantA, "select count(*)::int as n from readiness_rules where document_type_id = $1", [t.id]);
      const audits = await ownerQuery(tenantA, "select count(*)::int as n from audit_events where action = 'readiness_rule.create'");
      const r = await admin.post("/readiness-rules", { kind: "document_for_procedure", procedureId: kanId, documentTypeId: t.id });
      expect([t.code, r.status, r.body.code]).toEqual([t.code, 422, "VALIDATION_FAILED"]);
      expect(r.body.field_errors?.documentTypeId, t.code).toMatch(/klinik çıktı/i);
      expect(await ownerQuery(tenantA, "select count(*)::int as n from readiness_rules where document_type_id = $1", [t.id])).toEqual(rules);
      expect(await ownerQuery(tenantA, "select count(*)::int as n from audit_events where action = 'readiness_rule.create'")).toEqual(audits);
    }
  });

  it("onam türüyle kural bugünkü gibi 201; var olmayan tür 422 (değişmedi)", async () => {
    const onam = types.find((t) => t.code === "GENEL-ONAM")!;
    const r = (await admin.post("/readiness-rules", { kind: "document_for_procedure", procedureId: kanId, documentTypeId: onam.id }).expect(201)).body;
    legacyRules.push(r.id); // diğer testleri etkilemesin diye hemen kaldırılır
    await ownerQuery(tenantA, "delete from readiness_rules where id = $1", [r.id]);
    const x = await admin.post("/readiness-rules", { kind: "document_for_procedure", procedureId: kanId, documentTypeId: randomUUID() });
    expect([x.status, x.body.field_errors?.documentTypeId]).toEqual([422, "Belge türü bulunamadı."]);
  });
});

describe("QA-110: etkin kalmış eski kural değerlendirmede yok sayılır", () => {
  it("sekreter/yönetici/hekim hazırlıkta klinik çıktı kalemi görmez; onam + anamnez kalemleri aynı; ready tutarlı", async () => {
    await insertLegacyRule(epi.id); // 0031 öncesi API'nin kabul ettiği biçim
    for (const c of [sec, admin, dentist]) {
      const r = await readiness(c);
      expect(clinicalLeaks(r.text)).toEqual([]);
      expect(r.body.items.map((i: Item) => [i.key.split(":")[0], i.status])).toEqual([["anamnesis", "missing"], ["document", "missing"]]);
      expect(r.body.items[1].label).toMatch(/Kanal tedavisi bilgilendirme.*\(KAN-01\)/);
      expect(r.body.ready).toBe(false);
    }
  });

  it("PİA Akış readiness_missing görevi klinik çıktı kalemini içermez (Bugün ekranı aynı kaynaktan)", async () => {
    await scan();
    const t = (await sec.get(`/tasks?patientId=${patientId}`).expect(200)).body.items.find((x: { kind: string; sourceId: string }) => x.kind === "readiness_missing" && x.sourceId === apptId);
    expect(t).toBeTruthy();
    expect(t.reason).toMatch(/Kanal tedavisi bilgilendirme/);
    for (const c of [sec, admin]) for (const text of await tasksText(c)) expect(clinicalLeaks(text)).toEqual([]);
  });

  it("klinik çıktı kalemi için istisna var olmayan kalemle aynı 409", async () => {
    const real = await dentist.post(`/appointments/${apptId}/readiness-exceptions`, { itemKey: `document:${epi.id}`, reason: "Sentetik istisna denemesi" });
    const none = await dentist.post(`/appointments/${apptId}/readiness-exceptions`, { itemKey: `document:${randomUUID()}`, reason: "Sentetik istisna denemesi" });
    expect(norm(real)).toEqual(norm(none));
    expect(real.status).toBe(409);
    expect(await ownerQuery(tenantA, "select count(*)::int as n from readiness_exceptions where appointment_id = $1 and item_key = $2", [apptId, `document:${epi.id}`])).toEqual([{ n: 0 }]);
  });

  it("onam kabulü + hekim istisnasıyla ready=true (epikriz yokken); hekim epikriz düzenleyince sekreter yanıtı aynı", async () => {
    const onam = types.find((t) => t.code === "ENDO-ONAM")!;
    const d = (await sec.post("/documents", { patientId, templateVersionId: onam.approvedTemplates[0]!.versionId, planVersionId }).expect(201)).body;
    await sec.post(`/documents/${d.id}/decision`, { decision: "accepted", method: "wet_signature_on_paper", attestation: true }).expect(200);
    await dentist.post(`/appointments/${apptId}/readiness-exceptions`, { itemKey: "anamnesis", reason: "Sentetik: anamnez ziyarette alınacak" }).expect(201);
    const before = await readiness(sec);
    expect(before.body.ready).toBe(true);
    expect(before.body.items.map((i: Item) => i.status)).toEqual(["excepted", "ok"]);
    await dentist.post("/documents", { patientId, templateVersionId: epi.approvedTemplates[0]!.versionId }).expect(201);
    for (const c of [sec, admin]) expect((await readiness(c)).text).toBe(before.text);
    expect((await readiness(dentist)).body.items.map((i: Item) => i.status)).toEqual(["excepted", "ok"]);
    await scan();
    const closed = (await sec.get(`/tasks?status=closed&patientId=${patientId}`).expect(200)).body.items.find((x: { kind: string; sourceId: string }) => x.kind === "readiness_missing" && x.sourceId === apptId);
    expect(closed?.closedReason).toMatch(/Hazırlık tamamlandı|istisna/);
  });

  it("eski klinik çıktı kuralı etkinleştirilemez (422); pasifleştirme serbest", async () => {
    const rid = await insertLegacyRule(types.find((t) => t.code === "HASTA-FOYU")!.id);
    await admin.post(`/readiness-rules/${rid}/active`, { active: false }).expect(200);
    const r = await admin.post(`/readiness-rules/${rid}/active`, { active: true });
    expect([r.status, r.body.code]).toEqual([422, "VALIDATION_FAILED"]);
    expect(await ownerQuery(tenantA, "select active from readiness_rules where id = $1", [rid])).toEqual([{ active: false }]);
    // Onam kuralı (seed) aç/kapa bugünkü gibi.
    const seedRule = (await ownerQuery(tenantA, "select r.id from readiness_rules r join document_types dt on dt.id = r.document_type_id where dt.code = 'ENDO-ONAM' and r.active limit 1"))[0].id;
    await admin.post(`/readiness-rules/${seedRule}/active`, { active: false }).expect(200);
    await admin.post(`/readiness-rules/${seedRule}/active`, { active: true }).expect(200);
  });
});

describe("QA-110: migration 0031 eski kural ve görev kayıtlarını düzeltir", () => {
  it("etkin klinik çıktı kuralı pasif; eski readiness_missing görevi clinical (açıksa kapanır); diğerleri aynı; tekrar güvenli", async () => {
    const name = readdirSync(join(__dirname, "../../../packages/db/migrations")).find((f) => /^0031_.*\.sql$/.test(f));
    expect(name, "packages/db/migrations/0031_*.sql olmalı").toBeTruthy();
    const sql = readFileSync(join(__dirname, "../../../packages/db/migrations", name!), "utf8");

    const recete = types.find((t) => t.code === "RECETE")!;
    const activeLegacy = await insertLegacyRule(recete.id);
    const other = (await sec.post("/patients", { firstName: "Hazırlık", lastName: `QA110 Eski ${tag}`, birthDate: "1979-06-06" }).expect(201)).body.patient.id;
    const appt2 = (await sec.post("/appointments", { patientId: other, practitionerId: pracId, date: tomorrowIstanbul(1), startTime: "22:50", durationMinutes: 30, allowOutsideHours: true }).expect(201)).body.id;
    // 0031 öncesi PİA Akış'ın yazdığı biçim: etiketinde klinik çıktı türü adı geçen görev (açık + kapalı) ve normal bir görev.
    const ins = async (status: string, reason: string, key: string) => {
      const id = (await ownerQuery(tenantA,
        `insert into tasks(tenant_id, kind, source_type, source_id, patient_id, dedupe_key, title, reason, next_step, assignee_role, due_at, status, closed_at, closed_reason)
         values ($1,'readiness_missing','appointment',$2,$3,$4,'Ziyaret hazırlığı eksik',$5,'Eksik belgeyi hazırlayın.','secretary', now() + interval '1 day', $6,
                 case when $6 = 'done' then now() end, case when $6 = 'done' then 'Hazırlık tamamlandı veya istisna kaydedildi' end) returning id`,
        [tenantA, appt2, other, key, reason, status]))[0].id as string;
      legacyTasks.push(id);
      return id;
    };
    const openLeak = await ins("open", `Yarınki randevu için eksik: Güncel ve hekimce onaylı anamnez; ${epi.name} (KAN-01)`, `readiness_missing:${appt2}`);
    const closedLeak = await ins("done", `Yarınki randevu için eksik: ${recete.name} (KAN-01)`, `readiness_missing:${appt2}:eski`);
    const normal = await ins("done", "Yarınki randevu için eksik: Kanal tedavisi bilgilendirme ve onam (KAN-01)", `readiness_missing:${appt2}:normal`);
    expect((await sec.get("/tasks").expect(200)).text).toContain(epi.name); // eski biçim sızıyordu

    const row = async (id: string) => (await ownerQuery(tenantA, "select status, sensitivity, assignee_role, closed_reason, closed_at, updated_at from tasks where id = $1", [id]))[0];
    const rulesBefore = await ownerQuery(tenantA,
      "select r.id, r.active from readiness_rules r left join document_types dt on dt.id = r.document_type_id where dt.category is distinct from 'clinical_output' order by r.id");
    const normalBefore = await row(normal);
    await ownerQuery(null, sql);

    expect(await ownerQuery(tenantA, "select active from readiness_rules where id = $1", [activeLegacy])).toEqual([{ active: false }]);
    expect(await ownerQuery(tenantA,
      "select count(*)::int as n from readiness_rules r join document_types dt on dt.id = r.document_type_id where dt.category = 'clinical_output' and r.active")).toEqual([{ n: 0 }]);
    expect(await ownerQuery(tenantA,
      "select r.id, r.active from readiness_rules r left join document_types dt on dt.id = r.document_type_id where dt.category is distinct from 'clinical_output' order by r.id")).toEqual(rulesBefore);
    expect(await row(openLeak)).toMatchObject({ status: "done", sensitivity: "clinical" });
    expect((await row(openLeak)).closed_reason).toMatch(/Hazırlık kuralları güncellendi/);
    expect(await row(closedLeak)).toMatchObject({ status: "done", sensitivity: "clinical", closed_reason: "Hazırlık tamamlandı veya istisna kaydedildi" });
    expect(await row(normal)).toEqual(normalBefore);

    const after = await Promise.all([openLeak, closedLeak, normal].map(row));
    await ownerQuery(null, sql);
    expect(await Promise.all([openLeak, closedLeak, normal].map(row))).toEqual(after);
    for (const c of [sec, admin]) for (const text of await tasksText(c)) expect(clinicalLeaks(text)).toEqual([]);
    expect((await dentist.get("/tasks?status=closed").expect(200)).body.items.some((t: { id: string }) => t.id === openLeak)).toBe(true);

    // PİA Akış kapanan eski görevin yerine temiz görev açar (yalnız anamnez eksik; klinik çıktı kalemi yok).
    await scan();
    const fresh = (await sec.get(`/tasks?patientId=${other}`).expect(200)).body.items.filter((t: { kind: string; sourceId: string }) => t.kind === "readiness_missing" && t.sourceId === appt2);
    expect(fresh).toHaveLength(1);
    legacyTasks.push(fresh[0].id);
    expect(fresh[0].reason).toBe("Yarınki randevu için eksik: Güncel ve hekimce onaylı anamnez");
  });
});
