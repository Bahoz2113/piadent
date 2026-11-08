import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
const SHOTS = process.env.E2E_SHOTS_DIR;

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Bugünün randevuları", level: 2 })).toBeVisible();
}
const noOverflow = async (page: Page) => {
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "yatay taşma").toBeLessThanOrEqual(vw + 1);
};
const tile = (page: Page, label: string) => page.locator(".net-tile", { hasText: label }).first();

test("vezne → dağıtım → iade → PİA Net özet (sekreter + finans)", async ({ page, browser }, info) => {
  // Finans: bakiye listesinden açık borçlu sentetik hastaya git
  await login(page, "finans@demo-yesil.test");
  await page.goto("/finans");
  await page.getByRole("tab", { name: "Hasta bakiyeleri" }).click();
  await page.locator("table tbody tr").first().getByRole("link").click(); // en yüksek açık borçlu sentetik hasta
  await expect(page.getByRole("heading", { name: "Hesap · PİA Net" })).toBeVisible();
  const url = page.url();
  const debtBefore = (await tile(page, "Açık borç").locator(".kpi").innerText()).trim();

  // Sekreter: tahsilat al, açık alacağa dağıt
  const sec = await (browser as Browser).newPage({ viewport: page.viewportSize()! });
  await login(sec, "sekreter@demo-yesil.test");
  await sec.goto(url);
  await expect(sec.getByRole("heading", { name: "Hesap · PİA Net" })).toBeVisible();
  await expect(sec.getByRole("button", { name: "İade", exact: true })).toHaveCount(0); // sekreter iade yapamaz
  await sec.getByRole("button", { name: "Tahsilat al" }).click();
  const d = sec.getByRole("dialog", { name: "Tahsilat al" });
  await d.getByLabel("Tutar (₺)").fill("150,00");
  await d.getByRole("button", { name: "Vadesi eski olandan başlayarak dağıt" }).click();
  await expect(d.getByText("Avans olarak kalacak:")).toBeVisible();
  await d.getByRole("button", { name: "Kaydet" }).click();
  await expect(d).toBeHidden();
  await expect(sec.getByText("Tahsilat kaydedildi ve dağıtıldı.")).toBeVisible();
  await expect(tile(sec, "Açık borç").locator(".kpi")).not.toHaveText(debtBefore);
  await tile(sec, "Açık borç").click();
  await expect(sec.getByText(/Açık borç = etkin alacaklar − dağıtılan ödemeler/)).toBeVisible();
  await expect(sec.getByText(/Hareket defteri toplamlarla mutabık/)).toBeVisible();
  if (SHOTS) await sec.screenshot({ path: `${SHOTS}/hesap-${info.project.name}.png`, fullPage: true });
  await noOverflow(sec);
  await sec.close();

  // Finans: son ödemeden 50 iade → dağıtım ters kaydı, borç yeniden açılır
  await page.reload();
  const payRow = page.locator("section", { hasText: "Ödemeler" }).locator("table tbody tr", { hasText: "150,00" }).first();
  await payRow.getByRole("button", { name: "İade" }).click();
  const r = page.getByRole("dialog", { name: "İade" });
  await r.getByLabel("İade tutarı (₺)").fill("50");
  await expect(r.getByText(/dağıtımı geri alacak/)).toBeVisible();
  await r.getByLabel("Gerekçe").fill("E2E sentetik iade");
  await r.getByRole("button", { name: "İadeyi kaydet" }).click();
  await expect(r).toBeHidden();
  await expect(page.getByText("İade kaydedildi.")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Dağıtım ters kaydı/ }).first()).toBeVisible();
  await expect(page.getByText(/Hareket defteri toplamlarla mutabık/)).toBeVisible();

  // PİA Net özet: işlem ≠ tahsilat, kaynak satıra iniş
  await page.goto("/finans");
  await expect(page.getByRole("heading", { name: "Finans · PİA Net" })).toBeVisible();
  await tile(page, "Tahsilat").click();
  await expect(page.getByRole("heading", { name: "Tahsilatı oluşturan ödemeler" })).toBeVisible();
  await expect(page.locator("table tbody tr", { hasText: "150,00" }).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/finans-${info.project.name}.png`, fullPage: true });
  await noOverflow(page);
});

test("hekim hasta hesabını ve klinik finansı göremez", async ({ page }) => {
  await login(page, "elif.aras@demo-yesil.test");
  await page.goto("/hastalar?q=1");
  await page.locator("a.rowlink").first().click();
  await page.getByRole("tab", { name: "Finans" }).click();
  await expect(page.getByText("Hasta hesabı rolünüze kapalı")).toBeVisible();
  await page.goto("/finans");
  await expect(page.getByText("Klinik finans raporları rolünüze kapalı")).toBeVisible();
  await noOverflow(page);
});
