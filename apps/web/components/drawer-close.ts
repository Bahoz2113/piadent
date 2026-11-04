/**
 * Çekmece kapatma kararı (Esc, X, arka plan aynı yolu izler) — QA-201.
 * Kapatıcı bir kez oluşturulur ama `dirty`/`onClose` değerlerini her çağrıda `latest` ref'inden okur;
 * böylece bir kez kurulan klavye dinleyicisi bayat (ilk render) değeri görmez.
 */
export const UNSAVED_CHANGES_CONFIRM = {
  title: "Kaydedilmemiş değişiklikler",
  message: "Bu formda kaydedilmemiş bilgiler var. Kapatırsanız girdiğiniz bilgiler kaybolur.",
  confirmLabel: "Kapat",
  cancelLabel: "Forma dön",
  danger: true,
};

export type DrawerLatest = { dirty?: boolean; onClose: () => void };
export type ConfirmFn = (o: typeof UNSAVED_CHANGES_CONFIRM) => Promise<boolean>;

export function createDrawerCloser(latest: { readonly current: DrawerLatest }, confirm: ConfirmFn): () => Promise<void> {
  let asking = false;
  return async () => {
    if (latest.current.dirty) {
      if (asking) return;
      asking = true;
      let ok = false;
      try { ok = await confirm(UNSAVED_CHANGES_CONFIRM); } finally { asking = false; }
      if (!ok) return;
    }
    latest.current.onClose();
  };
}

/** Esc: iç açılır pencere (takvim) olayı tükettiyse (`defaultPrevented`) çekmece kapanmaz. */
export function handleDrawerEscape(e: Pick<KeyboardEvent, "key" | "defaultPrevented" | "preventDefault">, close: () => Promise<void>): boolean {
  if (e.key !== "Escape" || e.defaultPrevented) return false;
  e.preventDefault();
  void close();
  return true;
}
