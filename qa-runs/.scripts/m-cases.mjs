// CEZERİ teslim testi — ADR-110 aylık çalışma listesi HTTP/DB vakası M01. Ürün kodunu değiştirmez; yalnız sentetik veri.
// Kullanım: BASE=http://127.0.0.1:4000 PASSWORD=<güvenli ortam> OWNER_URL=<yerel> ADMIN_URL=<yerel> OUT=<evidence> tsx qa-runs/.scripts/m-cases.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const pg = require("pg");

const BASE = process.env.BASE ?? "http://127.0.0.1:4000";
const PASSWORD = process.env.PASSWORD; const OUT = process.env.OUT ?? "evidence"; const OWNER_URL = process.env.OWNER_URL; const ADMIN_URL = process.env.ADMIN_URL;
if (!PASSWORD || !OWNER_URL || !ADMIN_URL) { console.error("PASSWORD, OWNER_URL ve ADMIN_URL gerekli"); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36).slice(-5);
const TEST_PAN = ["4111", "1111", "1111", "1111"].join(""); // sentetik test numarası; kanıtta maskelenir
const mask = (s) => String(s).split(TEST_PAN).join("‹PAN›");
const results = [];
const rec = (id, c, extra = "") => { const status = c.length && c.every((x) => x.pass) ? "PASS" : "FAIL";
  results.push({ id, status, summary: mask(`${c.filter((x) => x.pass).length}/${c.length} kontrol${extra}: ${c.filter((x) => !x.pass).map((x) => x.check).join("; ") || "hepsi geçti"}`), at: new Date().toISOString(), evidence: `${id}-http.json` });
  writeFileSync(`${OUT}/${id}-http.json`, mask(JSON.stringify({ checks: c }, null, 1))); console.log(`${status.padEnd(6)} ${id} ${results.at(-1).summary}`); };
const ok = (cond, label, list) => { list.push({ check: label, pass: !!cond }); return !!cond; };
const pool = new pg.Pool({ connectionString: OWNER_URL, max: 2 });
const adminDb = new URL(ADMIN_URL); adminDb.pathname = "/viadent";
const admin = new pg.Pool({ connectionString: adminDb.toString(), max: 1 });
let TENANT = null;
const q = async (sql, args = [], tenant = TENANT) => { const c = await pool.connect();
  try { await c.query("begin"); await c.query("select set_config('app.tenant_id', $1, true)", [tenant]); const r = await c.query(sql, args); await c.query("commit"); return r.rows; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } };
async function api(s, method, path, body, k) {
  const h = { "content-type": "application/json", "x-viadent-request": "1", ...(k ? { "idempotency-key": k } : {}) };
  if (s?.cookie) h.cookie = s.cookie; if (s?.ctx) h["x-viadent-context"] = s.ctx;
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j, replayed: r.headers.get("idempotent-replayed") };
}
async function login(email) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-viadent-request": "1" }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (r.status !== 200) { console.error("giriş", email.split("@")[0], r.status); process.exit(2); }
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const s = await (await fetch(`${BASE}/api/v1/session`, { headers: { cookie } })).json();
  return { cookie, ctx: s.activeMembership.id, tenantId: s.activeMembership.tenantId };
}
const key = () => "qa-" + randomUUID();
const TZ = "Europe/Istanbul";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const day = (n) => { const [y, m, d] = today().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const cents = (v) => Math.round(Number(v) * 100);

const A = { admin: await login("yonetici@demo-yesil.test"), dentist: await login("elif.aras@demo-yesil.test"), sec: await login("sekreter@demo-yesil.test"),
  asst: await login("asistan@demo-yesil.test"), fin: await login("finans@demo-yesil.test") };
const B = { admin: await login("yonetici@demo-mavi.test") };
TENANT = A.admin.tenantId;


const iso = (o) => day(o);
const wdOk = (d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; };
const used = new Set();
const fut = (o) => { for (let x = o; ; x++) { const d = iso(x); if (wdOk(d) && !used.has(d)) { used.add(d); return d; } } };
const pat = (await api(A.sec, "POST", "/patients", { firstName: "QaListe", lastName: `M${RUN}`, birthDate: "1983-04-05", acknowledgeDuplicates: true })).body.patient.id;
const res = (await api(A.admin, "GET", "/admin/resources")).body;
const pracs = res.practitioners.filter((p) => p.active);
const P1 = pracs[pracs.length - 1].id, P2 = pracs[0].id;
const chair = res.chairs.find((c) => c.active).id;

// M01 — aylık çalışma listesi
{ const c = [];
  const d1 = fut(75), d2 = fut(76), d3 = fut(77), d4 = fut(78);
  const m = d1.slice(0, 7);
  for (const [who, s] of [["sekreter", A.sec], ["hekim", A.dentist], ["asistan", A.asst], ["finans", A.fin]]) {
    const r = await api(s, "GET", `/work-roster?month=${m}`);
    ok(r.status === 200 && r.body.days?.length >= 28 && r.body.practitioners?.some((p) => p.id === P1), `${who} okur ${r.status}`, c);
  }
  ok((await api(A.sec, "GET", "/work-roster?month=2026-00")).status === 422, "ay biçimi 422", c);
  for (const [who, s] of [["sekreter", A.sec], ["hekim", A.dentist], ["finans", A.fin]]) {
    ok((await api(s, "POST", "/work-roster", { cells: [{ practitionerId: P1, date: d1, kind: "off" }] })).status === 403, `${who} yazamaz`, c);
  }
  const bad = [["bitiş<başlangıç", { kind: "work", start: "15:00", end: "09:00" }], ["15 dk dışı", { kind: "work", start: "09:05", end: "12:00" }],
    ["çalışmıyor+saat", { kind: "off", start: "09:00", end: "10:00" }], ["Unicode tür", { kind: "çalış" }], ["boş saat", { kind: "work", start: "", end: "" }],
    ["hekim yok", { kind: "off", practitionerId: "00000000-0000-4000-8000-000000000000" }]];
  for (const [l, b] of bad) { const r = await api(A.admin, "POST", "/work-roster", { cells: [{ practitionerId: P1, date: d1, ...b }] }); ok(r.status === 422, `${l} → ${r.status}`, c); }
  const w = await api(A.admin, "POST", "/work-roster", { cells: [{ practitionerId: P1, date: d1, kind: "work", start: "14:00", end: "18:30", chairId: chair, note: "QA öğleden sonra" }] });
  ok(w.status === 200 && w.body.saved === 1, `çalışıyor kaydı ${w.status}`, c);
  const av = (await api(A.sec, "GET", `/availability?practitionerId=${P1}&date=${d1}&minutes=30`)).body;
  ok(av.planSource === "roster" && av.slots[0] === "14:00" && av.slots.at(-1) === "18:00" && !av.slots.includes("10:00"), `uygun saatler listeden ${av.slots?.[0]}…${av.slots?.at(-1)}`, c);
  const out = await api(A.sec, "POST", "/appointments", { patientId: pat, practitionerId: P1, date: d1, startTime: "10:00", durationMinutes: 30 });
  ok(out.status === 422 && out.body.code === "OUTSIDE_WORKING_HOURS", `liste dışı randevu ${out.status}/${out.body.code}`, c);
  const inn = await api(A.sec, "POST", "/appointments", { patientId: pat, practitionerId: P1, date: d1, startTime: "15:00", durationMinutes: 30 });
  ok(inn.status === 201, `liste içi randevu ${inn.status}`, c);
  const moved = await api(A.admin, "POST", "/work-roster", { cells: [{ practitionerId: P1, date: d1, kind: "off" }] });
  ok(moved.status === 409 && moved.body.code === "ROSTER_APPOINTMENTS_OUTSIDE" && moved.body.details?.outside?.[0]?.count === 1, `randevulu güne çalışmıyor → ${moved.status}`, c);
  const db0 = (await q("select kind from work_rosters where practitioner_id = $1 and work_date = $2", [P1, d1]))[0]?.kind;
  ok(db0 === "work", `onaysız 409 sonrası DB değişmedi (${db0})`, c);
  const ack = await api(A.admin, "POST", "/work-roster", { cells: [{ practitionerId: P1, date: d1, kind: "off" }], acknowledgeAppointments: true });
  ok(ack.status === 200, `bilinçli onay ${ack.status}`, c);
  const ap = (await q("select status from appointments where id = $1", [inn.body.id]))[0]?.status;
  ok(ap === "planned", `randevu silinmedi (${ap})`, c);
  const offAv = (await api(A.sec, "GET", `/availability?practitionerId=${P1}&date=${d1}&minutes=30`)).body;
  ok(offAv.rosterOff === true && offAv.slots.length === 0, "çalışmıyor → boş saat yok", c);
  await api(A.admin, "POST", "/work-roster", { cells: [{ practitionerId: P1, date: d2, kind: "work", start: "09:00", end: "13:00", chairId: chair }] });
  const clash = await api(A.admin, "POST", "/work-roster", { cells: [{ practitionerId: P2, date: d2, kind: "work", start: "12:30", end: "15:00", chairId: chair }] });
  ok(clash.status === 409 && clash.body.code === "CHAIR_ROSTER_CONFLICT", `ünite çakışması ${clash.status}`, c);
  ok((await api(A.admin, "POST", "/work-roster", { cells: [{ practitionerId: P2, date: d2, kind: "work", start: "13:00", end: "15:00", chairId: chair }] })).status === 200, "ardışık saat aynı ünite olur", c);
  const bulk = await api(A.admin, "POST", "/work-roster", { cells: [{ practitionerId: P2, date: d3, kind: "off" }, { practitionerId: P2, date: d4, kind: "work", start: "08:00", end: "12:00" }] });
  ok(bulk.status === 200 && bulk.body.saved === 2, `toplu 2 gün ${bulk.status}`, c);
  const mv = (await api(A.dentist, "GET", `/work-roster?month=${d3.slice(0, 7)}`)).body;
  ok(mv.entries.some((e) => e.practitionerId === P2 && e.date === d3 && e.kind === "off"), "hekim listede çalışmıyor günü görür", c);
  const clr = await api(A.admin, "POST", "/work-roster/clear", { cells: [{ practitionerId: P1, date: d2 }] });
  const avc = (await api(A.sec, "GET", `/availability?practitionerId=${P1}&date=${d2}&minutes=30`)).body;
  ok(clr.body.cleared === 1 && avc.planSource !== "roster", `şablona dönüş (${avc.planSource})`, c);
  const au = await q("select action, count(*)::int n from audit_events where entity_type = 'work_roster' and created_at > now() - interval '10 minutes' group by 1");
  const n = Object.fromEntries(au.map((x) => [x.action, x.n]));
  ok(n["work_roster.save"] >= 5 && n["work_roster.clear"] >= 1, `audit save=${n["work_roster.save"]} clear=${n["work_roster.clear"]}`, c);
  const bm = (await api(B.admin, "GET", `/work-roster?month=${m}`)).body;
  ok(!bm.practitioners.some((p) => p.id === P1) && !bm.entries.some((e) => e.practitionerId === P1), "B kiracısı A listesini görmez", c);
  ok((await api(B.admin, "POST", "/work-roster", { cells: [{ practitionerId: P1, date: d4, kind: "off" }] })).status === 422, "B kiracısı A hekimine yazamaz", c);
  const rls = await q("select relforcerowsecurity f from pg_class where relname = 'work_rosters'", [], null);
  ok(rls[0]?.f === true, "FORCE RLS", c);
  rec("M01", c);
}

writeFileSync(`${OUT}/m-summary.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
await pool.end(); await admin.end();
