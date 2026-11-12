/** Ürün sahibi 12.11.2026: Randevu ver → Ödeme planı "Tamamı" fiyat tanımsızken boş, düzenlenebilir tutar kutusu. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../components/appointment/new-appointment-page.tsx", import.meta.url), "utf8");
describe("randevu ödeme planı", () => {
  it("'Fiyat tanımsız' yazan salt okunur kutu yok; fiyat yoksa Tamamı elle girilen tutarı kullanır", () => {
    expect(src).not.toMatch(/"Fiyat tanımsız"/);
    expect(src).toMatch(/pay\.mode === "full" \? \(effectivePrice \?\? manualAmount\)/);
    expect(src).toMatch(/pay\.mode === "full" && priceKnown/);
    expect(src).toMatch(/İşlem fiyatı tanımlı değil; hastadan alınan tutarı yazın\./);
  });
});

const home = readFileSync(new URL("../app/(app)/bugun/page.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/shell.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/(app)/bugun/layout.tsx", import.meta.url), "utf8");
describe("Anasayfa (12.11.2026)", () => {
  it("menü ve sekme başlığı Anasayfa", () => {
    expect(shell).toMatch(/\{ href: "\/bugun", label: "Anasayfa"/);
    expect(shell).not.toMatch(/label: "Panel"/);
    expect(layout).toMatch(/title: "Anasayfa"/);
  });
  it("bekleyen hasta, bugünkü/bekleyen tahsilat kartları ve aylık gelir grafiği yok", () => {
    for (const gone of ["Bekleyen hasta", "Bugünkü tahsilat", "Bekleyen tahsilat", "Aylık gelir"]) expect(home).not.toContain(`"${gone}"`);
    expect(home).toMatch(/"Bugünkü randevular"/);
    expect(home).toMatch(/"Aktif hekim"/);
  });
});
