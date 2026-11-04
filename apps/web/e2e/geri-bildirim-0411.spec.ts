import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Ürün sahibi geri bildirimi 04.11.2026 — kullanıcı akışları (ADR-093…097):
 *  Panel (sayaçlar + grafik + tablo görünümü), menü adları, hasta satırının tamamı tıklanabilir ve telefon tam görünür,
 *  telefon hane sınırı, geçmiş saat ajandada tıklanamaz, Hekimler modülü (ücret modeli), Yönetim → Ürün ve fiyat listesi,
 *  randevuda kullanılan malzeme ve gider.
 * CEZERİ qa-20261104-1549-65201a2 QA-201/202: kaydedilmemiş formda Esc / X / yalnız-Not kapatma uyarısı.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

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
const nav = (page: Page) => page.getByRole("navigation").first();

test("Panel: menü adları, sayaçlar, grafikler ve tablo görünümü; sekreterde para kartları yok", async ({ page }, info) => {
  await login(page, "yonetici@demo-yesil.test");
  if (info.project.name === "telefon-360") await page.getByRole("button", { name: /Menüyü aç|Menü/ }).first().click().catch(() => {});
  await expect(nav(page).getByRole("link", { name: "Panel" })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Randevular" })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Hekimler" })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Bugün" })).toHaveCount(0);
  await expect(nav(page).getByRole("link", { name: "Ajanda" })).toHaveCount(0);
  await page.goto("/bugun");
  const kpis = page.getByRole("region", { name: "Günün özeti" });
  await expect(kpis.getByText("Bugünkü randevular")).toBeVisible();
  await expect(kpis.getByText("Bekleyen tahsilat")).toBeVisible();
  const chart = page.locator("section", { has: page.getByRole("heading", { name: "Randevu yoğunluğu" }) });
  await expect(chart.getByRole("img")).toBeVisible();
  await chart.getByRole("button", { name: "Tablo" }).click();
  await expect(chart.getByRole("table")).toBeVisible();
  await expect(chart.getByRole("columnheader", { name: "Dönem" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "PİA Akış" })).toBeVisible();
  await noHorizontalOverflow(page);

  const sec = await page.context().browser()!.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const p2 = await sec.newPage();
  await login(p2, "sekreter@demo-yesil.test");
  await expect(p2.getByRole("region", { name: "Günün özeti" }).getByText("Bugünkü randevular")).toBeVisible();
  await expect(p2.getByRole("region", { name: "Günün özeti" }).getByText("Bekleyen tahsilat")).toHaveCount(0);
  await expect(p2.getByRole("heading", { name: "Aylık gelir" })).toHaveCount(0);
  await sec.close();
});

test("Hastalar: satırın tamamı karta götürür, telefon tam görünür; yeni hastada telefon 0 ile 11 haneyi aşmaz", async ({ page }) => {
  await login(page, "sekreter@demo-yesil.test");
  await page.goto("/hastalar");
  const row = page.locator("tbody tr.row-click").first();
  await expect(row).toBeVisible();
  const text = await row.innerText();
  expect(text, "telefon maskesiz").not.toMatch(/\*{2,}|•{2,}/);
  // Ad bağlantısı dışındaki görünür son hücreye tıklanır (satırın tamamı tıklanabilir)
  await row.locator("td:visible").last().click({ position: { x: 4, y: 4 } });
  await expect(page).toHaveURL(/\/hastalar\/[0-9a-f-]{36}/);
  await page.goto("/hastalar");
  await page.getByRole("button", { name: /Yeni hasta/ }).first().click();
  const phone = page.getByRole("dialog").getByLabel(/Telefon/).first();
  await phone.fill("053212345678901");
  expect((await phone.inputValue()).replace(/\D/g, "").length).toBe(11);
  await phone.fill("5321234567890");
  expect((await phone.inputValue()).replace(/\D/g, "").length).toBe(10);
});

test("Hekimler: finans ücret modelini görür; yönetici hekim listesini ve çalışma saatlerini görür", async ({ page }) => {
  await login(page, "finans@demo-yesil.test");
  await page.goto("/hekimler");
  await expect(page.getByRole("heading", { name: "Hekimler", level: 1 })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Ücret modeli" })).toBeVisible();
  await page.locator("tbody tr").first().locator("button.link-button").click();
  await expect(page.getByRole("heading", { name: "Ücret ve hakediş" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ücret modelini değiştir" })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("Yönetim → Ürün ve fiyat listesi; randevu ayrıntısında malzeme gideri", async ({ page }) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/yonetim?sekme=urunler");
  await expect(page.getByRole("heading", { name: "Ürün ve fiyat listesi" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Birim maliyet" })).toBeVisible();
  await expect(page.getByText("Muayene eldiveni (sentetik)")).toBeVisible();
  await noHorizontalOverflow(page);
});

test("Raporlar: rapor açıkken menüden Raporlar listeye döner; varsayılan aralık son 30 gün", async ({ page }, info) => {
  test.skip(info.project.name !== "masaustu", "menü bağlantısı masaüstünde görünür");
  await login(page, "yonetici@demo-yesil.test");
  await page.getByRole("link", { name: "Raporlar" }).first().click();
  await page.getByRole("button", { name: /Gelir – gider/ }).click();
  await expect(page.getByRole("heading", { name: "Gelir – gider (nakit akışı)" })).toBeVisible();
  await expect(page).toHaveURL(/rapor=gelir-gider/);
  const from = await page.getByLabel("Başlangıç").inputValue();
  const to = await page.getByLabel("Bitiş").inputValue();
  const days = (Date.parse(to.split(".").reverse().join("-")) - Date.parse(from.split(".").reverse().join("-"))) / 86400000;
  expect(days).toBe(29);
  await page.getByRole("link", { name: "Raporlar" }).first().click();
  await expect(page.getByRole("button", { name: /Gelir – gider/ })).toBeVisible();
  await expect(page).toHaveURL(/\/raporlar$/);
});

test("Kaydedilmemiş form: Esc de X gibi uyarır, yalnız Not/Süre değişimi kirli sayılır; temiz ve ön doldurulmuş form uyarısız kapanır (QA-201, QA-202)", async ({ page }) => {
  await login(page, "sekreter@demo-yesil.test");
  const leave = page.getByRole("alertdialog", { name: "Kaydedilmemiş değişiklikler" });
  const closeX = (d: Locator) => d.getByRole("button", { name: "Kapat", exact: true }).click();
  await page.goto("/ajanda");
  const open = async () => {
    await page.getByRole("button", { name: "Randevu ver" }).first().click();
    const d = page.getByRole("dialog", { name: "Randevu ver" });
    await expect(d).toBeVisible();
    return d;
  };

  // Temiz form: Esc ve X uyarısız kapatır
  let ap = await open();
  await page.keyboard.press("Escape");
  await expect(ap).toBeHidden();
  await expect(leave).toHaveCount(0);
  ap = await open();
  await closeX(ap);
  await expect(ap).toBeHidden();
  await expect(leave).toHaveCount(0);

  // QA-201: Açıklama yazıldıktan sonra Esc → uygulama modalı; "Forma dön" metni korur
  ap = await open();
  await ap.getByLabel("Açıklama", { exact: true }).fill("E2E Esc kontrolü");
  await page.keyboard.press("Escape");
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "Forma dön" }).click();
  await expect(leave).toBeHidden();
  await expect(ap).toBeVisible();
  await expect(ap.getByLabel("Açıklama", { exact: true })).toHaveValue("E2E Esc kontrolü");
  // Modal açıkken Esc yalnız modalı kapatır (Forma dön); çekmece açık kalır
  await page.keyboard.press("Escape");
  await expect(leave).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(leave).toBeHidden();
  await expect(ap).toBeVisible();
  // Takvim açıkken Esc yalnız takvimi kapatır
  await ap.locator(".date-field", { hasText: "Tarih" }).getByRole("button", { name: "Takvimi aç" }).click();
  const cal = ap.getByRole("dialog", { name: "Tarih takvimi" });
  await expect(cal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cal).toBeHidden();
  await expect(leave).toHaveCount(0);
  await expect(ap).toBeVisible();
  // Esc → "Kapat" → çekmece kapanır
  await page.keyboard.press("Escape");
  await leave.getByRole("button", { name: "Kapat" }).click();
  await expect(ap).toBeHidden();

  // QA-202: yalnız Not doldurulunca X ve Esc uyarır
  ap = await open();
  await expect(ap.getByLabel("Açıklama", { exact: true })).toHaveValue("");
  await ap.getByLabel("Not", { exact: true }).fill("Yalnız idari not");
  await closeX(ap);
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "Forma dön" }).click();
  await expect(ap.getByLabel("Not", { exact: true })).toHaveValue("Yalnız idari not");
  await page.keyboard.press("Escape");
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "Kapat" }).click();
  await expect(ap).toBeHidden();

  // QA-202: yalnız Süre değişince de kirli; açılış değerine dönünce temiz
  ap = await open();
  const dur = ap.getByLabel("Süre", { exact: true });
  const initialDur = await dur.inputValue();
  await dur.selectOption(initialDur === "45" ? "60" : "45");
  await closeX(ap);
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "Forma dön" }).click();
  await dur.selectOption(initialDur);
  await closeX(ap);
  await expect(ap).toBeHidden();
  await expect(leave).toHaveCount(0);

  // Ön doldurulmuş hasta (hasta kartından "Randevu ver") kirli sayılmaz
  await page.goto("/hastalar");
  await page.locator("tbody tr.row-click").first().locator("td:visible").last().click({ position: { x: 4, y: 4 } });
  await expect(page).toHaveURL(/\/hastalar\/[0-9a-f-]{36}/);
  await page.getByRole("link", { name: "Randevu ver" }).first().click();
  ap = page.getByRole("dialog", { name: "Randevu ver" });
  await expect(ap.getByRole("button", { name: "Değiştir" })).toBeVisible(); // ön doldurulan hasta yüklendi
  await closeX(ap);
  await expect(ap).toBeHidden();
  await expect(leave).toHaveCount(0);

  // QA-201: Yeni hasta çekmecesinde de Esc uyarır
  await page.goto("/hastalar");
  await page.getByRole("button", { name: /Yeni hasta/ }).first().click();
  const np = page.getByRole("dialog", { name: "Yeni hasta" });
  await np.getByRole("textbox", { name: "Ad", exact: true }).fill("Esc");
  await page.keyboard.press("Escape");
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "Forma dön" }).click();
  await expect(np.getByRole("textbox", { name: "Ad", exact: true })).toHaveValue("Esc");
  await page.keyboard.press("Escape");
  await leave.getByRole("button", { name: "Kapat" }).click();
  await expect(np).toBeHidden();
});
