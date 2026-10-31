// VİADENT yük ölçümü (yalnız sentetik perf veritabanına karşı). Bağımlılık yok: Node 22 fetch.
// Kullanım: BASE=http://127.0.0.1:4100 PASSWORD=<demo parolası> VUS=50 DURATION=60 node scripts/perf/load.mjs
// Her sanal kullanıcı (VU) gerçek bir rolle oturum açar ve klinik gününe benzer bir karışım çalıştırır:
//   hasta arama (ad/telefon), hasta kartı, hasta randevu geçmişi, günlük ajanda (500+ randevulu gün), Bugün görevleri,
//   kaynaklar, finans özeti (yönetici/finans), %5 yazma (gelecek tarihe randevu oluşturma; çakışma 409 ayrı sayılır).
import { createHash } from "node:crypto";

const BASE = process.env.BASE ?? "http://127.0.0.1:4100";
const PASSWORD = process.env.PASSWORD;
const VUS = Number(process.env.VUS ?? 50);
const DURATION = Number(process.env.DURATION ?? 60) * 1000;
const WARMUP = Number(process.env.WARMUP ?? 10) * 1000;
const PATIENTS = Number(process.env.PERF_PATIENTS ?? 100000);
// Düşünme süresi (ms): gerçek kullanıcı her işlemden sonra ekranı okur/yazar. 0 = doygunluk (stres) profili.
const THINK_MIN = Number(process.env.THINK_MIN ?? 0), THINK_MAX = Number(process.env.THINK_MAX ?? 0);
const think = () => (THINK_MAX > 0 ? new Promise((r) => setTimeout(r, THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN))) : null);
if (!PASSWORD) { console.error("PASSWORD gerekli"); process.exit(1); }

const ROLES = ["sekreter@demo-yesil.test", "sekreter@demo-yesil.test", "elif.aras@demo-yesil.test", "yonetici@demo-yesil.test", "finans@demo-yesil.test", "asistan@demo-yesil.test"];
const NAMES = ["ayse", "mehmet yil", "fatma kay", "ali dem", "zeynep", "emre", "selin cel", "mustafa oz", "elif", "can ak", "0555", "90555123"];
const uuid = (s) => { const h = createHash("md5").update(s).digest("hex"); const v = `${h.slice(0, 12)}4${h.slice(13, 16)}8${h.slice(17)}`; return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (n) => Math.floor(Math.random() * n);
const isoDay = (d) => d.toISOString().slice(0, 10);
const randomDay = () => isoDay(new Date(Date.UTC(2021, 5, 1) + rnd(2000) * 86400000));

const stats = new Map(); // ad → {ms: [], status: {}}
function rec(name, ms, status) {
  let s = stats.get(name);
  if (!s) stats.set(name, (s = { ms: [], status: {} }));
  s.ms.push(ms);
  s.status[status] = (s.status[status] ?? 0) + 1;
}
let measuring = false;
const samples = new Map(); // uç → ilk beklenmeyen hata örneği (tanı için)

async function login(email) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-viadent-request": "1" }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (r.status !== 200) throw new Error(`login ${email} ${r.status}`);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const s = await (await fetch(`${BASE}/api/v1/session`, { headers: { cookie } })).json();
  return { cookie, ctx: s.activeMembership.id, role: s.activeMembership.role, perms: new Set(s.activeMembership.permissions ?? []) };
}

async function call(u, name, path, init = {}) {
  const t = performance.now();
  const r = await fetch(`${BASE}/api/v1${path}`, { ...init, headers: { cookie: u.cookie, "x-viadent-context": u.ctx, "x-viadent-request": "1", "content-type": "application/json", ...(init.headers ?? {}) } });
  const body = await r.text();
  const ms = performance.now() - t;
  if (measuring) rec(name, ms, r.status);
  if (r.status >= 400 && r.status !== 409 && !samples.has(name)) samples.set(name, `${r.status} ${body.slice(0, 200)}`);
  return { status: r.status, body };
}

async function vu(i, until) {
  const u = await login(ROLES[i % ROLES.length]);
  const pracs = JSON.parse((await call(u, "resources", "/resources")).body).practitioners?.map((p) => p.id) ?? [];
  while (Date.now() < until) {
    const x = Math.random();
    const pid = uuid(`perf-p${1 + rnd(PATIENTS)}`);
    if (x < 0.25) await call(u, "hasta_arama", `/patients?q=${encodeURIComponent(pick(NAMES))}`);
    else if (x < 0.43) await call(u, "hasta_karti", `/patients/${pid}`);
    else if (x < 0.55) await call(u, "hasta_randevulari", `/patients/${pid}/appointments`);
    else if (x < 0.75) await call(u, "ajanda_gun", `/appointments?date=${randomDay()}`);
    else if (x < 0.85) await call(u, "bugun_gorevler", "/tasks");
    else if (x < 0.90) await call(u, "kaynaklar", "/resources");
    else if (x < 0.95) {
      if (u.role === "clinic_admin" || u.role === "finance") await call(u, "finans_ozet", "/finance/summary");
      else await call(u, "hasta_arama", `/patients?q=${encodeURIComponent(pick(NAMES))}`);
    } else if (pracs.length && (u.role === "secretary" || u.role === "clinic_admin")) {
      const d = isoDay(new Date(Date.UTC(2027, 0, 1) + rnd(1400) * 86400000));
      const m = 9 * 60 + rnd(40) * 15;
      await call(u, "randevu_olustur", "/appointments", { method: "POST", body: JSON.stringify({ patientId: pid, practitionerId: pick(pracs), date: d,
        startTime: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, durationMinutes: 30, allowOutsideHours: true }) });
    } else await call(u, "hasta_karti", `/patients/${pid}`);
    await think();
  }
}

const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const start = Date.now();
const until = start + WARMUP + DURATION;
setTimeout(() => { measuring = true; }, WARMUP);
const t0 = Date.now() + WARMUP;
await Promise.all(Array.from({ length: VUS }, (_, i) => vu(i, until)));
const secs = (Date.now() - t0) / 1000;
const out = [];
let total = 0, all = [];
for (const [name, s] of [...stats.entries()].sort()) {
  const ms = s.ms.sort((a, b) => a - b);
  total += ms.length; all = all.concat(ms);
  out.push({ uç: name, istek: ms.length, p50: +q(ms, 0.5).toFixed(1), p95: +q(ms, 0.95).toFixed(1), p99: +q(ms, 0.99).toFixed(1), maks: +ms[ms.length - 1].toFixed(1), durum: s.status });
}
all.sort((a, b) => a - b);
console.table(out);
if (samples.size) console.log("hata örnekleri:", Object.fromEntries(samples));
console.log(JSON.stringify({ vus: VUS, dusunmeMs: [THINK_MIN, THINK_MAX], sureSn: Math.round(secs), istek: total, istekPerSn: +(total / secs).toFixed(1), genelP50: +q(all, 0.5).toFixed(1), genelP95: +q(all, 0.95).toFixed(1), genelP99: +q(all, 0.99).toFixed(1), detay: out }, null, 0));
