// CEZERİ tester sondası — klinik dosyanın izleri (geçmiş, dışa aktarım access_log, onam kanıtı file_id). Ürün kodunu değiştirmez.
// fix3 risk 1/2 adaylarını bağımsız üretir. Kullanım: BASE=… PASSWORD=… OUT=… node qa-runs/.scripts/file-trace-probe.mjs
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
const items = (x) => x?.items ?? x?.events ?? [];
const dr = await login("elif.aras@demo-yesil.test"), sec = await login("sekreter@demo-yesil.test"), adm = await login("yonetici@demo-yesil.test");
const pid = (await api(dr, "POST", "/patients", { firstName: "İz", lastName: "Sonda", birthDate: "1991-02-02" })).body?.patient?.id;
// Gerçek baytlarla klinik radyograf (en küçük geçerli JPEG başlığı + dolgu)
const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), Buffer.alloc(1004, 0x20), Buffer.from([0xff, 0xd9])]);
const init = await api(dr, "POST", "/files", { patientId: pid, category: "radiograph", originalName: "iz-sonda-radyograf.jpg", contentType: "image/jpeg", size: bytes.length });
const fid = init.body?.id;
const put = await fetch(`${B}/files/${fid}/content`, { method: "PUT", headers: { ...dr, "content-type": "application/octet-stream" }, body: bytes });
const secHist = items((await api(sec, "GET", `/patients/${pid}/history`)).body);
const admHist = items((await api(adm, "GET", `/patients/${pid}/history`)).body);
const drHist = items((await api(dr, "GET", `/patients/${pid}/history`)).body);
const exp = (await api(adm, "POST", `/patients/${pid}/export`, { reason: "QA KVKK erişim talebi sınaması (iz)" })).body;
const accessLogFileRows = (exp?.sections?.access_log ?? []).filter((e) => (e.entity_type ?? e.entityType) === "file_asset" || /^file\./.test(e.action));
const res = {
  initiate: init.status, upload: put.status,
  dentistHistoryFileEvents: drHist.filter((e) => e.entityId === fid).map((e) => e.action),
  secretaryHistoryFileEvents: secHist.filter((e) => e.entityId === fid || JSON.stringify(e).includes(fid)).map((e) => e.action),
  adminHistoryFileEvents: admHist.filter((e) => e.entityId === fid || JSON.stringify(e).includes(fid)).map((e) => e.action),
  adminExportFilesHasIt: JSON.stringify(exp?.sections?.files ?? []).includes(fid),
  adminExportAccessLogFileRows: accessLogFileRows.length,
  adminExportAccessLogMentionsFid: JSON.stringify(exp?.sections?.access_log ?? []).includes(fid),
};
writeFileSync(`${OUT}/file-trace-probe.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
