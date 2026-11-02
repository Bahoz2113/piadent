// CEZERİ tester sondası — klinik çıktı belgesine bağlı idari kategorili dosya (QA-107). Ürün kodunu değiştirmez.
// n-cases N05'in oluşturduğu "Epikriz Sınama" hastasını kullanır. Kullanım: BASE=… PASSWORD=… OUT=… node qa-runs/.scripts/linked-file-probe.mjs
import { writeFileSync } from "node:fs";
const B = (process.env.BASE ?? "http://127.0.0.1:4000") + "/api/v1";
const OUT = process.env.OUT ?? "evidence";
const login = async (email) => {
  const r = await fetch(B + "/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-viadent-request": "1" }, body: JSON.stringify({ email, password: process.env.PASSWORD }) });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const s = await (await fetch(B + "/session", { headers: { cookie } })).json();
  return { cookie, "x-viadent-context": s.activeMembership.id, "x-viadent-request": "1", "content-type": "application/json" };
};
const dr = await login("elif.aras@demo-yesil.test"), sec = await login("sekreter@demo-yesil.test");
const pid = (await (await fetch(B + "/patients?q=" + encodeURIComponent("Epikriz Sınama"), { headers: dr })).json()).items[0].id;
const docs = (await (await fetch(B + "/patients/" + pid + "/documents", { headers: dr })).json()).items;
const doc = docs.find((d) => d.status === "issued") ?? docs[0];
const up = await fetch(B + "/files", { method: "POST", headers: dr, body: JSON.stringify({ patientId: pid, category: "document_scan", originalName: "epikriz-imzali-tarama.pdf", contentType: "application/pdf", size: 2048, patientDocumentId: doc.id }) });
const fid = (await up.json()).id;
const st = async (h, p, m = "GET") => (await fetch(B + p, { method: m, headers: h, body: m === "POST" ? "{}" : undefined })).status;
const fake = "00000000-0000-4000-8000-000000000000";
const secList = await (await fetch(B + "/patients/" + pid + "/files", { headers: sec })).json();
const res = {
  docType: doc.typeName, dentistUpload: up.status,
  secretaryListSeesFile: (secList.items ?? []).some((f) => f.id === fid),
  secDetail: [await st(sec, "/files/" + fid), await st(sec, "/files/" + fake)],
  secContent: [await st(sec, "/files/" + fid + "/content"), await st(sec, "/files/" + fake + "/content")],
  secDelete: [await st(sec, "/files/" + fid + "/delete", "POST"), await st(sec, "/files/" + fake + "/delete", "POST")],
  drDetail: await st(dr, "/files/" + fid),
  drListSees: JSON.stringify(await (await fetch(B + "/patients/" + pid + "/files", { headers: dr })).json()).includes(fid),
};
writeFileSync(`${OUT}/linked-file-probe.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
