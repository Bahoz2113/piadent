import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Görünüm (ADR-082): üst çubuktaki Görünüm düğmesi → palet/şema/ölçek seçimi anında uygulanır, yenilemede ilk boyamadan itibaren
 * korunur (nonce'lu başlangıç betiği), sunucuya yazılır (yeni oturum/cihaz), koyu şema + farklı palette axe ciddi/kritik ihlal yok.
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
const attrs = (page: Page) => page.evaluate(() => ({ scheme: document.documentElement.dataset.scheme, accent: document.documentElement.dataset.accent, scale: document.documentElement.dataset.scale, root: getComputedStyle(document.documentElement).fontSize, primary: getComputedStyle(document.documentElement).getPropertyValue("--brand-primary").trim() }));

test("görünüm: lacivert + koyu + ölçek 4 → anında, yenilemede ve yeni oturumda korunur; axe temiz; varsayılana dönüş", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, "asistan@demo-yesil.test");
  await page.goto("/bugun");
  const before = await attrs(page);
  // ADR-106: başlangıç görünümü açık şema + mavi palet
  expect(before).toMatchObject({ scheme: "light", accent: "mavi", scale: "3", root: "16px", primary: "#1d4ed8" });

  await page.getByRole("button", { name: "Görünüm" }).click();
  const d = page.getByRole("dialog", { name: "Görünüm" });
  await d.getByRole("radio", { name: "Lacivert" }).click();
  await d.getByRole("radio", { name: "Koyu" }).click();
  await d.getByRole("button", { name: "Büyüt" }).click();
  await expect(d.getByText("Kaydedildi (tüm cihazlarınızda)")).toBeVisible();
  let a = await attrs(page);
  expect(a).toMatchObject({ scheme: "dark", accent: "lacivert", scale: "4", root: "17px", primary: "#9db4ee" });

  // Koyu şema + lacivert palette erişilebilirlik (ciddi/kritik yok) — çekmece açıkken ve kapalıyken
  const scan = async (name: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad, `${name}: ${bad.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`).join("\n")}`).toEqual([]);
  };
  await scan("görünüm çekmecesi (koyu)");
  await d.getByRole("button", { name: "Kapat" }).click();
  await scan("bugün (koyu, lacivert)");

  // Yenileme: ilk boyamadan itibaren koyu (başlangıç betiği) — hidrasyon beklenmeden öznitelik hazır
  await page.reload();
  a = await attrs(page);
  expect(a).toMatchObject({ scheme: "dark", accent: "lacivert", scale: "4" });

  // Yeni tarayıcı bağlamı (başka cihaz): sunucudan gelir
  const ctx = await browser.newContext({ viewport: page.viewportSize()! });
  const other = await ctx.newPage();
  await login(other, "asistan@demo-yesil.test");
  await other.goto("/hesabim");
  await expect(other.getByRole("heading", { name: "Görünüm" })).toBeVisible();
  await expect.poll(async () => (await attrs(other)).accent).toBe("lacivert");
  // Hesabım panelinden varsayılana dön
  await other.getByRole("button", { name: "Varsayılana dön" }).click();
  await expect(other.getByText("Kaydedildi (tüm cihazlarınızda)")).toBeVisible();
  const back = await attrs(other);
  expect(back).toMatchObject({ scheme: "light", accent: "mavi", scale: "3", root: "16px" });
  await ctx.close();
});
