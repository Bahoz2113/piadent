// CEZERİ teslim testi — 07.11.2026 geri bildirimi 2. paket HTTP vakaları (H01, H03, H04, H05). Ürün kodunu değiştirmez.
// Yalnız sentetik veri (sentetik PNG/DICOM baytları); üretime dokunulmaz.
// Kullanım: BASE=http://127.0.0.1:4000 PASSWORD=<güvenli ortam> OWNER_URL=<yerel> WORKER_URL=<yerel> OUT=<evidence> tsx qa-runs/.scripts/h-cases.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const pg = require("pg");

const BASE = process.env.BASE ?? "http://127.0.0.1:4000";
const PASSWORD = process.env.PASSWORD; const OUT = process.env.OUT ?? "evidence"; const OWNER_URL = process.env.OWNER_URL; const WORKER_URL = process.env.WORKER_URL;
if (!PASSWORD || !OWNER_URL || !WORKER_URL) { console.error("PASSWORD, OWNER_URL ve WORKER_URL gerekli"); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36).slice(-5);
const results = [];
const rec = (id, c, extra = "") => { const status = c.length && c.every((x) => x.pass) ? "PASS" : "FAIL";
  results.push({ id, status, summary: `${c.filter((x) => x.pass).length}/${c.length} kontrol${extra}: ${c.filter((x) => !x.pass).map((x) => x.check).join("; ") || "hepsi geçti"}`, at: new Date().toISOString(), evidence: `${id}-http.json` });
  writeFileSync(`${OUT}/${id}-http.json`, JSON.stringify({ checks: c }, null, 1)); console.log(`${status.padEnd(6)} ${id} ${results.at(-1).summary}`); };
const ok = (cond, label, list) => { list.push({ check: label, pass: !!cond }); return !!cond; };
const pool = new pg.Pool({ connectionString: OWNER_URL, max: 2 });
let TENANT = null;
const q = async (sql, args = [], tenant = TENANT) => { const c = await pool.connect();
  try { await c.query("begin"); await c.query("select set_config('app.tenant_id', $1, true)", [tenant]); const r = await c.query(sql, args); await c.query("commit"); return r.rows; } finally { c.release(); } };
async function api(s, method, path, body, headers = {}) {
  const h = { "content-type": "application/json", "x-viadent-request": "1", ...headers };
  if (s?.cookie) h.cookie = s.cookie; if (s?.ctx) h["x-viadent-context"] = s.ctx;
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j, headers: Object.fromEntries(r.headers), text: t };
}
async function login(email) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-viadent-request": "1" }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (r.status !== 200) { console.error("giriş", email.split("@")[0], r.status); process.exit(2); }
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const s = await (await fetch(`${BASE}/api/v1/session`, { headers: { cookie } })).json();
  return { cookie, ctx: s.activeMembership.id, tenantId: s.activeMembership.tenantId, permissions: s.activeMembership.permissions ?? s.permissions };
}
const key = () => "qa-" + randomUUID();
const TZ = "Europe/Istanbul";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const day = (n) => { const [y, m, d] = today().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const cents = (v) => Math.round(Number(v) * 100);
const sum = (rows, k) => rows.reduce((n, r) => n + cents(r[k]), 0);

const A = { admin: await login("yonetici@demo-yesil.test"), dentist: await login("elif.aras@demo-yesil.test"), sec: await login("sekreter@demo-yesil.test"),
  asst: await login("asistan@demo-yesil.test"), fin: await login("finans@demo-yesil.test") };
const B = { admin: await login("yonetici@demo-mavi.test") };
TENANT = A.admin.tenantId;
const newPatient = async (tag, extra = {}) => (await api(A.sec, "POST", "/patients", { firstName: "Sınama", lastName: `${tag}${RUN}`, phone: "0555 222 33 44", acknowledgeDuplicates: true, ...extra })).body.patient.id;
const pracId = (await api(A.admin, "POST", "/practitioners", { displayName: `Dt. Sınama ${RUN}` })).body.id;
await api(A.admin, "PUT", `/practitioners/${pracId}/schedule`, { blocks: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "13:00" })) });


const putBytes = async (s, fid, buf) => (await fetch(`${BASE}/api/v1/files/${fid}/content`, { method: "PUT", body: buf,
  headers: { "content-type": "application/octet-stream", "x-viadent-request": "1", cookie: s.cookie, "x-viadent-context": s.ctx } })).status;
const waitStatus = async (s, pid, fid, want, ms = 30000) => { const t0 = Date.now(); let st = null;
  while (Date.now() - t0 < ms) { st = (await api(s, "GET", `/patients/${pid}/files`)).body.items?.find((x) => x.id === fid)?.status; if (want.includes(st)) return st; await new Promise((r) => setTimeout(r, 700)); } return st; };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("qa-sentetik-png-".repeat(30))]);
const DCM = Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), Buffer.from("qa-sentetik-dicom-".repeat(20))]);

// H01 — gerçekleşen işlem dişe yansır (API sözleşmesi): çekim, iki yüz dolgu, kanal + kron; düzeltilen işlem haritada "corrected"; ziyaret şartı
{ const c = []; const pid = await newPatient("Dis");
  const procs = (await api(A.dentist, "GET", "/procedures")).body.items; const P = (code) => procs.find((x) => x.code === code);
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(Date.now() + 2 * 60_000));
  const nowM = Number(now.slice(0, 2)) * 60 + Number(now.slice(3));
  const ap = await api(A.sec, "POST", "/appointments", { patientId: pid, practitionerId: pracId, date: today(), startTime: now, durationMinutes: 15, allowOutsideHours: true });
  const fut = await api(A.sec, "POST", "/appointments", { patientId: pid, practitionerId: pracId, date: day(1), startTime: "10:00", durationMinutes: 15 });
  const noVisit = await api(A.dentist, "POST", `/patients/${pid}/performed`, { appointmentId: fut.body.id, procedureId: P("CEK-01").id, quantity: 1, location: { kind: "tooth", tooth: "36", surfaces: [] } });
  ok(noVisit.status === 422 && noVisit.body.code === "VISIT_REQUIRED", `gelmemiş randevuda işlem ${noVisit.status} ${noVisit.body.code}`, c);
  if (ap.status !== 201) { ok(nowM > 23 * 60 + 40, `bugün ileri saatli randevu açılamadı (${ap.status} ${ap.body?.code}) — yalnız gece yarısına yakınsa kabul`, c); }
  else {
    const ci = await api(A.sec, "POST", `/appointments/${ap.body.id}/status`, { version: ap.body.version, status: "checked_in" }); ok(ci.status === 200, `geldi ${ci.status}`, c);
    const rec2 = async (code, tooth, surfaces = []) => api(A.dentist, "POST", `/patients/${pid}/performed`, { appointmentId: ap.body.id, procedureId: P(code).id, quantity: 1, location: { kind: "tooth", tooth, surfaces } });
    const r1 = await rec2("CEK-01", "36"); const r2 = await rec2("DOL-02", "15", ["M", "O"]); const r3 = await rec2("KAN-01", "46"); const r4 = await rec2("KRN-01", "46");
    ok([r1, r2, r3, r4].every((r) => r.status === 201), `işlemler ${[r1, r2, r3, r4].map((r) => r.status).join("/")}`, c);
    const bad = await rec2("DOL-02", "15", []); ok(bad.status === 422, `yüzeysiz yüzey işlemi ${bad.status}`, c);
    const sekr = await api(A.sec, "POST", `/patients/${pid}/performed`, { appointmentId: ap.body.id, procedureId: P("CEK-01").id, quantity: 1, location: { kind: "tooth", tooth: "37", surfaces: [] } });
    ok(sekr.status === 403, `sekreter işlem kaydı ${sekr.status}`, c);
    const ch = (await api(A.dentist, "GET", `/patients/${pid}/chart`)).body.performed;
    const got = ch.filter((x) => x.status === "completed").map((x) => `${x.code}@${x.location.tooth}${(x.location.surfaces || []).join("")}`).sort();
    ok(JSON.stringify(got) === JSON.stringify(["CEK-01@36", "DOL-02@15MO", "KAN-01@46", "KRN-01@46"]), `harita ${got.join(",")}`, c);
    ok(ch.every((x) => x.at && x.practitioner), "her işlemde tarih ve hekim (ipucu/ayrıntı verisi)", c);
    const acc = (await api(A.sec, "GET", `/patients/${pid}/account`)).body.totals; ok(cents(acc.openDebt) > 0, `hesaba alacak ${acc.openDebt}`, c);
    const secChart = await api(A.sec, "GET", `/patients/${pid}/chart`); ok(secChart.status === 403, `sekreter harita ${secChart.status}`, c);
  }
  rec("H01", c);
}

// H03 — her belge türünde onaylı şablon; 39 şablonun her biri önizlemede hasta bilgisiyle eksiksiz dolar (yer tutucu kalmaz); DEMO işaretli
{ const c = []; const pid = await newPatient("Belge", { birthDate: "1981-02-03" });
  const types = (await api(A.dentist, "GET", "/document-types")).body.items;
  ok(types.length === 42, `tür sayısı ${types.length}`, c);
  const noTpl = types.filter((t) => !t.approvedTemplates.length).map((t) => t.code); ok(noTpl.length === 0, `şablonsuz tür: ${noTpl.join(",") || "yok"}`, c);
  const nonClinical = types.filter((t) => t.category !== "clinical_output");
  const bad = []; let demo = 0;
  for (const t of nonClinical) {
    const v = t.approvedTemplates[0].versionId; const pv = await api(t.issuerRole === "dentist" ? A.dentist : A.sec, "POST", `/template-versions/${v}/preview`, { patientId: pid });
    const okOne = pv.status === 200 && /^PİA-DENT ÖRNEK METİN \(DEMO\)/.test(pv.body.content) && pv.body.content.includes(`Sınama Belge${RUN}`) && !/\{\{/.test(pv.body.content) && (!pv.body.content.includes("Doğum tarihi") || pv.body.content.includes("03.02.1981"));
    if (pv.body?.isDemo) demo++; if (!okOne) bad.push(`${t.code}:${pv.status}`);
  }
  ok(nonClinical.length === 39 && bad.length === 0, `önizleme ${nonClinical.length - bad.length}/${nonClinical.length}${bad.length ? " hatalı " + bad.join(",") : ""}`, c);
  ok(demo === nonClinical.length, `DEMO işaretli ${demo}`, c);
  const forbidden = (await q("select d.code from template_versions v join templates t on t.id = v.template_id join document_types d on d.id = t.document_type_id where v.status = 'approved' and (v.body ~* 'yasal olarak geçerli|bakanlık onaylı|tam uyumlu|macrodental')")).map((x) => x.code);
  ok(forbidden.length === 0, `yasak ifade: ${forbidden.join(",") || "yok"}`, c);
  const fin = await api(A.fin, "GET", "/document-types"); ok(fin.status === 403, `finans belge türleri ${fin.status}`, c);
  const issued = await api(A.sec, "POST", "/documents", { patientId: pid, templateVersionId: types.find((t) => t.code === "CEKIM-ONAM").approvedTemplates[0].versionId });
  ok(issued.status === 201 && /^[0-9a-f]{64}$/.test(issued.body.contentHash), `diş çekimi onamı üretildi ${issued.status}`, c);
  rec("H03", c, ` (${nonClinical.length} şablon önizlendi)`);
}

// H04 — 0037 migration yeniden uygulanabilir (değişiklik yok); B kiracısı da tam; yer tutucu sürüm kalmadı
{ const c = []; const sql = (await import("node:fs")).readFileSync(new URL("../../packages/db/migrations/0037_standard_document_templates.sql", import.meta.url), "utf8");
  const cnt = async (t) => (await q("select (select count(*) from document_types)::int as d, (select count(*) from templates)::int as t, (select count(*) from template_versions)::int as v", [], t))[0];
  const before = [await cnt(A.admin.tenantId), await cnt(B.admin.tenantId)];
  const cl = await pool.connect(); try { await cl.query("begin"); await cl.query(sql); await cl.query("commit"); } catch (e) { await cl.query("rollback"); ok(false, `migration hata ${e.message}`, c); } finally { cl.release(); }
  const after = [await cnt(A.admin.tenantId), await cnt(B.admin.tenantId)];
  ok(JSON.stringify(before) === JSON.stringify(after), `tekrar uygulama değişiklik yok A ${JSON.stringify(after[0])} B ${JSON.stringify(after[1])}`, c);
  ok(after[1].d === 42, `B kiracısı tür ${after[1].d}`, c);
  const ph = await q("select count(*)::int as n from template_versions where status = 'approved' and body like 'SENTETİK DEMO BELGESİ%'"); ok(ph[0].n === 0, `onaylı yer tutucu ${ph[0].n}`, c);
  const bTypes = (await api(B.admin, "GET", "/document-types")).body.items; ok(bTypes.every((t) => t.approvedTemplates.length > 0), "B kiracısında her tür şablonlu", c);
  rec("H04", c);
}

// H05 — Görüntülemeler: tür/çekim tarihi/diş/not; DICOM imza doğrulaması; sağlık verisi görünürlüğü; doğrulama; kiracı yalıtımı
{ const c = []; const pid = await newPatient("Film");
  const base = { patientId: pid, originalName: "pan.png", contentType: "image/png", size: PNG.length };
  const f1 = await api(A.asst, "POST", "/files", { ...base, category: "radiograph", imagingKind: "panoramic", takenOn: day(-5), teeth: ["16", "26"], imagingNote: "QA sentetik" });
  ok(f1.status === 201, `asistan panoramik ${f1.status}`, c);
  ok((await putBytes(A.asst, f1.body.id, PNG)) === 200, "içerik gönderildi", c);
  const f2 = await api(A.dentist, "POST", "/files", { ...base, originalName: "cbct.dcm", contentType: "application/dicom", size: DCM.length, category: "radiograph", imagingKind: "cbct", takenOn: day(0) });
  ok(f2.status === 201 && (await putBytes(A.dentist, f2.body.id, DCM)) === 200, `DICOM ${f2.status}`, c);
  const f3 = await api(A.dentist, "POST", "/files", { ...base, originalName: "sahte.dcm", contentType: "application/dicom", size: PNG.length, category: "radiograph", imagingKind: "mr" });
  await putBytes(A.dentist, f3.body.id, PNG);
  const s1 = await waitStatus(A.dentist, pid, f1.body.id, ["available", "rejected", "quarantined"]); const s2 = await waitStatus(A.dentist, pid, f2.body.id, ["available", "rejected", "quarantined"]);
  const s3 = await waitStatus(A.dentist, pid, f3.body.id, ["available", "rejected", "quarantined"]);
  ok(s1 === "available" && s2 === "available" && s3 === "rejected", `tarama panoramik=${s1} DICOM=${s2} sahte DICOM=${s3}`, c);
  const row = (await api(A.dentist, "GET", `/patients/${pid}/files`)).body.items.find((x) => x.id === f1.body.id);
  ok(row?.imagingKind === "panoramic" && row.takenOn === day(-5) && JSON.stringify(row.teeth) === '["16","26"]' && row.imagingNote === "QA sentetik", `meta ${JSON.stringify({ k: row?.imagingKind, t: row?.takenOn, d: row?.teeth })}`, c);
  const dl = await fetch(`${BASE}/api/v1/files/${f1.body.id}/content`, { headers: { cookie: A.admin.cookie, "x-viadent-context": A.admin.ctx } });
  ok(dl.status === 200 && Buffer.from(await dl.arrayBuffer()).equals(PNG), `yönetici açar ${dl.status}`, c);
  const ev = await q("select action from file_access_events where file_id = $1 order by at", [f1.body.id]); ok(ev.some((e) => e.action === "downloaded"), "açılış erişim izinde", c);
  const secList = (await api(A.sec, "GET", `/patients/${pid}/files`)).body.items; ok(secList.length === 0, `sekreter listesi ${secList.length}`, c);
  const secDl = await fetch(`${BASE}/api/v1/files/${f1.body.id}/content`, { headers: { cookie: A.sec.cookie, "x-viadent-context": A.sec.ctx } }); ok(secDl.status === 404, `sekreter içerik ${secDl.status}`, c);
  const secUp = await api(A.sec, "POST", "/files", { ...base, category: "radiograph", imagingKind: "periapical" }); ok(secUp.status === 403, `sekreter yükleme ${secUp.status}`, c);
  const finL = await api(A.fin, "GET", `/patients/${pid}/files`); ok(finL.status === 403 || (finL.body.items ?? []).length === 0, `finans ${finL.status}`, c);
  const bL = await api(B.admin, "GET", `/patients/${pid}/files`); ok(bL.status === 404, `B kiracısı ${bL.status}`, c);
  const v = [
    ["gelecek tarih", { ...base, category: "radiograph", imagingKind: "panoramic", takenOn: day(1) }],
    ["tür–kategori uyuşmazlığı", { ...base, category: "radiograph", imagingKind: "intraoral_photo" }],
    ["geçersiz diş", { ...base, category: "radiograph", imagingKind: "periapical", teeth: ["59"] }],
    ["tekrarlı diş", { ...base, category: "radiograph", imagingKind: "periapical", teeth: ["11", "11"] }],
    ["DICOM fotoğraf", { ...base, category: "clinical_photo", contentType: "application/dicom", imagingKind: "intraoral_photo" }],
    ["DICOM belge taraması", { ...base, category: "document_scan", contentType: "application/dicom" }],
    ["türsüz meta", { ...base, category: "radiograph", teeth: ["11"] }],
    ["uzun not", { ...base, category: "radiograph", imagingKind: "other", imagingNote: "x".repeat(501) }],
    ["21 MB", { ...base, category: "radiograph", imagingKind: "other", size: 21 * 1024 * 1024 }],
    ["desteklenmeyen tür", { ...base, category: "radiograph", imagingKind: "other", contentType: "image/tiff" }],
  ];
  const vr = []; for (const [l, b] of v) { const r = await api(A.dentist, "POST", "/files", b); vr.push(`${l}=${r.status}`); ok(r.status === 422, `${l} ${r.status}`, c); }
  const photo = await api(A.dentist, "POST", "/files", { ...base, category: "clinical_photo", imagingKind: "intraoral_photo", teeth: ["51", "85"] }); ok(photo.status === 201, `süt dişli fotoğraf ${photo.status}`, c);
  const cols = await q("select column_name from information_schema.columns where table_name = 'file_assets' and column_name in ('imaging_kind','taken_on','teeth','imaging_note') order by 1");
  ok(cols.length === 4, `kolonlar ${cols.map((x) => x.column_name).join(",")}`, c);
  rec("H05", c, ` (doğrulama: ${vr.join(", ")})`);
}

// H10 — ADR-104 ek: katalog uygulama içinden tamamlanır (canlı demo yolu); B kiracısı etkilenmez; tekrar yazmaz
{ const c = [];
  const bBefore = (await q("select count(*)::int as n from template_versions", [], B.admin.tenantId))[0].n;
  await q("update template_versions v set status = 'retired' from templates t, document_types d where v.template_id = t.id and t.document_type_id = d.id and d.code in ('APIKAL-REZ-ONAM','ORTO-SONU-BILGI') and v.status = 'approved'");
  const gone = (await api(A.sec, "GET", "/document-types")).body.items.filter((t) => ["APIKAL-REZ-ONAM", "ORTO-SONU-BILGI"].includes(t.code));
  ok(gone.length === 2 && gone.every((t) => t.approvedTemplates.length === 1), `şablonu kaldırılan 2 tür ilk açılışta yeniden şablonlu (${gone.map((t) => t.approvedTemplates.length).join("/")})`, c);
  const n1 = (await q("select count(*)::int as n from template_versions"))[0].n; await api(A.sec, "GET", "/document-types");
  ok((await q("select count(*)::int as n from template_versions"))[0].n === n1, "ikinci açılış yazmaz", c);
  ok((await q("select count(*)::int as n from audit_events where action = 'document_catalog.install'"))[0].n >= 1, "denetim olayı", c);
  ok((await q("select count(*)::int as n from template_versions", [], B.admin.tenantId))[0].n === bBefore, "B kiracısı değişmedi", c);
  const vid = gone[0]?.approvedTemplates?.[0]?.versionId;
  const pv = vid ? await api(A.sec, "POST", `/template-versions/${vid}/preview`, { patientId: await newPatient("Kat") }) : { status: "şablon yok", body: {} };
  ok(pv.status === 200 && /^PİA-DENT ÖRNEK METİN \(DEMO\)/.test(pv.body.content), `yeni şablon önizlenir ${pv.status}`, c);
  rec("H10", c);
}

// H09 — ADR-106: cinsiyet üç seçenek; başlangıç görünümü açık + mavi (seçim yapmamış kullanıcı)
{ const c = [];
  for (const [g, want] of [["female", 201], ["male", 201], ["unspecified", 201], ["other", 422], ["diger", 422]]) {
    const r = await api(A.sec, "POST", "/patients", { firstName: "Cins", lastName: `${g}${RUN}`, gender: g, acknowledgeDuplicates: true }); ok(r.status === want, `cinsiyet ${g} ${r.status}`, c);
  }
  const db = await q("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'patients_gender_check'"); ok(/'female'.*'male'.*'unspecified'/.test(db[0]?.d ?? "") && !/other/.test(db[0]?.d ?? ""), `DB kısıtı ${db[0]?.d}`, c);
  // Tester düzeltmesi (tur3): hata alan transaction geri alınmadan bağlantı havuza dönüyordu (25P02); ayrı bağlantı + rollback.
  let bad = false; { const cl = await pool.connect(); try { await cl.query("begin"); await cl.query("select set_config('app.tenant_id', $1, true)", [TENANT]);
    await cl.query("update patients set gender = 'other' where id = (select id from patients limit 1)"); } catch { bad = true; } finally { await cl.query("rollback").catch(() => {}); cl.release(); } }
  ok(bad, "DB 'other' yazımını reddeder", c);
  const fresh = (await q("select count(*)::int as n from patients where gender = 'other'"))[0].n; ok(fresh === 0, `'other' kayıt ${fresh}`, c);
  const ap = await api(A.fin, "GET", "/me/appearance"); ok(ap.status === 200 && ap.body.scheme === "light" && ap.body.accent === "mavi" && ap.body.scale === 3, `başlangıç görünümü ${JSON.stringify(ap.body)}`, c);
  // Tester düzeltmesi (tur4): oturum yanıtı görünümü varsayılanla doldurulmuş döner; saklı değer DB'de boş kalmalı.
  const ses = (await (await fetch(`${BASE}/api/v1/session`, { headers: { cookie: A.fin.cookie } })).json());
  ok(JSON.stringify(ses.user.appearance) === '{"scheme":"light","accent":"mavi","scale":3}', `oturumda başlangıç görünümü ${JSON.stringify(ses.user.appearance)}`, c);
  const stored = (await pool.query("select appearance from users where email = 'finans@demo-yesil.test'")).rows[0]?.appearance;
  ok(!stored || Object.keys(stored).length === 0, `seçim yapmamış kullanıcıda saklı görünüm yok (${JSON.stringify(stored)})`, c);
  rec("H09", c);
}

writeFileSync(`${OUT}/h-summary.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
await pool.end();
