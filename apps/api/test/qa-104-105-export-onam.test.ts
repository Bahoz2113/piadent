/**
 * QA-104 (S1) — KVKK hasta dışa aktarımı (`POST /patients/:id/export`): `patient.health.read` olmayan dışa aktaranda klinik çıktı
 * belgeleri (ADR-085, `document_types.category = 'clinical_output'`) ve bunlara bağlı `consent_requests`, `evidence_events`,
 * `files` (file_assets.patient_document_id) satırları yer almaz; `omitted` ve not bunu açıkça belirtir; counts/checksums kalan
 * içerikle tutarlıdır; denetim kaydı (`patient.export`) dışlananları içerir. Sağlık yetkili dışa aktaranda tüm belgeler kalır.
 *
 * QA-105 (S2) — Onam/belge raporu (`GET /reports/onam`, CSV/XLSX): sağlık yetkisi olmayan rolde klinik çıktı belgeleri satırlarda
 * ve toplamlarda yer almaz. ADR-088: sağlık yetkili rolde (raporu çalıştırma yetkisi de varsa) klinik çıktılar listelenir.
 *
 * Varsayılan rol matrisinde `export.patient` ve `report.operations` yetkisi olan hiçbir rolde `patient.health.read` yoktur
 * (hekim: ikisi de yok → 403). Sağlık yetkili davranış, test içinde yalnız ilgili üyeliğin bağlamına `patient.health.read`
 * eklenerek sınanır (ürün kodu değişmez; `AuthService.buildContext` sarmalanır ve geri alınır).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { dayRangeUtc } from "@viadent/contracts";
import { AuthService } from "../src/auth/auth.service.js";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";

let app: INestApplication;
let dentist: Client, sec: Client, admin: Client;
let tenantA: string;
let patientId: string;
let patientName: string;
let clinicalDocId: string;
let consentDocId: string;
let clinicalFileId: string;
const MARKER = `QA104-GIZLI-EPIKRIZ-${Math.random().toString(36).slice(2, 10)}`;
const TZ = "Europe/Istanbul";
const CLINICAL_TYPE_NAMES = ["Epikriz / tedavi özeti", "Hasta bilgi föyü (klinik)", "Reçete yazısı (e-reçete değildir)"];
type Rows = Record<string, unknown>[];
type DocSections = { patient_documents: Rows; consent_requests: Rows; evidence_events: Rows; files: Rows };
const CO_MARKERS = ["patient_documents:clinical_output", "consent_requests:clinical_output", "evidence_events:clinical_output", "files:clinical_output"];

const typeByCode = async (c: Client, code: string) => (await c.get("/document-types").expect(200)).body.items.find((t: { code: string }) => t.code === code);
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const sha = (rows: unknown) => createHash("sha256").update(JSON.stringify(rows), "utf8").digest("hex");
const exportOf = async (c: Client) => {
  const r = await c.post(`/patients/${patientId}/export`, { reason: "Veri sahibi talebi (sentetik QA-104)" }).expect(200);
  return { text: r.text, doc: JSON.parse(r.text) };
};

/** Yalnız verilen üyeliğin istek bağlamına `patient.health.read` ekler (test kancası; ürün rol matrisi değişmez). */
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

beforeAll(async () => {
  app = await startApp();
  [dentist, sec, admin] = await Promise.all([login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  const last = `QA104 Sentetik ${Math.random().toString(36).slice(2, 7)}`;
  const created = (await sec.post("/patients", { firstName: "Dışa", lastName: last, birthDate: "1979-07-07" }).expect(201)).body.patient;
  patientId = created.id;
  patientName = `${created.firstName} ${created.lastName}`; // kayıtta ad biçimlenir (ör. "Qa104"); CSV/XLSX araması kayıtlı adla
  // Klinik çıktı: hekim epikriz üretir (serbest metinde benzersiz işaret), yazdırır (kanıt) ve belgeye dosya bağlar.
  const epi = await typeByCode(dentist, "EPIKRIZ");
  expect(epi.category).toBe("clinical_output");
  clinicalDocId = (await dentist.post("/documents", { patientId, templateVersionId: epi.approvedTemplates[0].versionId, freeText: MARKER }).expect(201)).body.id;
  await dentist.post(`/documents/${clinicalDocId}/print`).expect(200);
  clinicalFileId = (await dentist.post("/files", { patientId, category: "document_scan", originalName: "epikriz.pdf", contentType: "application/pdf", size: 10, patientDocumentId: clinicalDocId }).expect(201)).body.id;
  // Klinik olmayan, kabul gerektiren onam belgesi: sekreter üretir ve yazdırır; dışa aktarımda ve raporda kalmalı.
  const types = (await sec.get("/document-types").expect(200)).body.items as { category: string; requiresAcceptance: boolean; issuerRole: string | null; active: boolean; approvedTemplates: { versionId: string }[] }[];
  const consent = types.find((t) => t.category !== "clinical_output" && t.requiresAcceptance && !t.issuerRole && t.active && t.approvedTemplates.length > 0);
  expect(consent, "seed'de onaylı şablonlu onam türü olmalı").toBeTruthy();
  consentDocId = (await sec.post("/documents", { patientId, templateVersionId: consent!.approvedTemplates[0]!.versionId }).expect(201)).body.id;
  await sec.post(`/documents/${consentDocId}/print`).expect(200);
  await sec.post("/files", { patientId, category: "document_scan", originalName: "onam.pdf", contentType: "application/pdf", size: 10, patientDocumentId: consentDocId }).expect(201);
});
afterAll(async () => app.close());

describe("QA-104 KVKK hasta dışa aktarımı: klinik çıktı belgeleri yalnız sağlık yetkisiyle", () => {
  it("yönetici (sağlık yetkisiz): epikriz id'si, içeriği/serbest metni, kanıtı ve bağlı dosyası yok; onam belgesi, onay isteği, kanıtı ve dosyası var", async () => {
    const { text, doc } = await exportOf(admin);
    expect(text).not.toContain(clinicalDocId);
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain(clinicalFileId);
    const s = doc.sections as DocSections;
    expect(s.patient_documents.map((d) => d.id)).toEqual([consentDocId]);
    expect(s.consent_requests.map((r) => r.patient_document_id)).toEqual([consentDocId]);
    expect(s.evidence_events.length).toBeGreaterThan(0);
    expect(s.evidence_events.every((e) => e.patient_document_id === consentDocId)).toBe(true);
    expect(s.files.map((f) => f.patient_document_id)).toEqual([consentDocId]);
  });

  it("yönetici: omitted klinik çıktı dışlamalarını ve sağlık bölümlerini listeler; not açıklar; counts/checksums kalan içerikle tutarlı", async () => {
    const { doc } = await exportOf(admin);
    expect(doc.omitted).toEqual(expect.arrayContaining([...CO_MARKERS, "clinical_notes", "anamnesis_versions"]));
    expect((doc.notes as string[]).some((n) => /klinik çıktı/i.test(n) && /sağlık/i.test(n))).toBe(true);
    expect(Object.keys(doc.counts).sort()).toEqual(Object.keys(doc.sections).sort());
    for (const [k, rows] of Object.entries(doc.sections) as [string, unknown[]][]) {
      expect(doc.counts[k], k).toBe(rows.length);
      expect(doc.checksums[k], k).toBe(sha(rows));
    }
  });

  it("denetim kaydı (patient.export) dışlanan klinik çıktı bölümlerini içerir", async () => {
    await exportOf(admin);
    const a = await ownerQuery(tenantA, "select changes from audit_events where action = 'patient.export' and entity_id = $1 order by id desc limit 1", [patientId]);
    expect(a[0].changes.omitted.to).toEqual(expect.arrayContaining(CO_MARKERS));
  });

  it("sağlık yetkili dışa aktaran (test için yetki verilmiş yönetici): tüm belgeler, kanıtlar ve dosyalar kalır; klinik çıktı dışlaması yok", async () => {
    const { text, doc } = await withHealth(admin.context, () => exportOf(admin));
    expect(text).toContain(clinicalDocId);
    expect(text).toContain(MARKER);
    const s = doc.sections as DocSections;
    expect(s.patient_documents.map((d) => d.id).sort()).toEqual([clinicalDocId, consentDocId].sort());
    expect(s.evidence_events.some((e) => e.patient_document_id === clinicalDocId)).toBe(true);
    expect(s.files.some((f) => f.id === clinicalFileId)).toBe(true);
    expect(doc.omitted).toEqual([]);
    for (const [k, rows] of Object.entries(doc.sections) as [string, unknown[]][]) expect(doc.checksums[k], k).toBe(sha(rows));
    // Kanca yalnız o çağrı içindi: ardından yönetici yine sağlık yetkisiz dışa aktarır.
    expect((await exportOf(admin)).text).not.toContain(clinicalDocId);
  });
});

describe("QA-105 onam/belge raporu: klinik çıktı satırları ve toplamları yalnız sağlık yetkisiyle (ADR-088)", () => {
  type Row = { patient: string; type: string; title: string; _drill: { patientId: string } };
  const onam = async (c: Client) => (await c.get(`/reports/onam?from=${day()}&to=${day()}`).expect(200)).body as { rows: Row[]; totals: { count: number }; truncated: boolean };
  const dbCounts = async () => {
    const r = dayRangeUtc(day(), TZ);
    return (await ownerQuery(tenantA, `select count(*)::int as all, count(*) filter (where dt.category <> 'clinical_output')::int as non_clinical
      from patient_documents pd join document_types dt on dt.id = pd.document_type_id where pd.issued_at >= $1 and pd.issued_at < $2`, [r.from, r.to]))[0] as { all: number; non_clinical: number };
  };

  it("sekreter: epikriz satırı yok (yalnız onam), hiçbir klinik çıktı türü listelenmez; toplam = klinik olmayan belge sayısı", async () => {
    const rep = await onam(sec);
    expect(rep.truncated).toBe(false);
    const mine = rep.rows.filter((r) => r._drill.patientId === patientId);
    expect(mine).toHaveLength(1);
    expect(CLINICAL_TYPE_NAMES).not.toContain(mine[0]!.type);
    expect(rep.rows.filter((r) => CLINICAL_TYPE_NAMES.includes(r.type))).toHaveLength(0);
    const n = await dbCounts();
    expect(n.all).toBeGreaterThan(n.non_clinical); // bugün klinik çıktı belgesi gerçekten var
    expect(rep.totals.count).toBe(n.non_clinical);
    expect(rep.rows).toHaveLength(rep.totals.count);
  });

  it("yönetici CSV ve XLSX: klinik çıktı türü yok; TOPLAM · Belge = klinik olmayan belge sayısı", async () => {
    const n = await dbCounts();
    const csv = (await admin.get(`/reports/onam/export?from=${day()}&to=${day()}`).expect(200)).text;
    for (const name of CLINICAL_TYPE_NAMES) expect(csv).not.toContain(name);
    expect(csv).toContain(patientName);
    expect(csv).toMatch(new RegExp(`TOPLAM · Belge"?;"?${n.non_clinical}"?\\r\\n`));
    const x = await admin.get(`/reports/onam/export?from=${day()}&to=${day()}&format=xlsx`).buffer(true)
      .parse((res, cb) => { const ch: Buffer[] = []; res.on("data", (d) => ch.push(d)); res.on("end", () => cb(null, Buffer.concat(ch))); }).expect(200);
    const dir = mkdtempSync(join(tmpdir(), "qa105-")); const f = join(dir, "r.xlsx"); writeFileSync(f, x.body as Buffer);
    const sheet = execFileSync("python3", ["-I", "-c", "import zipfile,sys; sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read('xl/worksheets/sheet1.xml').decode())", f], { encoding: "utf8" });
    for (const name of CLINICAL_TYPE_NAMES) expect(sheet).not.toContain(name);
    expect(sheet).toContain(patientName);
    expect(sheet).toMatch(new RegExp(`TOPLAM · Belge</t></is></c><c [^>]*><v>${n.non_clinical}</v>`));
  });

  it("sağlık yetkili rol (test için yetki verilmiş sekreter): epikriz satırı listelenir; toplam = tüm belgeler", async () => {
    const rep = await withHealth(sec.context, () => onam(sec));
    const mine = rep.rows.filter((r) => r._drill.patientId === patientId);
    expect(mine.map((r) => r.type)).toContain("Epikriz / tedavi özeti");
    expect(mine).toHaveLength(2);
    expect(rep.totals.count).toBe((await dbCounts()).all);
    expect(rep.rows).toHaveLength(rep.totals.count);
    // Kanca kalktıktan sonra sekreter yine görmez.
    expect((await onam(sec)).rows.filter((r) => r._drill.patientId === patientId)).toHaveLength(1);
  });

  it("hekim varsayılan rolde onam raporunu çalıştıramaz (report.operations yok → 403); belgeyi hasta kartında görür", async () => {
    await dentist.get(`/reports/onam?from=${day()}&to=${day()}`).expect(403);
    await dentist.get(`/documents/${clinicalDocId}`).expect(200);
  });
});
