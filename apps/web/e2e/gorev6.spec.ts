import { expect, test, type Browser, type Page } from "@playwright/test";

/** Görev 6 — laboratuvar, stok, raporlar, prim ödemesi. Worker çalışır durumda olmalıdır. */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
const SHOTS = process.env.E2E_SHOTS_DIR;

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
const isoDay = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
};

test("laboratuvar: sekreter iş emri açar → gönderir → teslim alır; hekim kabul eder; aşamalar ve föy", async ({ page, browser }, info) => {
  await login(page, "sekreter@demo-yesil.test");
  await page.goto("/hastalar?q=1");
  await page.locator("a.rowlink").first().click();
  await page.getByRole("tab", { name: "Laboratuvar" }).click();
  await page.getByRole("button", { name: "Yeni iş emri" }).click();
  const d = page.getByRole("dialog", { name: "Yeni laboratuvar iş emri" });
  await d.getByRole("combobox", { name: /^Laboratuvar/ }).selectOption({ index: 1 });
  await d.getByRole("combobox", { name: /^Hekim/ }).selectOption({ index: 1 });
  const work = `E2E köprü ${Date.now() % 100000}`;
  await d.getByLabel("İş tanımı").fill(work);
  await d.getByLabel("Dişler (FDI)").fill("14, 15");
  await d.getByRole("button", { name: "Taslak oluştur" }).click();
  const o = page.getByRole("dialog").filter({ hasText: work });
  await expect(o.getByText("Taslak", { exact: true })).toBeVisible();
  await o.getByRole("button", { name: "Laboratuvara gönder" }).click();
  await o.getByLabel("Hedef teslim").fill(isoDay(4));
  await o.getByRole("button", { name: "Kaydet" }).click();
  await expect(o.getByText("Laboratuvara gönderildi").first()).toBeVisible();
  await o.getByRole("button", { name: "İş föyü" }).click();
  await expect(o.getByText(/· İş emri \d+/)).toBeVisible();
  await expect(o.getByText(/hasta kimliği, iletişim ve sağlık bilgisi paylaşılmaz/)).toBeVisible();
  await expect(o.getByRole("button", { name: "Kabul et" })).toHaveCount(0);
  await o.getByRole("button", { name: "Teslim alındı" }).click();
  await o.getByRole("button", { name: "Kaydet" }).click();
  await expect(o.getByText("Klinikte teslim alındı (kabul bekliyor)").first()).toBeVisible();
  await expect(o.getByRole("button", { name: "Kabul et" })).toHaveCount(0); // sekreter klinik kabul veremez
  await expect(o.getByRole("heading", { name: "Maliyet" })).toHaveCount(0); // maliyet sekretere kapalı

  const dent = await (browser as Browser).newPage({ viewport: page.viewportSize()! });
  await login(dent, "elif.aras@demo-yesil.test");
  await dent.goto("/laboratuvar"); // 08.11.2026 (ADR-108): iş emirleri Laboratuvar menüsünde
  await dent.getByRole("button", { name: "Kabul bekliyor", exact: true }).click();
  await dent.locator("tr", { hasText: work }).getByRole("button", { name: "Aç", exact: true }).click();
  const od = dent.getByRole("dialog").filter({ hasText: work });
  await od.getByRole("button", { name: "Revizyona gönder" }).click();
  await expect(od.getByRole("button", { name: "Kaydet" })).toBeDisabled(); // gerekçesiz revizyon olmaz
  await od.getByRole("button", { name: "Vazgeç" }).click();
  await od.getByRole("button", { name: "Kabul et" }).click();
  await od.getByRole("button", { name: "Kaydet" }).click();
  await expect(od.getByText("Kabul edildi").first()).toBeVisible();
  await expect(od.getByText("Hekim kabul etti")).toBeVisible();
  if (SHOTS) await dent.screenshot({ path: `${SHOTS}/lab-${info.project.name}.png`, fullPage: true });
  await noOverflow(dent);
  await dent.close();
});

test("stok: asistan giriş ve sayım yapar; bakiye hareketlerden, sayım farkı düzeltme hareketi", async ({ page }, info) => {
  await login(page, "asistan@demo-yesil.test");
  await page.goto("/operasyon?sekme=stok");
  const row = page.locator("tr", { hasText: "Muayene eldiveni" });
  const before = Number((await row.locator("td.money strong").innerText()).replace(",", "."));
  await row.getByRole("button", { name: "Giriş" }).click();
  const g = page.getByRole("dialog", { name: "Stok girişi" });
  await g.getByLabel(/Miktar/).fill("3");
  await g.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(/giriş kaydedildi/)).toBeVisible();
  await expect(row.locator("td.money strong")).toHaveText(String(before + 3));
  await row.getByRole("button", { name: "Sayım" }).click();
  const s = page.getByRole("dialog", { name: "Sayım" });
  await s.getByLabel("Sayılan miktar").fill(String(before + 2));
  await s.getByLabel("Açıklama").fill("E2E sayımı");
  await s.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(/Sayım farkı -1 kutu düzeltme hareketi olarak yazıldı/)).toBeVisible();
  await row.getByRole("button", { name: "Hareketler" }).click();
  const h = page.getByRole("dialog").filter({ hasText: "Hareketler · Muayene eldiveni" });
  await expect(h.getByText("Sayım düzeltmesi").first()).toBeVisible();
  await expect(h.getByText(/Sayım: sistem \d+, sayılan \d+ · E2E sayımı/).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/stok-${info.project.name}.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Yeni kalem" })).toHaveCount(0); // tanım yalnız yönetici
  await noOverflow(page);
});

test("raporlar: finans gelir–gider → satırdan nakit hareketlerine iner, CSV indirir; sekreter finans raporu görmez", async ({ page, browser }, info) => {
  await login(page, "finans@demo-yesil.test");
  await page.goto("/raporlar");
  await page.getByRole("button", { name: /Gelir – gider/ }).click();
  await expect(page.getByRole("heading", { name: "Gelir – gider (nakit akışı)" })).toBeVisible();
  await expect(page.getByLabel("Toplamlar").getByText("Net nakit akışı")).toBeVisible();
  const net = await page.getByLabel("Toplamlar").locator(".stat", { hasText: "Net nakit akışı" }).locator(".value").innerText();
  await page.locator("tr.drill").first().click();
  await expect(page.getByRole("heading", { name: "Nakit hareketleri (kaynak satırlar)" })).toBeVisible();
  await expect(page.getByLabel("Toplamlar").locator(".stat", { hasText: /^Net/ }).locator(".value")).toHaveText(net);
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).click();
  expect((await dl).suggestedFilename()).toMatch(/^viadent-nakit-hareketleri-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  await page.getByRole("button", { name: "Önceki rapor" }).click();
  await expect(page.getByRole("heading", { name: "Gelir – gider (nakit akışı)" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/rapor-${info.project.name}.png`, fullPage: true });
  await noOverflow(page);

  const sec = await (browser as Browser).newPage({ viewport: page.viewportSize()! });
  await login(sec, "sekreter@demo-yesil.test");
  await sec.goto("/raporlar");
  await expect(sec.getByRole("button", { name: /Randevu ve gelmeme/ })).toBeVisible();
  await expect(sec.getByRole("button", { name: /Gelir – gider/ })).toHaveCount(0);
  await sec.getByRole("button", { name: /Laboratuvar sorgulama/ }).click();
  await expect(sec.getByRole("columnheader", { name: "Maliyet" })).toHaveCount(0);
  await expect(sec.getByRole("button", { name: "CSV" })).toHaveCount(0);
  await noOverflow(sec);
  await sec.close();
});

test("prim: finans hekime prim öder (kasadan çıkış), ters kayıt alır", async ({ page }, info) => {
  await login(page, "finans@demo-yesil.test");
  await page.goto("/finans");
  await page.getByRole("tab", { name: "Hekim primi" }).click();
  const g = page.locator("tr", { hasText: "Elif Aras" }).first();
  await g.getByRole("button", { name: "Prim öde" }).click();
  const d = page.getByRole("dialog", { name: "Prim ödemesi" });
  await d.getByLabel("Tutar (₺)").fill("1,00");
  await d.getByRole("button", { name: "Ödemeyi kaydet" }).click();
  const pay = page.locator("section", { has: page.getByRole("heading", { name: "Prim ödemeleri" }) }).locator("li")
    .filter({ hasText: "1,00 ₺" }).filter({ has: page.getByRole("button", { name: "Ters kayıt" }) }).last();
  await expect(pay).toBeVisible();
  await pay.getByRole("button", { name: "Ters kayıt" }).click();
  const r = page.getByRole("dialog", { name: "Prim ödemesini ters kayda al" });
  await r.getByLabel("Gerekçe").fill("E2E ters kayıt");
  await r.getByRole("button", { name: "Ters kayda al" }).click();
  await expect(page.getByText("(ters kayıt)").first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/prim-${info.project.name}.png`, fullPage: true });
  await noOverflow(page);
});
