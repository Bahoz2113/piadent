import { expect, test, type Page } from "@playwright/test";

/**
 * Ürün sahibi geri bildirimi 12.11.2026: Randevu ver → 5 · Ödeme planı → "Tamamı" seçilince işlem fiyatı tanımsızsa
 * (işlem seçilmedi / fiyat yok) "Alınan tutar" kutusunda "Fiyat tanımsız" yazmamalı; boş açılmalı ve elle girilebilmeli.
 * Girilen tutar gerçekten tahsil edilir (avans). Fiyat tanımlıysa "Tamamı" fiyatı gösterir.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Bugünün randevuları", level: 2 })).toBeVisible();
}

test("Tamamı: fiyat tanımsızken tutar kutusu boş açılır, elle girilen tutar tahsil edilir", async ({ page }, info) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/ajanda");
  await page.getByRole("button", { name: "Randevu ver" }).click();
  await expect(page.getByRole("heading", { name: "Randevu ver", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: "Hasta", exact: true }).fill("Ay");
  await page.getByRole("listbox", { name: "Hasta sonuçları" }).getByRole("option").first().click();
  // İşlem seçilmedi → işlem fiyatı "—"
  const day = new Date(Date.now() + (info.project.name === "telefon-360" ? 3 : 2) * 86_400_000);
  while ([0, 6].includes(day.getDay())) day.setDate(day.getDate() + 1);
  const ddmmyyyy = `${String(day.getDate()).padStart(2, "0")}.${String(day.getMonth() + 1).padStart(2, "0")}.${day.getFullYear()}`;
  await page.getByPlaceholder("gg.aa.yyyy").first().fill(ddmmyyyy);
  const slots = page.getByRole("radiogroup", { name: "Uygun saatler" });
  await expect.poll(() => slots.getByRole("radio").count(), { timeout: 10_000 }).toBeGreaterThan(3);
  await slots.getByRole("radio").nth((Date.now() % 3) + 2).click();
  await page.getByRole("radiogroup", { name: "Ödeme" }).getByRole("radio", { name: "Tamamı" }).click();
  const amount = page.getByLabel("Alınan tutar (₺)");
  await expect(amount).toBeEditable();
  await expect(amount).toHaveValue("");
  await expect(page.getByText("Fiyat tanımsız")).toHaveCount(0);
  await expect(page.getByText("İşlem fiyatı tanımlı değil; hastadan alınan tutarı yazın.")).toBeVisible();
  await amount.fill("1.250,00");
  await page.getByRole("button", { name: "Randevuyu kaydet" }).click();
  await expect(page.getByText(/Randevu oluşturuldu; .*1\.250,00.* ödeme alındı/)).toBeVisible();
});
