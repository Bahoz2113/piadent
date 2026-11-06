import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Panel", level: 1 })).toBeVisible();
}
/** Mobil emülasyonda tarayıcı taşan sayfayı uzaklaştırır; bu yüzden düzen genişliği proje görünüm alanıyla karşılaştırılır. */
const noOverflow = async (page: Page) => {
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "yatay taşma").toBeLessThanOrEqual(vw + 1);
};

// 07.11.2026 (ADR-100): anamnez paneli kaldırıldı; yerine hasta kartında sağlık özeti (kronik hastalık / ilaç / alerji).
test("hekim: sağlık özetini girer ve başlıkta uyarı görür; sekreter içeriği görmez, sağlık sekmesine erişemez", async ({ page, browser }) => {
  await login(page, "elif.aras@demo-yesil.test");
  await page.goto("/hastalar?q=1");
  await page.locator("a.rowlink").first().click();
  await page.getByRole("tab", { name: "Sağlık" }).click();
  await expect(page.getByRole("heading", { name: "Sağlık özeti" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Anamnez/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^(Ekle|Düzenle)$/ }).first().click();
  const dr = page.getByRole("dialog", { name: "Sağlık özeti" });
  await dr.getByLabel("Alerji").fill("Penisilin (sentetik E2E)");
  await dr.getByRole("button", { name: "Kaydet" }).click();
  await expect(dr).toBeHidden();
  await expect(page.locator(".chip-alert", { hasText: "Alerji: Penisilin (sentetik E2E)" })).toBeVisible();
  await noOverflow(page);

  const sec = await (browser as Browser).newPage();
  await login(sec, "sekreter@demo-yesil.test");
  await sec.goto("/hastalar?q=1");
  await sec.locator("a.rowlink").first().click();
  await expect(sec.locator(".chip-alert", { hasText: "Sağlık uyarısı var" })).toBeVisible();
  await expect(sec.getByText(/Penisilin/)).toHaveCount(0); // sağlık içeriği sekretere sızmaz
  await sec.getByRole("tab", { name: "Sağlık" }).click();
  await expect(sec.getByText("Sağlık bilgileri rolünüze kapalı")).toBeVisible();
  await sec.close();
});

test("yönetici daveti → yeni kullanıcı kabul eder ve doğru rolle girer", async ({ page, browser }) => {
  const email = `davet${Date.now().toString().slice(-7)}@demo-yesil.test`;
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/yonetim");
  await page.getByRole("button", { name: "Ekibe davet et" }).click();
  const d = page.getByRole("dialog", { name: "Ekibe davet et" });
  await d.getByRole("textbox", { name: "Ad soyad", exact: true }).fill("Sentetik Asistan");
  await d.getByRole("textbox", { name: "E-posta", exact: true }).fill(email);
  await d.getByLabel("Rol").selectOption("assistant");
  await d.getByRole("button", { name: "Davet bağlantısı oluştur" }).click();
  const link = await d.getByLabel("Davet bağlantısı").inputValue();
  expect(link).toMatch(/\/davet\/[A-Za-z0-9_-]{40,}$/);
  await d.getByRole("button", { name: "Tamam" }).click();
  await expect(page.getByText(email)).toBeVisible(); // bekleyen davetler

  const ctx = await (browser as Browser).newContext();
  const guest = await ctx.newPage();
  await guest.goto(new URL(link).pathname);
  await expect(guest.getByText(/· Asistan/)).toBeVisible();
  await guest.getByRole("textbox", { name: "Yeni parola", exact: true }).fill("Guvenli-Deneme-Parolasi-7");
  await guest.getByRole("textbox", { name: "Parola (tekrar)", exact: true }).fill("Guvenli-Deneme-Parolasi-7");
  await guest.getByRole("button", { name: "Kabul et ve giriş yap" }).click();
  await expect(guest.getByRole("heading", { name: "Panel", level: 1 })).toBeVisible();
  if (guest.viewportSize()!.width < 900) await guest.getByRole("button", { name: "Menüyü aç" }).click();
  await expect(guest.getByText(/^Asistan( · |$)/).filter({ visible: true }).first()).toBeVisible();
  // Aynı bağlantı ikinci kez kullanılamaz.
  const again = await ctx.newPage();
  await again.goto(new URL(link).pathname);
  await expect(again.getByRole("heading", { name: "Davet geçersiz" })).toBeVisible();
  await ctx.close();
});

test("sekreter: yakın ekler; yasal temsil dayanaksız reddedilir", async ({ page }) => {
  await login(page, "sekreter@demo-yesil.test");
  await page.goto("/hastalar?q=2");
  await page.locator("a.rowlink").first().click();
  await page.getByRole("button", { name: "Yakın ekle" }).click();
  const d = page.getByRole("dialog", { name: "Yakın ekle" });
  await d.getByRole("button", { name: "Kayıtlı olmayan kişi" }).click();
  await d.getByRole("textbox", { name: "Ad soyad", exact: true }).fill(`Sentetik Vasi ${Date.now() % 10000}`);
  await d.getByLabel("Yakınlık").selectOption("legal_guardian");
  await d.getByText("Yasal temsilci (veli/vasi)").click();
  await d.getByRole("button", { name: "Kaydet" }).click();
  await expect(d.getByText("Yasal temsil için dayanak belge/açıklama gerekli")).toBeVisible();
  await d.getByRole("textbox", { name: "Dayanak", exact: true }).fill("Vesayet kararı görüldü (sentetik)");
  await d.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Yasal temsilci").first()).toBeVisible();
  await noOverflow(page);
});

test("ana sayfalar dar ekranda taşmaz", async ({ page }) => {
  await login(page, "yonetici@demo-yesil.test");
  for (const path of ["/bugun", "/hastalar", "/ajanda", "/ajanda?gorunum=hafta", "/yonetim", "/tedavi"]) {
    await page.goto(path);
    await page.waitForTimeout(500);
    await noOverflow(page);
  }
});
