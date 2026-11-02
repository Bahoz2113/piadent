import { expect, test, type Page } from "@playwright/test";

/**
 * Faz 1.1 (ADR-084) — Anamnez şablonu: yönetici Yönetim → Anamnez şablonu'nda taslak açar, soru ekler, kaydeder; yayın düğmesini görmez.
 * Hekim yayınlar; Hasta 360 → Sağlık → anamnez girişinde yeni soru görünür; sonra hekim şablonu emekli eder (yerleşik sete dönüş,
 * diğer testler bozulmasın). Yalnız masaüstünde (durumlu akış).
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email); await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"), { timeout: 15_000 });
}

test("anamnez şablonu: yönetici taslak → hekim yayınlar → hastada yeni soru → emekli", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "masaustu", "durumlu akış yalnız masaüstünde");
  test.setTimeout(150_000);
  const stamp = Date.now().toString().slice(-5);
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/yonetim");
  await page.getByRole("tab", { name: "Anamnez şablonu" }).click();
  const panel = page.locator("section.card", { hasText: "Anamnez soru şablonu" });
  await expect(panel.getByText(/Yürürlükte:/)).toBeVisible();
  // Önceki koşudan kalan taslak varsa kullanılır; yoksa yeni açılır.
  if (await panel.getByRole("button", { name: "Yeni sürüm taslağı" }).isVisible().catch(() => false)) {
    await panel.getByRole("button", { name: "Yeni sürüm taslağı" }).click();
    await expect(page.getByText("Yürürlükteki setin kopyasıyla taslak açıldı.")).toBeVisible();
  }
  await panel.getByLabel("Form başlığı").fill(`E2E anamnez formu ${stamp}`);
  await panel.getByRole("button", { name: "Soru ekle" }).click();
  const last = panel.getByLabel("Soru", { exact: true }).last();
  await last.fill(`Daha önce diş hekimi korkusu yaşadınız mı? ${stamp}`);
  await panel.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page.getByText("Taslak kaydedildi.")).toBeVisible();
  await expect(panel.getByText("Yayını yalnız hekim yapabilir")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Hekim olarak yayınla" })).toHaveCount(0);

  // Hekim yayınlar
  const dr = await (await browser.newContext({ viewport: page.viewportSize()! })).newPage();
  await login(dr, "elif.aras@demo-yesil.test");
  await dr.goto("/yonetim");
  await dr.getByRole("tab", { name: "Anamnez şablonu" }).click();
  const dpanel = dr.locator("section.card", { hasText: "Anamnez soru şablonu" });
  await dpanel.getByRole("button", { name: "Hekim olarak yayınla" }).click();
  await expect(dr.getByText("Şablon yayınlandı")).toBeVisible();
  await expect(dpanel.getByText(`E2E anamnez formu ${stamp}`)).toBeVisible();

  // Hasta 360 → Sağlık sekmesi → anamnez girişinde yeni soru
  await dr.goto("/hastalar");
  await dr.locator("table tbody tr").first().getByRole("link").click();
  await dr.getByRole("tab", { name: "Sağlık" }).click();
  const anam = dr.locator("section.card", { hasText: /^Anamnez/ }).first();
  await anam.getByRole("button", { name: /Anamnez gir|Güncelle/ }).click();
  await expect(anam.getByText(`Daha önce diş hekimi korkusu yaşadınız mı? ${stamp}`)).toBeVisible();
  await expect(anam.getByText(`Form: E2E anamnez formu ${stamp}`)).toBeVisible();
  await anam.getByRole("button", { name: "Vazgeç" }).click();

  // Temizlik: hekim şablonu emekli eder → yerleşik set
  await dr.goto("/yonetim");
  await dr.getByRole("tab", { name: "Anamnez şablonu" }).click();
  const row = dr.locator("table tbody tr", { hasText: `E2E anamnez formu ${stamp}` });
  await expect(row.getByText("Yayında")).toBeVisible();
  dr.once("dialog", (dlg) => void dlg.accept());
  await row.getByRole("button", { name: "Emekli et" }).click();
  await expect(dr.getByText("Şablon emekli edildi")).toBeVisible();
  await expect(row.getByText("Emekli", { exact: true })).toBeVisible();
  await dr.context().close();
});
