import { expect, test, type Page } from "@playwright/test";

/**
 * ADR-110 (ürün sahibi 12.11.2026): Hekimler → Çalışma listesi (aylık çalışma tablosu).
 *  - Yönetici ay seçer, bir güne dokunup saat + ünite girer; toplu planla ile seçilen günleri "çalışmıyor" yapar;
 *    tablo hücresi ve uygun saatler (API) planı izler; telefonda sayfa yatay taşmaz (tablo kendi içinde kayar).
 *  - Sekreter listeyi görür, düzenleyemez.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
const SHOTS = process.env.E2E_SHOTS_DIR ?? process.env.E2E_SHOTS;

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
/** Bugünden `ahead` ay sonraki ayın n. pazartesisi ve cumartesileri (İstanbul). */
function target(ahead: number, nthMonday: number) {
  const now = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date()) + "T00:00:00Z");
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + ahead;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const days: Date[] = [];
  for (let d = new Date(Date.UTC(y, m, 1)); d.getUTCMonth() === ((m % 12) + 12) % 12; d = new Date(d.getTime() + 86_400_000)) days.push(d);
  const mondays = days.filter((d) => d.getUTCDay() === 1);
  const monday = iso(mondays[nthMonday]!);
  const tr = (s: string) => s.split("-").reverse().join(".");
  return { monday, mondayTr: tr(monday), month: monday.slice(0, 7), saturdays: days.filter((d) => d.getUTCDay() === 6).map(iso) };
}

test("yönetici aylık çalışma listesi oluşturur: tek gün saat + ünite, toplu çalışmıyor; plan uygun saatleri belirler", async ({ page }, info) => {
  await login(page, "yonetici@demo-yesil.test");
  await page.goto("/hekimler");
  await page.getByRole("tablist", { name: "Hekimler bölümleri" }).getByRole("tab", { name: "Çalışma listesi" }).click();
  await expect(page).toHaveURL(/sekme=calisma/);
  const t = target(info.project.name === "telefon-360" ? 3 : 2, 1);
  for (let i = 0; i < (info.project.name === "telefon-360" ? 3 : 2); i++) await page.getByRole("button", { name: "Sonraki ay" }).click();
  const grid = page.getByRole("region", { name: /çalışma tablosu$/ });
  await expect(grid.getByRole("table")).toBeVisible();
  const cell = grid.getByRole("button", { name: new RegExp(`^Dt\\. Kerem Tunç, ${t.mondayTr.replace(/\./g, "\\.")} Pazartesi`) });
  await cell.click();
  const d = page.getByRole("dialog", { name: "Çalışma planı" });
  await d.getByRole("radio", { name: "Çalışıyor" }).check();
  await d.getByLabel("Başlangıç").fill("10:00");
  await d.getByLabel("Bitiş").fill("14:00");
  const unite = d.getByRole("combobox", { name: /Ünite/ });
  await unite.selectOption({ index: 1 });
  await d.getByRole("button", { name: "Kaydet" }).click();
  const ack = d.getByRole("button", { name: "Randevuları bilerek kaydet" });
  if (await ack.isVisible().catch(() => false)) await ack.click();
  await expect(d).toBeHidden();
  await expect(page.getByText(/Çalışma listesi kaydedildi|Değişiklik yok/)).toBeVisible();
  await expect(cell).toContainText("10–14");
  await expect(cell).toHaveAccessibleName(/Çalışıyor 10:00–14:00, Ünite/);

  await page.getByRole("button", { name: "Toplu planla" }).click();
  const b = page.getByRole("dialog", { name: "Toplu planla" });
  await b.getByRole("combobox", { name: /^Hekim/ }).selectOption({ label: "Dt. Kerem Tunç" });
  for (const w of ["Pzt", "Sal", "Çar", "Per", "Cum"]) await b.getByRole("checkbox", { name: w }).uncheck();
  await b.getByRole("checkbox", { name: "Cmt" }).check();
  await b.getByRole("radio", { name: "Çalışmıyor" }).check();
  await expect(b.getByRole("button", { name: /günü kaydet$/ })).toBeEnabled();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/calisma-toplu-${info.project.name}.png`, fullPage: true });
  await b.getByRole("button", { name: /günü kaydet$/ }).click();
  const ack2 = b.getByRole("button", { name: "Randevuları bilerek kaydet" });
  if (await ack2.isVisible().catch(() => false)) await ack2.click();
  await expect(b).toBeHidden();
  const sat = t.saturdays.at(-1)!.split("-").reverse().join(".").replace(/\./g, "\\.");
  await expect(grid.getByRole("button", { name: new RegExp(`^Dt\\. Kerem Tunç, ${sat} Cumartesi: .*Çalışmıyor`) })).toBeVisible();
  await noOverflow(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/calisma-listesi-${info.project.name}.png`, fullPage: true });

  // Plan uygun saatleri belirler
  const roster = await (await page.request.get(`/api/v1/work-roster?month=${t.month}`)).json() as { practitioners: { id: string; name: string }[] };
  const kerem = roster.practitioners.find((p) => p.name === "Dt. Kerem Tunç")!;
  const av = await (await page.request.get(`/api/v1/availability?practitionerId=${kerem.id}&date=${t.monday}&minutes=30`)).json();
  expect(av).toMatchObject({ planSource: "roster", blocks: [{ start: 600, end: 840 }] });
  const avSat = await (await page.request.get(`/api/v1/availability?practitionerId=${kerem.id}&date=${t.saturdays.at(-1)}&minutes=30`)).json();
  expect(avSat).toMatchObject({ rosterOff: true, slots: [] });
});

test("sekreter çalışma listesini görür, düzenleyemez", async ({ page }) => {
  await login(page, "sekreter@demo-yesil.test");
  await page.goto("/hekimler?sekme=calisma");
  const grid = page.getByRole("region", { name: /çalışma tablosu$/ });
  await expect(grid.getByRole("table")).toBeVisible();
  await expect(grid.getByRole("row", { name: /Dt\. Elif Aras/ })).toBeVisible();
  await expect(grid.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Toplu planla" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Yazdır" })).toBeVisible();
  await noOverflow(page);
});
