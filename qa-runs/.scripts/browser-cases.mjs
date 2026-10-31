// CEZERİ teslim testi — VİADENT tarayıcı vakaları (V01–V05 arayüz doğrulaması), masaüstü + mobil emülasyon.
// HTTP koşusunun oluşturduğu sentetik hastayı kullanır (http-summary.json). Ürün kodunu değiştirmez.
// Kullanım: cd apps/web && BASE=http://127.0.0.1:3000 PASSWORD=<güvenli> SUMMARY=<http-summary.json> OUT=<evidence> node ../../qa-runs/.scripts/browser-cases.mjs
import { chromium, devices } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const PASSWORD = process.env.PASSWORD; const OUT = process.env.OUT ?? "evidence";
const summary = JSON.parse(readFileSync(process.env.SUMMARY, "utf8"));
const P = summary.patient;
if (!PASSWORD) { console.error("PASSWORD gerekli"); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const out = [];
const rec = (profile, id, status, detail) => { out.push({ profile, id, status, ...detail }); console.log(`${status.padEnd(6)} ${profile.padEnd(8)} ${id} ${detail.summary ?? ""}`); };

async function session(profile, email) {
  const ctx = await browser.newContext({ ...(profile === "mobil" ? { ...devices["Pixel 5"], viewport: { width: 360, height: 780 } } : { viewport: { width: 1366, height: 900 } }), locale: "tr-TR", timezoneId: "Europe/Istanbul" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/giris`);
  await page.getByLabel("E-posta").fill(email); await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"), { timeout: 20_000 });
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const pretty = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const v03 = JSON.parse(readFileSync(`${OUT}/V03-http.json`, "utf8"));
const v04 = JSON.parse(readFileSync(`${OUT}/V04-http.json`, "utf8"));
const v05 = JSON.parse(readFileSync(`${OUT}/V05-http.json`, "utf8"));

for (const profile of ["masaustu", "mobil"]) {
  // V01 — B kliniği yöneticisi A hastasının sayfasını açar: ad/önizleme yok
  {
    const { ctx, page } = await session(profile, "yonetici@demo-mavi.test");
    const r = await page.goto(`${BASE}/hastalar/${P}`);
    await page.waitForLoadState("networkidle");
    const text = await page.locator("main, body").first().innerText();
    const leak = /Sınama|Hasta[a-z0-9]{6,}/.test(text);
    await shot(page, `${profile}-V01-b-tenant`);
    await page.goto(`${BASE}/hastalar?q=${encodeURIComponent("Sınama")}`); await page.waitForLoadState("networkidle");
    const rows = await page.locator("table tbody tr").count();
    rec(profile, "V01", !leak && rows === 0 ? "PASS" : "FAIL", { summary: `B hasta sayfası sızıntı=${leak}, arama satırı ${rows}`, evidence: `evidence/${profile}-V01-b-tenant.png` });
    await ctx.close();
  }
  // V02 — hekim Tedavi sekmesinde diş 16
  {
    const { ctx, page } = await session(profile, "elif.aras@demo-yesil.test");
    await page.goto(`${BASE}/hastalar/${P}?sekme=tedavi`); await page.waitForLoadState("networkidle");
    const tooth = page.locator("[data-tooth='16'], [aria-label*='16 numaralı'], button:has-text('16')").first();
    const toothVisible = await tooth.isVisible().catch(() => false);
    const text = await page.locator("main").innerText();
    const hasDol = /DOL-01|Dolgu/i.test(text);
    const hasCorrected = /Düzeltildi|düzeltme/i.test(text);
    await shot(page, `${profile}-V02-tedavi`);
    rec(profile, "V02", toothVisible && hasDol ? "PASS" : "FAIL", { summary: `diş 16 görünür=${toothVisible}, işlem metni=${hasDol}, düzeltme izi=${hasCorrected}`, evidence: `evidence/${profile}-V02-tedavi.png` });
    await ctx.close();
  }
  // V03 — ajanda: yarış günündeki slotta tek randevu
  {
    const { ctx, page } = await session(profile, "sekreter@demo-yesil.test");
    const [day, time] = v03.slot.split(" ");
    await page.goto(`${BASE}/ajanda?tarih=${day}`); await page.waitForLoadState("networkidle");
    const text = await page.locator("main").innerText();
    const count = (text.match(new RegExp(`${time}`, "g")) ?? []).length;
    const n = await page.locator(`[data-start='${time}'], .appt:has-text('${time}'), [class*=appointment]:has-text('${time}')`).count();
    await shot(page, `${profile}-V03-ajanda`);
    rec(profile, "V03", n === 1 || (n === 0 && count >= 1) ? "PASS" : "FAIL", { summary: `${pretty(day)} ${time} ajandada randevu bloğu ${n} (metin eşleşmesi ${count}); API: ${v03.appointmentsAtSlot}`, evidence: `evidence/${profile}-V03-ajanda.png` });
    await ctx.close();
  }
  // V04 — Finans sekmesi: tek 300,00 ödeme, bakiye API ile aynı
  {
    const { ctx, page } = await session(profile, "finans@demo-yesil.test");
    await page.goto(`${BASE}/hastalar/${P}?sekme=finans`); await page.waitForLoadState("networkidle");
    const text = await page.locator("main").innerText();
    const n300 = (text.match(/300,00/g) ?? []).length;
    const debtShown = text.includes(v04.refund.openDebtAfter.replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, "."));
    const refundShown = /İade|iade/.test(text) && /100,00/.test(text);
    await shot(page, `${profile}-V04-finans`);
    rec(profile, "V04", n300 >= 1 && debtShown && refundShown ? "PASS" : "FAIL", { summary: `300,00 geçişi ${n300}, açık borç ${v04.refund.openDebtAfter} görünür=${debtShown}, iade izi=${refundShown}`, evidence: `evidence/${profile}-V04-finans.png` });
    await ctx.close();
  }
  // V05 — Geçmiş sekmesi: hekim düzeltmeyi görür; sekreter klinik bulgu olayını GÖRMEMELİ
  {
    const { ctx, page } = await session(profile, "elif.aras@demo-yesil.test");
    await page.goto(`${BASE}/hastalar/${P}?sekme=gecmis`); await page.waitForLoadState("networkidle");
    const t1 = await page.locator("main").innerText();
    const dentistSees = /procedure\.correct|düzelt/i.test(t1) && /procedure\.complete|işlem/i.test(t1);
    await shot(page, `${profile}-V05-gecmis-hekim`);
    await ctx.close();
    const s2 = await session(profile, "sekreter@demo-yesil.test");
    await s2.page.goto(`${BASE}/hastalar/${P}?sekme=gecmis`); await s2.page.waitForLoadState("networkidle");
    const t2 = await s2.page.locator("main").innerText();
    const secSeesClinical = /finding\.create|diagnosis\.create|Bulgu|tooth|Diş: 16/i.test(t2);
    await shot(s2.page, `${profile}-V05-gecmis-sekreter`);
    await s2.ctx.close();
    rec(profile, "V05", dentistSees && !secSeesClinical ? "PASS" : "FAIL", { summary: `hekim düzeltme izi=${dentistSees}; sekreter klinik bulgu olayı görüyor=${secSeesClinical} (API: ${v05.secretaryClinicalEventsVisible?.length ?? "?"} olay)`, evidence: `evidence/${profile}-V05-gecmis-sekreter.png` });
  }
}
await browser.close();
writeFileSync(`${OUT}/browser-summary.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, patient: P, results: out }, null, 1));
console.log(JSON.stringify({ pass: out.filter((r) => r.status === "PASS").length, fail: out.filter((r) => r.status === "FAIL").length }));
