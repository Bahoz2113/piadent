import { expect, test, type Browser, type Page } from "@playwright/test";

/** Görev 5 — PİA Köprü (MOCK sağlayıcı). Worker çalışır durumda olmalıdır: `pnpm dev:worker`. */
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
async function bridge(page: Page) {
  await page.goto("/yonetim?sekme=kopru");
  await expect(page.getByRole("heading", { name: "Bağlantılar" })).toBeVisible();
}
/** Worker kuyruğu işleyene kadar sayfayı yeniler. */
async function until(page: Page, check: () => Promise<boolean>, reload: () => Promise<void>) {
  for (let i = 0; i < 20; i++) { if (await check()) return; await page.waitForTimeout(1000); await reload(); }
  throw new Error("Worker işi zamanında işlemedi");
}

test("PİA Köprü: erişim bekleyen bağlantılar dürüstçe gösterilir; dış gönderim kapısı kapalı", async ({ page }, info) => {
  await login(page, "yonetici@demo-yesil.test");
  await bridge(page);
  await expect(page.getByText("KAPALI", { exact: true })).toBeVisible();
  await expect(page.locator("tr", { hasText: "WhatsApp" }).getByText("Erişim bekliyor")).toBeVisible();
  await expect(page.locator("tr", { hasText: "e-Fatura" }).getByText("Erişim bekliyor")).toBeVisible();
  await expect(page.locator("tr", { hasText: "WhatsApp" }).getByRole("button", { name: "Etkinleştir" })).toHaveCount(0);
  await expect(page.locator("tr", { hasText: "SMS" }).first().getByText("MOCK")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Erişim bekleyen entegrasyonlar" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/kopru-${info.project.name}.png`, fullPage: true });
  await noOverflow(page);
});

test("online ödeme (MOCK): bağlantı ≠ tahsilat; imzalı bildirim → avans; sağlayıcı iadesi dört göz onayıyla", async ({ page, browser }, info) => {
  const fin = page;
  await login(fin, "finans@demo-yesil.test");
  await fin.goto("/hastalar?q=1");
  await fin.locator("a.rowlink").first().click();
  await fin.getByRole("tab", { name: "Finans" }).click();
  await expect(fin.getByRole("heading", { name: "Online ödeme istekleri" })).toBeVisible();
  const patientUrl = fin.url();
  const amount = `${200 + (Date.now() % 700)},00`;
  const shown = `${amount.replace(",00", "")},00`;
  await fin.getByRole("button", { name: "Ödeme bağlantısı (MOCK)" }).click();
  const d = fin.getByRole("dialog", { name: "Online ödeme bağlantısı" });
  await d.getByLabel("Tutar (₺)").fill(amount);
  await d.getByRole("button", { name: "Bağlantı iste" }).click();
  await expect(fin.getByText("Ödeme bağlantısı isteği sıraya alındı (MOCK).")).toBeVisible();
  const req = fin.locator("section", { has: fin.getByRole("heading", { name: "Online ödeme istekleri" }) }).locator("li", { hasText: shown }).first();
  await until(fin, async () => (await req.getByText("Bağlantı hazır (ödeme bekleniyor)").count()) > 0,
    () => fin.locator("section", { has: fin.getByRole("heading", { name: "Online ödeme istekleri" }) }).getByRole("button", { name: "Yenile" }).click());
  await expect(req.getByText(/mock\.invalid/)).toBeVisible();
  const payRows = fin.locator("section", { has: fin.getByRole("heading", { name: "Ödemeler" }) }).locator("tbody tr", { hasText: "Online" });
  const paidBefore = await payRows.count();

  // Yönetici: MOCK sağlayıcı "ödendi" bildirimi (imzalı, gerçek webhook yolundan)
  const adm = await (browser as Browser).newPage({ viewport: fin.viewportSize()! });
  await login(adm, "yonetici@demo-yesil.test");
  await bridge(adm);
  await adm.getByRole("button", { name: "Tümü" }).click();
  await adm.locator("tr", { hasText: `${shown.replace(",", ".")} TRY ödeme bağlantısı` }).first().getByRole("button", { name: "Ayrıntı" }).click();
  const jd = adm.getByRole("dialog", { name: "Ödeme bağlantısı" });
  await jd.getByLabel("Simüle edilecek olay").selectOption("payment.succeeded");
  await jd.getByRole("button", { name: "MOCK bildirimi gönder" }).click();
  await expect(adm.getByText("Bildirim: İşlendi")).toBeVisible();
  await jd.getByRole("button", { name: "MOCK bildirimi gönder" }).click(); // ikinci "ödendi" bildirimi ikinci ödeme oluşturmaz
  await expect(adm.getByText(/Bildirim: Eski\/ters sıra/)).toBeVisible();
  await adm.keyboard.press("Escape");

  await fin.goto(patientUrl);
  await fin.getByRole("tab", { name: "Finans" }).click();
  await expect(payRows).toHaveCount(paidBefore + 1);
  await expect(req.getByText("Ödendi (sağlayıcı bildirdi)")).toBeVisible();

  // Finans: sağlayıcıdan iade ister → onay kapısı; kendi isteğini onaylayamaz
  await payRows.filter({ hasText: shown }).first().getByRole("button", { name: "Sağlayıcıdan iade" }).click();
  const rd = fin.getByRole("dialog", { name: "Sağlayıcı üzerinden iade" });
  await rd.getByLabel("İade tutarı (₺)").fill("50,00");
  await rd.getByLabel("Gerekçe").fill("E2E sentetik iade");
  await rd.getByRole("button", { name: "Onaya gönder" }).click();
  await expect(fin.getByText(/İade onay kapısında/)).toBeVisible();
  await bridge(fin);
  const myJob = fin.locator("tr", { hasText: "50.00 TRY iade" }).first();
  await expect(myJob.getByText("Onay bekliyor")).toBeVisible();
  await expect(myJob.getByText("Kendi isteğinizi onaylayamazsınız")).toBeVisible();
  await expect(myJob.getByRole("button", { name: "Onayla" })).toHaveCount(0);

  // Yönetici onaylar → worker gönderir → sağlayıcı "kabul" → iade bildirimi gelince deftere düşer
  await bridge(adm);
  const job = adm.locator("tr", { hasText: "50.00 TRY iade" }).first();
  await job.getByRole("button", { name: "Onayla" }).click();
  await expect(adm.getByText("Onaylandı; iş kuyruğa alındı.")).toBeVisible();
  await adm.getByRole("button", { name: "Tümü" }).click();
  await until(adm, async () => (await adm.locator("tr", { hasText: "50.00 TRY iade" }).first().getByText("Sağlayıcı kabul etti").count()) > 0,
    () => adm.getByRole("button", { name: "Yenile", exact: true }).click());
  await adm.locator("tr", { hasText: "50.00 TRY iade" }).first().getByRole("button", { name: "Ayrıntı" }).click();
  const rj = adm.getByRole("dialog", { name: "Sağlayıcı üzerinden iade" });
  await rj.getByRole("button", { name: "MOCK bildirimi gönder" }).click();
  await expect(adm.getByText("Bildirim: İşlendi")).toBeVisible();
  if (SHOTS) await adm.screenshot({ path: `${SHOTS}/kopru-is-${info.project.name}.png`, fullPage: true });
  await adm.keyboard.press("Escape");
  await expect(adm.getByText("Tekrar (yok sayıldı)").or(adm.getByText("İşlendi")).first()).toBeVisible();

  await fin.goto(patientUrl);
  await fin.getByRole("tab", { name: "Finans" }).click();
  await expect(payRows.filter({ hasText: shown }).first().getByText("−50,00", { exact: false })).toBeVisible();
  if (SHOTS) await fin.screenshot({ path: `${SHOTS}/online-odeme-${info.project.name}.png`, fullPage: true });
  await noOverflow(fin);
  await adm.close();
});
