import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Bugün", level: 1 })).toBeVisible();
}

/** Mobil emülasyonda tarayıcı taşan sayfayı uzaklaştırır; bu yüzden düzen genişliği proje görünüm alanıyla karşılaştırılır. */
async function noHorizontalOverflow(page: Page) {
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "yatay taşma").toBeLessThanOrEqual(vw + 1);
}

test("sekreter: hasta oluştur → randevu ver → çakışma reddi → VİA İz", async ({ page }, info) => {
  const mobile = info.project.name.includes("360");
  const stamp = Date.now().toString().slice(-6);
  const last = `Deneme${stamp}${mobile ? "M" : "D"}`;
  await login(page, "sekreter@demo-yesil.test");
  await noHorizontalOverflow(page);

  await page.goto("/hastalar");
  await page.getByRole("button", { name: "Yeni hasta" }).click();
  const drawer = page.getByRole("dialog", { name: "Yeni hasta" });
  await drawer.getByRole("textbox", { name: "Ad", exact: true }).fill("Sentetik");
  await drawer.getByRole("textbox", { name: "Soyad", exact: true }).fill(last);
  // Gelecek doğum tarihi istemci ve sunucuda reddedilir.
  await drawer.getByLabel("Doğum tarihi").fill("2099-01-01");
  await drawer.getByRole("button", { name: "Hastayı kaydet" }).click();
  await expect(drawer.getByText("Doğum tarihi gelecekte olamaz.")).toBeVisible();
  await drawer.getByLabel("Doğum tarihi").fill("1990-05-17");
  await drawer.getByLabel("Telefon").fill("0555 000 77 66");
  await drawer.getByRole("button", { name: "Hastayı kaydet" }).click();
  await expect(page.getByRole("heading", { name: `Sentetik ${last}`, level: 1 })).toBeVisible();
  await noHorizontalOverflow(page);

  await page.getByRole("link", { name: "Randevu ver" }).click();
  const ap = page.getByRole("dialog", { name: "Randevu ver" });
  await expect(ap.getByText(`Sentetik ${last}`)).toBeVisible();
  const offset = 20 + (Number(stamp) % 300) * 2 + (mobile ? 1 : 0); // her koşuda farklı gün
  const day = new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  await ap.getByRole("textbox", { name: "Tarih", exact: true }).fill(day);
  await ap.getByRole("textbox", { name: "Saat", exact: true }).fill(mobile ? "07:00" : "07:30");
  await ap.getByLabel("Açıklama").fill("Kontrol");
  await ap.getByRole("button", { name: "Randevuyu kaydet" }).click();
  // 07:xx çalışma saati dışında: uyarı gösterilir, bilinçli onayla kaydedilir (T05).
  await expect(ap.getByText("Çalışma saati dışı", { exact: true })).toBeVisible();
  await ap.getByRole("button", { name: "Çalışma saati dışında yine de kaydet" }).click();
  await expect(page.getByText("Randevu oluşturuldu.")).toBeVisible();

  // Aynı hekim/saat ikinci kez → anlamlı çakışma (sunucu kontrolü).
  await page.getByRole("button", { name: "Randevu ver" }).first().click();
  const ap2 = page.getByRole("dialog", { name: "Randevu ver" });
  await ap2.getByRole("textbox", { name: "Hasta", exact: true }).fill(last);
  await ap2.getByRole("option", { name: new RegExp(last, "i") }).click();
  await ap2.getByRole("textbox", { name: "Tarih", exact: true }).fill(day);
  await ap2.getByRole("textbox", { name: "Saat", exact: true }).fill(mobile ? "07:00" : "07:30");
  await ap2.getByRole("button", { name: "Randevuyu kaydet" }).click();
  await ap2.getByRole("button", { name: "Çalışma saati dışında yine de kaydet" }).click();
  await expect(ap2.getByText(/dolu/)).toBeVisible();
  await ap2.getByRole("button", { name: "Vazgeç" }).click();
  page.once("dialog", (d) => void d.accept());

  await page.goto(`/hastalar?q=${last}`);
  await page.getByRole("link", { name: `Sentetik ${last}` }).click();
  await page.getByRole("tab", { name: "Geçmiş" }).click();
  await expect(page.getByText("Hasta kaydı oluşturuldu")).toBeVisible();
  await expect(page.getByText("Randevu oluşturuldu")).toBeVisible();
  await page.getByRole("tab", { name: "Sağlık" }).click();
  await expect(page.getByText("Sağlık bilgileri rolünüze kapalı")).toBeVisible();
  await noHorizontalOverflow(page);
});

test("ajanda ve Bugün ekranları klavye ile kullanılabilir, taşma yok", async ({ page }) => {
  await login(page, "sekreter@demo-yesil.test");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "İçeriğe geç" })).toBeFocused();
  await page.goto("/ajanda");
  await expect(page.getByRole("heading", { name: "Ajanda" })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.goto("/bugun");
  await expect(page.getByRole("heading", { name: "VİA Akış" })).toBeVisible();
  await noHorizontalOverflow(page);
});
