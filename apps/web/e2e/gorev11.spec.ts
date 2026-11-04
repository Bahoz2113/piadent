import { expect, test, type Page } from "@playwright/test";

/** Görev 11 — DateField (gg.aa.yyyy + takvim, ADR-066), kimlik no gerekçeli gösterim (ADR-063), destek erişiminde dört göz (ADR-064). */
const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.skip(!PASSWORD, "E2E_PASSWORD (sentetik demo parolası) tanımlı değil");

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris") || u.search.length > 0, { timeout: 15_000 }).catch(() => undefined);
}

test("DateField: gg.aa.yyyy yazımı, geçersiz gün uyarısı, takvimle seçim ve klavye; yerel type=date yok", async ({ page }, info) => {
  await login(page, "sekreter@demo-yesil.test");
  await page.goto("/hastalar");
  await page.getByRole("button", { name: "Yeni hasta" }).click();
  const drawer = page.getByRole("dialog", { name: "Yeni hasta" });
  const dob = drawer.getByLabel("Doğum tarihi", { exact: true });
  await expect(dob).toHaveAttribute("placeholder", "gg.aa.yyyy");
  expect(await page.locator('input[type="date"]').count()).toBe(0);
  // rakamlar yazılırken noktalar eklenir
  await dob.pressSequentially("17051990");
  await expect(dob).toHaveValue("17.05.1990");
  // takvimde olmayan gün → yerel uyarı, dışa yayılmaz
  await dob.fill("31.02.2001"); await dob.blur();
  await expect(drawer.getByText("Geçerli bir tarih girin (gg.aa.yyyy).")).toBeVisible();
  // ISO yapıştırma kabul edilir ve gg.aa.yyyy'ye çevrilir
  await dob.fill("1990-05-17"); await dob.blur();
  await expect(dob).toHaveValue("17.05.1990");
  // takvim: aç, ay başlığı görünür, ok tuşlarıyla gün değiştir, Enter ile seç
  const calBtn = drawer.locator(".date-field", { hasText: "Doğum tarihi" }).getByRole("button", { name: "Takvimi aç" });
  await calBtn.click();
  const cal = drawer.getByRole("dialog", { name: "Doğum tarihi takvimi" });
  await expect(cal.getByText("Mayıs 1990")).toBeVisible();
  await expect(cal.getByRole("gridcell", { name: "17.05.1990" })).toBeFocused();
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(cal).toBeHidden();
  await expect(dob).toHaveValue("25.05.1990");
  if (process.env.E2E_SHOTS_DIR) {
    await calBtn.click();
    await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/g11-takvim-${info.project.name}.png` });
    await page.keyboard.press("Escape");
  }
  // gelecekteki tarih: max sınırı takvimde kapalı; metinle girilirse form doğrulaması uyarır
  await dob.fill("01.01.2099"); await dob.blur();
  await drawer.getByRole("textbox", { name: "Ad", exact: true }).fill("Takvim");
  await drawer.getByRole("textbox", { name: "Soyad", exact: true }).fill("Deneme");
  await drawer.getByRole("button", { name: "Hastayı kaydet" }).click();
  await expect(drawer.getByText("Doğum tarihi gelecekte olamaz.")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("ajanda tarih alanı gg.aa.yyyy; takvimden gün seçimi ajandayı taşır", async ({ page }) => {
  await login(page, "sekreter@demo-yesil.test");
  await page.goto("/ajanda");
  const d = page.getByLabel("Tarih seç", { exact: true });
  await expect(d).toHaveValue(/^\d{2}\.\d{2}\.\d{4}$/);
  await d.fill("15.01.2027"); await d.blur();
  await expect(page).toHaveURL(/tarih=2027-01-15/);
  await expect(d).toHaveValue("15.01.2027");
  expect(await page.locator('input[type="date"]').count()).toBe(0);
});

function syntheticTckn(seed: number): string {
  for (let n = seed; ; n++) {
    const d = String(100000000 + (n % 800000000)).split("").map(Number);
    if (d[0] === 0) continue;
    const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!, even = d[1]! + d[3]! + d[5]! + d[7]!;
    const d10 = (((odd * 7 - even) % 10) + 10) % 10, d11 = (d.reduce((a, b) => a + b, 0) + d10) % 10;
    return `${d.join("")}${d10}${d11}`;
  }
}

test("Hasta 360: kimlik no herkese maskeli; 'Göster' gerekçe ister, tam değeri gösterir", async ({ page }, info) => {
  test.skip(info.project.name !== "masaustu", "tek profil yeter");
  await login(page, "sekreter@demo-yesil.test");
  await page.goto("/hastalar");
  await page.getByRole("button", { name: "Yeni hasta" }).click();
  const drawer = page.getByRole("dialog", { name: "Yeni hasta" });
  const last = `Kimlik${Date.now().toString(36)}`;
  const id = syntheticTckn(Date.now() % 700000000);
  await drawer.getByRole("textbox", { name: "Ad", exact: true }).fill(`Sentetik${last.slice(-4)}`);
  await drawer.getByRole("textbox", { name: "Soyad", exact: true }).fill(last);
  await drawer.getByLabel("Doğum tarihi", { exact: true }).fill("12.03.1985");
  await drawer.getByLabel("Kimlik belgesi türü").selectOption("tckn");
  await drawer.getByLabel("Kimlik / pasaport no").fill(id);
  await drawer.getByRole("button", { name: "Hastayı kaydet" }).click();
  await expect(page.getByRole("heading", { name: `Sentetik${last.slice(-4)} ${last}`, level: 1 })).toBeVisible();
  const dd = page.locator("dd", { hasText: "T.C. Kimlik No" }).first();
  await expect(dd).toContainText("•");
  await expect(dd).not.toContainText(id);
  await dd.getByRole("button", { name: "Göster" }).click();
  const idDlg = page.getByRole("alertdialog", { name: "Kimlik numarasını göster" });
  await idDlg.getByRole("textbox").fill("Resmî evrak için kimlik doğrulaması (E2E)");
  await idDlg.getByRole("button", { name: "Göster" }).click();
  await expect(dd).toContainText(id);
  await expect(dd.getByRole("button", { name: "Göster" })).toBeHidden();
});

test("destek erişimi dört göz: Mavi'de talep 'Onay bekliyor', açan onaylayamaz, ikinci yönetici onaylar", async ({ browser }, info) => {
  test.skip(info.project.name !== "masaustu", "durumlu akış");
  const tag = Date.now().toString(36);
  const a = await browser.newContext(); const p1 = await a.newPage();
  await login(p1, "yonetici@demo-mavi.test");
  await p1.goto("/yonetim?sekme=guvenlik");
  await expect(p1.getByText(/Dört göz kuralı/)).toBeVisible();
  await p1.getByLabel("Destek hesabı e-postası").fill("asistan@demo-yesil.test");
  await p1.getByLabel("Gerekçe (destek talebi / sorun)").fill(`E2E dört göz ${tag} (sentetik)`);
  await p1.getByRole("button", { name: "Destek erişimi ver" }).click();
  await expect(p1.getByText(/Destek talebi açıldı; başka bir yönetici onaylayınca/)).toBeVisible();
  const row = p1.locator("tr", { hasText: `E2E dört göz ${tag}` });
  await expect(row.getByText("Onay bekliyor")).toBeVisible();
  await expect(row.getByText("Başka bir yönetici onaylamalı")).toBeVisible();
  await expect(row.getByRole("button", { name: "Onayla" })).toHaveCount(0);
  await a.close();

  const b = await browser.newContext(); const p2 = await b.newPage();
  await login(p2, "coklu@demo.test");
  await p2.goto("/yonetim?sekme=guvenlik");
  const sel = p2.getByRole("combobox", { name: "Klinik", exact: true });
  const cur = await sel.locator("option:checked").innerText();
  if (!cur.startsWith("Mavikent")) {
    await sel.selectOption({ label: "Mavikent Diş Kliniği (Demo) — Klinik yöneticisi" });
    await p2.waitForURL(/\/bugun/, { timeout: 15_000 });
    await p2.goto("/yonetim?sekme=guvenlik");
  }
  const row2 = p2.locator("tr", { hasText: `E2E dört göz ${tag}` });
  await row2.getByRole("button", { name: "Onayla" }).click();
  await expect(p2.getByText("Destek erişimi onaylandı ve etkinleşti.")).toBeVisible();
  await expect(row2.getByText("Etkin")).toBeVisible();
  if (process.env.E2E_SHOTS_DIR) await p2.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/g11-dort-goz.png`, fullPage: true });
  // temizlik: erişimi kaldır
  await row2.getByRole("button", { name: "Kaldır" }).click();
  const end2 = p2.getByRole("alertdialog", { name: "Destek erişimini sonlandır" });
  await end2.getByRole("textbox").fill("E2E temizlik");
  await end2.getByRole("button", { name: "Sonlandır" }).click();
  await expect(row2.getByText("Kaldırıldı")).toBeVisible();
  await b.close();
});
