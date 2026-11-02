"use client";
import { useEffect } from "react";

/**
 * Mobil kart görünümü (ADR-087): geniş tablolarda (`table.table-wide`) her hücreye başlık metnini `data-label` olarak yazar;
 * ≤640 px'te CSS satırı karta çevirip etiketi hücre üstünde gösterir. İçerik ve DOM sırası değişmez (ekran okuyucu tablo olarak okur).
 */
export function TableLabels() {
  useEffect(() => {
    const root = document.getElementById("icerik") ?? document.body;
    const apply = () => {
      for (const table of root.querySelectorAll<HTMLTableElement>("table.table-wide")) {
        const heads = [...table.querySelectorAll<HTMLTableCellElement>("thead th")].map((th) => (th.textContent ?? "").trim());
        if (!heads.length) continue;
        for (const row of table.querySelectorAll<HTMLTableRowElement>("tbody tr")) {
          row.querySelectorAll<HTMLTableCellElement>("td").forEach((td, i) => { const label = heads[i]; if (label && td.dataset.label !== label) td.dataset.label = label; });
        }
      }
    };
    apply();
    const mo = new MutationObserver(() => { window.requestAnimationFrame(apply); });
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return null;
}
