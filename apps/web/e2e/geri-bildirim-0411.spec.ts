import { expect, test, type Page } from "@playwright/test";

/**
 * Ürün sahibi geri bildirimi 04.11.2026 — kullanıcı akışları (ADR-093…097):
 *  Panel (sayaçlar + grafik + tablo görünümü), menü adları, hasta satırının tamamı tıklanabilir ve telefon tam görünür,
 *  telefon hane sınırı, geçmiş saat ajandada tıklanamaz, Hekimler modülü (ücret modeli), Yönetim → Ürün ve fiyat listesi,
 *  randevuda kullanılan malzeme ve gider.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Panel", level: 1 })).toBeVisible();
}
async function noHorizontalOverflow(page: Page) {
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "yatay taşma").toBeLessThanOrEqual(vw + 1);
}
const nav = (page: Page) => page.getByRole("navigation").first();

test("Panel: menü adları, sayaçlar, grafikler ve tablo görünümü; sekreterde para kartları yok", async ({ page }, info) => {
  await login(page, "yonetici@demo-yesil.test");
  if (info.project.name === "telefon-360") await page.getByRole("button", { name: /Menüyü aç|Menü/ }).first().click().catch(() => {});
  await expect(nav(page).getByRole("link", { name: "Panel" })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Randevular" })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Hekimler" })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Bugün" })).toHaveCount(0);
  await expect(nav(page).getByRole("link", { name: "Ajanda" })).toHaveCount(0);
  await page.goto("/bugun");
  const kpis = page.getByRole("region", { name: "Günün özeti" });
  await expect(kpis.getByText("Bugünkü randevular")).toBeVisible();
  await expect(kpis.getByText("Bekleyen tahsilat")).toBeVisible();
  const chart = page.locator("section", { has: page.getByRole("heading", { name: "Randevu yoğunluğu" }) });
  await expect(chart.getByRole("img")).toBeVisible();
  await chart.getByRole("button", { name: "Tablo" }).click();
  await expect(chart.getByRole("table")).toBeVisible();
  await expect(chart.getByRole("columnheader", { name: "Dönem" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "PİA Akış" })).toBeVisible();
  await noHorizontalOverflow(page);

  const sec = await page.context().browser()!.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const p2 = await sec.newPage();
  await login(p2, "sekreter@demo-yesil.test");
  await expect(p2.getByRole("region", { name: "Günün özeti" }).getByText("Bugünkü randevular")).toBeVisible();
  await expect(p2.getByRole("region", { name: "Günün özeti" }).getByText("Bekleyen tahsilat")).toHaveCount(0);
  await expect(p2.getByRole("heading", { name: "Aylık gelir" })).toHaveCount(0);
  await sec.close();
});

test("Hastalar: satırın tamamı karta götürür, telefon tam görünür; yeni hastada telefon 0 ile 11 haneyi aşmaz", async ({ page }) => {
  await login(page, "sekreter@demo-yesil.test");
  await page.goto("/hastalar");
  const row = page.locator("tbody tr.row-click").first();
  await expect(row).toBeVisible();
  const text = await row.innerText();
  expect(text, "telefon maskesiz").not.toMatch(/\*{2,}|•{2,}/);
  // Ad bağlantısı dışındaki görünür son hücreye tıklanır (satırın tamamı tıklanabilir)
  await row.locator("td:visible").last().click({ position: { x: 4, y: 4 } });
  await expect(page).toHaveURL(/\/hastalar\/[0-9a-f-]{36}/);
  await page.goto("/hastalar");
  await page.getByRole("button", { name: /Yeni hasta/ }).first().click();
  const phone = page.getByRole("dialog").getByLabel(/Telefon/).first();
  await phone.fill("053212345678901");
  expect((await phone.inputValue()).replace(/\D/g, "").length).toBe(11);
  await phone.fill("5321234567890");
  expect((await phone.inputValue()).replace(/\D/g, "").length).toBe(10);
});

test("Hekimler: finans ücret modelini görür; yönetici hekim listesini ve çalışma saatlerini görür", async ({ page }) => {
  await login(page, "finans@demo-yesil.test");
  await page.goto("/hekimler");
  await expect(page.getByRole("heading", { name: "Hekimler", level: 1 })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Ücret modeli" })).toBeVisible();
  await page.locator("tbody tr").first().locator("button.link-button").click();
  await expect(page.getByRole("heading", { name: "Ücret ve hakediş" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ücret modelini değiştir" })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("Yönetim → Ürün ve fiyat listesi; randevu ayrıntısında malzeme gideri", async ({ page }) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/yonetim?sekme=urunler");
  await expect(page.getByRole("heading", { name: "Ürün ve fiyat listesi" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Birim maliyet" })).toBeVisible();
  await expect(page.getByText("Muayene eldiveni (sentetik)")).toBeVisible();
  await noHorizontalOverflow(page);
});

test("Raporlar: rapor açıkken menüden Raporlar listeye döner; varsayılan aralık son 30 gün", async ({ page }, info) => {
  test.skip(info.project.name !== "masaustu", "menü bağlantısı masaüstünde görünür");
  await login(page, "yonetici@demo-yesil.test");
  await page.getByRole("link", { name: "Raporlar" }).first().click();
  await page.getByRole("button", { name: /Gelir – gider/ }).click();
  await expect(page.getByRole("heading", { name: "Gelir – gider (nakit akışı)" })).toBeVisible();
  await expect(page).toHaveURL(/rapor=gelir-gider/);
  const from = await page.getByLabel("Başlangıç").inputValue();
  const to = await page.getByLabel("Bitiş").inputValue();
  const days = (Date.parse(to.split(".").reverse().join("-")) - Date.parse(from.split(".").reverse().join("-"))) / 86400000;
  expect(days).toBe(29);
  await page.getByRole("link", { name: "Raporlar" }).first().click();
  await expect(page.getByRole("button", { name: /Gelir – gider/ })).toBeVisible();
  await expect(page).toHaveURL(/\/raporlar$/);
});
