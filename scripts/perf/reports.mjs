// PİA-DENT rapor + haftalık ajanda ölçümü (yalnız sentetik perf veritabanına karşı). Bağımlılık yok: Node 22 fetch.
// Kullanım: BASE=http://127.0.0.1:4100 PASSWORD=<parola> node scripts/perf/reports.mjs
// Her rapor: son 30 gün ve rapor izninin verdiği en uzun aralık (maxDays) için ardışık 5 koşu; p50/p95 ms, satır sayısı, kesildi mi.
const BASE = process.env.BASE ?? "http://127.0.0.1:4100";
const PASSWORD = process.env.PASSWORD;
const RUNS = Number(process.env.RUNS ?? 5);
if (!PASSWORD) { console.error("PASSWORD gerekli"); process.exit(2); }

async function login(email) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-viadent-request": "1" }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (r.status !== 200) throw new Error(`login ${email} ${r.status}`);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const s = await (await fetch(`${BASE}/api/v1/session`, { headers: { cookie } })).json();
  return { cookie, ctx: s.activeMembership.id };
}
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(s) + n * 86400_000));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function timed(u, path) {
  const t0 = performance.now();
  const r = await fetch(`${BASE}/api/v1${path}`, { headers: { cookie: u.cookie, "x-viadent-context": u.ctx } });
  const body = await r.json();
  return { ms: performance.now() - t0, status: r.status, body };
}

const admin = await login("yonetici@demo-yesil.test");
const today = iso(new Date());
const out = [];
// haftalık ajanda (7 gün, tüm hekimler) ve günlük ajanda — en yoğun hafta (perf verisi 2021-06'dan itibaren günde 20 randevu/hekim)
for (const [name, path] of [["ajanda-gun", `/appointments?date=${today}`], ["ajanda-hafta", `/appointments?from=${today}&days=7`], ["ajanda-hafta-2021", `/appointments?from=2021-06-07&days=7`]]) {
  const ms = [], rows = [];
  for (let i = 0; i < RUNS; i++) { const r = await timed(admin, path); if (r.status !== 200) throw new Error(`${name} ${r.status}`); ms.push(r.ms); rows.push((r.body.items ?? r.body.appointments ?? []).length); }
  out.push({ name, p50: Math.round(pct(ms, 0.5)), p95: Math.round(pct(ms, 0.95)), rows: rows[0] });
}
const cat = (await timed(admin, "/reports")).body.reports;
for (const def of cat) {
  for (const [label, from] of [["30g", addDays(today, -29)], [`${def.maxDays}g`, addDays(today, -(def.maxDays - 1))]]) {
    if (def.maxDays <= 30 && label !== "30g") continue;
    const path = `/reports/${def.id}?from=${from}&to=${today}`;
    const ms = []; let last;
    for (let i = 0; i < RUNS; i++) { last = await timed(admin, path); if (last.status !== 200) { ms.push(NaN); break; } ms.push(last.ms); }
    out.push({ name: `${def.id} (${label})`, p50: Math.round(pct(ms, 0.5)), p95: Math.round(pct(ms, 0.95)), rows: last?.body?.rows?.length ?? null, truncated: !!last?.body?.truncated, status: last?.status });
  }
}
console.log(JSON.stringify({ base: BASE, runs: RUNS, at: new Date().toISOString(), results: out }, null, 1));
