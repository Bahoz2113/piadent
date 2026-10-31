// VİADENT ekran turu (Görev 14): rol başına ana ekranların görüntüsü — kılavuzlar ve durum sayfası için. Sentetik demo verisiyle.
// Kullanım: BASE=http://localhost:3000 PASSWORD=<parola> OUT=<dizin> node e2e/screens-tur.mjs
import { chromium } from "@playwright/test";
const base = process.env.BASE ?? "http://localhost:3000";
const PASSWORD = process.env.PASSWORD; const out = process.env.OUT ?? "screens-tur";
import { mkdirSync } from "node:fs"; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: "tr-TR", timezoneId: "Europe/Istanbul" });
const page = await ctx.newPage();
async function login(email) {
  await ctx.clearCookies();
  await page.goto(`${base}/giris`);
  await page.getByLabel("E-posta").fill(email); await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"));
}
async function shot(name, { full = false } = {}) { await page.waitForLoadState("networkidle"); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png`, fullPage: full }); console.log(name); }
async function openPatient() {
  await page.goto(`${base}/hastalar`); await page.waitForLoadState("networkidle");
  await page.locator("table tbody tr a.rowlink").first().click(); await page.waitForURL(/\/hastalar\//);
}

await page.goto(`${base}/giris`); await shot("00-giris");
// Sekreter
await login("sekreter@demo-yesil.test");
await page.goto(`${base}/bugun`); await shot("10-sekreter-bugun");
await page.goto(`${base}/ajanda`); await shot("11-sekreter-ajanda");
await page.goto(`${base}/ajanda?gorunum=hafta`); await shot("12-sekreter-ajanda-hafta");
await page.goto(`${base}/hastalar`); await shot("13-sekreter-hastalar");
await openPatient(); await shot("14-sekreter-hasta360", { full: true });
await page.getByRole("button", { name: "Yeni hasta" }).click().catch(() => undefined);
await page.goto(`${base}/hastalar`); await page.getByRole("button", { name: "Yeni hasta" }).click();
await page.getByRole("dialog", { name: "Yeni hasta" }).locator(".date-field", { hasText: "Doğum tarihi" }).getByRole("button", { name: "Takvimi aç" }).click();
await shot("15-sekreter-yeni-hasta-takvim");
await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
// Hekim
await login("elif.aras@demo-yesil.test");
await openPatient(); await page.getByRole("tab", { name: "Tedavi" }).click(); await shot("20-hekim-tedavi", { full: true });
await page.getByRole("tab", { name: /Anamnez|Klinik/ }).first().click().catch(() => undefined); await shot("21-hekim-klinik", { full: true });
await page.goto(`${base}/tedavi`); await shot("22-hekim-tedavi-panosu");
// Finans
await login("finans@demo-yesil.test");
await page.goto(`${base}/finans`); await shot("30-finans-ozet", { full: true });
await openPatient(); await page.goto(`${page.url().split("?")[0]}?sekme=finans`); await shot("31-finans-hasta-hesap", { full: true });
await page.goto(`${base}/operasyon`); await shot("32-operasyon");
await page.goto(`${base}/raporlar`); await page.getByRole("button", { name: /Borç/ }).first().click(); await shot("33-finans-rapor-borc", { full: true });
// Yönetici
await login("yonetici@demo-yesil.test");
for (const [t, n] of [["ekip", "40-yonetim-ekip"], ["kaynaklar", "41-yonetim-hekimler"], ["katalog", "42-yonetim-katalog"], ["kopru", "43-yonetim-kopru"], ["aktarim", "44-yonetim-veri-aktarimi"], ["guvenlik", "45-yonetim-guvenlik"]]) {
  await page.goto(`${base}/yonetim?sekme=${t}`); await shot(n, { full: t === "guvenlik" || t === "aktarim" });
}
await page.goto(`${base}/raporlar`); await shot("46-raporlar-katalog", { full: true });
await page.getByRole("button", { name: /Klinik işletme/ }).first().click(); await shot("47-raporlar-isletme", { full: true });
await page.goto(`${base}/hesabim`); await shot("48-hesabim", { full: true });
await browser.close();
