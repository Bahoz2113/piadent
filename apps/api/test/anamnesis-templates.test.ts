/**
 * Faz 1.1 (ADR-084) — Anamnez şablonu: taslak (yönetici/hekim) → yayın (yalnız hekim) → eski kayıt eski sorularla, yeni kayıt yeni
 * sorularla; yayınlanan değişmez; kritik etiketler şablondan; sekreter erişemez; B kliniği etkilenmez.
 * NOT: bu test kiracı A'nın yürürlükteki formunu değiştirir; sonunda emekli ederek yerleşik sete döner (diğer testler yerleşik seti varsayar).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { ANAMNESIS_QUESTIONS } from "@viadent/contracts";
import { EMAILS, login, ownerQuery, startApp, useLegacyAdmin, type Client } from "./helpers.js";

let app: INestApplication; let admin: Client; let dentist: Client; let sec: Client; let bDentist: Client; let tenantA: string;
let tplId: string; let patientId: string;
beforeAll(async () => {
  app = await startApp();
  // ADR-098: yönetici artık her şeyi görür; bu dosya sağlık yetkisiz rolün süzgecini sınadığından eski yönetici kümesi kullanılır.
  await useLegacyAdmin(app);
  [admin, dentist, sec, bDentist] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aDentist), login(app, EMAILS.aSecretary), login(app, EMAILS.bDentist)]);
  tenantA = admin.session.activeMembership.tenantId;
  patientId = (await sec.post("/patients", { firstName: "Şablon", lastName: "Anamnez", birthDate: "1979-07-07" }).expect(201)).body.patient.id;
});
afterAll(async () => {
  // temizlik: yayındaki klinik şablonu emekli et → yerleşik set
  const list = (await admin.get("/anamnesis-templates")).body as { items: { id: string; status: string }[] };
  for (const t of list?.items ?? []) if (t.status !== "retired") await dentist.post(`/anamnesis-templates/${t.id}/retire`, {});
  await app.close();
});

describe("şablon yaşam döngüsü", () => {
  it("başlangıç: yürürlükte yerleşik DEMO set; eski kayıt yerleşik sorularla alınır", async () => {
    const l = (await admin.get("/anamnesis-templates").expect(200)).body;
    expect(l.active.demo).toBe(true); expect(l.active.templateId).toBeNull();
    const r = (await dentist.post(`/patients/${patientId}/anamnesis`, { basedOnVersion: 0, answers: { anticoagulant: { value: "yes", detail: "Sentetik" }, smoking: { value: "no" } } }).expect(201)).body;
    expect(r.criticalFlags).toEqual(["anticoagulant"]);
  });
  it("yönetici taslak açar (yürürlükteki kopya), düzenler; ikinci taslak 409; sekreter 403", async () => {
    const r = (await admin.post("/anamnesis-templates", {}).expect(201)).body;
    tplId = r.id; expect(r.status).toBe("draft"); expect(r.version).toBe(1);
    expect((await admin.post("/anamnesis-templates", {}).expect(409)).body.code).toBe("DRAFT_EXISTS");
    const l = (await admin.get("/anamnesis-templates").expect(200)).body;
    expect(l.items[0].questions).toHaveLength(ANAMNESIS_QUESTIONS.length);
    await admin.patch(`/anamnesis-templates/${tplId}`, { title: "Yeşilvadi anamnez formu v1", questions: [
      { key: "allergy", label: "Bilinen alerjiniz var mı?", critical: true, detailHint: "Neye karşı" },
      { key: "implant_history", label: "Daha önce implant uygulandı mı?", critical: false },
      { key: "pacemaker", label: "Kalp pili veya benzeri cihaz var mı?", critical: true },
    ] }).expect(200);
    await admin.patch(`/anamnesis-templates/${tplId}`, { title: "x", questions: [{ key: "soru_a", label: "Soru A", critical: false }, { key: "soru_a", label: "Soru B", critical: false }] }).expect(422); // tekrar anahtar
    await admin.patch(`/anamnesis-templates/${tplId}`, { title: "Dup", questions: [{ key: "Büyük Harf", label: "Soru", critical: false }] }).expect(422);
    await sec.get("/anamnesis-templates").expect(403);
    await sec.post("/anamnesis-templates", {}).expect(403);
  });
  it("yayın yalnız hekim: yönetici 403, hekim 200; yürürlük değişir; yayınlanan şablon düzenlenemez", async () => {
    await admin.post(`/anamnesis-templates/${tplId}/publish`, {}).expect(403);
    const p = (await dentist.post(`/anamnesis-templates/${tplId}/publish`, {}).expect(200)).body;
    expect(p).toMatchObject({ status: "published", retiredVersion: null });
    const l = (await admin.get("/anamnesis-templates").expect(200)).body;
    expect(l.active).toMatchObject({ demo: false, templateId: tplId, version: "v1", title: "Yeşilvadi anamnez formu v1" });
    expect(l.active.questions.map((q: { key: string }) => q.key)).toEqual(["allergy", "implant_history", "pacemaker"]);
    expect((await admin.patch(`/anamnesis-templates/${tplId}`, { title: "Değişti", questions: [{ key: "soru_a", label: "Soru A", critical: false }] }).expect(409)).body.code).toBe("TEMPLATE_NOT_DRAFT");
    await expect(ownerQuery(tenantA, "update anamnesis_templates set questions = '[]'::jsonb where id = $1", [tplId])).rejects.toThrow(/anamnesis_template_locked|violates check/);
  });
  it("eski kayıt eski sorularıyla gösterilir (outdated), yeni kayıt yeni setle alınır; yerleşik anahtar artık tanımsız; kritik etiket yeni şablondan", async () => {
    const a = (await dentist.get(`/patients/${patientId}/anamnesis`).expect(200)).body;
    expect(a.questionnaire).toMatchObject({ demo: false, templateId: tplId });
    expect(a.current.outdated).toBe(true);
    expect(a.current.questions.map((q: { key: string }) => q.key)).toContain("anticoagulant"); // eski kayıt, eski sorular
    await dentist.post(`/patients/${patientId}/anamnesis`, { basedOnVersion: 1, answers: { anticoagulant: { value: "yes" } } }).expect(422); // yeni sette yok
    const r = (await dentist.post(`/patients/${patientId}/anamnesis`, { basedOnVersion: 1, answers: { pacemaker: { value: "yes", detail: "Sentetik cihaz" }, implant_history: { value: "yes" } } }).expect(201)).body;
    expect(r.criticalFlags).toEqual(["pacemaker"]);
    const b = (await dentist.get(`/patients/${patientId}/anamnesis`).expect(200)).body;
    expect(b.current.outdated).toBe(false); expect(b.current.questionnaireVersion).toBe("v1");
    const v1 = (await dentist.get(`/patients/${patientId}/anamnesis/1`).expect(200)).body;
    expect(v1.questions.map((q: { key: string }) => q.key)).toEqual(ANAMNESIS_QUESTIONS.map((q) => q.key)); // sürüm 1 yerleşik setle
    const pt = (await dentist.get(`/patients/${patientId}`).expect(200)).body;
    expect(pt.clinical.criticalFlags).toEqual(["pacemaker"]);
    expect(pt.clinical.criticalFlagLabels).toEqual(["Kalp pili veya benzeri cihaz var mı?"]);
  });
  it("yeni sürüm: taslak → yayın öncekini emekli eder; B kliniği A'nın şablonunu görmez, yürürlüğü yerleşik kalır", async () => {
    const t2 = (await dentist.post("/anamnesis-templates", { title: "Form v2", questions: [{ key: "allergy", label: "Alerji?", critical: true }] }).expect(201)).body;
    const p = (await dentist.post(`/anamnesis-templates/${t2.id}/publish`, {}).expect(200)).body;
    expect(p.retiredVersion).toBe(1);
    const l = (await admin.get("/anamnesis-templates").expect(200)).body;
    expect(l.items.map((t: { version: number; status: string }) => [t.version, t.status])).toEqual([[2, "published"], [1, "retired"]]);
    expect(l.items.find((t: { version: number }) => t.version === 1).usageCount).toBe(1);
    const bl = (await bDentist.get("/anamnesis-templates").expect(200)).body;
    expect(bl.items).toEqual([]); expect(bl.active.demo).toBe(true);
    await bDentist.get(`/anamnesis-templates`).expect(200);
    await bDentist.patch(`/anamnesis-templates/${t2.id}`, { title: "Başka klinik", questions: [{ key: "soru_a", label: "Soru A", critical: false }] }).expect(404);
  });
});
