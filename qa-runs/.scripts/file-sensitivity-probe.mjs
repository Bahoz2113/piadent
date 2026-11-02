// CEZERİ tester sondası — hasta dışa aktarımında dosya hassasiyeti (fix2 risk 1 adayı). Ürün kodunu değiştirmez.
// Kullanım: BASE=… PASSWORD=… OUT=… node qa-runs/.scripts/file-sensitivity-probe.mjs
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
const dr = await login("elif.aras@demo-yesil.test"), adm = await login("yonetici@demo-yesil.test");
const tag = Date.now().toString(36);
const pat = await api(dr, "POST", "/patients", { firstName: "Dosya", lastName: "Sonda", birthDate: "1990-01-01" });
const pid = pat.body?.patient?.id;
const clinicalName = `panoramik-sonda-${tag}.jpg`, adminName = `kimlik-fotokopi-${tag}.pdf`;
const up1 = await api(dr, "POST", "/files", { patientId: pid, category: "radiograph", originalName: clinicalName, contentType: "image/jpeg", size: 1024 });
const up2 = await api(dr, "POST", "/files", { patientId: pid, category: "identity", originalName: adminName, contentType: "application/pdf", size: 1024 });
const admList = await api(adm, "GET", `/patients/${pid}/files`);
const admListStr = JSON.stringify(admList.body ?? {});
const exp = await api(adm, "POST", `/patients/${pid}/export`, { reason: "QA KVKK erişim talebi sınaması (dosya)" });
const expStr = JSON.stringify(exp.body ?? {});
const res = {
  patientCreate: pat.status, uploadClinical: up1.status, uploadAdmin: up2.status, uploadAdminBody: up2.status >= 400 ? up2.body : undefined,
  adminFileListStatus: admList.status, adminListSeesClinical: admListStr.includes(clinicalName), adminListSeesAdministrative: admListStr.includes(adminName),
  adminExportStatus: exp.status, adminExportHasClinicalFile: expStr.includes(clinicalName) || (up1.body?.id ? expStr.includes(up1.body.id) : false),
  adminExportHasAdministrativeFile: expStr.includes(adminName), exportOmitted: exp.body?.omitted,
  exportFileSensitivities: (exp.body?.sections?.files ?? []).map((f) => f.sensitivity + ":" + f.category),
};
writeFileSync(`${OUT}/file-sensitivity-probe.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
