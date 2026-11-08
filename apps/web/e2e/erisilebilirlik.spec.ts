import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Görev 12 (ADR-070) — otomatik erişilebilirlik taraması (axe-core, WCAG 2.1 A/AA kuralları).
 * Ana ekranlar ve açık çekmeceler/takvim taranır; "serious" ve "critical" ihlal 0 olmalı. Elle ekran okuyucu testinin yerine geçmez (AT-18 kalanı).
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

async function scan(page: Page, name: string) {
  // QA-004: tarama kararlı belgede yapılır; başlık her ekranda dolu olmalı (beklenti sıkılaştırıldı, gevşetilmedi).
  await expect(page, `${name}: belge başlığı`).toHaveTitle(/PİA-DENT/);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = bad.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(bad, `${name}: ciddi/kritik axe ihlali\n${summary}`).toEqual([]);
  return { total: r.violations.length, minor: r.violations.filter((v) => v.impact === "minor" || v.impact === "moderate").map((v) => v.id) };
}

test("giriş sayfası", async ({ page }) => {
  await page.goto("/giris");
  await scan(page, "giriş");
});

test("sekreter: bugün, ajanda, hasta 360", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "sekreter@demo-yesil.test");
  await page.goto("/bugun"); await scan(page, "bugün");
  await page.goto("/is-akisi"); await scan(page, "iş akışı");
  await page.goto("/ajanda"); await scan(page, "ajanda");
  await page.goto("/hastalar");
  await page.locator("table tbody tr a.rowlink").first().click();
  await page.waitForURL(/\/hastalar\//); await page.waitForLoadState("networkidle");
  await scan(page, "hasta 360");
});

test("sekreter: hastalar, yeni hasta çekmecesi + takvim", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "sekreter@demo-yesil.test");
  await page.goto("/hastalar"); await scan(page, "hastalar");
  await page.getByRole("button", { name: "Yeni hasta" }).click();
  await expect(page.getByRole("dialog", { name: "Yeni hasta" })).toBeVisible();
  await scan(page, "yeni hasta çekmecesi");
  await page.getByRole("dialog", { name: "Yeni hasta" }).locator(".date-field", { hasText: "Doğum tarihi" }).getByRole("button", { name: "Takvimi aç" }).click();
  await expect(page.getByRole("dialog", { name: "Doğum tarihi takvimi" })).toBeVisible();
  await scan(page, "takvim");
});

test("yönetici: yönetim (ekip, güvenlik, veri aktarımı), raporlar, hesabım", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, "yonetici@demo-yesil.test");
  for (const [path, name] of [["/yonetim?sekme=ekip", "ekip"], ["/yonetim?sekme=guvenlik", "güvenlik"], ["/yonetim?sekme=aktarim", "veri aktarımı"], ["/raporlar", "raporlar"], ["/hesabim", "hesabım"]] as const) {
    await page.goto(path); await page.waitForLoadState("networkidle"); await scan(page, name);
  }
});

test("finans: finans, operasyon", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "finans@demo-yesil.test");
  await page.goto("/finans"); await page.waitForLoadState("networkidle"); await scan(page, "finans");
  await page.goto("/operasyon"); await page.waitForLoadState("networkidle"); await scan(page, "operasyon");
});
