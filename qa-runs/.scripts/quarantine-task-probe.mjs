// CEZERİ tester sondası — gizli klinik dosya karantinaya düşerse görev listesi ne gösteriyor (fix4 risk 1). Ürün kodunu değiştirmez.
// Sentetik, zararsız PDF: yalnız "/JavaScript" anahtar sözcüğü (tarayıcı kuralını tetikler), çalıştırılabilir içerik yok.
// Kullanım: BASE=… PASSWORD=… OUT=… node qa-runs/.scripts/quarantine-task-probe.mjs
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
const pid = (await api(dr, "POST", "/patients", { firstName: "Karantina", lastName: "Sonda", birthDate: "1993-04-04" })).body?.patient?.id;
const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction 2 0 R >> endobj\n2 0 obj << /S /JavaScript /JS (sentetik) >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");
const fid = (await api(dr, "POST", "/files", { patientId: pid, category: "clinical_document", originalName: "karantina-sonda-klinik.pdf", contentType: "application/pdf", size: pdf.length })).body?.id;
const put = (await fetch(`${B}/files/${fid}/content`, { method: "PUT", headers: { ...dr, "content-type": "application/octet-stream" }, body: pdf })).status;
let st = null;
for (let i = 0; i < 30; i++) { st = (await api(dr, "GET", `/files/${fid}`)).body?.status; if (["quarantined", "rejected", "available"].includes(st)) break; await new Promise((r) => setTimeout(r, 1000)); }
const has = (b) => JSON.stringify(b ?? {}).includes(fid);
const tasksSec = await api(sec, "GET", "/tasks"), tasksAdm = await api(adm, "GET", "/tasks"), tasksDr = await api(dr, "GET", "/tasks");
const pick = (b) => (b?.items ?? b?.tasks ?? []).filter((t) => JSON.stringify(t).includes(fid)).map((t) => ({ kind: t.kind, sensitivity: t.sensitivity, assigneeRole: t.assigneeRole ?? t.assignee_role, hasPatient: !!(t.patientId ?? t.patient_id ?? t.patient) }));
const res = {
  upload: put, fileStatus: st,
  secretaryTasksStatus: tasksSec.status, secretarySeesFileId: has(tasksSec.body), secretaryTask: pick(tasksSec.body),
  adminSeesFileId: has(tasksAdm.body), adminTask: pick(tasksAdm.body), adminFileDetail: (await api(adm, "GET", `/files/${fid}`)).status,
  dentistSeesFileId: has(tasksDr.body),
};
writeFileSync(`${OUT}/quarantine-task-probe.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
