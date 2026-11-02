import { expect, test, type Page } from "@playwright/test";

/**
 * Faz 4.4 (ADR-087) — Mobil kart görünümü: 360 px'te Finans sekmesindeki geniş tablolar kart satırlarına döner (grid), yatay sayfa
 * taşması yok, hücre etiketleri başlıktan türetilir; masaüstünde tablo olarak kalır. Faz 4.1: Raporlar sayfasında ham kaynak kodu yok.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email); await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"), { timeout: 15_000 });
}

test("finans sekmesi geniş tablolar: mobilde kart, masaüstünde tablo; raporlarda ham kod yok", async ({ page }, info) => {
  await login(page, "finans@demo-yesil.test");
  await page.goto("/finans");
  await page.getByRole("tab", { name: "Hasta bakiyeleri" }).click();
  await page.locator("table tbody tr").first().getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Hesap · PİA Net" })).toBeVisible();
  const row = page.locator("section.card", { hasText: "Ödemeler" }).locator("table.table-wide tbody tr").first();
  await expect(row).toBeVisible();
  const display = await row.evaluate((el) => getComputedStyle(el).display);
  const label = await row.locator("td").first().getAttribute("data-label");
  expect(label).toBe("Tarih");
  if (info.project.name === "telefon-360") {
    expect(display).toBe("grid");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(row.locator("td").first()).toHaveCSS("display", "block");
  } else {
    expect(display).toBe("table-row");
  }
  await page.goto("/raporlar");
  await expect(page.getByRole("heading", { name: "Raporlar" })).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(/\b[RTGHOV]\d{2}\b/); // R22, T07 gibi iç kodlar kullanıcıya gösterilmez
  await page.getByRole("button", { name: /Nakit hareketleri/ }).click();
  await expect(page.getByRole("heading", { name: "Nakit hareketleri (kaynak satırlar)" })).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(/\b[RTGHOV]\d{2}\b/);
  await expect(page.getByRole("button", { name: "Excel" })).toBeVisible();
});
