import { expect, test, type Page } from "@playwright/test";

/**
 * Faz 2.2 (ADR-083) — Fatura taslağı: finans rolü taslak oluşturur (KDV satır bazında), listede "numara yok (taslak)",
 * "Sağlayıcıya gönder" sahte başarı üretmez (409 uyarısı görünür), taslak yazdırmada TASLAK uyarısı; sekreter düğmeyi görmez.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email); await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"), { timeout: 15_000 });
}

test("fatura taslağı: oluştur → numara yok → gönderim reddi görünür → yazdır TASLAK → sekreter oluşturamaz", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.context().addInitScript(() => { window.print = () => {}; });
  await login(page, "finans@demo-yesil.test");
  await page.goto("/finans");
  await page.getByRole("tab", { name: "Hasta bakiyeleri" }).click();
  await page.locator("table tbody tr").first().getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Hesap · PİA Net" })).toBeVisible();
  const url = page.url();

  const card = page.locator("section.card", { hasText: "Fatura taslakları" });
  await expect(card.getByText("e-Belge sağlayıcısı bağlı değil")).toBeVisible();
  await card.getByRole("button", { name: "Taslak oluştur" }).click();
  const d = page.getByRole("dialog", { name: "Fatura taslağı" });
  await d.getByLabel("Alıcı adı / unvanı").fill("Sentetik Alıcı E2E");
  await d.getByLabel("Açıklama 1").fill("Dolgu (sentetik)");
  await d.getByLabel("Birim (₺)").first().fill("333,33");
  await expect(d.getByText("Genel toplam").locator("..").getByText("366,66 ₺")).toBeVisible(); // 333,33 + KDV %10 = 33,33
  await d.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(d).toBeHidden();
  await expect(page.getByText("Fatura taslağı kaydedildi.")).toBeVisible();
  const row = card.locator("table tbody tr", { hasText: "Sentetik Alıcı E2E" }).first();
  await expect(row).toContainText("numara yok");
  await expect(row).toContainText("366,66 ₺");
  await expect(row.getByText("Taslak", { exact: true })).toBeVisible();

  await row.getByRole("button", { name: "Aç" }).click();
  const v = page.getByRole("dialog", { name: /e-Arşiv fatura · Taslak/ });
  await v.getByRole("button", { name: "Sağlayıcıya gönder" }).click();
  await expect(v.getByText(/e-Belge sağlayıcısı bağlı değil: fatura düzenlenemez/)).toBeVisible();
  await expect(v.getByText("yok — yalnız sağlayıcı verir")).toBeVisible();
  const [popup] = await Promise.all([page.waitForEvent("popup"), v.getByRole("button", { name: "Taslağı yazdır" }).click()]);
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup.locator("main")).toContainText("TASLAK");
  await expect(popup.locator("main")).toContainText("resmî belge değildir");
  await expect(popup.locator("main")).toContainText("Fatura no: yok");
  await popup.close();
  await v.getByRole("button", { name: "Kapat" }).click();

  const sec = await (await browser.newContext({ viewport: page.viewportSize()! })).newPage();
  await login(sec, "sekreter@demo-yesil.test");
  await sec.goto(url);
  const secCard = sec.locator("section.card", { hasText: "Fatura taslakları" });
  await expect(secCard).toBeVisible();
  await expect(secCard.getByRole("button", { name: "Taslak oluştur" })).toHaveCount(0);
  await expect(secCard.locator("table tbody tr", { hasText: "Sentetik Alıcı E2E" }).first()).toBeVisible();
  await sec.context().close();
});
