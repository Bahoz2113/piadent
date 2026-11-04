import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
const SHOTS = process.env.E2E_SHOTS_DIR;

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Panel", level: 1 })).toBeVisible();
}
const noOverflow = async (page: Page) => {
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "yatay taşma").toBeLessThanOrEqual(vw + 1);
};
async function openPatientTreatment(page: Page) {
  await page.goto("/hastalar?q=1");
  await page.locator("a.rowlink").first().click();
  await page.getByRole("tab", { name: "Tedavi" }).click();
}

test("hekim: odontogram → yeni plan → teklif → kabul → gerçekleşen işlem", async ({ page }, info) => {
  await login(page, "elif.aras@demo-yesil.test");
  await openPatientTreatment(page);
  await expect(page.getByRole("heading", { name: "Odontogram" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Diş 16; Çürük/ })).toBeVisible(); // seed bulgusu erişilebilir adda
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tedavi-${info.project.name}.png`, fullPage: true });
  await noOverflow(page);

  // Kabul edilmiş seed planındaki kalemi bugünkü ziyarete bağlayarak gerçekleştir
  await page.getByRole("button", { name: "Gerçekleştir" }).first().click();
  const pd = page.getByRole("dialog", { name: "İşlemi gerçekleştir" });
  await pd.getByRole("button", { name: "Tamamlandı olarak kaydet" }).click();
  await expect(pd).toBeHidden();
  await expect(page.getByRole("heading", { name: "Gerçekleşen işlemler" })).toBeVisible();

  // Yeni plan: diş 37 seç, O yüzeyi, dolgu ekle, teklif et, kabul kaydet
  await page.getByRole("button", { name: "Yeni plan" }).click();
  const np = page.getByRole("dialog", { name: "Yeni tedavi planı" });
  await np.getByLabel("Plan adı").fill("E2E plan");
  await np.getByRole("button", { name: "Oluştur" }).click();
  await expect(np).toBeHidden();
  await page.getByRole("button", { name: /^Diş 37/ }).click();
  await page.getByRole("button", { name: "Taslak plana ekle" }).click();
  const it = page.getByRole("dialog", { name: "Plana kalem ekle" });
  await it.getByLabel("İşlem").selectOption({ label: "DOL-01 · Kompozit dolgu (tek yüz)" });
  await expect(it.getByText(/Tarife fiyatı: ₺?\s?1\.800,00|1\.800,00/)).toBeVisible();
  await it.getByRole("checkbox", { name: "O" }).check();
  await it.getByRole("button", { name: "Ekle" }).click();
  await expect(it).toBeHidden();
  const draft = page.locator(".plan-version", { hasText: "E2E plan" }).first();
  await draft.getByRole("button", { name: "Teklif olarak sun" }).click();
  await draft.getByRole("button", { name: "Hasta kararını kaydet" }).click();
  const dd = page.getByRole("dialog", { name: "Hasta kararını kaydet" });
  await dd.getByRole("radio", { name: /Kabul/ }).check();
  await dd.getByRole("button", { name: "Kaydet" }).click();
  await expect(dd).toBeHidden();
  await expect(draft.getByText("Sürüm 1 · Kabul edildi")).toBeVisible();
  await expect(draft.getByRole("button", { name: /kalemini sil/ })).toHaveCount(0); // kabul edilen sürüm düzenlenemez
  await noOverflow(page);
});

test("sekreter: plan ve teklifi görür, klinik harita ve işlem tamamlama kapalı", async ({ page }) => {
  await login(page, "sekreter@demo-yesil.test");
  await openPatientTreatment(page);
  await expect(page.getByText("Klinik harita (odontogram, tanı) rolünüze kapalı.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tedavi planları" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gerçekleştir" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Yeni plan" })).toHaveCount(0);
  await noOverflow(page);
});

test("tedavi takibi ve yönetici katalog/tarife ekranı", async ({ page, browser }, info) => {
  await login(page, "elif.aras@demo-yesil.test");
  await page.goto("/tedavi");
  await expect(page.getByRole("heading", { name: "Tedavi takibi" })).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/takip-${info.project.name}.png`, fullPage: true });
  await noOverflow(page);

  const adm = await (browser as Browser).newPage({ viewport: page.viewportSize()! });
  await login(adm, "yonetici@demo-yesil.test");
  await adm.goto("/yonetim");
  await adm.getByRole("tab", { name: "Katalog ve tarife" }).click();
  await expect(adm.getByRole("heading", { name: "İşlem kataloğu" })).toBeVisible();
  await expect(adm.getByText("2026 Genel Tarife (sentetik)")).toBeVisible();
  await adm.getByRole("button", { name: "Fiyatları gör" }).first().click();
  await expect(adm.getByRole("dialog").getByText("Yayınlanmış/kaldırılmış tarife salt okunurdur.")).toBeVisible();
  if (SHOTS) await adm.screenshot({ path: `${SHOTS}/katalog-${info.project.name}.png` });
  await adm.close();
});
