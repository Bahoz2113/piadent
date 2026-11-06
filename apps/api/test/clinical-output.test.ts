/**
 * Faz 1.2 (ADR-085) — Klinik çıktı belgeleri (epikriz / föy / reçete yazısı): yalnız hekim üretir; tanı, anamnez kritik işareti ve
 * serbest metin alanları dolar; sekreter listede göremez, ayrıntıda 404; e-reçete iddiası yok.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { clinicalOutputStarterBody, unknownTemplateFields } from "@viadent/contracts";
import { EMAILS, login, startApp, useLegacyAdmin, type Client } from "./helpers.js";

let app: INestApplication; let dentist: Client; let sec: Client; let admin: Client; let patientId: string;
beforeAll(async () => {
  app = await startApp();
  // ADR-098: yönetici artık her şeyi görür; bu dosya sağlık yetkisiz rolün süzgecini sınadığından eski yönetici kümesi kullanılır.
  await useLegacyAdmin(app);
  [dentist, sec, admin] = await Promise.all([login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aAdmin)]);
  patientId = (await sec.post("/patients", { firstName: "Epikriz", lastName: "Çıktı", birthDate: "1990-05-15" }).expect(201)).body.patient.id;
});
afterAll(async () => app.close());

const typeByCode = async (c: Client, code: string) => (await c.get("/document-types").expect(200)).body.items.find((t: { code: string }) => t.code === code);

describe("klinik çıktı", () => {
  it("başlangıç gövdeleri yalnız tanımlı alanları kullanır", () => {
    for (const code of ["EPIKRIZ", "HASTA-FOYU", "RECETE"] as const) expect(unknownTemplateFields(clinicalOutputStarterBody(code))).toEqual([]);
    expect(clinicalOutputStarterBody("RECETE")).toMatch(/e-reçete değildir/);
  });
  it("üç tür hekim-only ve clinical_output kategorisinde; DEMO şablonu onaylı", async () => {
    for (const code of ["EPIKRIZ", "HASTA-FOYU", "RECETE"]) {
      const t = await typeByCode(dentist, code);
      expect(t).toMatchObject({ category: "clinical_output", issuerRole: "dentist" });
      expect(t.approvedTemplates[0]?.isDemo).toBe(true);
    }
  });
  it("epikriz: tanı + anamnez kritik işareti + serbest metin + yaş metne yazılır; sekreter üretemez (hekim-only)", async () => {
    await dentist.post(`/patients/${patientId}/diagnoses`, { location: { kind: "tooth", tooth: "36", surfaces: [] }, description: "Sentetik derin çürük", code: "K02.1" }).expect(201);
    await dentist.post(`/patients/${patientId}/anamnesis`, { basedOnVersion: 0, answers: { allergy: { value: "yes", detail: "Sentetik penisilin" } } }).expect(201);
    const t = await typeByCode(dentist, "EPIKRIZ");
    const vid = t.approvedTemplates[0].versionId;
    const pv = (await dentist.post(`/template-versions/${vid}/preview`, { patientId, freeText: "Sentetik öneri: 1 hafta sonra kontrol." }).expect(200)).body;
    expect(pv.content).toContain("K02.1 Sentetik derin çürük (diş 36)");
    expect(pv.content).toContain("Alerji (ilaç, lateks, lokal anestezik vb.)");
    expect(pv.content).toContain("Sentetik öneri: 1 hafta sonra kontrol.");
    expect(pv.content).toMatch(/\(3[56] yaş\)/);
    expect(pv.requiresAcceptance).toBe(false);
    await sec.post(`/template-versions/${vid}/preview`, { patientId }).expect(403);
    const doc = (await dentist.post("/documents", { patientId, templateVersionId: vid, freeText: "Sentetik öneri: 1 hafta sonra kontrol." }).expect(201)).body;
    expect(doc.requiresAcceptance).toBe(false);
    // Sağlık verisi kapısı: sekreter ve yönetici listede görmez, ayrıntıda 404; hekim görür
    const secList = (await sec.get(`/patients/${patientId}/documents`).expect(200)).body.items;
    expect(secList.find((d: { id: string }) => d.id === doc.id)).toBeUndefined();
    await sec.get(`/documents/${doc.id}`).expect(404);
    await admin.get(`/documents/${doc.id}`).expect(404);
    const mine = (await dentist.get(`/documents/${doc.id}`).expect(200)).body;
    expect(mine.content).toContain("Sentetik derin çürük");
    expect(mine.integrityOk).toBe(true);
  });
  it("reçete yazısı: e-reçete değildir ibaresi metinde; serbest metin yoksa alan '—'", async () => {
    const t = await typeByCode(dentist, "RECETE");
    const pv = (await dentist.post(`/template-versions/${t.approvedTemplates[0].versionId}/preview`, { patientId }).expect(200)).body;
    expect(pv.content).toMatch(/e-reçete değildir/);
    expect(pv.content).toMatch(/İlaçlar ve kullanım:\n—/);
  });
});
