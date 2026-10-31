// Sayfa açılış süresi (Plan: sayfa ≤ 2 sn). Gerçek Chromium, üretim derlemesi (next start), perf veritabanı.
// Ölçüm: gezinme başlangıcından ağ boşalana (networkidle) kadar geçen süre — HTML + JS + tüm API çağrıları dahil.
// Kullanım: WEB=http://127.0.0.1:3000 PASSWORD=<demo parolası> ROUNDS=5 node scripts/perf/pages.mjs
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const WEB = process.env.WEB ?? "http://127.0.0.1:3000";
const PASSWORD = process.env.PASSWORD;
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const v4 = (s) => { const h = createHash("md5").update(s).digest("hex"); const v = `${h.slice(0, 12)}4${h.slice(13, 16)}8${h.slice(17)}`;
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`; };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ locale: "tr-TR", timezoneId: "Europe/Istanbul", viewport: { width: 1366, height: 900 } });
const r = await ctx.request.post(`${WEB}/api/v1/auth/login`, { headers: { "x-viadent-request": "1" }, data: { email: "yonetici@demo-yesil.test", password: PASSWORD } });
if (r.status() !== 200) throw new Error(`login ${r.status()}`);
const page = await ctx.newPage();
const PAGES = [
  ["Bugün", "/bugun"], ["Hastalar", "/hastalar"], ["Hasta arama (ayşe)", "/hastalar?q=ay%C5%9Fe"], ["Ajanda (gün, ~500 randevu)", "/ajanda?tarih=2025-03-12"],
  ["Hasta 360", `/hastalar/${v4("perf-p4242")}`], ["Finans", "/finans"], ["Raporlar", "/raporlar"], ["Operasyon", "/operasyon"],
];
const out = [];
for (const [name, path] of PAGES) {
  await page.goto(`${WEB}${path}`, { waitUntil: "networkidle" }); // ısınma (ilk derleme/önbellek)
  const ms = [];
  for (let i = 0; i < ROUNDS; i++) {
    const t = Date.now();
    await page.goto(`${WEB}${path}`, { waitUntil: "networkidle" });
    ms.push(Date.now() - t);
  }
  ms.sort((a, b) => a - b);
  out.push({ sayfa: name, medyanMs: ms[Math.floor(ms.length / 2)], maksMs: ms[ms.length - 1], url: page.url().replace(WEB, "") });
}
console.table(out);
console.log(JSON.stringify(out));
await browser.close();
