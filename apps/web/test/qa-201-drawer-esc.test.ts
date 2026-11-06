/**
 * QA-201 (S2): kirli çekmece Esc ile uyarısız kapanıyordu. Klavye dinleyicisi bir kez kurulur; kapatıcı
 * dirty/onClose değerini her çağrıda güncel ref'ten okumalı. Esc, X ve arka plan aynı kapatıcıyı kullanır.
 * QA-202 (S3): randevu formunun "kirli" tanımı tüm alanları kapsar (kaynak düzeyi kontrol).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createDrawerCloser, handleDrawerEscape, UNSAVED_CHANGES_CONFIRM, type DrawerLatest } from "../components/drawer-close";

const esc = (defaultPrevented = false) => ({ key: "Escape", defaultPrevented, preventDefault: vi.fn() });
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(initial: Omit<DrawerLatest, "onClose">, answer = false) {
  const onClose = vi.fn();
  const latest = { current: { ...initial, onClose } as DrawerLatest };
  const confirm = vi.fn(async () => answer);
  const close = createDrawerCloser(latest, confirm); // dinleyici kurulumu gibi: bir kez oluşturulur
  return { latest, onClose, confirm, close };
}

describe("QA-201 çekmece Esc: güncel dirty değeri", () => {
  it("açılışta temiz, sonra kirli → Esc onay penceresini açar; Forma dön kapatmaz", async () => {
    const s = setup({ dirty: false }, false);
    s.latest.current = { dirty: true, onClose: s.onClose }; // kullanıcı yazdı → yeniden render
    const e = esc();
    expect(handleDrawerEscape(e, s.close)).toBe(true);
    await flush();
    expect(e.preventDefault).toHaveBeenCalled();
    expect(s.confirm).toHaveBeenCalledTimes(1);
    expect(s.confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_CONFIRM);
    expect(UNSAVED_CHANGES_CONFIRM).toMatchObject({ title: "Kaydedilmemiş değişiklikler", confirmLabel: "Kapat", cancelLabel: "Forma dön" });
    expect(s.onClose).not.toHaveBeenCalled();
  });

  it("kirli + Kapat → güncel onClose çağrılır", async () => {
    const s = setup({ dirty: false }, true);
    const newer = vi.fn();
    s.latest.current = { dirty: true, onClose: newer };
    handleDrawerEscape(esc(), s.close);
    await flush();
    expect(s.confirm).toHaveBeenCalledTimes(1);
    expect(newer).toHaveBeenCalledTimes(1);
    expect(s.onClose).not.toHaveBeenCalled();
  });

  it("kirli → sonra temiz (ör. kayıt sonrası) → Esc uyarısız kapatır", async () => {
    const s = setup({ dirty: true });
    s.latest.current = { dirty: false, onClose: s.onClose };
    handleDrawerEscape(esc(), s.close);
    await flush();
    expect(s.confirm).not.toHaveBeenCalled();
    expect(s.onClose).toHaveBeenCalledTimes(1);
  });

  it("temiz form Esc ile doğrudan kapanır", async () => {
    const s = setup({});
    handleDrawerEscape(esc(), s.close);
    await flush();
    expect(s.confirm).not.toHaveBeenCalled();
    expect(s.onClose).toHaveBeenCalledTimes(1);
  });

  it("iç açılır pencere Esc'i tükettiyse (defaultPrevented) çekmece kapanmaz, onay da açılmaz", async () => {
    const s = setup({ dirty: true });
    const e = esc(true);
    expect(handleDrawerEscape(e, s.close)).toBe(false);
    await flush();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(s.confirm).not.toHaveBeenCalled();
    expect(s.onClose).not.toHaveBeenCalled();
  });

  it("Esc dışındaki tuşlar kapatıcıyı tetiklemez", async () => {
    const s = setup({});
    expect(handleDrawerEscape({ key: "Tab", defaultPrevented: false, preventDefault: vi.fn() }, s.close)).toBe(false);
    await flush();
    expect(s.onClose).not.toHaveBeenCalled();
  });

  it("onay açıkken ikinci kapatma isteği ikinci pencere açmaz; yanıt sonrası yeniden sorulabilir", async () => {
    let resolve!: (v: boolean) => void;
    const onClose = vi.fn();
    const latest = { current: { dirty: true, onClose } as DrawerLatest };
    const confirm = vi.fn(() => new Promise<boolean>((r) => { resolve = r; }));
    const close = createDrawerCloser(latest, confirm);
    void close(); void close();
    expect(confirm).toHaveBeenCalledTimes(1);
    resolve(false); await flush();
    expect(onClose).not.toHaveBeenCalled();
    void close();
    expect(confirm).toHaveBeenCalledTimes(2);
    resolve(true); await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("QA-201/202 bağlantı (kaynak düzeyi)", () => {
  const ui = readFileSync(new URL("../components/ui.tsx", import.meta.url), "utf8");
  const drawer = ui.slice(ui.indexOf("export function Drawer"), ui.indexOf("// ---------------------------------------------------------------- form alanları"));
  it("Drawer: Esc, X ve arka plan aynı ref tabanlı kapatıcıyı kullanır", () => {
    expect(drawer).toMatch(/latest\.current = \{ dirty, onClose \}/);
    expect(drawer).toMatch(/useState\(\(\) => createDrawerCloser\(latest, confirmDialog\)\)/);
    expect(drawer).toMatch(/handleDrawerEscape\(e, tryClose\)/);
    expect(drawer.match(/onClick=\{\(\) => void tryClose\(\)\}/g)).toHaveLength(2); // arka plan + X
    expect(drawer).not.toMatch(/if \(dirty\)/); // render kapanışındaki dirty'e doğrudan bakılmaz
  });
  it("Randevu ver: dirty yalnız hasta/açıklama değil, açılış değerinden sapan her alan", () => {
    // 07.11.2026: randevu verme tam sayfaya taşındı (components/appointment/new-appointment-page.tsx); kural aynı.
    const page = readFileSync(new URL("../components/appointment/new-appointment-page.tsx", import.meta.url), "utf8");
    expect(page).not.toMatch(/dirty=\{!!patient \|\| !!f\.reason\}/);
    expect(page).toMatch(/\.some\(\(k\) => f\[k\] !== initialF\[k\]\)/);
  });
});
