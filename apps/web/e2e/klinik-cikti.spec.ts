import { expect, test, type Page } from "@playwright/test";

/**
 * Faz 1.2 (ADR-085) — Klinik çıktı belgesi: hekim Belgeler → Belge hazırla → Epikriz; serbest metin girer; önizlemede tanı/anamnez
 * alanları ve metni görür; üretir. Sekreter aynı hastanın Belgeler sekmesinde epikrizi GÖRMEZ (sağlık verisi), seçenek "yalnız hekim".
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email); await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"), { timeout: 15_000 });
}

test("epikriz: hekim üretir, serbest metin ve otomatik alanlar; sekreter göremez", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const stamp = `E2E-${Date.now().toString().slice(-6)}`;
  await login(page, "elif.aras@demo-yesil.test");
  await page.goto("/hastalar?q=1");
  await page.locator("a.rowlink").first().click();
  await page.waitForURL(/\/hastalar\/[0-9a-f-]{36}/);
  const url = page.url();
  await page.getByRole("tab", { name: "Belgeler" }).click();
  await page.getByRole("button", { name: "Belge hazırla" }).click();
  const d = page.getByRole("dialog", { name: "Belge hazırla" });
  const opt = await d.getByLabel("Belge türü / şablon").locator("option", { hasText: "Epikriz / tedavi özeti —" }).getAttribute("value");
  await d.getByLabel("Belge türü / şablon").selectOption(opt!);
  await expect(d.locator(".alert-info", { hasText: "Klinik çıktı" })).toContainText("e-reçete değildir");
  await d.getByLabel(/Serbest metin/).fill(`Sentetik hekim önerisi ${stamp}`);
  await d.getByRole("button", { name: "Önizle" }).click();
  const prev = d.locator(".doc-preview");
  await expect(prev).toContainText("EPİKRİZ / TEDAVİ ÖZETİ");
  await expect(prev).toContainText("Tanılar:");
  await expect(prev).toContainText("Anamnez kritik işaretleri:");
  await expect(prev).toContainText(`Sentetik hekim önerisi ${stamp}`);
  await d.getByRole("button", { name: "Belgeyi üret" }).click();
  const doc = page.getByRole("dialog").filter({ hasText: "Kanıt olayları" });
  await expect(doc).toBeVisible();
  await expect(doc).toContainText(`Sentetik hekim önerisi ${stamp}`);
  await doc.getByRole("button", { name: "Kapat" }).click();
  await expect(page.locator("section.card", { hasText: "Belgeler" }).getByText(/Epikriz \/ tedavi özeti/).first()).toBeVisible();

  // Sekreter: aynı hasta, Belgeler sekmesi — epikriz yok; Belge hazırla'da seçenek "yalnız hekim"
  const sec = await (await browser.newContext({ viewport: page.viewportSize()! })).newPage();
  await login(sec, "sekreter@demo-yesil.test");
  await sec.goto(url);
  await sec.getByRole("tab", { name: "Belgeler" }).click();
  await expect(sec.getByRole("heading", { name: /Belgeler/ }).first()).toBeVisible();
  await expect(sec.getByText(/Epikriz \/ tedavi özeti/)).toHaveCount(0);
  await sec.getByRole("button", { name: "Belge hazırla" }).click();
  const sd = sec.getByRole("dialog", { name: "Belge hazırla" });
  await expect(sd.getByLabel("Belge türü / şablon").locator("option", { hasText: "Epikriz / tedavi özeti — yalnız hekim" })).toHaveCount(1);
  await sec.context().close();
});
