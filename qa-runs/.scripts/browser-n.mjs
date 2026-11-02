// CEZERİ teslim testi — PİA-DENT yeni kapsam tarayıcı vakaları (N01, N02, N04, N05, N06, N09) masaüstü + mobil emülasyon.
// N-cases HTTP koşusunun oluşturduğu sentetik hastaları adlarıyla bulur. Ürün kodunu değiştirmez. Kanıtlar PNG (sonra JPG'ye çevrilir).
// Kullanım (apps/web içinden geçici kopya): BASE=… PASSWORD=… OUT=… node ./.qa-browser-n.mjs
import { chromium, devices } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000"; const PASSWORD = process.env.PASSWORD; const OUT = process.env.OUT ?? "evidence"; const TUR = process.env.TUR ?? "tur1";
if (!PASSWORD) { console.error("PASSWORD gerekli"); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const out = [];
const rec = (profile, id, status, summary, evidence) => { out.push({ profile, id, status, summary, evidence }); console.log(`${status.padEnd(6)} ${profile.padEnd(8)} ${id} ${summary}`); };
async function session(profile, email) {
  const ctx = await browser.newContext({ ...(profile === "mobil" ? { ...devices["Pixel 5"], viewport: { width: 360, height: 780 } } : { viewport: { width: 1366, height: 900 } }), locale: "tr-TR", timezoneId: "Europe/Istanbul" });
  await ctx.addInitScript(() => { window.print = () => {}; });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/giris`);
  await page.getByLabel("E-posta").fill(email); await page.getByLabel("Parola").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"), { timeout: 20_000 });
  return { ctx, page };
}
async function openPatient(page, q, tab) {
  await page.goto(`${BASE}/hastalar?q=${encodeURIComponent(q)}`); await page.waitForLoadState("networkidle");
  await page.locator("a.rowlink").first().click(); await page.waitForURL(/\/hastalar\/[0-9a-f-]{36}/);
  if (tab) await page.getByRole("tab", { name: tab }).click();
  await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const attrs = (page) => page.evaluate(() => ({ scheme: document.documentElement.dataset.scheme, accent: document.documentElement.dataset.accent, scale: document.documentElement.dataset.scale, root: getComputedStyle(document.documentElement).fontSize }));

for (const profile of ["masaustu", "mobil"]) {
  // N01 — makbuz numarası ve yazdırma penceresi
  try {
    const { ctx, page } = await session(profile, "finans@demo-yesil.test");
    await openPatient(page, "Makbuz Sınama", "Finans");
    const card = page.locator("section.card", { hasText: "Ödemeler" }).first();
    const no = (await card.locator(".mono").first().innerText()).trim();
    const [popup] = await Promise.all([page.waitForEvent("popup"), card.getByRole("button", { name: `Makbuz ${no} yazdır` }).click()]);
    await popup.waitForLoadState("domcontentloaded");
    const t = await popup.locator("main").innerText();
    await popup.screenshot({ path: `${OUT}/${profile}-N01-makbuz-pencere.png` }); await popup.close();
    await shot(page, `${profile}-N01-finans`);
    const ok = /^TM-\d{4}-\d{6}$/.test(no) && t.includes(no) && /fatura veya e-Arşiv belgesi yerine geçmez/.test(t) && (await overflow(page)) <= 0;
    rec(profile, "N01", ok ? "PASS" : "FAIL", `listede ${no}; pencere no+uyarı=${t.includes(no) && /yerine geçmez/.test(t)}; taşma ${await overflow(page)}`, `evidence/${TUR}/${profile}-N01-makbuz-pencere.jpg`);
    await ctx.close();
  } catch (e) { rec(profile, "N01", "FAIL", `istisna: ${e.message.split("\n")[0]}`); }

  // N02 — fatura listesi: MOCK no rozeti, iptal durumu, taslak "numara yok"; sekreter oluşturamaz
  try {
    const { ctx, page } = await session(profile, "finans@demo-yesil.test");
    await openPatient(page, "Fatura Sınama", "Finans");
    const card = page.locator("section.card", { hasText: "Fatura taslakları" });
    const text = await card.innerText();
    await shot(page, `${profile}-N02-fatura`);
    const mockRow = card.locator("table tbody tr", { hasText: /MOCK\d{4}/ }).first();
    await mockRow.getByRole("button", { name: "Aç" }).click();
    const dlg = page.getByRole("dialog", { name: /e-Arşiv fatura · |e-Fatura · / });
    const dt = await dlg.innerText();
    // QA-103 yeniden sınaması: düzenlenmiş/iptal edilmiş faturada "TASLAK" ibaresi olmamalı
    const noDraftMark = !/TASLAK/.test(dt);
    await page.screenshot({ path: `${OUT}/${profile}-N02-fatura-ayrinti.png` });
    await dlg.getByRole("button", { name: "Kapat" }).click();
    const s2 = await session(profile, "sekreter@demo-yesil.test");
    await openPatient(s2.page, "Fatura Sınama", "Finans");
    const secBtn = await s2.page.locator("section.card", { hasText: "Fatura taslakları" }).getByRole("button", { name: "Taslak oluştur" }).count();
    await s2.ctx.close();
    const ok = /MOCK/.test(text) && /İptal/.test(text) && /numara yok/.test(text) && /resmî belge değil/.test(dt) && /Sağlayıcı/.test(dt) && noDraftMark && secBtn === 0 && (await overflow(page)) <= 0;
    rec(profile, "N02", ok ? "PASS" : "FAIL", `liste: MOCK rozeti=${/MOCK/.test(text)}, iptal=${/İptal/.test(text)}, taslak 'numara yok'=${/numara yok/.test(text)}; ayrıntıda 'resmî belge değil'=${/resmî belge değil/.test(dt)}, TASLAK ibaresi yok=${noDraftMark}; sekreter düğmesi ${secBtn}; taşma ${await overflow(page)}`, `evidence/${TUR}/${profile}-N02-fatura.jpg`);
    await ctx.close();
  } catch (e) { rec(profile, "N02", "FAIL", `istisna: ${e.message.split("\n")[0]}`); }

  // N04 — eski şablonla alınmış kayıt uyarısı; yürürlükteki form
  try {
    const { ctx, page } = await session(profile, "elif.aras@demo-yesil.test");
    await openPatient(page, "Anamnez Sınama", "Sağlık");
    const t = await page.locator("main").innerText();
    await shot(page, `${profile}-N04-anamnez`);
    const ok = /Kalp pili var mı\?/.test(t) && /yerleşik DEMO/.test(t);
    rec(profile, "N04", ok ? "PASS" : "FAIL", `son kayıt kendi sorusuyla (Kalp pili)=${/Kalp pili var mı/.test(t)}; yürürlük yerleşik set bildirimi=${/yerleşik DEMO/.test(t)}`, `evidence/${TUR}/${profile}-N04-anamnez.jpg`);
    await ctx.close();
  } catch (e) { rec(profile, "N04", "FAIL", `istisna: ${e.message.split("\n")[0]}`); }

  // N05 — sekreter Belgeler'de epikrizi görmez; Geçmiş'te ne görünüyor (gözlem)
  try {
    const { ctx, page } = await session(profile, "sekreter@demo-yesil.test");
    await openPatient(page, "Epikriz Sınama", "Belgeler");
    const docs = await page.locator("main").innerText();
    await shot(page, `${profile}-N05-sekreter-belgeler`);
    await page.getByRole("tab", { name: "Geçmiş" }).click(); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
    const hist = await page.locator("main").innerText();
    await shot(page, `${profile}-N05-sekreter-gecmis`);
    const histShowsDoc = /Belge (düzenlendi|üretildi|hazırlandı|iptal edildi)|document\.issue/i.test(hist);
    const ok = !/Epikriz \/ tedavi özeti/.test(docs) && !histShowsDoc;
    rec(profile, "N05", ok ? "PASS" : "FAIL", `Belgeler'de epikriz görünür=${/Epikriz \/ tedavi özeti/.test(docs)}; Geçmiş'te belge olayı görünür=${histShowsDoc}`, `evidence/${TUR}/${profile}-N05-sekreter-gecmis.jpg`);
    await ctx.close();
  } catch (e) { rec(profile, "N05", "FAIL", `istisna: ${e.message.split("\n")[0]}`); }

  // N06 — görünüm: koyu + lacivert + ölçek 4, axe, yenileme, varsayılana dönüş
  try {
    const { ctx, page } = await session(profile, "asistan@demo-yesil.test");
    await page.goto(`${BASE}/bugun`); await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Görünüm" }).click();
    const d = page.getByRole("dialog", { name: "Görünüm" });
    await d.getByRole("radio", { name: "Lacivert" }).click(); await d.getByRole("radio", { name: "Koyu" }).click(); await d.getByRole("button", { name: "Büyüt" }).click();
    await d.getByText("Kaydedildi (tüm cihazlarınızda)").waitFor();
    const a1 = await attrs(page);
    await page.screenshot({ path: `${OUT}/${profile}-N06-koyu-panel.png` });
    await d.getByRole("button", { name: "Kapat" }).click();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = axe.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id);
    await page.reload(); const a2 = await attrs(page);
    const ov = await overflow(page);
    await shot(page, `${profile}-N06-koyu-bugun`);
    await page.goto(`${BASE}/hesabim`); await page.getByRole("button", { name: "Varsayılana dön" }).click(); await page.getByText("Kaydedildi (tüm cihazlarınızda)").waitFor();
    const a3 = await attrs(page);
    const ok = a1.scheme === "dark" && a1.accent === "lacivert" && a1.scale === "4" && a1.root === "17px" && serious.length === 0 && a2.scheme === "dark" && a2.accent === "lacivert" && a3.accent === "yesil" && a3.root === "16px" && ov <= 0;
    rec(profile, "N06", ok ? "PASS" : "FAIL", `uygulandı ${JSON.stringify(a1)}; axe ciddi/kritik [${serious}]; yenilemede ${a2.scheme}/${a2.accent}; varsayılan ${a3.accent}/${a3.root}; taşma ${ov}`, `evidence/${TUR}/${profile}-N06-koyu-panel.jpg`);
    await ctx.close();
  } catch (e) { rec(profile, "N06", "FAIL", `istisna: ${e.message.split("\n")[0]}`); }

  // N09 — kart görünümü (mobil) / tablo (masaüstü); stokta Sayım tıklanır; raporlarda ham kod yok
  try {
    const { ctx, page } = await session(profile, "asistan@demo-yesil.test");
    await page.goto(`${BASE}/operasyon?sekme=stok`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
    const row = page.locator("tr", { hasText: "Muayene eldiveni" });
    const disp = await row.evaluate((el) => getComputedStyle(el).display);
    const lbl = await row.locator("td").first().getAttribute("data-label");
    await row.getByRole("button", { name: "Sayım" }).click({ timeout: 10_000 });
    const sayim = await page.getByRole("dialog", { name: "Sayım" }).isVisible();
    await page.keyboard.press("Escape");
    const ov1 = await overflow(page);
    await shot(page, `${profile}-N09-stok`);
    await ctx.close();
    const f = await session(profile, "finans@demo-yesil.test");
    await f.page.goto(`${BASE}/raporlar`); await f.page.waitForLoadState("networkidle");
    const cat = await f.page.locator("main").innerText();
    await f.page.getByRole("button", { name: /Mali müşavir dönem dökümü/ }).click(); await f.page.waitForLoadState("networkidle"); await f.page.waitForTimeout(400);
    const rep = await f.page.locator("main").innerText();
    const excel = await f.page.getByRole("button", { name: "Excel" }).isVisible();
    const ov2 = await overflow(f.page);
    await shot(f.page, `${profile}-N09-rapor`);
    await f.ctx.close();
    const codes = /\b[RTGHOVF]\d{2}\b/.test(cat) || /\b[RTGHOVF]\d{2}\b/.test(rep);
    const wantDisp = profile === "mobil" ? "grid" : "table-row";
    const ok = disp === wantDisp && lbl === "Kalem" && sayim && ov1 <= 0 && ov2 <= 0 && !codes && excel;
    rec(profile, "N09", ok ? "PASS" : "FAIL", `stok satırı display=${disp} (beklenen ${wantDisp}), etiket ${lbl}, Sayım açıldı=${sayim}; taşma stok ${ov1} rapor ${ov2}; ham kod=${codes}; Excel=${excel}`, `evidence/${TUR}/${profile}-N09-stok.jpg`);
  } catch (e) { rec(profile, "N09", "FAIL", `istisna: ${e.message.split("\n")[0]}`); }
}
await browser.close();
writeFileSync(`${OUT}/browser-n-summary.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, results: out }, null, 1));
console.log(JSON.stringify({ pass: out.filter((r) => r.status === "PASS").length, fail: out.filter((r) => r.status !== "PASS").map((r) => `${r.profile}:${r.id}`) }));
