/**
 * ADR-098 (ürün sahibi kararı 07.11.2026): klinik yöneticisi her şeyi görür ve yapabilir — sağlık içeriği dahil.
 * Yöneticinin her sağlık görüntülemesi PİA İz'e "patient.health_view" olarak düşer (KVKK erişim izi).
 * Diğer roller rol bazlı kalır: sekreter/finans sağlık içeriğine yine erişemez; hekim okuması iz üretmez.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { PERMISSIONS, permissionsFor } from "@viadent/contracts";
import { EMAILS, login, ownerQuery, startApp, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, dentist: Client, sec: Client, fin: Client;
let patientId: string, tenantA: string;

const views = async (by: string) => (await ownerQuery(tenantA,
  `select e.changes from audit_events e join users u on u.id = e.actor_user_id
    where e.action = 'patient.health_view' and e.patient_id = $1 and u.email = $2 order by e.created_at`, [patientId, by])).map((r) => r.changes.section as string);

beforeAll(async () => {
  app = await startApp();
  [admin, dentist, sec, fin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.aFinance)]);
  patientId = (await sec.post("/patients", { firstName: "Yonetici", lastName: "Gorur", birthDate: "1988-03-03" }).expect(201)).body.patient.id;
  tenantA = admin.session.activeMembership.tenantId;
  await dentist.post(`/patients/${patientId}/findings`, { tooth: "26", surfaces: ["O"], findingType: "caries" }).expect(201);
  await dentist.post(`/patients/${patientId}/clinical-notes`, { body: "Sentetik not ADR098-HEKIM" }).expect(201);
});
afterAll(async () => app.close());

describe("ADR-098 yönetici her şeyi görür ve yapar", () => {
  it("yetki kümesi tüm yetkiler; diğer roller değişmedi (sekreter/finans sağlık yetkisiz)", () => {
    expect([...permissionsFor("clinic_admin")].sort()).toEqual([...PERMISSIONS].sort());
    expect(permissionsFor("secretary").has("patient.health.read")).toBe(false);
    expect(permissionsFor("finance").has("patient.health.read")).toBe(false);
  });

  it("yönetici diş şeması, klinik not ve anamnez okur; klinik not yazar", async () => {
    expect((await admin.get(`/patients/${patientId}/chart`).expect(200)).body).toBeTruthy();
    const notes = (await admin.get(`/patients/${patientId}/clinical-notes`).expect(200)).body.items as { body: string }[];
    expect(notes.some((n) => n.body.includes("ADR098-HEKIM"))).toBe(true);
    await admin.get(`/patients/${patientId}/anamnesis`).expect(200);
    await admin.post(`/patients/${patientId}/clinical-notes`, { body: "Yönetici notu ADR098-YON" }).expect(201);
    expect((await dentist.get(`/patients/${patientId}/clinical-notes`).expect(200)).body.items.some((n: { body: string }) => n.body.includes("ADR098-YON"))).toBe(true);
  });

  it("yöneticinin sağlık görüntülemeleri PİA İz'e düşer; hekim okuması iz üretmez", async () => {
    const before = await views(EMAILS.aAdmin);
    await admin.get(`/patients/${patientId}/chart`).expect(200);
    await admin.get(`/patients/${patientId}/clinical-notes`).expect(200);
    await admin.get(`/patients/${patientId}/anamnesis`).expect(200);
    await admin.get(`/patients/${patientId}`).expect(200);
    const after = await views(EMAILS.aAdmin);
    expect(after.slice(before.length)).toEqual(["Diş şeması", "Klinik notlar", "Anamnez", "Hasta kartı sağlık özeti"]);
    await dentist.get(`/patients/${patientId}/chart`).expect(200);
    await dentist.get(`/patients/${patientId}/clinical-notes`).expect(200);
    expect(await views(EMAILS.aDentist)).toEqual([]);
  });

  it("KVKK dışa aktarımı yöneticide sağlık bölümlerini içerir", async () => {
    const d = JSON.parse((await admin.post(`/patients/${patientId}/export`, { reason: "Veri sahibi talebi (sentetik ADR-098)" }).expect(200)).text);
    const log = d.sections.access_log as { entity_type: string }[];
    expect(log.some((e) => e.entity_type === "clinical_chart" || e.entity_type === "clinical_note")).toBe(true);
  });

  it("sekreter ve finans rol bazlı kalır: sağlık içeriği 403", async () => {
    for (const c of [sec, fin]) {
      await c.get(`/patients/${patientId}/chart`).expect(403);
      await c.get(`/patients/${patientId}/clinical-notes`).expect(403);
    }
  });
});
