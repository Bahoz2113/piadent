// Görsel kontrol için ekran görüntüleri (test değildir). Kullanım: node e2e/screens.mjs <çıktı-dizini>
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "screens";
const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
for (const [name, viewport] of [["desktop", { width: 1366, height: 900 }], ["mobile", { width: 360, height: 780 }]]) {
  const ctx = await browser.newContext({ viewport, locale: "tr-TR", timezoneId: "Europe/Istanbul", deviceScaleFactor: name === "mobile" ? 2 : 1 });
  const page = await ctx.newPage();
  await page.goto(`${base}/giris`);
  await page.screenshot({ path: `${out}/${name}-0-giris.png` });
  await page.getByLabel("E-posta").fill(process.env.E2E_EMAIL ?? "sekreter@demo-yesil.test");
  await page.getByLabel("Parola").fill(process.env.E2E_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.getByRole("heading", { name: "PİA Akış" }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}-1-bugun.png`, fullPage: true });
  await page.goto(`${base}/hastalar`);
  await page.getByText(/sonuç/).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-2-hastalar.png`, fullPage: true });
  await page.locator("a.rowlink").first().click();
  await page.getByRole("tab", { name: "Özet" }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-3-hasta360.png`, fullPage: true });
  await page.getByRole("tab", { name: "Geçmiş" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-4-gecmis.png`, fullPage: true });
  await page.goto(`${base}/ajanda`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-5-ajanda.png`, fullPage: name === "mobile" });
  await page.goto(`${base}/hastalar`);
  await page.getByRole("button", { name: "Yeni hasta" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-6-yeni-hasta.png` });
  await ctx.close();
}
await browser.close();
