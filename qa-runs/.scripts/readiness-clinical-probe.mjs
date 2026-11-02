// CEZERİ tester sondası — hazırlık kuralı klinik çıktı belge türüne bağlanabiliyor mu, sekreter ne görüyor (fix5 risk 2). Ürün kodunu değiştirmez.
// Kural yalnız sentetik demo kliniğinde oluşturulur ve sonda sonunda pasifleştirilir. Kullanım: BASE=… PASSWORD=… OUT=… node qa-runs/.scripts/readiness-clinical-probe.mjs
import { writeFileSync } from "node:fs";
const B = (process.env.BASE ?? "http://127.0.0.1:4000") + "/api/v1";
const OUT = process.env.OUT ?? "evidence";
const login = async (email) => {
  const r = await fetch(B + "/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-viadent-request": "1" }, body: JSON.stringify({ email, password: process.env.PASSWORD }) });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const s = await (await fetch(B + "/session", { headers: { cookie } })).json();
  return { cookie, "x-viadent-context": s.activeMembership.id, "x-viadent-request": "1", "content-type": "application/json" };
};
const api = async (h, m, p, b) => { const r = await fetch(B + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const dr = await login("elif.aras@demo-yesil.test"), sec = await login("sekreter@demo-yesil.test"), adm = await login("yonetici@demo-yesil.test");
const types = (await api(dr, "GET", "/document-types")).body.items;
const epi = types.find((t) => t.code === "EPIKRIZ");
const procs = (await api(dr, "GET", "/procedures")).body.items;
const proc = procs.find((p) => p.code === "KAN-01") ?? procs[0];
const prac = (await api(sec, "GET", "/practitioners")).body;
const pracId = (prac.items ?? prac)[0]?.id;
const rule = await api(adm, "POST", "/readiness-rules", { kind: "document_for_procedure", procedureId: proc.id, documentTypeId: epi.id });
const res = { ruleCreateWithClinicalOutputType: rule.status, ruleError: rule.status >= 400 ? rule.body?.code ?? rule.body : undefined };
if (rule.status < 300) {
  const pid = (await api(sec, "POST", "/patients", { firstName: "Hazırlık", lastName: "Sonda", birthDate: "1994-05-05" })).body?.patient?.id;
  const plan = (await api(dr, "POST", `/patients/${pid}/plans`, { title: "Hazırlık sondası", practitionerId: pracId })).body;
  await api(dr, "POST", `/plan-versions/${plan.versionId}/items`, { procedureId: proc.id, location: { kind: "tooth", tooth: "16" }, quantity: 1 });
  await api(dr, "POST", `/plan-versions/${plan.versionId}/propose`, {});
  await api(sec, "POST", `/plan-versions/${plan.versionId}/decision`, { decision: "accepted" });
  const d = new Date(Date.now() + 86_400_000); const date = d.toISOString().slice(0, 10);
  const a = (await api(sec, "POST", "/appointments", { patientId: pid, practitionerId: pracId, date, startTime: "06:15", durationMinutes: 30, allowOutsideHours: true })).body;
  const before = (await api(sec, "GET", `/appointments/${a?.id}/readiness`)).body;
  await api(dr, "POST", "/documents", { patientId: pid, templateVersionId: epi.approvedTemplates[0].versionId, freeText: "Hazırlık sondası" });
  const after = (await api(sec, "GET", `/appointments/${a?.id}/readiness`)).body;
  const lbl = (r) => (r?.items ?? []).filter((i) => /Epikriz/.test(i.label ?? "")).map((i) => ({ label: i.label, status: i.status, detail: i.detail }));
  Object.assign(res, { appointment: !!a?.id, secretaryBefore: lbl(before), secretaryAfter: lbl(after),
    secretaryLearnsEpikrizExists: JSON.stringify(lbl(before)) !== JSON.stringify(lbl(after)) });
  res.ruleDeactivate = (await api(adm, "POST", `/readiness-rules/${rule.body.id}/active`, { active: false })).status;
}
writeFileSync(`${OUT}/readiness-clinical-probe.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
