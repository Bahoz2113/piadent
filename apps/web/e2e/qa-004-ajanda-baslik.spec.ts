import { expect, test, type Page } from "@playwright/test";

/**
 * QA-004 regresyonu — /ajanda açılışında belge başlığı (<title>) hiçbir anda boş kalmaz.
 * Kök neden: sayfa yüklenir yüklenmez `router.replace("/ajanda?tarih=…")` ile sunucuya giden bir RSC gezinmesi yapılıyor,
 * başlık bu geçişte sunucudan akan metadata'ya bağlanıyor; istek aksarsa/yavaşlarsa tam sayfa yüklemeye düşüyor ve tarama
 * başlıksız bir belgeyi yakalıyordu. Yama: URL eşitlemesi `history.replaceState` ile (sunucuya gitmez) + rota başlıkları.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"), { timeout: 15_000 });
}

test("ajanda: URL eşitlemesi sunucuya gitmez, sayfa yeniden yüklenmez, başlık hiç boş kalmaz", async ({ page }) => {
  test.setTimeout(120_000);
  // Her karede <title> yoklanır; boş kalan anlar sayılır.
  await page.addInitScript(() => {
    const w = window as unknown as { __titleGaps: string[] };
    w.__titleGaps = [];
    let missingSince = -1;
    const tick = () => {
      const has = !!document.querySelector("title")?.textContent?.trim();
      if (!has && missingSince < 0) missingSince = performance.now();
      if (has && missingSince >= 0) { w.__titleGaps.push(`${Math.round(missingSince)}→${Math.round(performance.now())}ms`); missingSince = -1; }
      requestAnimationFrame(tick);
    };
    document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(tick)); // ilk ayrıştırma bitince başla
  });
  await login(page, "sekreter@demo-yesil.test");

  const rscNavigations: string[] = [];
  let loads = 0;
  page.on("request", (r) => { if (r.headers()["rsc"] === "1" && !r.headers()["next-router-prefetch"]) rscNavigations.push(r.url()); });
  page.on("load", () => { loads++; });

  await page.goto("/ajanda");
  loads = 0; rscNavigations.length = 0; // goto'nun kendi yüklemesi sayılmaz
  await expect(page).toHaveTitle("Ajanda · VİADENT");
  await page.waitForURL(/\/ajanda\?tarih=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500); // ikinci eşitleme (hekim seçimi) ve gecikmeli etkiler için pay

  expect(rscNavigations, "URL eşitlemesi sunucuya RSC gezinmesi yapmamalı").toEqual([]);
  expect(loads, "tam sayfa yeniden yükleme olmamalı").toBe(0);
  const gaps = await page.evaluate(() => (window as unknown as { __titleGaps: string[] }).__titleGaps);
  expect(gaps, "başlığın boş kaldığı kare olmamalı").toEqual([]);
  await expect(page).toHaveTitle("Ajanda · VİADENT");
  // Hafta görünümüne geçiş de yalnız adres çubuğunu günceller.
  await page.getByRole("button", { name: "Hafta", exact: true }).click();
  await page.waitForURL(/gorunum=hafta/);
  expect(rscNavigations).toEqual([]);
  expect(loads).toBe(0);
});
