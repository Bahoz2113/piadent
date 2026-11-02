// CEZERİ tester sondası — onam kanıtına bağlanan klinik dosyanın kimliği sağlık yetkisi olmayana görünüyor mu (fix3 risk 2). Ürün kodunu değiştirmez.
// Kullanım: BASE=… PASSWORD=… OUT=… node qa-runs/.scripts/evidence-file-probe.mjs
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
const pid = (await api(dr, "POST", "/patients", { firstName: "Kanıt", lastName: "Sonda", birthDate: "1992-03-03" })).body?.patient?.id;
const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), Buffer.alloc(1004, 0x20), Buffer.from([0xff, 0xd9])]);
const fid = (await api(dr, "POST", "/files", { patientId: pid, category: "radiograph", originalName: "kanit-sonda-radyograf.jpg", contentType: "image/jpeg", size: bytes.length })).body?.id;
const put = (await fetch(`${B}/files/${fid}/content`, { method: "PUT", headers: { ...dr, "content-type": "application/octet-stream" }, body: bytes })).status;
let fileStatus = null;
for (let i = 0; i < 30; i++) { fileStatus = (await api(dr, "GET", `/files/${fid}`)).body?.status; if (fileStatus === "available" || fileStatus === "quarantined" || fileStatus === "rejected") break; await new Promise((r) => setTimeout(r, 1000)); }
const types = (await api(dr, "GET", "/document-types")).body.items;
const consent = types.find((t) => t.requiresAcceptance && t.category !== "clinical_output" && t.approvedTemplates?.length);
const doc = await api(dr, "POST", "/documents", { patientId: pid, templateVersionId: consent.approvedTemplates[0].versionId });
const dec = await api(dr, "POST", `/documents/${doc.body?.id}/decision`, { decision: "accepted", method: "verbal_in_person", attestation: true, fileId: fid });
const secDoc = await api(sec, "GET", `/documents/${doc.body?.id}`);
const exp = (await api(adm, "POST", `/patients/${pid}/export`, { reason: "QA KVKK erişim talebi sınaması (kanıt dosyası)" })).body;
const res = {
  upload: put, fileStatus, consentType: consent?.code, docCreate: doc.status, dentistDecisionWithClinicalFile: dec.status,
  secretaryDocDetail: secDoc.status, secretarySeesClinicalFileId: JSON.stringify(secDoc.body?.evidence ?? []).includes(fid),
  secretaryFileDetail: (await api(sec, "GET", `/files/${fid}`)).status,
  adminExportEvidenceHasFileId: JSON.stringify(exp?.sections?.evidence_events ?? []).includes(fid),
};
writeFileSync(`${OUT}/evidence-file-probe.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
