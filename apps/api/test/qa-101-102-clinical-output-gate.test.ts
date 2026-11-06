/**
 * QA-101 (S1) — Klinik çıktı belgesi (ADR-085, `document_types.category = 'clinical_output'`) sağlık verisidir:
 * `patient.health.read` olmayan rol için TÜM belge uçları var olmayan belgeyle aynı yanıtı verir (404), durum değiştirmez,
 * kanıt olayı yazmaz; belgeye dosya bağlama da var olmayan belgeyle aynı yanıtı verir. Sağlık yetkili roller (hekim; asistan
 * okuma/yazdırma) mevcut davranışı korur.
 *
 * QA-102 (S2) — Sağlık yetkisi olmayan rol hasta geçmişinde (PİA İz) klinik çıktı belgesine ait olayları görmez; onam gibi
 * diğer belge olayları görünmeye devam eder. Aynı süzgeç (QA-001 ile tutarlı) KVKK dışa aktarımı access_log ve denetim
 * raporunda da uygulanır.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, login, startApp, useLegacyAdmin, type Client } from "./helpers.js";

let app: INestApplication;
let dentist: Client, sec: Client, admin: Client, asst: Client, fin: Client;
let patientId: string;
let clinicalDocId: string;
let consentDocId: string;
const MISSING = "00000000-0000-4000-8000-000000000000";

const typeByCode = async (c: Client, code: string) => (await c.get("/document-types").expect(200)).body.items.find((t: { code: string }) => t.code === code);
const evidenceCount = async () => ((await dentist.get(`/documents/${clinicalDocId}`).expect(200)).body.evidence as unknown[]).length;
/** correlation_id isteğe özgüdür; geri kalan gövde var olmayan belgeyle birebir aynı olmalı. */
const shape = (r: { status: number; body: Record<string, unknown> }) => { const { correlation_id: _c, ...rest } = r.body; return { status: r.status, body: rest }; };
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());

beforeAll(async () => {
  app = await startApp();
  // ADR-098: yönetici artık her şeyi görür; bu dosya sağlık yetkisiz rolün süzgecini sınadığından eski yönetici kümesi kullanılır.
  await useLegacyAdmin(app);
  [dentist, sec, admin, asst, fin] = await Promise.all([
    login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aAdmin), login(app, EMAILS.aAssistant), login(app, EMAILS.aFinance)]);
  patientId = (await sec.post("/patients", { firstName: "Kapı", lastName: "QA101 Sentetik", birthDate: "1988-03-03" }).expect(201)).body.patient.id;
  const foy = await typeByCode(dentist, "HASTA-FOYU");
  expect(foy.category).toBe("clinical_output");
  clinicalDocId = (await dentist.post("/documents", { patientId, templateVersionId: foy.approvedTemplates[0].versionId, freeText: "Sentetik QA-101 notu" }).expect(201)).body.id;
  // Klinik olmayan, kabul gerektiren (onam) bir belge: sekreter üretir; geçmişte görünmeye devam etmeli.
  const types = (await sec.get("/document-types").expect(200)).body.items as { category: string; requiresAcceptance: boolean; issuerRole: string | null; active: boolean; approvedTemplates: { versionId: string }[] }[];
  const consent = types.find((t) => t.category !== "clinical_output" && t.requiresAcceptance && !t.issuerRole && t.active && t.approvedTemplates.length > 0);
  expect(consent, "seed'de onaylı şablonlu onam türü olmalı").toBeTruthy();
  consentDocId = (await sec.post("/documents", { patientId, templateVersionId: consent!.approvedTemplates[0]!.versionId }).expect(201)).body.id;
});
afterAll(async () => app.close());

describe("QA-101 klinik çıktı belgesi: sağlık yetkisi olmayan rol için tüm uçlar 404 (varlık kahini yok)", () => {
  it("sekreter print → 404, var olmayan belgeyle aynı gövde; kanıt sayısı değişmez", async () => {
    const before = await evidenceCount();
    const r = await sec.post(`/documents/${clinicalDocId}/print`);
    const m = await sec.post(`/documents/${MISSING}/print`);
    expect(r.status).toBe(404);
    expect(shape(r)).toEqual(shape(m));
    expect(await evidenceCount()).toBe(before);
  });

  it("sekreter decision → 404 (409 değil), var olmayan belgeyle aynı; kanıt yazılmaz", async () => {
    const before = await evidenceCount();
    const body = { decision: "accepted", method: "wet_signature_on_paper", attestation: true };
    const r = await sec.post(`/documents/${clinicalDocId}/decision`, body);
    const m = await sec.post(`/documents/${MISSING}/decision`, body);
    expect(r.status).toBe(404);
    expect(shape(r)).toEqual(shape(m));
    expect(await evidenceCount()).toBe(before);
  });

  it("yönetici revoke → 404, var olmayan belgeyle aynı; durum 'issued' kalır, kanıt yazılmaz", async () => {
    const before = await evidenceCount();
    const r = await admin.post(`/documents/${clinicalDocId}/revoke`, { reason: "Yetkisiz iptal denemesi (sentetik)" });
    const m = await admin.post(`/documents/${MISSING}/revoke`, { reason: "Yetkisiz iptal denemesi (sentetik)" });
    expect(r.status).toBe(404);
    expect(shape(r)).toEqual(shape(m));
    const d = (await dentist.get(`/documents/${clinicalDocId}`).expect(200)).body;
    expect(d.status).toBe("issued");
    expect(d.evidence).toHaveLength(before);
    expect((d.evidence as { kind: string }[]).some((e) => e.kind === "revoked")).toBe(false);
  });

  it("sekreter belgeye dosya bağlayamaz: yanıt var olmayan belgeyle aynı (dosya kaydı açılmaz)", async () => {
    const file = { patientId, category: "document_scan", originalName: "tarama.pdf", contentType: "application/pdf", size: 10 };
    const r = await sec.post("/files", { ...file, patientDocumentId: clinicalDocId });
    const m = await sec.post("/files", { ...file, patientDocumentId: MISSING });
    expect(r.status).toBe(422);
    expect(shape(r)).toEqual(shape(m));
    const files = (await dentist.get(`/patients/${patientId}/files`).expect(200)).body.items as { patientDocumentId: string | null }[];
    expect(files.some((f) => f.patientDocumentId === clinicalDocId)).toBe(false);
  });

  it("sağlık yetkili roller korunur: asistan ayrıntı 200 + print 200 (kanıt +1); hekim dosya bağlar 201", async () => {
    const before = await evidenceCount();
    await asst.get(`/documents/${clinicalDocId}`).expect(200);
    await asst.post(`/documents/${clinicalDocId}/print`).expect(200);
    expect(await evidenceCount()).toBe(before + 1);
    await dentist.post("/files", { patientId, category: "document_scan", originalName: "foy.pdf", contentType: "application/pdf", size: 10, patientDocumentId: clinicalDocId }).expect(201);
  });

  it("onam (klinik olmayan) belgede sekreter print 200 — kapı yalnız klinik çıktıya uygulanır", async () => {
    await sec.post(`/documents/${consentDocId}/print`).expect(200);
  });
});

describe("QA-102 hasta geçmişi: klinik çıktı belgesi olayları yalnız sağlık yetkisiyle", () => {
  type Ev = { action: string; entityType: string; entityId: string | null };
  const hist = async (c: Client) => (await c.get(`/patients/${patientId}/history`).expect(200)).body.items as Ev[];

  it("hekim klinik çıktının document.issue olayını görür; sekreter/yönetici/finans hiçbir olayını görmez; onam olayı herkese görünür", async () => {
    const mine = await hist(dentist);
    expect(mine.some((e) => e.entityId === clinicalDocId && e.action === "document.issue")).toBe(true);
    expect(mine.some((e) => e.entityId === consentDocId && e.action === "document.issue")).toBe(true);
    for (const c of [sec, admin, fin]) {
      const items = await hist(c);
      expect(items.filter((e) => e.entityId === clinicalDocId)).toHaveLength(0);
      expect(items.some((e) => e.entityId === consentDocId && e.action === "document.issue")).toBe(true);
      expect(items.some((e) => e.action === "patient.create")).toBe(true);
    }
  });

  it("hekim iptali (200) sonrası: hekim document.revoke görür; sekreter görmez", async () => {
    await dentist.post(`/documents/${clinicalDocId}/revoke`, { reason: "Hekim düzeltmesi (sentetik)" }).expect(200);
    expect((await dentist.get(`/documents/${clinicalDocId}`).expect(200)).body.status).toBe("revoked");
    expect((await hist(dentist)).some((e) => e.entityId === clinicalDocId && e.action === "document.revoke")).toBe(true);
    expect((await hist(sec)).filter((e) => e.entityId === clinicalDocId)).toHaveLength(0);
  });

  it("KVKK dışa aktarımı (yönetici, sağlık yetkisiz): access_log klinik çıktı belge olayını taşımaz, onam olayını taşır", async () => {
    const all = (await hist(dentist)).filter((e) => e.entityType === "patient_document");
    const nonClinical = all.filter((e) => e.entityId !== clinicalDocId).length;
    expect(all.length).toBeGreaterThan(nonClinical); // hekim tarafında klinik olaylar var
    const d = JSON.parse((await admin.post(`/patients/${patientId}/export`, { reason: "Veri sahibi talebi (sentetik QA-102)" }).expect(200)).text);
    const log = (d.sections.access_log as { entity_type: string }[]).filter((e) => e.entity_type === "patient_document");
    expect(log).toHaveLength(nonClinical);
  });

  it("denetim (log) raporu (yönetici): klinik çıktı belgesinin olayları listelenmez; onam olayı listelenir", async () => {
    const rows = (await admin.get(`/reports/log?from=${day()}&to=${day()}&entityType=patient_document`).expect(200)).body.rows as { entity: string }[];
    expect(rows.some((r) => r.entity.includes(consentDocId.slice(0, 8)))).toBe(true);
    expect(rows.filter((r) => r.entity.includes(clinicalDocId.slice(0, 8)))).toHaveLength(0);
  });
});
