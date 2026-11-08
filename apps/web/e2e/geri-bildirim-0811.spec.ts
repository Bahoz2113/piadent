import { expect, test, type Page } from "@playwright/test";

/**
 * Ürün sahibi geri bildirimi 08.11.2026 (ADR-107):
 *  - Randevu verirken işlem ZORUNLU DEĞİL (sekreter tanıyı/işlemi bilemez) ve BİRDEN FAZLA işlem eklenebilir (toplam fiyat, kaldır).
 *  - Hekim randevu ayrıntısında ziyarete birden fazla tanı ekler (birkaç dişe birden).
 *  - "Koltuk" yerine "Ünite" (Ünite A/B/C).
 *  - Panel: "Panel" başlığı yok; en üstte klinik adı + bugünün tarihi; altında bugünün randevuları (saat · hasta · hekim).
 *  - PİA Akış (iş akışları ve uyarılar) ayrı "İş akışı" menü sekmesinde.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");
const SHOTS = process.env.E2E_SHOTS;

async function login(page: Page, email: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("heading", { name: "Bugünün randevuları", level: 2 })).toBeVisible();
}
async function noHorizontalOverflow(page: Page) {
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "yatay taşma").toBeLessThanOrEqual(vw + 1);
}
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
const nextWeekday = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return { tr: `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`, iso: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` };
};

test("Panel: klinik adı + tarih, bugünün randevuları; PİA Akış 'İş akışı' sekmesinde", async ({ page }, info) => {
  await login(page, "yonetici@demo-yesil.test");
  await expect(page.getByRole("heading", { name: "Panel", level: 1 })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Yeşilvadi Ağız ve Diş Sağlığı (Demo)", level: 1 })).toBeVisible();
  const day = todayIst();
  const appts = (await (await page.request.get(`/api/v1/appointments?date=${day}`)).json()) as { items: { patientName: string; practitionerName: string }[] };
  const list = page.locator("section", { has: page.getByRole("heading", { name: "Bugünün randevuları" }) });
  if (appts.items.length) {
    await expect(list.locator(".today-row")).toHaveCount(appts.items.length);
    await expect(list.locator(".today-row").first()).toContainText(/\d{2}:\d{2}/);
    await expect(list).toContainText(appts.items[0]!.patientName);
    await expect(list).toContainText(appts.items[0]!.practitionerName);
  } else {
    await expect(list.getByText("Bugün randevu yok")).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "PİA Akış" })).toHaveCount(0);
  await noHorizontalOverflow(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/panel-0811-${info.project.name}.png`, fullPage: true });
  const menu = page.getByRole("button", { name: "Menüyü aç" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation").first().getByRole("link", { name: "İş akışı" }).click();
  await expect(page.getByRole("heading", { name: "İş akışı", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "PİA Akış" })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("Randevu ver: işlemsiz kayıt ve birden fazla işlem (toplam, kaldır); ayrıntıda işlem listesi; Ünite", async ({ page }, info) => {
  await login(page, "sekreter@demo-yesil.test");
  await page.goto("/ajanda");
  await page.getByRole("button", { name: "Randevu ver" }).first().click();
  await expect(page.getByRole("heading", { name: "Randevu ver", level: 1 })).toBeVisible();
  // QA-503: seçiciler randevu formunun bölümlerine kapsanır; Randevular sayfasının hekim süzgeci sayıma girmez.
  const form = page.getByRole("region", { name: "2 · İşlem, hekim ve gün", exact: true });
  await expect(form.getByRole("combobox", { name: "Ünite" })).toBeVisible();
  await expect(page.getByText("Koltuk", { exact: true })).toHaveCount(0);
  // 1) işlemsiz randevu
  const mobile = info.project.name !== "masaustu";
  const tag = `${mobile ? "M" : "D"}${Date.now() % 100000}`;
  // Tekrarlanan koşularda aynı hekimin günü dolmasın: gün 3–30 arası, saniyeye göre; son hekim seçilir.
  const target = nextWeekday(3 + (Math.floor(Date.now() / 1000) % 28));
  await page.getByRole("textbox", { name: "Hasta", exact: true }).fill(`İşlemsiz ${tag}`);
  await page.getByRole("button", { name: /Yeni hasta oluştur/ }).click();
  await page.getByRole("dialog", { name: "Yeni hasta" }).getByRole("button", { name: "Hastayı kaydet" }).click();
  await expect(page.getByText("İşlem seçilmedi — randevu işlemsiz kaydedilebilir.")).toBeVisible();
  const hekim = form.getByRole("combobox", { name: "Hekim", exact: true });
  const gun = form.getByRole("textbox", { name: "Gün", exact: true });
  const slots = page.getByRole("region", { name: /^3 · Uygun saatler/ }).getByRole("radiogroup", { name: "Uygun saatler", exact: true });
  const pickLastHekim = async () => {
    await expect.poll(() => hekim.locator("option").count(), { timeout: 10_000 }).toBeGreaterThan(0);
    const opts = hekim.locator("option");
    await hekim.selectOption((await opts.nth((await opts.count()) - 1).getAttribute("value"))!);
  };
  await pickLastHekim();
  await gun.fill(target.tr);
  await expect.poll(() => slots.getByRole("radio").count(), { timeout: 10_000 }).toBeGreaterThan(0);
  await slots.getByRole("radio").first().click();
  await page.getByRole("button", { name: "Randevuyu kaydet" }).click();
  await expect(page.getByText("Randevu oluşturuldu.")).toBeVisible();

  // 2) iki işlem + kaldır + toplam
  await page.getByRole("button", { name: "Randevu ver" }).first().click();
  await page.getByRole("textbox", { name: "Hasta", exact: true }).fill(`Çokİşlem ${tag}`);
  await page.getByRole("button", { name: /Yeni hasta oluştur/ }).click();
  await page.getByRole("dialog", { name: "Yeni hasta" }).getByRole("button", { name: "Hastayı kaydet" }).click();
  const add = form.getByRole("combobox", { name: "İşlemler (isteğe bağlı)" });
  for (const name of ["Diş taşı temizliği", "Kompozit dolgu (tek yüz)", "Kontrol muayenesi"]) {
    await add.selectOption((await add.locator("option", { hasText: name }).first().getAttribute("value"))!);
  }
  const chosen = form.getByRole("list", { name: "Seçilen işlemler" });
  await expect(chosen.getByRole("listitem")).toHaveCount(4); // 3 işlem + toplam
  await chosen.getByRole("button", { name: "Kontrol muayenesi işlemini kaldır" }).click();
  await expect(chosen.getByRole("listitem")).toHaveCount(3); // 2 işlem + toplam
  await expect(chosen).toContainText("Toplam");
  await expect(add.locator("option", { hasText: "Diş taşı temizliği" })).toHaveCount(0); // seçilen tekrar sunulmaz
  await pickLastHekim();
  await gun.fill(target.tr);
  await expect.poll(() => slots.getByRole("radio").count(), { timeout: 10_000 }).toBeGreaterThan(0);
  await slots.getByRole("radio").first().click();
  await noHorizontalOverflow(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/randevu-cok-islem-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Randevuyu kaydet" }).click();
  await expect(page.getByText("Randevu oluşturuldu.")).toBeVisible();
  // Kayıt: iki işlem sırasıyla, toplam fiyat (API); ayrıntı çekmecesi masaüstü günlük görünümde
  const found = ((await (await page.request.get(`/api/v1/patients?q=${encodeURIComponent(tag)}&limit=5`)).json()) as { items: { id: string; fullName: string }[] }).items.find((x) => x.fullName.toLocaleLowerCase("tr").startsWith("çok"));
  const saved = ((await (await page.request.get(`/api/v1/patients/${found!.id}/appointments`)).json()) as { items: { startsAt: string; procedures: { name: string }[]; plannedPrice: string | null }[] }).items[0];
  expect(saved?.procedures).toHaveLength(2);
  expect(saved!.procedures[0]!.name).toMatch(/^Diş taşı temizliği/);
  expect(saved!.procedures[1]!.name).toBe("Kompozit dolgu (tek yüz)");
  expect(saved?.plannedPrice).toBeTruthy();
  if (mobile) return;
  await page.goto(`/ajanda?tarih=${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(saved!.startsAt))}`);
  await page.locator("button.appt:visible, button.appt-row:visible", { hasText: new RegExp(`Çok.*${tag}`) }).first().click();
  const dr = page.getByRole("dialog", { name: new RegExp(`Çok.*${tag}`) });
  await expect(dr.getByText("Planlanan işlemler")).toBeVisible();
  await expect(dr).toContainText("Diş taşı temizliği");
  await expect(dr).toContainText("Kompozit dolgu (tek yüz)");
  await expect(dr).toContainText("Toplam:");
  await expect(dr.getByText("Ünite", { exact: true })).toBeVisible();
});

test("Hekim ziyarete birden fazla tanı ekler (iki diş + genel)", async ({ page }, info) => {
  await login(page, "elif.aras@demo-yesil.test");
  const day = todayIst();
  const appts = (await (await page.request.get(`/api/v1/appointments?date=${day}`)).json()) as { items: { patientId: string; patientName: string; status: string }[] };
  const visit = appts.items.find((a) => a.status === "checked_in") ?? appts.items.find((a) => a.status === "completed");
  expect(visit, "seed: bugün gelmiş hasta randevusu").toBeTruthy();
  await page.goto(`/ajanda?tarih=${day}`);
  await page.locator("button.appt:visible, button.appt-row:visible", { hasText: visit!.patientName }).first().click();
  const dr = page.getByRole("dialog", { name: visit!.patientName });
  const box = dr.getByRole("region", { name: "Tanılar" });
  await expect(box).toBeVisible();
  const desc = `Sentetik tanı ${info.project.name} ${Date.now() % 10000}`;
  await box.locator('[data-tooth="17"]').click();
  await box.locator('[data-tooth="27"]').click();
  await expect(box.getByText("Seçili dişler: 17, 27")).toBeVisible();
  await box.getByLabel("Tanı açıklaması").fill(desc);
  await box.getByRole("button", { name: "Tanıyı 2 dişe kaydet" }).click();
  await expect(box.getByText(/Tanı kaydedildi: diş 17, 27/)).toBeVisible();
  await box.getByLabel("Tanı açıklaması").fill(`${desc} genel`);
  await box.getByRole("button", { name: "Tanıyı kaydet" }).click();
  await expect(box.getByText(/Tanı kaydedildi \(tüm ağız \/ genel\)/)).toBeVisible();
  const visitList = box.getByRole("list", { name: "Bu ziyaretin tanıları" });
  await expect(visitList.getByRole("listitem").filter({ hasText: desc })).toHaveCount(3);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ziyaret-tanilar-${info.project.name}.png`, fullPage: true });
});
