import { expect, test, type Browser, type Page } from "@playwright/test";

/** Worker (tarama + mesaj) çalışır durumda olmalıdır: `pnpm dev:worker`. */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
const SHOTS = process.env.E2E_SHOTS_DIR;

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Panel", level: 1 })).toBeVisible();
}
const noOverflow = async (page: Page) => {
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "yatay taşma").toBeLessThanOrEqual(vw + 1);
};
async function openPatient(page: Page, tab: string) {
  await page.goto("/hastalar?q=1");
  await page.locator("a.rowlink").first().click();
  await page.getByRole("tab", { name: tab }).click();
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("e2e-sentetik-".repeat(30))]);
const EICAR = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");

test("sekreter: DEMO belge önizle → üret → yüz yüze kabul; dosya yükle → tarama → karantina", async ({ page }, info) => {
  await login(page, "sekreter@demo-yesil.test");
  await openPatient(page, "Belgeler");
  await page.getByRole("button", { name: "Belge hazırla" }).click();
  const d = page.getByRole("dialog", { name: "Belge hazırla" });
  await d.getByLabel("Belge türü / şablon").selectOption({ label: /Kanal tedavisi bilgilendirme ve onam — / } as never).catch(async () => {
    const opt = await d.getByLabel("Belge türü / şablon").locator("option", { hasText: "Kanal tedavisi bilgilendirme ve onam —" }).getAttribute("value");
    await d.getByLabel("Belge türü / şablon").selectOption(opt!);
  });
  const planSelect = d.getByLabel("Bağlı tedavi planı (isteğe bağlı)");
  if (await planSelect.isVisible()) await planSelect.selectOption({ index: 1 });
  await d.getByRole("button", { name: "Önizle" }).click();
  await expect(d.getByText(/SENTETİK DEMO BELGESİ/)).toBeVisible();
  await expect(d.getByText("Bu şablon SENTETİK DEMO içeriktir", { exact: false })).toBeVisible();
  await d.getByRole("button", { name: "Belgeyi üret" }).click();
  const doc = page.getByRole("dialog").filter({ hasText: "Kanıt olayları" });
  await expect(doc).toBeVisible();
  await doc.getByRole("button", { name: "Kabul kaydet" }).click();
  await expect(doc.getByRole("button", { name: "Kaydet" })).toBeDisabled(); // personel beyanı olmadan kaydedilmez
  await doc.getByRole("checkbox").check();
  await doc.getByRole("button", { name: "Kaydet" }).click();
  await expect(doc.getByText("Kabul kaydedildi").first()).toBeVisible();
  await expect(doc.getByText(/elektronik imza değildir/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/belge-${info.project.name}.png`, fullPage: true });
  await doc.getByRole("button", { name: "Kapat" }).click().catch(() => page.keyboard.press("Escape"));

  // Dosya: temiz PNG → taranır → kullanılabilir; EICAR → karantina (worker gerçek kuyruktan işler)
  await page.getByLabel("Yüklenecek dosya", { exact: true }).setInputFiles({ name: "e2e-tarama.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText(/Dosya alındı; zararlı içerik taraması bitince/)).toBeVisible();
  await expect(page.locator("tr", { hasText: "e2e-tarama.png" }).first().getByText("Kullanılabilir")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Yüklenecek dosya", { exact: true }).setInputFiles({ name: "e2e-zararli.png", mimeType: "image/png", buffer: EICAR });
  await expect(page.locator("tr", { hasText: "e2e-zararli.png" }).first().getByText("Karantinada")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("tr", { hasText: "e2e-zararli.png" }).first().getByRole("button", { name: "İndir" })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dosya-${info.project.name}.png`, fullPage: true });
  await noOverflow(page);
});

test("iletişim: izin tablosu ve MOCK mesaj — teslim uydurulmaz", async ({ page }, info) => {
  await login(page, "sekreter@demo-yesil.test");
  await openPatient(page, "İletişim");
  await expect(page.getByRole("button", { name: /Randevu hatırlatma · SMS: İzin var/ })).toBeVisible();
  await expect(page.getByText(/DENEME — gerçek mesaj gönderilmez/)).toBeVisible();
  await page.getByRole("button", { name: "Mesaj gönder" }).click();
  const d = page.getByRole("dialog", { name: "Mesaj gönder" });
  await d.getByRole("button", { name: "Kuyruğa al" }).click();
  await expect(d).toBeHidden();
  await expect(async () => {
    await page.reload();
    await page.getByRole("tab", { name: "İletişim" }).click();
    await expect(page.getByText("Sağlayıcıya iletildi (teslim bilinmiyor)").first()).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText("Teslim edildi", { exact: true })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/iletisim-${info.project.name}.png`, fullPage: true });
  await noOverflow(page);
});

test("hekim kontrol planlar; yönetici şablon ve PİA Hazır kurallarını görür", async ({ page, browser }) => {
  await login(page, "elif.aras@demo-yesil.test");
  await openPatient(page, "Tedavi");
  await page.getByRole("button", { name: "Kontrol planla" }).click();
  const d = page.getByRole("dialog", { name: "Kontrol planla" });
  await d.getByLabel("Gerekçe").fill("E2E sentetik kontrol");
  await d.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("E2E sentetik kontrol").first()).toBeVisible();
  await noOverflow(page);

  const adm = await (browser as Browser).newPage({ viewport: page.viewportSize()! });
  await login(adm, "yonetici@demo-yesil.test");
  await adm.goto("/yonetim");
  await adm.getByRole("tab", { name: "Belge şablonları" }).click();
  await expect(adm.getByRole("heading", { name: "Şablonlar" })).toBeVisible();
  await expect(adm.getByRole("heading", { name: "PİA Hazır kuralları" })).toBeVisible();
  await expect(adm.getByText(/klinik\/hukuk incelemesinden geçmemiştir/)).toBeVisible();
  await noOverflow(adm);
  await adm.close();
});
