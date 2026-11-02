import { expect, test, type Page } from "@playwright/test";

/**
 * Faz 2.1 (ADR-081) — Makbuz: tahsilat sonrası Finans sekmesinde makbuz numarası görünür; "Makbuz" düğmesi yazdırma penceresi
 * açar; pencere makbuz numarasını, hastayı, tutarı ve "fatura yerine geçmez" uyarısını içerir. Yazdırma denetim kaydı API testinde.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"), { timeout: 15_000 });
}

test("tahsilat → makbuz numarası listede → Makbuz düğmesi yazdırma penceresi açar", async ({ page }) => {
  test.setTimeout(90_000);
  await page.context().addInitScript(() => { window.print = () => {}; }); // başsız tarayıcıda yazdırma diyaloğu yok
  await login(page, "finans@demo-yesil.test");
  await page.goto("/finans");
  await page.getByRole("tab", { name: "Hasta bakiyeleri" }).click();
  await page.locator("table tbody tr").first().getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Hesap · PİA Net" })).toBeVisible();

  await page.getByRole("button", { name: "Tahsilat al" }).click();
  const d = page.getByRole("dialog", { name: "Tahsilat al" });
  await d.getByLabel("Tutar (₺)").fill("25,00");
  await d.getByRole("button", { name: "Kaydet" }).click();
  await expect(d).toBeHidden();

  // Ödemeler tablosunda yeni satır makbuz numarası taşır (TM-YYYY-NNNNNN).
  const row = page.locator("table tbody tr", { hasText: "25,00" }).filter({ hasText: /TM-\d{4}-\d{6}/ }).last();
  await expect(row).toBeVisible();
  const no = (await row.locator(".mono").first().innerText()).trim();
  expect(no).toMatch(/^TM-\d{4}-\d{6}$/);

  // Yazdırma penceresi içeriği denetlenir.
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    row.getByRole("button", { name: `Makbuz ${no} yazdır` }).click(),
  ]);
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup.locator("main")).toContainText(no);
  await expect(popup.locator("main")).toContainText("Tahsilat makbuzu");
  await expect(popup.locator("main")).toContainText("25,00");
  await expect(popup.locator("main")).toContainText(/fatura veya e-Arşiv belgesi yerine geçmez/);
  await expect(popup.locator("body")).toContainText("PİA");
  await popup.close();
});
