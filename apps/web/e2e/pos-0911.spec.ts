import { expect, test, type Page } from "@playwright/test";

/**
 * ADR-109 (09.11.2026): POS — Faz 0.
 *  - Yönetici DENEME cihazı tanımlar → hastadan Kart (POS) ile tutar cihaza gönderilir → kart onayı benzetilir → tahsilat;
 *    Finans → POS ve gün sonu: onaylı çekim görünür, fiş eşleşince gün sonu kapanır.
 *  - Sekreter banka POS'unda çekimi elle eşleştirir (onay kodu + son 4 hane); son 4 hane alanı fazla rakam almaz;
 *    Finans'ta yalnız POS sekmesini görür.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
const SHOTS = process.env.E2E_SHOTS_DIR ?? process.env.E2E_SHOTS;

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
async function openPatientAccount(page: Page) {
  await page.goto("/hastalar?q=1");
  await page.locator("a.rowlink").first().click();
  await page.getByRole("tab", { name: "Finans" }).click();
  await expect(page.getByRole("heading", { name: "Hesap · PİA Net" })).toBeVisible();
}

test("DENEME cihazı: tutar cihaza gider → onay → tahsilat → gün sonu eşleşir", async ({ page }, info) => {
  await login(page, "yonetici@demo-yesil.test");
  const name = `E2E DENEME ${info.project.name} ${Date.now() % 100000}`;
  await page.goto("/finans");
  await page.getByRole("tab", { name: "POS ve gün sonu" }).click();
  await page.getByRole("button", { name: "Terminal ekle" }).click();
  const td = page.getByRole("dialog", { name: "POS terminali ekle" });
  await td.getByLabel("Ad").fill(name);
  await td.getByRole("combobox", { name: "Bağlantı" }).selectOption("mock");
  await td.getByRole("button", { name: "Kaydet" }).click();
  await expect(td).toBeHidden();
  await expect(page.getByRole("region", { name: `${name} gün sonu` })).toBeVisible();

  await openPatientAccount(page);
  await page.getByRole("button", { name: "Tahsilat al" }).click();
  const d = page.getByRole("dialog", { name: "Tahsilat al" });
  await d.getByLabel("Tutar (₺)").fill("150,00");
  await d.getByRole("combobox", { name: "Yöntem" }).selectOption({ label: "Kart (POS)" });
  await d.getByRole("combobox", { name: /^POS terminali/ }).selectOption({ label: `${name} (DENEME)` });
  await d.getByRole("combobox", { name: "Taksit" }).selectOption({ label: "3 taksit" });
  await expect(d.getByLabel("Onay (provizyon) kodu")).toHaveCount(0); // cihaz sürücüsünde kod elle girilmez
  await noOverflow(page);
  await d.getByRole("button", { name: "Tutarı cihaza gönder" }).click();
  const k = page.getByRole("dialog", { name: "Kartla tahsilat" });
  await expect(k.getByText("Cihazda kart bekleniyor")).toBeVisible();
  await expect(k.getByText("Tutar cihaza gönderildi")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pos-cihaz-${info.project.name}.png`, fullPage: true });
  await noOverflow(page);
  await k.getByRole("button", { name: "Kart onaylandı (deneme)" }).click();
  await expect(k).toBeHidden();
  await expect(page.getByText(/Tahsilat kaydedildi/)).toBeVisible();
  const row = page.locator("section", { hasText: "Ödemeler" }).locator("table tbody tr", { hasText: "150,00" }).first();
  await expect(row).toContainText("Kart (POS)");
  await expect(row).toContainText("3 taksit");

  await page.goto("/finans");
  await page.getByRole("tab", { name: "POS ve gün sonu" }).click();
  const sec = page.getByRole("region", { name: `${name} gün sonu` });
  await expect(sec.getByText("1 adet · 150,00 ₺")).toBeVisible();
  await expect(sec.getByRole("cell", { name: "3 taksit" })).toBeVisible();
  await sec.getByRole("button", { name: "Gün sonunu kapat" }).click();
  const s = page.getByRole("dialog", { name: "Gün sonunu kapat" });
  await s.getByLabel("Fişteki satış adedi").fill("1");
  await s.getByLabel("Fişteki satış toplamı (₺)").fill("140,00");
  await expect(s.getByText("Sistem ile fiş tutmuyor")).toBeVisible();
  await expect(s.getByRole("button", { name: "Gün sonunu kapat" })).toBeDisabled();
  await s.getByLabel("Fişteki satış toplamı (₺)").fill("150,00");
  await expect(s.getByText("Sistem ile POS fişi eşleşiyor.")).toBeVisible();
  await s.getByRole("button", { name: "Gün sonunu kapat" }).click();
  await expect(s).toBeHidden();
  await expect(sec.getByText("Gün sonu eşleşti")).toBeVisible();
  await expect(sec.getByRole("button", { name: "Gün sonunu kapat" })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pos-gun-sonu-${info.project.name}.png`, fullPage: true });
  await noOverflow(page);
});

test("banka POS'u: sekreter çekimi onay kodu + son 4 hane ile eşleştirir; Finans'ta yalnız POS sekmesi", async ({ page }, info) => {
  await login(page, "sekreter@demo-yesil.test");
  await openPatientAccount(page);
  await page.getByRole("button", { name: "Tahsilat al" }).click();
  const d = page.getByRole("dialog", { name: "Tahsilat al" });
  await d.getByLabel("Tutar (₺)").fill("85,40");
  await d.getByRole("combobox", { name: "Yöntem" }).selectOption({ label: "Kart (POS)" });
  await d.getByRole("combobox", { name: /^POS terminali/ }).selectOption({ label: "Banka POS — ön büro (sentetik)" });
  await expect(d.getByText(/tutarı cihaza siz girersiniz/)).toBeVisible();
  await expect(d.getByRole("button", { name: "Çekimi kaydet" })).toBeDisabled();
  const code = `E${info.project.name === "telefon-360" ? "T" : "M"}${Date.now() % 100000}`;
  await d.getByLabel("Onay (provizyon) kodu").fill(code);
  const last4 = d.getByLabel("Kartın son 4 hanesi");
  await last4.fill("4242424242424242");
  await expect(last4).toHaveValue("4242");
  await noOverflow(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pos-elle-${info.project.name}.png`, fullPage: true });
  await d.getByRole("button", { name: "Çekimi kaydet" }).click();
  await expect(d).toBeHidden();
  await expect(page.getByText(/Tahsilat kaydedildi/)).toBeVisible();
  const row = page.locator("section", { hasText: "Ödemeler" }).locator("table tbody tr", { hasText: code.toUpperCase() }).first();
  await expect(row).toContainText("Kart (POS)");
  await expect(row).toContainText("•••• 4242");

  await page.goto("/finans");
  const tabs = page.getByRole("tablist", { name: "Finans bölümleri" });
  await expect(tabs.getByRole("tab")).toHaveCount(1);
  await expect(tabs.getByRole("tab", { name: "POS ve gün sonu" })).toBeVisible();
  const sec = page.getByRole("region", { name: "Banka POS — ön büro (sentetik) gün sonu" });
  await expect(sec.getByRole("cell", { name: new RegExp(code.toUpperCase()) })).toBeVisible();
  await noOverflow(page);
});
