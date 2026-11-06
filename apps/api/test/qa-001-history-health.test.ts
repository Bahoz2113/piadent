/**
 * QA-001 (S1): Sağlık yetkisi (`patient.health.read`) olmayan roller hasta geçmişinde (PİA İz)
 * odontogram bulgu/tanı olaylarını (`entity_type = 'clinical_chart'`) görmemeli.
 * İkincil (aynı kök): KVKK hasta dışa aktarımı `access_log` ve denetim (log) raporu da
 * klinik olayları (clinical_chart / clinical_note / anamnesis) sağlık yetkisi yoksa dışlar.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, login, startApp, useLegacyAdmin, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, dentist: Client, sec: Client, fin: Client;
let patientId: string;

const CLINICAL = new Set(["clinical_chart", "clinical_note", "anamnesis"]);
const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};

beforeAll(async () => {
  app = await startApp();
  // ADR-098: yönetici artık her şeyi görür; bu dosya sağlık yetkisiz rolün süzgecini sınadığından eski yönetici kümesi kullanılır.
  await useLegacyAdmin(app);
  [admin, dentist, sec, fin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aFinance)]);
  patientId = (await sec.post("/patients", { firstName: "Gecmis", lastName: "Sentetik", birthDate: "1991-02-02" }).expect(201)).body.patient.id;
  await dentist.post(`/patients/${patientId}/findings`, { tooth: "16", surfaces: ["O"], findingType: "caries" }).expect(201);
  await dentist.post(`/patients/${patientId}/diagnoses`, { location: { kind: "tooth", tooth: "16", surfaces: ["O"] }, description: "Sentetik tanı GİZLİ-QA001" }).expect(201);
});
afterAll(async () => app.close());

describe("QA-001 hasta geçmişi: klinik olaylar yalnız sağlık yetkisiyle", () => {
  it("hekim geçmişte clinical_chart olayını görür (≥1)", async () => {
    const items = (await dentist.get(`/patients/${patientId}/history`).expect(200)).body.items as { entityType: string; action: string }[];
    expect(items.filter((e) => e.entityType === "clinical_chart").length).toBeGreaterThanOrEqual(1);
    expect(items.some((e) => e.action === "finding.create")).toBe(true);
  });

  it("sekreter ve finans geçmişte clinical_chart olayı görmez (0)", async () => {
    for (const c of [sec, fin]) {
      const r = await c.get(`/patients/${patientId}/history`).expect(200);
      const items = r.body.items as { entityType: string; action: string }[];
      expect(items.filter((e) => e.entityType === "clinical_chart")).toHaveLength(0);
      expect(items.some((e) => e.action === "finding.create" || e.action === "diagnosis.create")).toBe(false);
      expect(JSON.stringify(items)).not.toContain("GİZLİ-QA001");
      // Hasta kaydı olayı görünür kalır (filtre yalnız klinik içerik içindir).
      expect(items.some((e) => e.action === "patient.create")).toBe(true);
    }
  });

  it("KVKK dışa aktarımı: sağlık yetkisi yoksa access_log klinik olay taşımaz", async () => {
    const d = JSON.parse((await admin.post(`/patients/${patientId}/export`, { reason: "Veri sahibi talebi (sentetik QA-001)" }).expect(200)).text);
    const log = d.sections.access_log as { entity_type: string; action: string }[];
    expect(log.length).toBeGreaterThan(0);
    expect(log.filter((e) => CLINICAL.has(e.entity_type))).toHaveLength(0);
    expect(log.some((e) => e.action === "finding.create" || e.action === "diagnosis.create")).toBe(false);
  });

  it("denetim (log) raporu: sağlık yetkisi yoksa klinik olaylar listelenmez", async () => {
    const rep = (await admin.get(`/reports/log?from=${day(0)}&to=${day(0)}`).expect(200)).body;
    const rows = rep.rows as { action: string; entity: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.action === "finding.create" || r.action === "diagnosis.create")).toHaveLength(0);
    expect(rows.filter((r) => /^(clinical_chart|clinical_note|anamnesis)\b/.test(r.entity))).toHaveLength(0);
    // Eylem öneki ile süzülünce de sızmaz.
    const f = (await admin.get(`/reports/log?from=${day(0)}&to=${day(0)}&action=finding`).expect(200)).body;
    expect(f.rows).toHaveLength(0);
    expect(f.totals.count).toBe(0);
  });
});
