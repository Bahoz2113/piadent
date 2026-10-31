import { expect, test, type Page } from "@playwright/test";

/** Görev 9 — Hesabım: parola değişikliği (politika + diğer oturumlar kapanır); yönetici parola sıfırlaması → geçici parola → zorunlu değişiklik. */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

test("yönetici parola sıfırlar → kullanıcı geçici parolayla girer → Hesabım'a zorlanır → yeni parola → normal akış", async ({ browser }, info) => {
  test.skip(info.project.name !== "masaustu", "durumlu akış; tek projede çalışır");
  const email = "asistan@demo-yesil.test";
  const a = await browser.newContext(); const admin = await a.newPage();
  await login(admin, "yonetici@demo-yesil.test");
  await expect(admin.getByRole("heading", { name: "Bugün", level: 1 })).toBeVisible();
  await admin.goto("/yonetim?sekme=ekip");
  const row = admin.getByRole("row").filter({ hasText: email });
  let temp = "";
  admin.on("dialog", (d) => {
    if (d.type() === "prompt" && /Kimliğini/.test(d.message())) void d.accept("E2E: kimlik yüz yüze doğrulandı");
    else if (d.type() === "prompt" && /Geçici parola/.test(d.message())) { temp = d.defaultValue(); void d.accept(); }
    else void d.accept();
  });
  await row.getByRole("button", { name: "Parola sıfırla" }).click();
  await expect(admin.getByText("Parola sıfırlandı.")).toBeVisible();
  expect(temp).toMatch(/^gecici-/);
  await a.close();

  const u = await browser.newContext(); const page = await u.newPage();
  await login(page, email, temp);
  await expect(page).toHaveURL(/\/hesabim\?parola=1/);
  await expect(page.getByText("Devam etmek için yeni parola belirleyin")).toBeVisible();
  // klinik sayfası açılmaya çalışılırsa geri yönlenir
  await page.goto("/hastalar");
  await expect(page).toHaveURL(/\/hesabim/);
  await page.getByLabel("Mevcut parola").fill(temp);
  await page.getByLabel("Yeni parola", { exact: true }).fill("1234567890");
  await page.getByLabel("Yeni parola (tekrar)").fill("1234567890");
  await page.getByRole("button", { name: "Parolayı değiştir" }).click();
  await expect(page.getByText(/çok yaygın/)).toBeVisible();
  await page.getByLabel("Yeni parola", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Yeni parola (tekrar)").fill(PASSWORD);
  await page.getByRole("button", { name: "Parolayı değiştir" }).click();
  await expect(page.getByRole("heading", { name: "Bugün", level: 1 })).toBeVisible();
  await u.close();
});
