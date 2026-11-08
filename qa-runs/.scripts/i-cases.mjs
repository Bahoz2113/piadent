// CEZERİ teslim testi — 08.11.2026 geri bildirimi (ADR-107) HTTP/DB vakaları I01–I06. Ürün kodunu değiştirmez; yalnız sentetik veri.
// Kullanım: BASE=http://127.0.0.1:4000 PASSWORD=<güvenli ortam> OWNER_URL=<yerel> WORKER_URL=<yerel> OUT=<evidence> tsx qa-runs/.scripts/i-cases.mjs
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
const res = (await api(A.sec, "GET", "/resources")).body;
const procs = (await api(A.sec, "GET", "/procedures")).body.items;
// Koşuya özel hekim: seed/E2E randevularıyla saat çakışması olmasın (F01 ile aynı yaklaşım).
const PRAC = (await api(A.admin, "POST", "/practitioners", { displayName: `Zz Dt. QA I ${RUN}` })).body.id;
let slot = 0;
const nextSlot = () => { const m = 9 * 60 + 15 * slot++; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
// Hafta içi bir gün (çalışma saati), 6–12 gün sonrası
let D = 6 + (parseInt(RUN, 36) % 20); while ([0, 6].includes(new Date(day(D) + "T12:00:00Z").getUTCDay())) D++;
const appt = (patientId, extra = {}) => ({ patientId, practitionerId: PRAC, date: day(D), startTime: nextSlot(), durationMinutes: 15, allowOutsideHours: true, ...extra });
async function newPatient(tag) {
  const r = await api(A.sec, "POST", "/patients", { firstName: `Qa${tag}`, lastName: `Içase${RUN}`, birthDate: "1981-02-03", acknowledgeDuplicates: true });
  return r.body.patient.id;
}

// I01 — işlemsiz randevu (sekreter); sınır: boş procedureIds dizisi de işlemsiz
{ const c = [];
  const p = await newPatient("A");
  const r = await api(A.sec, "POST", "/appointments", appt(p));
  ok(r.status === 201, `işlemsiz randevu ${r.status} ${r.status !== 201 ? JSON.stringify(r.body).slice(0, 200) : ""}`, c);
  ok(Array.isArray(r.body.procedures) && r.body.procedures.length === 0 && r.body.procedureId === null && r.body.plannedPrice === null, `boş işlem listesi ${JSON.stringify(r.body.procedures)}`, c);
  const r2 = await api(A.sec, "POST", "/appointments", appt(p, { procedureIds: [] }));
  ok(r2.status === 201 && r2.body.procedures.length === 0, `procedureIds: [] ${r2.status}`, c);
  ok((await q("select count(*)::int as n from appointment_procedures where appointment_id = any($1::uuid[])", [[r.body.id, r2.body.id]]))[0].n === 0, "liste satırı yok", c);
  rec("I01", c);
}

// I02 — birden fazla işlem: sıra, ilk işlem, fiyatlar, toplam (tam sayı kuruş), neden, denetim, gün listesi ve hasta randevuları
{ const c = [];
  const priced = procs.filter((x) => x.price).slice(0, 4);
  const ids = [priced[3].id, priced[1].id, priced[0].id];
  const prices = []; for (const id of ids) prices.push((await api(A.sec, "GET", `/price?procedureId=${id}&practitionerId=${PRAC}&date=${day(D)}`)).body.price);
  const p = await newPatient("B");
  const r = await api(A.sec, "POST", "/appointments", appt(p, { procedureIds: ids }));
  ok(r.status === 201, `kayıt ${r.status}`, c);
  ok(JSON.stringify(r.body.procedures?.map((x) => x.id)) === JSON.stringify(ids), "sıra korunur", c);
  ok(r.body.procedureId === ids[0], "procedureId = ilk işlem", c);
  ok(JSON.stringify(r.body.procedures?.map((x) => x.price)) === JSON.stringify(prices), `işlem fiyatları = /price ${JSON.stringify(prices)}`, c);
  const total = prices.reduce((s, v) => s + cents(v), 0);
  ok(cents(r.body.plannedPrice) === total && /^\d+\.\d{2}$/.test(r.body.plannedPrice), `toplam ${r.body.plannedPrice} = ${total / 100}`, c);
  ok(r.body.reason === ids.map((id) => procs.find((x) => x.id === id).name).join(", "), `neden ${r.body.reason}`, c);
  const rows = await q("select procedure_id, position from appointment_procedures where appointment_id = $1 order by position", [r.body.id]);
  ok(JSON.stringify(rows.map((x) => [x.procedure_id, x.position])) === JSON.stringify(ids.map((id, i) => [id, i + 1])), "DB sıra 1..3", c);
  const au = await q("select changes from audit_events where action = 'appointment.create' and entity_id = $1", [r.body.id]);
  ok(JSON.stringify(au[0]?.changes?.procedure_ids?.to) === JSON.stringify(ids), "denetim procedure_ids", c);
  const dl = (await api(A.sec, "GET", `/appointments?date=${day(D)}`)).body.items.find((x) => x.id === r.body.id);
  ok(dl?.procedures?.length === 3 && dl.plannedPrice === r.body.plannedPrice, "gün listesi aynı", c);
  const pl = (await api(A.sec, "GET", `/patients/${p}/appointments`)).body.items.find((x) => x.id === r.body.id);
  ok(pl?.procedures?.length === 3, "hasta randevuları aynı", c);
  // açıklama verilirse işlem adları yazılmaz; 10 işlem sınırı tam 10 ile geçer
  const r3 = await api(A.sec, "POST", "/appointments", appt(p, { procedureIds: procs.slice(0, 10).map((x) => x.id), reason: "Kontrol + şikâyet", durationMinutes: 15 }));
  ok(r3.status === 201 && r3.body.procedures.length === 10 && r3.body.reason === "Kontrol + şikâyet", `10 işlem sınırı ${r3.status}`, c);
  ok((r3.body.reason ?? "").length <= 120, "neden ≤ 120", c);
  rec("I02", c);
}

// I03 — doğrulama: tekrar, 11 işlem, bilinmeyen, pasif, biçim dışı, yanlış tip → 422; hiçbir yazım yok
{ const c = [];
  const p = await newPatient("C");
  const n0 = (await q("select count(*)::int as n from appointments where patient_id = $1", [p]))[0].n;
  const cases = [
    ["aynı işlem iki kez", { procedureIds: [procs[0].id, procs[0].id] }],
    ["11 işlem", { procedureIds: procs.slice(0, 11).map((x) => x.id) }],
    ["bilinmeyen işlem", { procedureIds: [procs[0].id, randomUUID()] }],
    ["uuid olmayan", { procedureIds: ["abc"] }],
    ["dizi değil", { procedureIds: procs[0].id }],
    ["null öğe", { procedureIds: [null] }],
  ];
  for (const [label, extra] of cases) { const r = await api(A.sec, "POST", "/appointments", appt(p, extra)); ok(r.status === 422, `${label} → ${r.status}`, c); }
  const inactive = (await q(`insert into procedures(tenant_id, code, name, category, tooth_scope, default_minutes, active) values ($1, $2, 'Pasif sentetik işlem', 'Diğer', 'mouth', 10, false) returning id`, [TENANT, `QA-P-${RUN.toUpperCase()}`]))[0].id;
  const ri = await api(A.sec, "POST", "/appointments", appt(p, { procedureIds: [inactive] }));
  ok(ri.status === 422 && !!ri.body.field_errors?.procedureIds, `pasif işlem → ${ri.status}`, c);
  const bProc = (await q("select id from procedures limit 1", [], B.admin.tenantId))[0].id;
  const rb = await api(A.sec, "POST", "/appointments", appt(p, { procedureIds: [bProc] }));
  ok(rb.status === 422, `B kiracısının işlemi → ${rb.status}`, c);
  ok((await q("select count(*)::int as n from appointments where patient_id = $1", [p]))[0].n === n0, "hiç randevu yazılmadı", c);
  rec("I03", c);
}

// I04 — kiracı yalıtımı ve yetki: FORCE RLS; B, A'nın satırlarını görmez; A randevusu B'den okunamaz; uygulama rolü silemez/güncelleyemez
{ const c = [];
  const rls = (await pool.query("select relrowsecurity, relforcerowsecurity from pg_class where relname = 'appointment_procedures'")).rows[0];
  ok(rls?.relrowsecurity && rls?.relforcerowsecurity, "ENABLE + FORCE RLS", c);
  const grants = (await pool.query("select privilege_type from information_schema.role_table_grants where table_name = 'appointment_procedures' and grantee = 'viadent_app' order by 1")).rows.map((r) => r.privilege_type);
  ok(JSON.stringify(grants) === '["INSERT","SELECT"]', `uygulama rolü yetkileri ${grants}`, c);
  const aRows = (await q("select count(*)::int as n from appointment_procedures"))[0].n;
  const leak = (await q("select count(*)::int as n from appointment_procedures where tenant_id = $1", [TENANT], B.admin.tenantId))[0].n;
  ok(aRows > 0 && leak === 0, `A satırları ${aRows}, B'den görünen ${leak}`, c);
  const one = (await q("select appointment_id from appointment_procedures limit 1"))[0].appointment_id;
  const bl = await api(B.admin, "GET", `/appointments?date=${day(D)}`);
  ok(bl.status === 200 && !bl.body.items.some((x) => x.id === one), "B gün listesinde A randevusu yok", c);
  const fin = await api(A.fin, "POST", "/appointments", appt(await newPatient("Fin"), { procedureIds: [procs[0].id] }));
  ok([403].includes(fin.status), `finans randevu veremez → ${fin.status}`, c);
  rec("I04", c);
}

// I05 — ziyarete birden fazla tanı (hekim); sekreter/finans tanı yazamaz ve tanı içeriğini okuyamaz
{ const c = [];
  const p = await newPatient("T");
  const a = (await api(A.sec, "POST", "/appointments", appt(p))).body;
  for (const t of ["16", "26", "36"]) {
    const r = await api(A.dentist, "POST", `/patients/${p}/diagnoses`, { appointmentId: a.id, description: "Sentetik çürük", code: "K02.1", location: { kind: "tooth", tooth: t, surfaces: [] } });
    ok(r.status === 201, `diş ${t} tanı ${r.status}`, c);
  }
  const g = await api(A.dentist, "POST", `/patients/${p}/diagnoses`, { appointmentId: a.id, description: "Sentetik gingivit", location: { kind: "mouth" } });
  ok(g.status === 201, `genel tanı ${g.status}`, c);
  const ch = (await api(A.dentist, "GET", `/patients/${p}/chart`)).body;
  const v = ch.diagnoses.filter((d) => d.appointmentId === a.id);
  ok(v.length === 4 && JSON.stringify(v.map((d) => d.location.tooth ?? "genel").sort()) === '["16","26","36","genel"]', `ziyaretin tanıları ${v.length}`, c);
  const s = await api(A.sec, "POST", `/patients/${p}/diagnoses`, { appointmentId: a.id, description: "Sekreter", location: { kind: "mouth" } });
  ok(s.status === 403, `sekreter tanı → ${s.status}`, c);
  const sc = await api(A.sec, "GET", `/patients/${p}/chart`);
  ok(sc.status === 403 || !(sc.body.diagnoses ?? []).some((d) => /Sentetik/.test(d.description ?? "")), `sekreter tanı içeriği görmez (${sc.status})`, c);
  const other = await newPatient("Y");
  const wrong = await api(A.dentist, "POST", `/patients/${other}/diagnoses`, { appointmentId: a.id, description: "Yanlış ziyaret", location: { kind: "mouth" } });
  ok(wrong.status === 422, `başka hastanın ziyareti → ${wrong.status}`, c);
  rec("I05", c);
}

// I06 — Koltuk → Ünite: kaynak adları; çakışma ayrıntısı 'ünite'; kapatma hatası 'Ünite'; 0040 yalnız varsayılan adlar
{ const c = [];
  ok(JSON.stringify(res.chairs.map((x) => x.name).sort()) === '["Ünite A","Ünite B","Ünite C"]', `A üniteleri ${res.chairs.map((x) => x.name)}`, c);
  const bres = (await api(B.admin, "GET", "/resources")).body;
  ok(JSON.stringify(bres.chairs.map((x) => x.name).sort()) === '["Ünite A","Ünite B"]', `B üniteleri ${bres.chairs.map((x) => x.name)}`, c);
  const ch = res.chairs[0].id; const p1 = await newPatient("U1"); const p2 = await newPatient("U2");
  const t = nextSlot();
  await api(A.sec, "POST", "/appointments", appt(p1, { chairId: ch, startTime: t, practitionerId: res.practitioners[0].id }));
  const cf = await api(A.sec, "POST", "/appointments", appt(p2, { chairId: ch, startTime: t, practitionerId: res.practitioners[1].id }));
  ok(cf.status === 409 && cf.body.details?.resource === "ünite", `ünite çakışması ${cf.status} ${cf.body.details?.resource}`, c);
  const bad = await api(A.sec, "POST", "/appointments", appt(p2, { chairId: randomUUID() }));
  ok(bad.status === 422 && /Ünite/.test(bad.body.field_errors?.chairId ?? ""), `bilinmeyen ünite: ${bad.body.field_errors?.chairId}`, c);
  // 0040 yeniden adlandırma ifadesi tekrar çalıştırılınca değişiklik yapmaz; özel ad korunur
  const mig = (await import("node:fs")).readFileSync(new URL("../../packages/db/migrations/0040_appointment_procedures_units.sql", import.meta.url), "utf8");
  const upd = mig.slice(mig.lastIndexOf("select app.for_each_tenant"));
  const cl = await pool.connect();
  try {
    await cl.query("begin");
    await cl.query("select set_config('app.tenant_id', $1, true)", [TENANT]);
    await cl.query("insert into chairs(tenant_id, branch_id, name) select $1, branch_id, 'Cerrahi oda' from chairs limit 1", [TENANT]);
    await cl.query("set local role viadent_owner").catch(() => {});
    await cl.query(upd);
    await cl.query("select set_config('app.tenant_id', $1, true)", [TENANT]); // for_each_tenant bağlamı sıfırlar
    const names = (await cl.query("select name from chairs order by name")).rows.map((r) => r.name);
    ok(names.includes("Cerrahi oda") && names.filter((n) => /^Ünite [ABC]$/.test(n)).length === 3 && !names.some((n) => /^Koltuk \d$|^Ünit [A-C]$/.test(n)), `tekrar çalıştırma: ${names}`, c);
  } finally { await cl.query("rollback"); cl.release(); }
  rec("I06", c);
}

writeFileSync(`${OUT}/i-summary.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
await pool.end();
