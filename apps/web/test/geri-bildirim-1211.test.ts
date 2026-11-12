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
