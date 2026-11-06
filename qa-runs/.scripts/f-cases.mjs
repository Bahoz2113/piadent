// CEZERİ teslim testi — PİA-DENT ürün sahibi geri bildirimi 04.11.2026 HTTP vakaları (F01–F12). Ürün kodunu değiştirmez.
// Yalnız sentetik demo verisi; DB okuma (doğrulama) yerel test DB'sinde sahip rolüyle. Üretime dokunulmaz.
// Kullanım: BASE=http://127.0.0.1:4000 PASSWORD=<güvenli ortam> OWNER_URL=<yerel> OUT=<evidence> node qa-runs/.scripts/f-cases.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const pg = require("pg");

const BASE = process.env.BASE ?? "http://127.0.0.1:4000";
const PASSWORD = process.env.PASSWORD; const OUT = process.env.OUT ?? "evidence"; const OWNER_URL = process.env.OWNER_URL;
if (!PASSWORD || !OWNER_URL) { console.error("PASSWORD ve OWNER_URL gerekli"); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36).slice(-5);
const results = [];
const rec = (id, status, summary, data = {}) => { results.push({ id, status, summary, at: new Date().toISOString(), evidence: `${id}-http.json`, ...data }); console.log(`${status.padEnd(6)} ${id} ${summary}`); };
const SENS = /^(firstName|lastName|fullName|name|email|nationalId|birthDate|patientName|by|createdBy|memberName|displayName|practitionerName|practitioner)$/;
const mask = (v) => Array.isArray(v) ? v.map(mask) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENS.test(k) && typeof x === "string" ? `‹${k}:${x.length}›` : mask(x)])) : v;
const save = (id, obj) => writeFileSync(`${OUT}/${id}-http.json`, JSON.stringify(mask(obj), null, 1));
const pool = new pg.Pool({ connectionString: OWNER_URL, max: 2 });
// Sahip rolü de FORCE RLS altındadır: her doğrulama sorgusu kiracı bağlamında çalışır (bağlamsız sorgu 0 satır döner ve
// "yazılmadı" kontrollerini yanlışlıkla geçirir — tur 1 tester düzeltmesi).
let TENANT = null;
const q = async (sql, args = [], tenant = TENANT) => {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("select set_config('app.tenant_id', $1, true)", [tenant]); const r = await c.query(sql, args); await c.query("commit"); return r.rows; }
  finally { c.release(); }
};

async function api(s, method, path, body, headers = {}) {
  const h = { "content-type": "application/json", "x-viadent-request": "1", ...headers };
  if (s?.cookie) h.cookie = s.cookie; if (s?.ctx) h["x-viadent-context"] = s.ctx;
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j, headers: Object.fromEntries(r.headers) };
}
async function login(email) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-viadent-request": "1" }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (r.status !== 200) { console.error("giriş", email.split("@")[0], r.status); process.exit(2); }
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const s = await (await fetch(`${BASE}/api/v1/session`, { headers: { cookie } })).json();
  return { cookie, ctx: s.activeMembership.id, tenantId: s.activeMembership.tenantId, role: email.split("@")[0] };
}
const key = () => "qa-" + randomUUID();
const TZ = "Europe/Istanbul";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const day = (n) => { const [y, m, d] = today().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const at = (deltaMin) => { const d = new Date(Date.now() + deltaMin * 60000); return { date: new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d), time: new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d) }; };
const month = () => today().slice(0, 7);
const nextMonth = () => { const [y, m] = month().split("-").map(Number); const k = y * 12 + m; return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`; };
const ok = (cond, label, list) => { list.push({ check: label, pass: !!cond }); return !!cond; };
function tckn(seed) { const d = String(100000000 + (seed % 899999999)).split("").map(Number); d[0] = d[0] || 1;
  const d10 = ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10; const a = [...d, (d10 + 10) % 10]; a.push(a.reduce((s, x) => s + x, 0) % 10); return a.join(""); }

const A = { admin: await login("yonetici@demo-yesil.test"), dentist: await login("elif.aras@demo-yesil.test"), sec: await login("sekreter@demo-yesil.test"),
  asst: await login("asistan@demo-yesil.test"), fin: await login("finans@demo-yesil.test") };
const B = { admin: await login("yonetici@demo-mavi.test"), dentist: await login("hekim@demo-mavi.test") };
const tenantA = A.admin.tenantId; TENANT = tenantA;
const res = (await api(A.sec, "GET", "/resources")).body;
const prac = res.practitioners[0].id;
const procs = (await api(A.dentist, "GET", "/procedures")).body.items;
const proc = (code) => procs.find((p) => p.code === code);
let slotN = 0; let visitN = (Number.parseInt(RUN, 36) % 7) * 12;
const freeSlot = () => { const m = 17 * 60 + (slotN++ % 9) * 40 + 5; // 30 dk randevular için 40 dk aralık (tur 1: 15 dk adım kendi randevularıyla çakışıyordu)
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
async function newPatient(tag, phone) {
  const r = await api(A.sec, "POST", "/patients", { firstName: "Sınama", lastName: `${tag}${RUN}`, birthDate: "1984-05-06", ...(phone ? { phone } : {}), acknowledgeDuplicates: true });
  if (r.status !== 201) throw new Error(`hasta ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.patient.id;
}
async function visit(pid, extra = {}) {
  // Geçmiş gün akşamı (seed randevularıyla çakışmaz); geriye dönük kayıt yalnız yöneticiyle ve gerekçeyle (ADR-094).
  const m = 20 * 60 + (visitN++ % 12) * 20;
  const a = await api(A.admin, "POST", "/appointments", { patientId: pid, practitionerId: prac, date: day(-3 - Math.floor(visitN / 12)), startTime: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, durationMinutes: 15, allowOutsideHours: true, backdateReason: "QA: geriye dönük ziyaret kaydı", ...extra });
  if (a.status !== 201) throw new Error(`visit ${a.status} ${JSON.stringify(a.body).slice(0, 200)}`);
  const s = await api(A.sec, "POST", `/appointments/${a.body.id}/status`, { version: a.body.version, status: "checked_in" });
  return { id: a.body.id, version: s.body.version };
}
const summary = { run: RUN };

// ============================ F01 — geçmişe randevu ============================
{
  const c = []; const pid = await newPatient("Gecmis");
  const before = (await q("select count(*)::int n from appointments where patient_id=$1", [pid]))[0].n;
  ok((await q("select count(*)::int n from patients where id=$1", [pid]))[0].n === 1, "doğrulama bağlamı: hasta DB'de görünür (pozitif kontrol)", c);
  const base = { patientId: pid, practitionerId: prac, durationMinutes: 30, allowOutsideHours: true };
  const y = await api(A.sec, "POST", "/appointments", { ...base, date: day(-1), startTime: "10:00" });
  const h2 = await api(A.sec, "POST", "/appointments", { ...base, ...{ date: at(-120).date, startTime: at(-120).time } });
  ok(y.status === 422 && y.body.code === "APPOINTMENT_IN_PAST" && y.body.field_errors?.date, "dün → 422 APPOINTMENT_IN_PAST + alan hatası", c);
  ok(h2.status === 422 && h2.body.code === "APPOINTMENT_IN_PAST", "2 saat önce → 422", c);
  ok((await q("select count(*)::int n from appointments where patient_id=$1", [pid]))[0].n === before, "reddedilen istek satır yazmadı", c);
  ok((await q("select count(*)::int n from audit_events where action='appointment.create' and patient_id=$1", [pid]))[0].n === 0, "reddedilen istek denetim yazmadı", c);
  const g = at(-5); const gr = await api(A.sec, "POST", "/appointments", { ...base, durationMinutes: 15, date: g.date, startTime: g.time });
  ok(gr.status === 201, `tolerans içi (−5 dk) → ${gr.status}`, c);
  if (gr.status === 201) await api(A.sec, "POST", `/appointments/${gr.body.id}/status`, { version: gr.body.version, status: "cancelled", cancelReason: "QA temizliği" });
  const g11 = at(-11); const gr11 = await api(A.sec, "POST", "/appointments", { ...base, durationMinutes: 15, date: g11.date, startTime: g11.time });
  ok(gr11.status === 422, `tolerans dışı (−11 dk) → ${gr11.status}`, c);
  const bd = { ...base, date: day(-2), startTime: "21:40", durationMinutes: 15 };
  const s403 = await api(A.sec, "POST", "/appointments", { ...bd, backdateReason: "Kayıt unutulmuş" });
  ok(s403.status === 403, `sekreter gerekçeyle geriye dönük → ${s403.status}`, c);
  const aNo = await api(A.admin, "POST", "/appointments", bd);
  ok(aNo.status === 422, `yönetici gerekçesiz → ${aNo.status}`, c);
  const aShort = await api(A.admin, "POST", "/appointments", { ...bd, backdateReason: "x".repeat(301) });
  ok(aShort.status === 422, `gerekçe 301 karakter → ${aShort.status}`, c);
  const aOk = await api(A.admin, "POST", "/appointments", { ...bd, backdateReason: "Kâğıt ajandadan aktarım — ğüşiöç" });
  const ev = aOk.status === 201 ? await q("select changes from audit_events where action='appointment.create' and entity_id=$1", [aOk.body.id]) : [];
  ok(aOk.status === 201 && ev[0]?.changes?.backdated?.to === true && ev[0]?.changes?.backdate_reason?.to?.includes("ğüşiöç"), "yönetici gerekçeyle 201 + denetimde backdated/gerekçe (Unicode)", c);
  for (const [lbl, t, d] of [["saat 25:00", "25:00", day(3)], ["saat 9:5", "9:5", day(3)], ["tarih 2026-02-30", "10:00", "2026-02-30"], ["tarih boş", "10:00", ""]]) {
    const r = await api(A.sec, "POST", "/appointments", { ...base, date: d, startTime: t }); ok(r.status === 422, `${lbl} → ${r.status}`, c);
  }
  const fut = await api(A.sec, "POST", "/appointments", { ...base, date: day(3), startTime: freeSlot() });
  ok(fut.status === 201, `ileri tarih → ${fut.status}`, c);
  summary.F01 = { patientId: pid };
  save("F01", { checks: c, samples: { yesterday: y.body, twoHours: h2.body, sec403: s403.body, adminNoReason: aNo.body?.code } });
  rec("F01", c.every((x) => x.pass) ? "PASS" : "FAIL", `${c.filter((x) => x.pass).length}/${c.length} kontrol: ${c.filter((x) => !x.pass).map((x) => x.check).join("; ") || "hepsi geçti"}`);
}

// ============================ F02 — sonuç bekliyor ============================
{
  const c = []; const pid = await newPatient("Sonuc");
  // Bugün sabah 07:10 (seed randevuları 09:00'dan başlar; koşu saati 07:40'tan sonraysa geçmiştir) — tur 1: −150 dk seed randevusuyla çakışıyordu.
  // Tur 1 (07.11.2026) tester düzeltmesi: koşu gece (07:40 öncesi) yapılırsa 07:10 gelecekte kalıyordu → saat bağımlılığı; gece koşusunda 60 dk önce.
  const nowMin = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date())) * 60 + Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, minute: "2-digit" }).format(new Date()));
  const p = nowMin >= 8 * 60 ? { date: today(), time: "07:10" } : nowMin >= 75 ? at(-60) : { date: day(-1), time: "23:10" };
  const a = await api(A.admin, "POST", "/appointments", { patientId: pid, practitionerId: prac, date: p.date, startTime: p.time, durationMinutes: 30, allowOutsideHours: true, backdateReason: "QA: saati geçmiş planlı" });
  const fut = await api(A.sec, "POST", "/appointments", { patientId: pid, practitionerId: prac, date: day(5), startTime: freeSlot(), durationMinutes: 30, allowOutsideHours: true });
  const list = (await api(A.sec, "GET", `/patients/${pid}/appointments`)).body.items ?? [];
  const pa = list.find((x) => x.id === a.body.id);
  ok(a.status === 201, `saati geçmiş planlı randevu kurulumu → ${a.status} ${a.body?.code ?? ""}`, c);
  ok(pa?.status === "planned", "saati geçmiş randevu durumu planlı kalır (otomatik değişmez)", c);
  ok(pa && new Date(pa.endsAt) < new Date(), "bitişi geçmişte (UI 'Sonuç bekliyor' koşulu)", c);
  ok(list.some((x) => x.id === fut.body.id && new Date(x.endsAt) > new Date()), "gelecek randevu ayrı (yaklaşan)", c);
  summary.F02 = { patientId: pid, pastId: a.body.id, futureId: fut.body.id };
  save("F02", { checks: c, list: list.map((x) => ({ id: x.id, status: x.status, startsAt: x.startsAt, endsAt: x.endsAt })) });
  rec("F02", c.every((x) => x.pass) ? "PASS" : "FAIL", `${c.filter((x) => x.pass).length}/${c.length} kontrol (API); UI tarafı tarayıcı vakasında`);
}

// ============================ F03 — telefon ============================
{
  const c = []; const pid = await newPatient("Telefon", "0532 111 22 33");
  await api(A.sec, "PATCH", `/patients/${pid}`, {}).catch(() => {});
  const nat = tckn(Date.now());
  const pn = await api(A.sec, "POST", "/patients", { firstName: "Kimlik", lastName: `Maske${RUN}`, birthDate: "1979-01-02", nationalIdType: "tckn", nationalId: nat, phone: "05321112234", acknowledgeDuplicates: true });
  const pidN = pn.body.patient?.id;
  for (const [role, s] of Object.entries(A)) {
    const d = await api(s, "GET", `/patients/${pidN}`);
    const ph = d.body.patient?.phone ?? d.body.phone;
    const ni = d.body.patient?.nationalId ?? d.body.nationalId;
    ok(d.status === 200 && ph && !/[*•]/.test(ph) && ph.replace(/\D/g, "").endsWith("5321112234"), `${role}: kartta tam telefon`, c);
    ok(!ni || ni !== nat, `${role}: kimlik no maskeli`, c);
    const l = await api(s, "GET", `/patients?q=${encodeURIComponent("Maske" + RUN)}`);
    const row = (l.body.items ?? [])[0];
    ok(row && row.phone && !/[*•]/.test(row.phone), `${role}: listede tam telefon`, c);
  }
  const cases = [["05321234567", 201], ["0532123456", 422], ["053212345678", 422], ["5321234567", 201], ["532123456", 422], ["53212345678", 422],
    ["+905321234567", 201], ["00905321234567", 201], ["0532abc4567", 422], ["٠٥٣٢١٢٣٤٥٦٧", 422], ["0 (532) 123 45 67", 201]];
  const got = [];
  for (const [ph, exp] of cases) {
    const r = await api(A.sec, "POST", "/patients", { firstName: "Hane", lastName: `Kural${RUN}${got.length}`, birthDate: "1990-02-03", phone: ph, acknowledgeDuplicates: true });
    got.push({ phone: ph, status: r.status, message: r.body?.field_errors?.phone });
    ok(r.status === exp, `telefon "${ph}" → ${r.status} (beklenen ${exp})`, c);
  }
  summary.F03 = { patientId: pidN, phoneLast: "5321112234" };
  save("F03", { checks: c, digits: got });
  rec("F03", c.every((x) => x.pass) ? "PASS" : "FAIL", `${c.filter((x) => x.pass).length}/${c.length} kontrol: ${c.filter((x) => !x.pass).map((x) => x.check).join("; ") || "hepsi geçti"}`);
}

// ============================ F05 — diş şeması (veri) ============================
{
  const c = []; const pid = await newPatient("DisSema");
  const v = await visit(pid);
  const cek = proc("CEK-01");
  const perf = await api(A.dentist, "POST", `/patients/${pid}/performed`, { appointmentId: v.id, procedureId: cek.id, location: { kind: "tooth", tooth: "16" }, quantity: 1 });
  ok(perf.status === 201, `hekim 16 numaralı dişe işlem → ${perf.status}`, c);
  const ch = await api(A.dentist, "GET", `/patients/${pid}/chart`);
  const doneTeeth = (ch.body.performed ?? []).filter((x) => x.status === "completed").map((x) => x.location?.tooth);
  ok(doneTeeth.includes("16") && doneTeeth.length === 1, "chart: yalnız 16 tamamlanmış", c);
  const sc = await api(A.sec, "GET", `/patients/${pid}/chart`);
  ok(sc.status === 403 || sc.status === 404, `sekreter chart → ${sc.status}`, c);
  summary.F05 = { patientId: pid, tooth: "16" };
  save("F05", { checks: c, performedTeeth: doneTeeth });
  rec("F05", c.every((x) => x.pass) ? "PASS" : "FAIL", `${c.filter((x) => x.pass).length}/${c.length} kontrol (API); UI işaretleri tarayıcı vakasında`);
}

// ============================ F06 — Panel ============================
{
  const c = [];
  const ad = (await api(A.admin, "GET", "/dashboard")).body, se = (await api(A.sec, "GET", "/dashboard")).body, fi = (await api(A.fin, "GET", "/dashboard")).body;
  ok(ad.charts.appointmentDensity.length === 30 && ad.charts.newPatients.length === 12 && ad.money?.monthlyIncome?.length === 12, "seri uzunlukları 30/12/12", c);
  ok(se.money === null && fi.money !== null && ad.money !== null, "money: sekreter null, finans/yönetici dolu", c);
  const dayList = (await api(A.admin, "GET", `/appointments?date=${ad.date}`)).body.items;
  ok(ad.today.appointments === dayList.filter((x) => x.status !== "cancelled").length, "bugünkü randevu = günün listesi", c);
  ok(ad.today.waiting === dayList.filter((x) => x.status === "checked_in").length, "bekleyen hasta = checked_in", c);
  const [y, m, d] = ad.date.split("-").map(Number);
  const dbNet = (await q(`select ((select coalesce(sum(amount),0) from payments where tenant_id=$1 and (paid_at at time zone 'Europe/Istanbul')::date=$2::date) - (select coalesce(sum(amount),0) from refunds where tenant_id=$1 and (refunded_at at time zone 'Europe/Istanbul')::date=$2::date))::numeric(14,2)::text v`, [tenantA, ad.date]))[0].v;
  ok(ad.money.todayCollections === dbNet, `günlük net tahsilat API ${ad.money.todayCollections} = DB ${dbNet}`, c);
  const dbOpen = (await q("select coalesce(sum(amount-allocated_amount),0)::numeric(14,2)::text v from receivables where tenant_id=$1 and status='active' and amount>allocated_amount", [tenantA]))[0].v;
  ok(ad.money.openReceivables === dbOpen, `açık borç API ${ad.money.openReceivables} = DB ${dbOpen}`, c);
  const bd = (await api(B.admin, "GET", "/dashboard")).body;
  ok(bd.today.appointments === (await api(B.admin, "GET", `/appointments?date=${bd.date}`)).body.items.filter((x) => x.status !== "cancelled").length, "B kiracısı kendi sayacı", c);
  ok((await api(null, "GET", "/dashboard")).status === 401, "oturumsuz 401", c);
  summary.F06 = { date: ad.date, today: ad.today, money: ad.money && { todayCollections: ad.money.todayCollections, openReceivables: ad.money.openReceivables } };
  save("F06", { checks: c, admin: { today: ad.today, money: { todayCollections: ad.money.todayCollections, openReceivables: ad.money.openReceivables } }, secretaryMoney: se.money });
  rec("F06", c.every((x) => x.pass) ? "PASS" : "FAIL", `${c.filter((x) => x.pass).length}/${c.length} kontrol (API/DB); menü ve ekran tarayıcı vakasında`);
}

// ============================ F07 — raporlar (API) ============================
{
  const c = []; const runs = [];
  for (const [role, s] of [["yonetici", A.admin], ["finans", A.fin], ["hekim", A.dentist], ["sekreter", A.sec]]) {
    const cat = (await api(s, "GET", "/reports")).body;
    for (const r of cat.reports) {
      const p = r.maxDays > 1 ? `?from=${day(-29)}&to=${today()}` : "";
      const x = await api(s, "GET", `/reports/${r.id}${p}`);
      runs.push({ role, id: r.id, status: x.status, rows: x.body?.rows?.length });
      ok(x.status === 200, `${role} ${r.id} → ${x.status}`, c);
    }
  }
  const secFin = await api(A.sec, "GET", "/reports/gelir-gider");
  ok(secFin.status === 403, `sekreter gelir-gider → ${secFin.status}`, c);
  save("F07", { checks: c.filter((x) => !x.pass), runs });
  rec("F07", c.every((x) => x.pass) ? "PASS" : "FAIL", `${runs.length} rapor çalıştırması, ${c.filter((x) => !x.pass).length} hata; menü dönüşü/varsayılan aralık tarayıcı vakasında`);
}

// ============================ F08 — Hekimler ============================
{
  const c = [];
  const pr = (await api(A.admin, "POST", "/practitioners", { displayName: `Zz QA Hekim ${RUN}` })).body.id;
  const ov = (await api(A.sec, "GET", "/practitioners/overview")).body.items.find((x) => x.id === pr);
  ok(ov && ov.pay === null, "sekreter listede, ücret alanı null", c);
  ok((await api(A.sec, "GET", `/practitioners/${pr}/compensation`)).status === 403, "sekreter ücret ayrıntısı 403", c);
  const post = (s, b) => api(s, "POST", `/practitioners/${pr}/compensation`, b);
  for (const [lbl, b, exp] of [["dün", { payModel: "salary", monthlySalary: "30000.00", validFrom: day(-1) }, 422], ["maaşsız maaş", { payModel: "salary", validFrom: day(0) }, 422],
    ["primde maaş", { payModel: "commission", monthlySalary: "1.00", validFrom: day(0) }, 422], ["tutar 0", { payModel: "salary", monthlySalary: "0", validFrom: day(0) }, 422],
    ["tutar -1", { payModel: "salary", monthlySalary: "-1.00", validFrom: day(0) }, 422], ["tutar 0,001", { payModel: "salary", monthlySalary: "0.001", validFrom: day(0) }, 422],
    ["tutar 1e15", { payModel: "salary", monthlySalary: "1000000000000000.00", validFrom: day(0) }, 422], ["geçersiz model", { payModel: "hourly", monthlySalary: "1.00", validFrom: day(0) }, 422]]) {
    const r = await post(A.fin, b); ok(r.status === exp, `ücret ${lbl} → ${r.status}`, c);
  }
  for (const [role, s] of [["sekreter", A.sec], ["hekim", A.dentist], ["asistan", A.asst]]) ok((await post(s, { payModel: "salary", monthlySalary: "30000.00", validFrom: day(0) })).status === 403, `${role} model yazamaz`, c);
  const v1 = await post(A.fin, { payModel: "salary", monthlySalary: "30000.00", validFrom: day(0), note: "QA maaş — ğüş" });
  ok(v1.status === 201, `finans sabit maaş → ${v1.status}`, c);
  ok((await post(A.fin, { payModel: "commission", validFrom: day(0) })).body.code === "COMPENSATION_EXISTS", "aynı gün 409", c);
  const ev = await q("select changes from audit_events where action='compensation.create' and entity_id=$1", [v1.body.id]);
  ok(ev[0]?.changes?.monthly_salary?.to === "30000.00", "denetim kaydı", c);
  // prim kuralı + işlem → sabit maaşta tahakkuk yok
  await api(A.fin, "POST", "/commission-rules", { practitionerId: pr, basis: "treatment", rate: "20", validFrom: day(0) });
  const pid = await newPatient("Maas");
  const a = await api(A.admin, "POST", "/appointments", { patientId: pid, practitionerId: pr, date: today(), startTime: at(-200).time, durationMinutes: 15, allowOutsideHours: true, backdateReason: "QA ziyaret" });
  const s1 = await api(A.sec, "POST", `/appointments/${a.body.id}/status`, { version: a.body.version, status: "checked_in" });
  const pf = await api(A.dentist, "POST", `/patients/${pid}/performed`, { appointmentId: a.body.id, procedureId: proc("TEM-01").id, location: { kind: "mouth" }, quantity: 1 });
  ok(pf.status === 201 && (await q("select count(*)::int n from commission_accruals where practitioner_id=$1", [pr]))[0].n === 0, "sabit maaşta prim tahakkuku yok", c);
  // maaş ödemesi
  const cash = (await api(A.fin, "GET", "/cash-accounts")).body.items.find((x) => x.active && x.kind === "cash");
  const body = { practitionerId: pr, period: month(), cashAccountId: cash.id };
  const pay = (b, k = key(), s = A.fin) => api(s, "POST", "/salary-payments", b, { "idempotency-key": k });
  ok((await pay({ ...body, amount: "30000.01" })).body.code === "SALARY_EXCEEDS_DUE", "hakedişi aşan 409", c);
  ok((await pay({ ...body, period: nextMonth(), amount: "1.00" })).status === 422, "gelecek ay 422", c);
  ok((await pay({ ...body, period: "2026-13", amount: "1.00" })).status === 422, "dönem 2026-13 422", c);
  ok((await pay({ ...body, amount: "0" })).status === 422, "tutar 0 422", c);
  ok((await pay({ ...body, amount: "1.00" }, key(), A.sec)).status === 403, "sekreter ödeyemez 403", c);
  // 07.11.2026 kabul değişikliği (ADR-098): yönetici tüm yetkili; yetkisiz ödeme sekreterle sınanır.
  ok((await pay({ ...body, amount: "1.00" }, key(), A.sec)).status === 403, "sekreter ödeyemez 403 (commission.payout yok)", c);
  const k = key();
  const p1 = await pay({ ...body, amount: "20000.00" }, k);
  const p1b = await pay({ ...body, amount: "20000.00" }, k);
  ok(p1.status === 201 && p1b.body.id === p1.body.id && p1b.headers["idempotent-replayed"] === "true", "idempotent tekrar aynı kayıt", c);
  const cm = await q("select amount::text from cash_movements where source='salary_payment' and source_id=$1", [p1.body.id]);
  ok(cm.length === 1 && cm[0].amount === "-20000.00", "tek kasa hareketi −20.000", c);
  const conc = await Promise.all([1, 2].map(() => pay({ ...body, amount: "6000.00" })));
  ok(conc.map((r) => r.status).sort().join() === "201,409", `eşzamanlı 2×6.000 → ${conc.map((r) => r.status).join(",")}`, c);
  ok((await api(A.fin, "POST", `/salary-payments/${p1.body.id}/reverse`, { reason: "QA ters kayıt" })).status === 201, "ters kayıt 201", c);
  ok((await api(A.fin, "POST", `/salary-payments/${p1.body.id}/reverse`, { reason: "tekrar" })).body.code === "ALREADY_REVERSED", "ikinci ters kayıt 409", c);
  const comp = (await api(A.fin, "GET", `/practitioners/${pr}/compensation`)).body;
  const cur = comp.months.at(-1);
  ok(cur.salaryDue === "30000.00" && cur.salaryPaid === "6000.00" && cur.salaryRemaining === "24000.00", `ay: hakediş ${cur.salaryDue}, ödenen ${cur.salaryPaid}, kalan ${cur.salaryRemaining}`, c);
  const dbPaid = (await q("select sum(amount)::numeric(14,2)::text v from salary_payments where practitioner_id=$1", [pr]))[0].v;
  ok(dbPaid === "6000.00", `DB net ödenen ${dbPaid}`, c);
  const rep = (await api(A.fin, "GET", `/reports/nakit-hareketleri?from=${today()}&to=${today()}&source=salary_payment`)).body;
  ok(rep.rows?.length >= 3 && rep.rows.every((r) => r.sourceLabel === "Maaş ödemesi"), "nakit raporu Maaş ödemesi satırları", c);
  ok((await api(B.admin, "GET", `/practitioners/${pr}/compensation`)).status === 404, "B kiracısı 404", c);
  // 07.11.2026 (ADR-098): B yöneticisi tüm yetkili; A hekimine ödeme yine yapılamaz (kiracı sınırı) — yetki değil kayıt bulunamaz/geçersiz.
  { const bp = (await api(B.admin, "POST", "/salary-payments", { ...body, amount: "1.00" }, { "idempotency-key": key() })).status;
    ok([403, 404, 422].includes(bp), `B yöneticisi A hekimine ödeme yapamaz (${bp})`, c); }
  summary.F08 = { practitionerId: pr };
  save("F08", { checks: c, compensation: { current: comp.current, months: comp.months.slice(-2), totals: comp.totals } });
  rec("F08", c.every((x) => x.pass) ? "PASS" : "FAIL", `${c.filter((x) => x.pass).length}/${c.length} kontrol: ${c.filter((x) => !x.pass).map((x) => x.check).join("; ") || "hepsi geçti"}`);
}

// ============================ F09 + F10 — ürün/fiyat, randevu malzemesi ============================
{
  const c = [], d = [];
  const supA = (await api(A.admin, "POST", "/suppliers", { kind: "medical", name: `QA Medikal A ${RUN}` })).body.id;
  const supB = (await api(A.admin, "POST", "/suppliers", { kind: "medical", name: `QA Medikal B ${RUN}` })).body.id;
  const it = (await api(A.admin, "POST", "/stock/items", { code: `QA-E${RUN}`, name: `QA eldiven ${RUN}`, unit: "kutu", trackLots: false, minLevel: "0" })).body.id;
  const it2 = (await api(A.admin, "POST", "/stock/items", { code: `QA-G${RUN}`, name: `QA gazlı bez ${RUN}`, unit: "paket", trackLots: false, minLevel: "0" })).body.id;
  await api(A.admin, "POST", "/stock/receipts", { itemId: it, quantity: "10", unitCost: "90.00", supplierId: supA }, { "idempotency-key": key() });
  await api(A.admin, "POST", "/stock/receipts", { itemId: it2, quantity: "5" }, { "idempotency-key": key() });
  const price = (b, s = A.admin) => api(s, "POST", "/supplier-prices", { supplierId: supA, stockItemId: it, validFrom: today(), ...b });
  for (const [lbl, b, exp] of [["dün", { unitPrice: "100.00", validFrom: day(-1) }, 422], ["0", { unitPrice: "0" }, 422], ["negatif", { unitPrice: "-5.00" }, 422], ["3 ondalık", { unitPrice: "1.005" }, 422], ["harf", { unitPrice: "abc" }, 422]])
    ok((await price(b)).status === exp, `fiyat ${lbl} → ${exp}`, c);
  ok((await price({ unitPrice: "100.00" }, A.sec)).status === 403 && (await price({ unitPrice: "100.00" }, A.asst)).status === 403, "sekreter/asistan fiyat 403", c);
  ok((await price({ unitPrice: "100.00", supplierCode: "A-ELD", note: "QA — ğüş" })).status === 201, "fiyat 201", c);
  ok((await price({ unitPrice: "101.00" })).body.code === "PRICE_EXISTS", "aynı gün 409", c);
  await api(A.admin, "POST", "/supplier-prices", { supplierId: supB, stockItemId: it, unitPrice: "80.00", validFrom: today() });
  await price({ unitPrice: "120.00", validFrom: day(30) });
  const bSup = (await api(B.admin, "POST", "/suppliers", { kind: "medical", name: `QA B ${RUN}` })).body.id;
  ok((await api(B.admin, "POST", "/supplier-prices", { supplierId: bSup, stockItemId: it, unitPrice: "1.00", validFrom: today() })).status === 422, "B kiracısı A ürününe fiyat 422", c);
  const cat = (await api(A.asst, "GET", "/stock/catalog")).body.items;
  const g = cat.find((x) => x.id === it), g2 = cat.find((x) => x.id === it2);
  ok(g.unitCost === "100.00" && g.costSource === "supplier_price", `maliyet: son alış tedarikçisinin fiyatı ${g.unitCost}`, c);
  ok(g.prices.map((p) => `${p.unitPrice}:${p.state}`).sort().join() === "100.00:current,120.00:scheduled,80.00:current", "geçerli/planlı ayrımı", c);
  ok(g2.unitCost === null, "fiyatsız ürün null (uydurulmaz)", c);
  ok((await api(A.sec, "GET", "/stock/catalog")).status === 403, "sekreter katalog 403", c);
  const si1 = await api(B.admin, "POST", "/stock/items/standard-import", {}), si2 = await api(B.admin, "POST", "/stock/items/standard-import", {});
  ok(si1.status === 201 && si1.body.added > 0 && si2.body.added === 0, `standart ürün listesi +${si1.body.added}, ikinci 0`, c);
  ok((await api(A.asst, "POST", "/stock/items/standard-import", {})).status === 403, "asistan standart liste 403", c);
  const bStd = (await api(B.admin, "GET", "/stock/catalog")).body.items.filter((x) => x.code.startsWith("STD-"));
  ok(bStd.every((x) => x.unitCost === null && x.balance === "0.000"), "standart ürünler fiyatsız/stoksuz", c);
  save("F09", { checks: c, catalogItem: g });
  rec("F09", c.every((x) => x.pass) ? "PASS" : "FAIL", `${c.filter((x) => x.pass).length}/${c.length} kontrol: ${c.filter((x) => !x.pass).map((x) => x.check).join("; ") || "hepsi geçti"}`);

  // F10
  const pid = await newPatient("Malzeme");
  const planned = await api(A.sec, "POST", "/appointments", { patientId: pid, practitionerId: prac, date: day(6), startTime: freeSlot(), durationMinutes: 15, allowOutsideHours: true });
  const mat = (aid, b, k = key(), s = A.asst) => api(s, "POST", `/appointments/${aid}/materials`, b, { "idempotency-key": k });
  ok((await mat(planned.body.id, { items: [{ itemId: it, quantity: "1" }] })).body.code === "APPOINTMENT_NOT_STARTED", "planlı randevu 409", c.length ? d : d);
  const v = await visit(pid);
  for (const [lbl, b] of [["boş liste", { items: [] }], ["miktar 0", { items: [{ itemId: it, quantity: "0" }] }], ["negatif", { items: [{ itemId: it, quantity: "-1" }] }],
    ["4 ondalık", { items: [{ itemId: it, quantity: "1.2345" }] }], ["31 kalem", { items: Array.from({ length: 31 }, () => ({ itemId: it, quantity: "0.01" })) }], ["geçersiz kimlik", { items: [{ itemId: "x", quantity: "1" }] }]])
    ok((await mat(v.id, b)).status === 422, `malzeme ${lbl} → 422`, d);
  ok((await mat(v.id, { items: [{ itemId: it, quantity: "1" }] }, key(), A.sec)).status === 403, "sekreter 403", d);
  const before = (await q("select count(*)::int n from stock_movements where appointment_id=$1", [v.id]))[0].n;
  const neg = await mat(v.id, { items: [{ itemId: it, quantity: "1" }, { itemId: it2, quantity: "99" }] });
  ok(neg.status === 409 && neg.body.code === "STOCK_INSUFFICIENT" && (await q("select count(*)::int n from stock_movements where appointment_id=$1", [v.id]))[0].n === before, "eksi stok 409, hiçbir satır yazılmadı", d);
  const k = key(); const body = { items: [{ itemId: it, quantity: "1.5" }, { itemId: it2, quantity: "2" }], note: "QA ek sarf — ğüş" };
  const m1 = await mat(v.id, body, k), m2 = await mat(v.id, body, k);
  ok(m1.status === 201 && JSON.stringify(m2.body.ids) === JSON.stringify(m1.body.ids), "idempotent", d);
  const mv = await q("select patient_id, appointment_id, unit_cost::text, stock_movements.quantity::text q from stock_movements where id = any($1::uuid[]) order by stock_movements.quantity", [m1.body.ids]);
  ok(mv.every((x) => x.patient_id === pid && x.appointment_id === v.id), "hasta+randevu bağlı", d);
  ok(mv.find((x) => x.q === "-1.500")?.unit_cost === "100.00" && mv.find((x) => x.q === "-2.000")?.unit_cost === null, "snapshot 100,00 / fiyatsız null", d);
  await api(A.admin, "POST", "/supplier-prices", { supplierId: supA, stockItemId: it, unitPrice: "150.00", validFrom: day(1) });
  const g1 = (await api(A.asst, "GET", `/appointments/${v.id}/materials`)).body;
  ok(g1.totals.materialCost === "150.00" && g1.totals.unknownCostLines === 1 && g1.revenue === null, `gider ${g1.totals.materialCost}, fiyatsız ${g1.totals.unknownCostLines}, asistan bedel görmez`, d);
  const rv = await api(A.asst, "POST", `/stock/movements/${m1.body.ids.find((id, i) => true)}/reverse`, { reason: "QA ters kayıt" });
  const g2r = (await api(A.fin, "GET", `/appointments/${v.id}/materials`)).body;
  ok(rv.status === 201 && g2r.revenue !== null && g2r.contribution !== null, `ters kayıt ${rv.status}; finans bedel ${g2r.revenue}, katkı ${g2r.contribution}`, d);
  const dbCost = (await q(`select coalesce(sum(round(-quantity*unit_cost,2)),0)::numeric(14,2)::text v from stock_movements where appointment_id=$1 and unit_cost is not null`, [v.id]))[0].v;
  ok(g2r.totals.materialCost === dbCost, `gider API ${g2r.totals.materialCost} = DB ${dbCost}`, d);
  ok((await api(B.admin, "GET", `/appointments/${v.id}/materials`)).status === 404, "B kiracısı 404", d);
  const stockBal = (await q("select sum(quantity)::numeric(12,3)::text v from stock_movements where item_id=$1", [it]))[0].v;
  const catBal = (await api(A.asst, "GET", "/stock/catalog")).body.items.find((x) => x.id === it).balance;
  ok(stockBal === catBal, `stok bakiyesi API ${catBal} = DB ${stockBal}`, d);
  summary.F10 = { patientId: pid, appointmentId: v.id, itemId: it };
  save("F10", { checks: d, materials: g2r });
  rec("F10", d.every((x) => x.pass) ? "PASS" : "FAIL", `${d.filter((x) => x.pass).length}/${d.length} kontrol: ${d.filter((x) => !x.pass).map((x) => x.check).join("; ") || "hepsi geçti"}`);
}

// ============================ F12 — işlem listesi + randevu fiyatı ============================
{
  const c = [];
  ok((await api(A.sec, "POST", "/procedures/standard-import", {})).status === 403, "sekreter standart işlem 403", c);
  const r1 = await api(B.admin, "POST", "/procedures/standard-import", {}), r2 = await api(B.admin, "POST", "/procedures/standard-import", {});
  ok(r1.status === 201 && r2.body.added === 0, `standart işlem +${r1.body.added}, ikinci 0`, c);
  if (r1.body.codes?.length) {
    const priced = await q("select count(*)::int n from tariff_items ti join procedures p on p.id=ti.procedure_id where p.tenant_id=$1 and p.code = any($2::text[])", [B.admin.tenantId, r1.body.codes], B.admin.tenantId);
    ok(priced[0].n === 0, "eklenenler fiyatsız", c);
  }
  const pid = await newPatient("IslemFiyat");
  const tem = proc("TEM-01");
  const recBefore = (await q("select count(*)::int n from receivables where patient_id=$1", [pid]))[0].n;
  const a = await api(A.sec, "POST", "/appointments", { patientId: pid, practitionerId: prac, date: day(4), startTime: freeSlot(), durationMinutes: 30, allowOutsideHours: true, procedureId: tem.id });
  const pr = await api(A.sec, "GET", `/price?procedureId=${tem.id}&practitionerId=${prac}&date=${day(4)}`);
  ok(a.status === 201 && a.body.plannedPrice && a.body.procedureLabel?.startsWith("TEM-01"), `randevu işlem etiketi + fiyat ${a.body.plannedPrice}`, c);
  ok(pr.status === 200 && (pr.body.price ?? pr.body.unitPrice ?? pr.body.amount) === a.body.plannedPrice, `tarife fiyatı (${JSON.stringify(pr.body).slice(0, 80)}) = plannedPrice`, c);
  ok((await q("select count(*)::int n from receivables where patient_id=$1", [pid]))[0].n === recBefore, "randevu alacak oluşturmadı", c);
  const types = (await api(A.admin, "GET", "/admin/resources")).body.appointmentTypes;
  const dolgu = types.find((t) => t.name === "Dolgu");
  const a2 = await api(A.sec, "POST", "/appointments", { patientId: pid, practitionerId: prac, date: day(4), startTime: freeSlot(), durationMinutes: 30, allowOutsideHours: true, appointmentTypeId: dolgu?.id });
  ok(a2.status === 201 && a2.body.procedureLabel?.startsWith("DOL-"), `tür varsayılanı (Dolgu türü ${dolgu ? "var" : "yok"}, ${a2.status} ${a2.body.procedureLabel ?? a2.body.code})`, c);
  const bProc = (await api(B.admin, "GET", "/procedures")).body.items[0].id;
  const a3 = await api(A.sec, "POST", "/appointments", { patientId: pid, practitionerId: prac, date: day(4), startTime: freeSlot(), durationMinutes: 30, allowOutsideHours: true, procedureId: bProc });
  ok(a3.status === 422, `B işlemi → ${a3.status}`, c);
  const acc = await api(A.sec, "GET", `/patients/${pid}/account`);
  ok(acc.status === 200, `hasta hesabı (formdaki açık borç kaynağı) ${acc.status}`, c);
  summary.F12 = { patientId: pid, plannedPrice: a.body.plannedPrice };
  save("F12", { checks: c, appointment: { procedureLabel: a.body.procedureLabel, plannedPrice: a.body.plannedPrice }, price: pr.body });
  rec("F12", c.every((x) => x.pass) ? "PASS" : "FAIL", `${c.filter((x) => x.pass).length}/${c.length} kontrol: ${c.filter((x) => !x.pass).map((x) => x.check).join("; ") || "hepsi geçti"}`);
}

writeFileSync(`${OUT}/f-summary.json`, JSON.stringify({ at: new Date().toISOString(), results, data: summary }, null, 1));
await pool.end();
