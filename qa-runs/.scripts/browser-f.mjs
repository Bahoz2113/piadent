// CEZERİ teslim testi — geri bildirim 04.11.2026 tarayıcı vakaları (F01–F12), masaüstü (1366) + mobil emülasyon (360, Pixel 5).
// f-cases.mjs HTTP koşusunun oluşturduğu sentetik kayıtları f-summary.json'dan okur. Ürün kodunu değiştirmez. Kanıt PNG → sonra JPG.
// Kullanım (apps/web içinden): BASE=… API=… PASSWORD=… SUMMARY=… OUT=… node ../../qa-runs/.scripts/browser-f.mjs
import { chromium, devices } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000"; const PASSWORD = process.env.PASSWORD; const OUT = process.env.OUT ?? "evidence";
const S = JSON.parse(readFileSync(process.env.SUMMARY, "utf8")).data;
if (!PASSWORD) { console.error("PASSWORD gerekli"); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const out = [];
const rec = (profile, id, status, summary, evidence) => { out.push({ profile, id, status, summary, evidence }); console.log(`${status.padEnd(6)} ${profile.padEnd(8)} ${id} ${summary}`); };

async function session(profile, email) {
  const ctx = await browser.newContext({ ...(profile === "mobil" ? { ...devices["Pixel 5"], viewport: { width: 360, height: 780 } } : { viewport: { width: 1366, height: 900 } }), locale: "tr-TR", timezoneId: "Europe/Istanbul" });
  const page = await ctx.newPage();
  page.nativeDialogs = 0;
  page.on("dialog", async (d) => { page.nativeDialogs++; await d.dismiss(); });
  await page.goto(`${BASE}/giris`);
  await page.getByLabel("E-posta").fill(email); await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.getByRole("heading", { name: "Panel", level: 1 }).waitFor({ timeout: 20000 });
  return { ctx, page };
}
const apiGet = async (page, path) => page.evaluate(async (p) => (await fetch(`/api/v1${p}`, { headers: { "x-viadent-request": "1" } })).json(), path);
const overflow = async (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const shot = async (page, profile, name) => { const f = `${OUT}/${profile}-${name}.png`; await page.screenshot({ path: f, fullPage: true }); return f; };
const tryCase = async (profile, id, fn) => {
  try { const r = await fn(); rec(profile, id, r.pass ? "PASS" : "FAIL", r.summary, r.evidence); }
  catch (e) { rec(profile, id, "FAIL", `hata: ${String(e.message).split("\n")[0].slice(0, 220)}`, null); }
};
// Uygulama tutarı "1.200,00 ₺" biçiminde yazar; karşılaştırma sayısal kısım üzerinden (tur 1 tester düzeltmesi: Intl "₺1.200,00" üretiyordu).
const num = (v) => Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (v) => `${num(v)} ₺`;
const same = (ui, v) => ui.replace(/[^\d.,-]/g, "") === num(v);

for (const profile of ["masaustu", "mobil"]) {
  // ------------------------------------------------ yönetici
  const { ctx, page } = await session(profile, "yonetici@demo-yesil.test");

  await tryCase(profile, "F06", async () => {
    const nav = page.locator("nav").first();
    if (profile === "mobil") await page.getByRole("button", { name: /Menü/ }).first().click().catch(() => {});
    const names = await nav.getByRole("link").allInnerTexts();
    const has = (n) => names.some((x) => x.trim() === n);
    const d = await apiGet(page, "/dashboard");
    await page.goto(`${BASE}/bugun`); await page.getByRole("region", { name: "Günün özeti" }).waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll(".kpi-value")].some((e) => e.textContent.trim() === "–"), null, { timeout: 10000 });
    const kpi = page.getByRole("region", { name: "Günün özeti" });
    const appt = (await kpi.locator(".kpi", { hasText: "Bugünkü randevular" }).locator(".kpi-value").innerText()).trim();
    const coll = (await kpi.locator(".kpi", { hasText: "Bugünkü tahsilat" }).locator(".kpi-value").innerText()).replace(/\s/g, " ").trim();
    const open = (await kpi.locator(".kpi", { hasText: "Bekleyen tahsilat" }).locator(".kpi-value").innerText()).replace(/\s/g, " ").trim();
    const chart = page.locator("section", { has: page.getByRole("heading", { name: "Randevu yoğunluğu" }) });
    await chart.getByRole("button", { name: "Tablo" }).click();
    const rows = await chart.locator("tbody tr").count();
    const ov = await overflow(page);
    const ev = await shot(page, profile, "F06-panel");
    const title = await page.title();
    const pass = has("Panel") && has("Randevular") && has("Hekimler") && !has("Bugün") && !has("Ajanda") && appt === String(d.today.appointments)
      && same(coll, d.money.todayCollections) && same(open, d.money.openReceivables) && rows === 30 && ov <= 1 && /Panel/.test(title);
    return { pass, summary: `menü [${names.map((x) => x.trim()).filter(Boolean).join(", ")}], başlık "${title}", KPI randevu ${appt}=${d.today.appointments}, tahsilat ${coll} / API ${d.money.todayCollections}, açık ${open} / API ${d.money.openReceivables}, tablo satırı ${rows}, taşma ${ov}`, evidence: ev };
  });

  await tryCase(profile, "F01", async () => {
    // Tur 2 tester düzeltmesi (saat bağımlılığı): ajanda 08:00'de başlar; koşu 08:30 öncesiyse bugünde geçmiş dilim yoktur → dünün günü.
    const hourTR = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hour12: false }).format(new Date()));
    const ymd = (dd) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(dd);
    await page.goto(`${BASE}/ajanda${hourTR < 9 ? `?tarih=${ymd(new Date(Date.now() - 86_400_000))}` : ""}`); await page.getByRole("heading", { name: "Randevular", level: 1 }).waitFor();
    await page.waitForTimeout(800);
    const pastCount = profile === "mobil" ? -1 : await page.locator(".agenda-slot.is-past").count(); // mobilde ızgara yerine liste görünümü
    const pastClickable = await page.locator("button.agenda-slot.is-past").count();
    let opened = false;
    // 07.11.2026 kabul değişikliği (ADR-101): randevu verme tam sayfa (çekmece değil); geçmiş dilim sayfayı da açmamalı.
    const title = page.getByRole("heading", { name: "Randevu ver", level: 1 });
    if (pastCount > 0) { await page.locator(".agenda-slot.is-past").first().click({ force: true }); await page.waitForTimeout(400); opened = await title.isVisible().catch(() => false); }
    await page.getByRole("button", { name: "Randevu ver" }).first().click();
    await title.waitFor();
    const dlg = page.locator("main");
    const dateBox = dlg.locator("input[placeholder='gg.aa.yyyy']").first();
    await dateBox.fill("01.01.2026"); await dateBox.blur();
    const v = await dateBox.inputValue();
    // Tur 3 tester uyarlaması: eski çekmece geçmiş tarihte "Geçmiş saat seçilemez" yazardı; tam sayfada (QA-301 kabulü, handoff.md) geçmiş gün için
    // "Geçmiş gün seçilemez". Plan F01 ("tarih alanı bugünden öncesini kabul etmez") değişmedi; ikisi de kabul uyarısıdır.
    const errVisible = await dlg.getByText(/Geçmiş (saat|gün) seçilemez/).count();
    const ev = await shot(page, profile, "F01-ajanda");
    await dlg.getByRole("button", { name: "Vazgeç" }).click(); await page.waitForTimeout(300);
    if (await page.getByRole("alertdialog").count()) await page.getByRole("alertdialog").getByRole("button", { name: "Çık" }).click();
    const pass = (profile === "mobil" || pastCount > 0) && pastClickable === 0 && !opened && (v !== "01.01.2026" || errVisible > 0);
    return { pass, summary: `geçmiş dilim ${pastCount} (düğme ${pastClickable}), tıklayınca form açıldı=${opened}; tarih alanına 01.01.2026 → değer "${v}", uyarı ${errVisible}`, evidence: ev };
  });

  await tryCase(profile, "F02", async () => {
    await page.goto(`${BASE}/hastalar/${S.F02.patientId}`);
    const past = page.locator("h3.list-heading", { hasText: "Geçmiş randevular" });
    await past.waitFor();
    const upHead = page.locator("h3.list-heading", { hasText: "Yaklaşan randevular" });
    const upList = upHead.locator("xpath=following-sibling::*[1]");
    const pastList = past.locator("xpath=following-sibling::*[1]");
    const pendingInPast = await pastList.getByText("Sonuç bekliyor").count();
    const pendingInUp = await upList.getByText("Sonuç bekliyor").count();
    const upCount = await upList.locator("li").count();
    const geldi = pastList.getByRole("button", { name: "Geldi" });
    const hasBtn = await geldi.count();
    const ev = await shot(page, profile, "F02-kart");
    let after = -1;
    if (profile === "mobil" && hasBtn) { await geldi.first().click(); await page.waitForTimeout(1200); after = await pastList.getByText("Sonuç bekliyor").count(); }
    const pass = pendingInPast === 1 && pendingInUp === 0 && upCount === 1 && hasBtn === 1 && (profile !== "mobil" || after === 0);
    return { pass, summary: `Geçmiş başlığında 'Sonuç bekliyor' ${pendingInPast}, Yaklaşan'da ${pendingInUp}, yaklaşan satır ${upCount}, Geldi düğmesi ${hasBtn}${after >= 0 ? `, Geldi sonrası rozet ${after}` : ""}`, evidence: ev };
  });

  const dent = await session(profile, "elif.aras@demo-yesil.test");
  await tryCase(profile, "F05", async () => {
    const page = dent.page; // yönetici sağlık yetkisine sahip değildir (§05); diş şeması hekimle doğrulanır
    await page.goto(`${BASE}/hastalar/${S.F05.patientId}`);
    const odo = page.getByRole("group", { name: "Odontogram" }).first();
    await odo.waitFor({ timeout: 15000 });
    const done = await odo.locator("button.tooth.has-done").allInnerTexts();
    const doneNo = done.map((t) => t.match(/\d{2}/)?.[0]);
    await odo.locator("button.tooth.has-done").first().click();
    await page.waitForTimeout(300);
    const detail = await page.locator(".tooth-detail").innerText().catch(() => "");
    const ev = await shot(page, profile, "F05-dis");
    const pass = doneNo.length === 1 && doneNo[0] === S.F05.tooth && /CEK-01|çekim/i.test(detail);
    return { pass, summary: `hekim: işlem yapılan diş(ler) ${doneNo.join(",")}, ayrıntı: ${detail.replace(/\s+/g, " ").slice(0, 120)}`, evidence: ev };
  });
  await dent.ctx.close();

  await tryCase(profile, "F07", async () => {
    await page.goto(`${BASE}/raporlar`); await page.locator(".report-card").first().waitFor();
    const n = await page.locator(".report-card").count();
    let bad = 0;
    for (let i = 0; i < n; i++) {
      await page.locator(".report-card").nth(i).click();
      await page.waitForFunction(() => document.querySelector("main table") || document.body.innerText.includes("Bu süzgeçle kayıt yok") || document.querySelector(".alert-error"), null, { timeout: 15000 }).catch(() => {});
      if (await page.locator(".alert-error").count()) bad++;
      await page.getByRole("button", { name: /Rapor listesi/ }).click();
      await page.locator(".report-card").first().waitFor();
    }
    await page.locator(".report-card").first().click();
    await page.waitForTimeout(800);
    const from = await page.getByLabel("Başlangıç").inputValue(), to = await page.getByLabel("Bitiş").inputValue();
    const days = (Date.parse(to.split(".").reverse().join("-")) - Date.parse(from.split(".").reverse().join("-"))) / 86400000;
    let back = "NA";
    if (profile === "masaustu") { await page.getByRole("link", { name: "Raporlar" }).first().click(); await page.waitForTimeout(800); back = String(await page.locator(".report-card").count()); }
    else { await page.getByRole("button", { name: /Menü/ }).first().click().catch(() => {}); const l = page.getByRole("link", { name: "Raporlar" }).first(); if (await l.isVisible().catch(() => false)) { await l.click(); await page.waitForTimeout(800); back = String(await page.locator(".report-card").count()); } }
    const ev = await shot(page, profile, "F07-raporlar");
    const pass = bad === 0 && days === 29 && (back === "NA" ? profile === "mobil" : Number(back) === n);
    return { pass, summary: `${n} rapor açıldı, hata ${bad}; varsayılan aralık ${days + 1} gün; menüden dönüş kart sayısı ${back}`, evidence: ev };
  });

  await tryCase(profile, "F09", async () => {
    await page.goto(`${BASE}/yonetim?sekme=urunler`);
    await page.getByRole("heading", { name: "Ürün ve fiyat listesi" }).waitFor();
    const cat = await apiGet(page, "/stock/catalog");
    const it = cat.items.find((x) => x.id === S.F10.itemId);
    const row = page.locator("tbody tr", { hasText: it.name }).first();
    const cost = (await row.locator("td").nth(2).innerText()).split("\n")[0].replace(/\u00a0/g, " ").trim();
    const unpriced = await page.getByText("Fiyat tanımsız").count();
    const warn = await page.getByText(/etkin üründe fiyat tanımlı değil/).count();
    await row.getByRole("button", { name: "Fiyat ekle" }).click();
    const dlg = page.getByRole("dialog", { name: "Tedarikçi fiyatı ekle" });
    await dlg.waitFor();
    await dlg.getByRole("button", { name: "Kapat" }).first().click();
    const ov = await overflow(page);
    const ev = await shot(page, profile, "F09-urunler");
    const pass = same(cost, it.unitCost) && unpriced > 0 && warn === 1 && ov <= 1;
    return { pass, summary: `ekranda birim maliyet ${cost} = API ${it.unitCost}; 'Fiyat tanımsız' ${unpriced}; uyarı ${warn}; Fiyat ekle penceresi açıldı; taşma ${ov}`, evidence: ev };
  });

  await tryCase(profile, "F10", async () => {
    const m = await apiGet(page, `/appointments/${S.F10.appointmentId}/materials`);
    const a0 = (await apiGet(page, `/patients/${S.F10.patientId}/appointments`)).items.find((x) => x.id === S.F10.appointmentId);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(a0.startsAt));
    const a = (await apiGet(page, `/appointments?date=${date}`)).items.find((x) => x.id === S.F10.appointmentId);
    await page.goto(`${BASE}/ajanda?tarih=${date}`); await page.waitForTimeout(1200);
    await page.getByText(a.patientName).locator("visible=true").first().click(); // mobilde ızgara gizli, liste görünür
    const card = page.getByRole("region", { name: "Kullanılan malzeme" });
    await card.waitFor({ timeout: 10000 });
    const total = (await card.locator(".money-strip div", { hasText: "Malzeme gideri" }).locator("strong").innerText()).replace(/\u00a0/g, " ").trim();
    const lines = await card.locator("ul.list li").count();
    let added = "atlandı";
    if (profile === "masaustu") {
      await card.getByRole("button", { name: "Malzeme ekle" }).click();
      await card.getByRole("combobox", { name: "Ürün 1" }).selectOption({ index: 1 });
      await card.getByLabel("Miktar").fill("1");
      await card.getByRole("button", { name: "Malzemeyi kaydet" }).click();
      await page.waitForTimeout(1200);
      added = String(await card.locator("ul.list li").count());
    }
    const ev = await shot(page, profile, "F10-malzeme");
    const pass = same(total, m.totals.materialCost) && lines === m.items.length && (profile !== "masaustu" || Number(added) === lines + 1);
    return { pass, summary: `ekranda gider ${total} = API ${m.totals.materialCost}; satır ${lines}=${m.items.length}; UI ile ekleme sonrası satır ${added}`, evidence: ev };
  });

  await tryCase(profile, "F11", async () => {
    // 07.11.2026 kabul değişikliği (ADR-101): "Randevu ver" tam sayfa → kapatma "Vazgeç"; çekmece Esc/X/arka plan kuralı "Yeni hasta" çekmecesinde sınanır.
    await page.goto(`${BASE}/ajanda`); await page.getByRole("heading", { name: "Randevular", level: 1 }).waitFor();
    const title = page.getByRole("heading", { name: "Randevu ver", level: 1 }), list = page.getByRole("heading", { name: "Randevular", level: 1 });
    const modal = page.getByRole("alertdialog", { name: "Kaydedilmemiş değişiklikler" });
    const open = async () => { await page.getByRole("button", { name: "Randevu ver" }).first().click(); await title.waitFor(); return page.locator("main"); };
    const steps = [];
    let d = await open(); await d.getByRole("button", { name: "Vazgeç" }).click(); await page.waitForTimeout(300);
    steps.push(["temiz sayfa: uyarısız döner", (await modal.count()) === 0 && (await list.isVisible())]);
    d = await open(); await d.getByLabel("Açıklama", { exact: true }).fill("QA kirli sayfa");
    await d.getByRole("button", { name: "Vazgeç" }).click(); await page.waitForTimeout(300);
    const shown = await modal.isVisible().catch(() => false); steps.push(["kirli sayfa: modal", shown]);
    if (shown) { await modal.getByRole("button", { name: "Forma dön" }).click(); await page.waitForTimeout(200);
      steps.push(["Forma dön veriyi korudu", (await d.getByLabel("Açıklama", { exact: true }).inputValue()) === "QA kirli sayfa"]);
      await d.getByRole("button", { name: "Vazgeç" }).click(); await modal.getByRole("button", { name: "Çık" }).click(); await page.waitForTimeout(300);
      steps.push(["Çık sayfayı kapattı", await list.isVisible()]); }
    d = await open(); await d.getByLabel("Not", { exact: true }).fill("QA yalnız not");
    await d.getByRole("button", { name: "Vazgeç" }).click(); await page.waitForTimeout(300);
    const noteModal = await modal.isVisible().catch(() => false); steps.push(["yalnız Not dolu: modal", noteModal]);
    if (noteModal) await modal.getByRole("button", { name: "Çık" }).click();
    // çekmece kuralı: Yeni hasta çekmecesi
    await page.goto(`${BASE}/hastalar`); await page.getByRole("button", { name: /Yeni hasta/ }).first().click();
    const np = page.getByRole("dialog", { name: "Yeni hasta" }); await np.waitFor();
    for (const how of profile === "mobil" ? ["X", "Esc"] : ["X", "Esc", "arka plan"]) {
      await np.getByRole("textbox", { name: "Ad", exact: true }).fill(`QA ${how}`);
      if (how === "X") await np.getByRole("button", { name: "Kapat" }).first().click();
      else if (how === "Esc") await np.getByRole("textbox", { name: "Ad", exact: true }).press("Escape");
      else await page.mouse.click(5, 300);
      await page.waitForTimeout(400);
      const sh = await modal.isVisible().catch(() => false); steps.push([`yeni hasta kirli ${how}: modal`, sh]);
      if (sh) { await modal.getByRole("button", { name: "Forma dön" }).click(); await page.waitForTimeout(200);
        steps.push([`yeni hasta ${how}: Forma dön veriyi korudu`, (await np.getByRole("textbox", { name: "Ad", exact: true }).inputValue()) === `QA ${how}`]); }
    }
    await np.getByRole("button", { name: "Kapat" }).first().click(); await modal.getByRole("button", { name: "Kapat" }).click(); await page.waitForTimeout(300);
    steps.push(["yeni hasta: Kapat çekmeceyi kapattı", !(await np.isVisible().catch(() => false))]);
    const ev = await shot(page, profile, "F11-kapatma");
    steps.push(["tarayıcı yerel penceresi hiç açılmadı", page.nativeDialogs === 0]);
    const failed = steps.filter((s) => !s[1]).map((s) => s[0]);
    return { pass: failed.length === 0, summary: `${steps.length - failed.length}/${steps.length} adım; başarısız: ${failed.join("; ") || "yok"}; yerel pencere ${page.nativeDialogs}`, evidence: ev };
  });

  await tryCase(profile, "F12", async () => {
    await page.goto(`${BASE}/ajanda`); await page.getByRole("heading", { name: "Randevular", level: 1 }).waitFor();
    // 07.11.2026 kabul değişikliği (ADR-101): tek "İşlem" seçimi (fiyatıyla), tam sayfa; bakiye şeridi ödeme planında.
    await page.getByRole("button", { name: "Randevu ver" }).first().click();
    await page.getByRole("heading", { name: "Randevu ver", level: 1 }).waitFor();
    const d = page.locator("main");
    const sel = d.getByRole("combobox", { name: "İşlem", exact: true });
    const opts = await sel.locator("option").allInnerTexts();
    const twoSelects = (await d.getByLabel("İşlem türü").count()) + (await d.getByLabel("Planlanan işlem").count());
    await sel.selectOption((await sel.locator("option", { hasText: "Diş taşı temizliği" }).first().getAttribute("value")));
    await page.waitForTimeout(800);
    const hint = await d.innerText();
    const priceShown = hint.includes(num(S.F12.plannedPrice));
    await d.locator("#ra-q").fill("Sınama");
    await page.waitForTimeout(900);
    await d.getByRole("option").first().click();
    await page.waitForTimeout(900);
    const strip = await d.locator(".money-strip").innerText().catch(() => "");
    const ev = await shot(page, profile, "F12-form");
    await d.getByRole("button", { name: "Vazgeç" }).click(); await page.waitForTimeout(300);
    if (await page.getByRole("alertdialog").count()) await page.getByRole("alertdialog").getByRole("button", { name: "Çık" }).click();
    const pass = opts.length > 50 && twoSelects === 0 && priceShown && /açık borç/i.test(strip) && /toplam borç/i.test(strip);
    return { pass, summary: `tek işlem seçimi (eski iki alan ${twoSelects}); işlem seçenekleri ${opts.length}; TEM-01 fiyatı ${fmt(S.F12.plannedPrice)} görünür=${priceShown}; şerit: ${strip.replace(/\s+/g, " ").slice(0, 120)}`, evidence: ev };
  });
  await ctx.close();

  // ------------------------------------------------ sekreter
  {
    const { ctx: c2, page: p2 } = await session(profile, "sekreter@demo-yesil.test");
    await tryCase(profile, "F03", async () => {
      await p2.goto(`${BASE}/hastalar`);
      await p2.getByRole("searchbox").first().fill("Maske").catch(() => {});
      await p2.waitForTimeout(800);
      const row = p2.locator("tbody tr").first();
      const text = await row.innerText();
      const masked = /\*{2,}|•{2,}/.test(text);
      await p2.goto(`${BASE}/hastalar/${S.F03.patientId}`); await p2.waitForTimeout(1200);
      const body = await p2.locator("main").innerText();
      const fullOnCard = body.replace(/\D/g, "").includes(S.F03.phoneLast);
      await p2.goto(`${BASE}/hastalar`);
      await p2.getByRole("button", { name: /Yeni hasta/ }).first().click();
      const ph = p2.getByRole("dialog").getByLabel(/Telefon/).first();
      await ph.fill("053212345678901"); const v1 = (await ph.inputValue()).replace(/\D/g, "").length;
      await ph.fill("5321234567890"); const v2 = (await ph.inputValue()).replace(/\D/g, "").length;
      await ph.fill("+905321234567890123"); const v3 = (await ph.inputValue()).replace(/\D/g, "").length;
      const ev = await shot(p2, profile, "F03-telefon");
      await p2.getByRole("dialog").getByRole("button", { name: "Kapat" }).first().click(); await p2.waitForTimeout(300);
      if (await p2.getByRole("alertdialog").count()) await p2.getByRole("alertdialog").getByRole("button", { name: "Kapat" }).click();
      // Yurt dışı girişte üst sınır 17 rakam ("00" + E.164 15 hane); kesin doğrulama API'de (8–15 hane, F03 HTTP).
      const pass = !masked && fullOnCard && v1 === 11 && v2 === 10 && v3 <= 17;
      return { pass, summary: `listede maske ${masked}; kartta tam telefon ${fullOnCard}; giriş 0'lı ${v1} hane, 0'sız ${v2} hane, yurt dışı ${v3} rakam`, evidence: ev };
    });
    await tryCase(profile, "F04", async () => {
      await p2.goto(`${BASE}/hastalar`);
      const row = p2.locator("tbody tr.row-click").first(); await row.waitFor();
      await row.locator("td:visible").last().click({ position: { x: 4, y: 4 } });
      await p2.waitForURL(/\/hastalar\/[0-9a-f-]{36}/, { timeout: 8000 });
      const okClick = /\/hastalar\/[0-9a-f-]{36}/.test(p2.url());
      await p2.goBack(); await p2.locator("tbody tr.row-click").first().waitFor();
      // metin seçimi gezinmez
      const r2 = p2.locator("tbody tr.row-click").first();
      const box = await r2.boundingBox();
      await p2.mouse.move(box.x + 10, box.y + box.height / 2); await p2.mouse.down(); await p2.mouse.move(box.x + Math.min(box.width - 10, 200), box.y + box.height / 2); await p2.mouse.up();
      await p2.waitForTimeout(600);
      const stayed = /\/hastalar$/.test(new URL(p2.url()).pathname);
      // klavye: ad bağlantısı
      const link = r2.locator("a").first();
      await link.focus(); await p2.keyboard.press("Enter"); await p2.waitForTimeout(1000);
      const kb = /\/hastalar\/[0-9a-f-]{36}/.test(p2.url());
      const ev = await shot(p2, profile, "F04-satir");
      return { pass: okClick && stayed && kb, summary: `hücre tıklaması karta gitti ${okClick}; sürükle-seç sayfada kaldı ${stayed}; klavye Enter ${kb}`, evidence: ev };
    });
    await tryCase(profile, "F05", async () => {
      await p2.goto(`${BASE}/hastalar/${S.F05.patientId}`); await p2.waitForTimeout(1500);
      const n = await p2.getByRole("group", { name: "Odontogram" }).count();
      const ev = await shot(p2, profile, "F05-sekreter");
      return { pass: n === 0, summary: `sekreter (sağlık yetkisi yok) kartta odontogram ${n}`, evidence: ev };
    });
    await tryCase(profile, "F06", async () => {
      await p2.goto(`${BASE}/bugun`); await p2.getByRole("region", { name: "Günün özeti" }).waitFor();
      const moneyKpi = await p2.getByRole("region", { name: "Günün özeti" }).getByText(/tahsilat/i).count();
      const income = await p2.getByRole("heading", { name: "Aylık gelir" }).count();
      const ev = await shot(p2, profile, "F06-sekreter");
      return { pass: moneyKpi === 0 && income === 0, summary: `sekreter Panel: para kartı ${moneyKpi}, Aylık gelir grafiği ${income}`, evidence: ev };
    });
    await c2.close();
  }

  // ------------------------------------------------ finans
  {
    const { ctx: c3, page: p3 } = await session(profile, "finans@demo-yesil.test");
    await tryCase(profile, "F08", async () => {
      const comp = await apiGet(p3, `/practitioners/${S.F08.practitionerId}/compensation`);
      await p3.goto(`${BASE}/hekimler?hekim=${S.F08.practitionerId}`);
      await p3.getByRole("heading", { name: "Ücret ve hakediş" }).waitFor();
      const kalan = (await p3.locator(".kpi", { hasText: "Bu ay maaş" }).locator(".kpi-value").innerText()).replace(/\u00a0/g, " ").trim();
      let paid = "atlandı";
      if (profile === "masaustu") {
        await p3.getByRole("button", { name: "Maaş öde" }).click();
        const dlg = p3.getByRole("dialog", { name: "Maaş ödemesi" }); await dlg.waitFor();
        await dlg.getByLabel("Tutar (₺)").fill("1.000,00");
        await dlg.getByRole("button", { name: "Ödemeyi kaydet" }).click();
        await p3.getByText("Maaş ödemesi kaydedildi.").waitFor({ timeout: 8000 });
        const c2 = await apiGet(p3, `/practitioners/${S.F08.practitionerId}/compensation`);
        paid = c2.months.at(-1).salaryPaid;
      }
      const ov = await overflow(p3);
      const ev = await shot(p3, profile, "F08-hekim");
      const pass = same(kalan, comp.months.at(-1).salaryRemaining) && ov <= 1 && (profile !== "masaustu" || paid === (Number(comp.months.at(-1).salaryPaid) + 1000).toFixed(2));
      return { pass, summary: `ekranda bu ay kalan ${kalan} = API ${comp.months.at(-1).salaryRemaining}; UI ile 1.000 ödeme sonrası API ödenen ${paid}; taşma ${ov}`, evidence: ev };
    });
    await c3.close();
  }
}
writeFileSync(`${OUT}/browser-f-summary.json`, JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1));
await browser.close();
