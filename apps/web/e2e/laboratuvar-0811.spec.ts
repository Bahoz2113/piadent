import { expect, test, type Page } from "@playwright/test";

/**
 * ADR-108 (08.11.2026): Laboratuvar menüsü.
 *  - Hasta işleri: menüden hasta seçerek yeni iş emri; ölçü türü/tarihi ve istenen malzeme ayrıntıda ve föyde.
 *  - Malzeme siparişleri: yeni sipariş (2 kalem) → gönder → kısmi teslim (lot takipli kalemde lot) → listede "Kısmen teslim alındı".
 *  - Tedarikçiler sekmesi; Operasyon'da Stok; eski bağlantı (/operasyon?sekme=tedarikci) Laboratuvar'a gider.
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
async function openNav(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Menüyü aç" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation").first().getByRole("link", { name, exact: true }).click();
}

test("Laboratuvar → Hasta işleri: hasta seçerek iş emri; ölçü ve istenen malzeme", async ({ page }, info) => {
  await login(page, "asistan@demo-yesil.test");
  await openNav(page, "Laboratuvar");
  await expect(page.getByRole("heading", { name: "Laboratuvar", level: 1 })).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Laboratuvar bölümleri" });
  for (const t of ["Hasta işleri", "Malzeme siparişleri", "Tedarikçiler"]) await expect(tabs.getByRole("tab", { name: t })).toBeVisible();
  await page.getByRole("button", { name: "Yeni iş emri" }).click();
  const d = page.getByRole("dialog", { name: "Yeni laboratuvar iş emri" });
  await expect(d.getByRole("button", { name: "Taslak oluştur" })).toBeDisabled();
  await d.getByLabel("Hasta").fill("Ay");
  await d.getByRole("listbox", { name: "Hasta sonuçları" }).getByRole("option").first().click();
  await expect(d.getByRole("button", { name: "Değiştir" })).toBeVisible();
  const lab = d.getByRole("combobox", { name: /^Laboratuvar/ });
  await lab.selectOption((await lab.locator("option").nth(1).getAttribute("value"))!);
  const hek = d.getByRole("combobox", { name: /^Hekim/ });
  await hek.selectOption((await hek.locator("option").nth(1).getAttribute("value"))!);
  const work = `E2E ölçü ${info.project.name} ${Date.now() % 100000}`;
  await d.getByLabel("İş tanımı").fill(work);
  await d.getByLabel("Dişler (FDI)").fill("36");
  await expect(d.getByRole("textbox", { name: "Ölçü tarihi" })).toBeDisabled();
  await d.getByRole("combobox", { name: "Ölçü türü" }).selectOption({ label: "Dijital tarama (ağız içi)" });
  const today = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
  await d.getByRole("textbox", { name: "Ölçü tarihi" }).fill(today);
  await d.getByRole("combobox", { name: "İstenen malzeme" }).selectOption({ label: "E.max (lityum disilikat)" });
  await noHorizontalOverflow(page);
  await d.getByRole("button", { name: "Taslak oluştur" }).click();
  const o = page.getByRole("dialog").filter({ hasText: work });
  await expect(o.getByText("Dijital tarama (ağız içi)")).toBeVisible();
  await expect(o.getByText("E.max (lityum disilikat)")).toBeVisible();
  await o.getByRole("button", { name: "İş föyü" }).click();
  const sheet = o.getByLabel("Laboratuvar iş föyü");
  await expect(sheet).toContainText("Dijital tarama (ağız içi)");
  await expect(sheet).toContainText("E.max (lityum disilikat)");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/lab-is-emri-${info.project.name}.png`, fullPage: true });
});

test("Laboratuvar → Malzeme siparişleri: sipariş → gönder → kısmi teslim stoğa girer", async ({ page }, info) => {
  await login(page, "asistan@demo-yesil.test");
  await page.goto("/laboratuvar?sekme=siparisler");
  await expect(page.getByRole("heading", { name: "Malzeme siparişleri" })).toBeVisible();
  // seed: tedarikçiye gönderilmiş örnek sipariş listede
  await expect(page.locator("tr", { hasText: "Medikal Depo" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Yeni sipariş" }).click();
  const d = page.getByRole("dialog", { name: "Yeni malzeme siparişi" });
  const sup = d.getByRole("combobox", { name: /^Tedarikçi/ });
  await sup.selectOption({ label: (await sup.locator("option", { hasText: "Medikal Depo" }).first().innerText()).trim() });
  await d.getByRole("button", { name: "Kalem ekle" }).click();
  await d.getByRole("button", { name: "Kalem ekle" }).click();
  const l1 = d.getByRole("group", { name: "Kalem 1" });
  const l2 = d.getByRole("group", { name: "Kalem 2" });
  await l1.getByRole("combobox", { name: /Stok kalemi/ }).selectOption({ label: (await l1.locator("option", { hasText: "Muayene eldiveni" }).innerText()).trim() });
  await l1.getByRole("textbox", { name: /^Miktar/ }).fill("6");
  await l2.getByRole("combobox", { name: /Stok kalemi/ }).selectOption({ label: (await l2.locator("option", { hasText: "İmplant fikstürü" }).innerText()).trim() });
  await l2.getByRole("textbox", { name: /^Miktar/ }).fill("2");
  await noHorizontalOverflow(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/siparis-yeni-${info.project.name}.png`, fullPage: true });
  await d.getByRole("button", { name: "Taslak oluştur" }).click();
  await expect(page.getByText(/Sipariş \d+ taslak olarak açıldı\./)).toBeVisible();
  const o = page.getByRole("dialog", { name: /^Sipariş \d+ · Medikal Depo/ });
  await expect(o.getByText("Taslak", { exact: true })).toBeVisible();
  await o.getByRole("button", { name: "Tedarikçiye gönderildi olarak işaretle" }).click();
  await o.getByRole("button", { name: "Kaydet" }).click();
  await expect(o.getByText("Tedarikçiye gönderildi").first()).toBeVisible();
  await o.getByRole("button", { name: "Teslim al" }).click();
  const r = o.getByLabel("Teslim al");
  await r.getByRole("textbox", { name: /Muayene eldiveni.*gelen/ }).fill("4");
  await r.getByRole("textbox", { name: /İmplant fikstürü.*gelen/ }).fill("1");
  await r.getByRole("textbox", { name: "Lot no" }).fill(`E2E-${info.project.name}-${Date.now() % 10000}`);
  await r.getByRole("button", { name: "Teslimi kaydet" }).click();
  await expect(page.getByText(/teslim stoğa işlendi/)).toBeVisible();
  await expect(o.getByText("Kısmen teslim alındı").first()).toBeVisible();
  await expect(o.getByRole("heading", { name: "Teslimler" })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("Tedarikçiler Laboratuvar'da; Operasyon'da Stok; eski bağlantı yönlenir", async ({ page }) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/operasyon?sekme=tedarikci");
  await expect(page).toHaveURL(/\/laboratuvar\?sekme=tedarikci/);
  await expect(page.getByRole("heading", { name: "Tedarikçiler ve laboratuvarlar" })).toBeVisible();
  await page.goto("/operasyon");
  await expect(page.getByRole("heading", { name: "Operasyon", level: 1 })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Operasyon bölümleri" })).toHaveCount(0);
  await expect(page.locator("tr", { hasText: "Muayene eldiveni" }).first()).toBeVisible();
});
