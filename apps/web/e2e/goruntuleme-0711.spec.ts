import { expect, test, type Page } from "@playwright/test";

/**
 * 07.11.2026 geri bildirimi (ADR-104, ADR-105):
 *  - Hasta kartı → Görüntülemeler: "Yeni görüntüleme ekle" (tür, çekim tarihi, diş, not) → tarama → kartta küçük resim → tıklayınca büyük görüntü.
 *    Sekreter (sağlık yetkisi yok) sekmeyi kilitli görür.
 *  - Belge hazırla: listedeki her tür onaylı şablonla gelir ("onaylı şablon yok" seçeneği yok); seçilen belge önizlemede hasta adıyla dolar.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
const SHOTS = process.env.E2E_SHOTS;

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Panel", level: 1 })).toBeVisible();
}
async function noHorizontalOverflow(page: Page) {
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "yatay taşma").toBeLessThanOrEqual(vw + 1);
}
async function firstPatient(page: Page) {
  const r = (await (await page.request.get("/api/v1/patients?q=")).json()) as { items: { id: string; fullName: string }[] };
  return r.items[0]!;
}
/** 64×48 sentetik PNG (gri degrade) — gerçek hasta görüntüsü değildir. */
async function syntheticPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 64; c.height = 48;
    const g = c.getContext("2d")!; const gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, "#111"); gr.addColorStop(1, "#ddd");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 48); return c.toDataURL("image/png").split(",")[1]!;
  });
  return Buffer.from(b64, "base64");
}

test("Görüntülemeler: yeni panoramik ekle → listede → büyük görüntü; sekreter kilitli", async ({ page, browser }, info) => {
  await login(page, "elif.aras@demo-yesil.test");
  const p = await firstPatient(page);
  await page.goto(`/hastalar/${p.id}?sekme=goruntuleme`);
  const sec = page.getByRole("region", { name: "Görüntülemeler" });
  await expect(sec.getByRole("heading", { name: "Görüntülemeler" })).toBeVisible();
  await sec.getByRole("button", { name: "Yeni görüntüleme ekle" }).click();
  const dr = page.getByRole("dialog", { name: "Yeni görüntüleme ekle" });
  const note = `E2E panoramik ${Date.now()}`;
  await dr.getByLabel("Görüntüleme dosyası").setInputFiles({ name: "panoramik-sentetik.png", mimeType: "image/png", buffer: await syntheticPng(page) });
  await expect(dr.getByText(/panoramik-sentetik\.png/)).toBeVisible();
  await dr.getByLabel("Görüntüleme türü").selectOption("panoramic");
  await dr.getByLabel("İlgili diş(ler)").fill("16, 99");
  await expect(dr.getByText("Geçersiz diş numarası: 99")).toBeVisible();
  await expect(dr.getByRole("button", { name: "Görüntülemeyi ekle" })).toBeDisabled();
  await dr.getByLabel("İlgili diş(ler)").fill("16, 26");
  await dr.getByLabel("Not").fill(note);
  await dr.getByRole("button", { name: "Görüntülemeyi ekle" }).click();
  await expect(dr).toBeHidden();
  const card = sec.getByRole("button", { name: /Panoramik röntgen, .*diş 16, 26/ }).first();
  await expect(card).toBeEnabled({ timeout: 30_000 }); // tarama bitince açılır
  await expect(card.locator("img")).toBeVisible();
  await card.click();
  const v = page.getByRole("dialog", { name: "Panoramik röntgen" });
  await expect(v.getByRole("img", { name: /Panoramik röntgen —/ })).toBeVisible();
  await expect(v.getByText(note)).toBeVisible();
  await expect(v.getByText("16, 26")).toBeVisible();
  await v.getByRole("button", { name: "Yakınlaştır" }).click();
  await expect(v.getByText("%125")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/goruntuleme-${info.project.name}.png`, fullPage: true });
  await noHorizontalOverflow(page);

  const ctx = await browser.newContext({ ...info.project.use });
  const p2 = await ctx.newPage();
  await login(p2, "sekreter@demo-yesil.test");
  await p2.goto(`/hastalar/${p.id}?sekme=goruntuleme`);
  await expect(p2.getByText("Görüntülemeler rolünüze kapalı")).toBeVisible();
  await expect(p2.getByRole("button", { name: "Yeni görüntüleme ekle" })).toHaveCount(0);
  await ctx.close();
});

test("Belge hazırla: her tür onaylı şablonla gelir; diş çekimi onamı hasta adıyla dolar", async ({ page }) => {
  await login(page, "sekreter@demo-yesil.test");
  const p = await firstPatient(page);
  await page.goto(`/hastalar/${p.id}?sekme=belgeler`);
  await page.getByRole("button", { name: "Belge hazırla" }).click();
  const d = page.getByRole("dialog", { name: "Belge hazırla" });
  const sel = d.getByLabel("Belge türü / şablon");
  await expect(sel.locator("option", { hasText: "onaylı şablon yok" })).toHaveCount(0);
  const opt = await sel.locator("option", { hasText: "Diş çekimi bilgilendirme ve onam —" }).getAttribute("value");
  await sel.selectOption(opt!);
  await d.getByRole("button", { name: "Önizle" }).click();
  await expect(d.getByText(/DİŞ ÇEKİMİ BİLGİLENDİRME VE ONAM FORMU/)).toBeVisible();
  await expect(d.getByText(new RegExp(`Hasta: ${p.fullName}`))).toBeVisible();
  await noHorizontalOverflow(page);
});
