import { expect, test, type Page } from "@playwright/test";

/**
 * 07.11.2026 geri bildirimi (ADR-103): anatomik odontogram + randevudan dişe işlem kaydı + takvimde yıl seçimi.
 *  - Randevu ayrıntısında (hasta geldi/tamamlandı) "Yapılan işlemi dişe işle": çekim (diş 36) ve iki yüz dolgu (diş 15, M+O).
 *  - Hasta kartı Özet'teki şemada çekilen diş "Çekildi" (soluk + çarpı), dolgu yüzeyle görünür; üstüne gelince ipucunda işlem,
 *    tıklayınca ayrıntıda kod/ad/tarih/hekim.
 *  - Tarih alanı takviminde ay ve yıl seçimi (doğum tarihi için 12 kez geri gitmeden).
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
const SHOTS = process.env.E2E_SHOTS;

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Bugünün randevuları", level: 2 })).toBeVisible();
}
async function noHorizontalOverflow(page: Page) {
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "yatay taşma").toBeLessThanOrEqual(vw + 1);
}
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());

test("randevudan dişe işlem → hasta kartı şemasında çekim ve dolgu, ipucu ve ayrıntı", async ({ page }, info) => {
  await login(page, "elif.aras@demo-yesil.test");
  const day = todayIst();
  const appts = (await (await page.request.get(`/api/v1/appointments?date=${day}`)).json()) as { items: { id: string; patientId: string; patientName: string; status: string }[] };
  const visit = appts.items.find((a) => a.status === "completed") ?? appts.items.find((a) => a.status === "checked_in");
  expect(visit, "seed: bugün gelmiş hasta randevusu").toBeTruthy();

  await page.goto(`/ajanda?tarih=${day}`);
  await page.locator("button.appt:visible, button.appt-row:visible", { hasText: visit!.patientName }).first().click();
  const dr = page.getByRole("dialog", { name: visit!.patientName });
  const box = dr.getByRole("region", { name: "Yapılan işlemi dişe işle" });
  await expect(box).toBeVisible();

  // Çekim: diş 36
  await box.getByLabel("İşlem").selectOption({ label: "CEK-01 · Diş çekimi (basit)" });
  await expect(box.getByText("Şemada: Çekildi")).toBeVisible();
  await box.locator('[data-tooth="36"]').click();
  await expect(box.getByText("Seçili: Diş 36")).toBeVisible();
  await box.getByRole("button", { name: "İşlemi dişe kaydet" }).click();
  await expect(box.getByText(/Diş 36 · CEK-01 Diş çekimi \(basit\) kaydedildi/)).toBeVisible();
  await expect(box.locator('[data-tooth="36"]')).toHaveAttribute("data-state", /Çekildi/);

  // İki yüz dolgu: diş 15, meziyal (sağ bölge) + okluzal (orta)
  await box.getByLabel("İşlem").selectOption({ label: "DOL-02 · Kompozit dolgu (iki yüz) (yüzey)" });
  await box.locator('[data-tooth="15"]').click();
  await box.locator('[data-tooth="15"] [data-surface="M"]').click();
  await box.locator('[data-tooth="15"] [data-surface="O"]').click();
  await expect(box.getByText(/yüzey: MO/)).toBeVisible();
  await box.getByRole("button", { name: "İşlemi dişe kaydet" }).click();
  await expect(box.getByText(/Diş 15 \(MO\) · DOL-02/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/randevu-dise-islem-${info.project.name}.png`, fullPage: true });

  // Hasta kartı → Özet: şema
  await page.goto(`/hastalar/${visit!.patientId}`);
  const card = page.getByRole("region", { name: "Diş şeması" });
  const odo = card.getByRole("group", { name: "Odontogram" });
  await expect(odo.locator('[data-tooth="36"]')).toHaveClass(/is-missing/);
  await expect(odo.locator('[data-tooth="36"]')).toHaveAttribute("aria-label", /^Diş 36; Çekildi/);
  await expect(odo.locator('[data-tooth="15"]')).toHaveAttribute("data-state", /Dolgu \(MO\)/);
  await expect(odo.locator('[data-tooth="15"]')).toHaveClass(/has-done/);
  if (info.project.name === "masaustu") {
    await odo.locator('[data-tooth="15"]').hover();
    const tip = page.getByRole("tooltip");
    await expect(tip).toContainText("Diş 15 · küçük azı");
    await expect(tip).toContainText("DOL-02");
    await expect(odo.locator('[data-tooth="15"]')).toHaveAttribute("aria-describedby", /.+/);
  }
  await odo.locator('[data-tooth="36"]').click();
  const detail = card.locator(".tooth-detail");
  await expect(detail).toContainText("Diş 36 · büyük azı");
  await expect(detail).toContainText("CEK-01");
  await expect(detail).toContainText("Diş çekimi (basit)");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/odontogram-${info.project.name}.png`, fullPage: true });
  await noHorizontalOverflow(page);
});

test("takvimde ay ve yıl seçimi: doğum tarihi tek adımda", async ({ page }) => {
  await login(page, "sekreter@demo-yesil.test");
  await page.goto("/hastalar");
  await page.getByRole("button", { name: /Yeni hasta/ }).first().click();
  const dr = page.getByRole("dialog", { name: /Yeni hasta/ });
  const field = dr.locator(".date-field", { hasText: "Doğum tarihi" });
  await field.getByRole("button", { name: "Takvimi aç" }).click();
  const cal = page.getByRole("dialog", { name: /Doğum tarihi takvimi/ });
  await cal.getByLabel("Yıl", { exact: true }).selectOption("1985");
  await cal.getByLabel("Ay", { exact: true }).selectOption({ label: "Mart" });
  await cal.getByRole("gridcell", { name: "14.03.1985" }).click();
  await expect(field.getByRole("textbox")).toHaveValue("14.03.1985");
  await noHorizontalOverflow(page);
});
