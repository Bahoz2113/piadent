// Görev 1 ekranları için görsel kontrol (test değildir). node e2e/screens-g1.mjs <dizin>
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "screens";
const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
async function session(email, viewport, scale = 1) {
  const ctx = await browser.newContext({ viewport, locale: "tr-TR", timezoneId: "Europe/Istanbul", deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.goto(`${base}/giris`);
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(process.env.E2E_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.getByRole("heading", { name: "PİA Akış" }).waitFor();
  return { ctx, page };
}
const D = { width: 1366, height: 900 };
{
  const { ctx, page } = await session("elif.aras@demo-yesil.test", D);
  await page.goto(`${base}/hastalar?q=1`);
  await page.locator("a.rowlink").first().click();
  await page.getByRole("tab", { name: "Sağlık" }).click();
  await page.getByText("Sürüm geçmişi").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/g1-anamnez.png`, fullPage: true });
  await page.getByRole("button", { name: "Güncelle" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/g1-anamnez-duzenle.png` });
  await page.goto(`${base}/ajanda?gorunum=hafta`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/g1-hafta.png` });
  await ctx.close();
}
{
  const { ctx, page } = await session("sekreter@demo-yesil.test", D);
  await page.goto(`${base}/hastalar?q=5`);
  await page.locator("a.rowlink").first().click();
  await page.getByText("Yakınlar ve veli").waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/g1-yakinlar.png`, fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await session("yonetici@demo-yesil.test", D);
  await page.goto(`${base}/yonetim`);
  await page.getByRole("heading", { name: "Ekip" }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/g1-yonetim-ekip.png`, fullPage: true });
  await page.getByRole("tab", { name: "Hekim ve üniteler" }).click();
  await page.getByText("Hekimler ve çalışma saatleri").waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/g1-yonetim-kaynak.png`, fullPage: true });
  await page.getByRole("button", { name: "Çalışma saatleri" }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/g1-calisma-saati.png` });
  await ctx.close();
}
{
  const { ctx, page } = await session("sekreter@demo-yesil.test", { width: 360, height: 780 }, 2);
  await page.goto(`${base}/ajanda?gorunum=hafta`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/g1-hafta-mobil.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
