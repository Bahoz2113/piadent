"use client";
/**
 * Uygulama içi onay / gerekçe / bilgi pencereleri (tarayıcının yerel confirm/prompt/alert pencereleri yerine).
 * Kullanım: `if (!(await confirmDialog({ title, message }))) return;` — `DialogHost` Shell içinde bir kez bulunur.
 * Erişilebilirlik: role="alertdialog", odak tuzağı, Esc = vazgeç, Enter = onay; açık çekmecenin klavye işleyicilerinden önce çalışır.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, HelpCircle, Info } from "lucide-react";

type Base = { title: string; message?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type ConfirmReq = Base & { kind: "confirm"; resolve: (v: boolean) => void };
type PromptReq = Base & { kind: "prompt"; inputLabel?: string; required?: boolean; defaultValue?: string; multiline?: boolean; maxLength?: number; resolve: (v: string | null) => void };
type AlertReq = Base & { kind: "alert"; copyValue?: string; resolve: () => void };
type Req = ConfirmReq | PromptReq | AlertReq;

let enqueue: ((r: Req) => void) | null = null;

export function confirmDialog(o: Base): Promise<boolean> {
  return new Promise((resolve) => (enqueue ? enqueue({ ...o, kind: "confirm", resolve }) : resolve(false)));
}
export function promptDialog(o: Base & { inputLabel?: string; required?: boolean; defaultValue?: string; multiline?: boolean; maxLength?: number }): Promise<string | null> {
  return new Promise((resolve) => (enqueue ? enqueue({ ...o, kind: "prompt", resolve }) : resolve(null)));
}
export function alertDialog(o: Base & { copyValue?: string }): Promise<void> {
  return new Promise((resolve) => (enqueue ? enqueue({ ...o, kind: "alert", resolve }) : resolve()));
}

export function DialogHost() {
  const [queue, setQueue] = useState<Req[]>([]);
  useEffect(() => {
    enqueue = (r) => setQueue((q) => [...q, r]);
    return () => { enqueue = null; };
  }, []);
  const cur = queue[0];
  if (!cur || typeof document === "undefined") return null;
  const done = () => setQueue((q) => q.slice(1));
  return createPortal(<Dialog key={queue.length + cur.title} req={cur} onDone={done} />, document.body);
}

function Dialog({ req, onDone }: { req: Req; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId(), msgId = useId(), inputId = useId();
  const [value, setValue] = useState(req.kind === "prompt" ? req.defaultValue ?? "" : "");
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    if (req.kind === "confirm") req.resolve(false);
    else if (req.kind === "prompt") req.resolve(null);
    else req.resolve();
    onDone();
  };
  const accept = () => {
    if (req.kind === "prompt") {
      const v = value.trim();
      if (req.required && !v) { setError("Bu alan zorunlu."); return; }
      req.resolve(v);
    } else if (req.kind === "confirm") req.resolve(true);
    else req.resolve();
    onDone();
  };

  const handlers = useRef({ cancel, accept });
  handlers.current = { cancel, accept };
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("textarea, input, [data-primary]");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Yakalama aşamasında çalışır: alttaki çekmecenin Esc/Tab işleyicileri tetiklenmez.
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); handlers.current.cancel(); return; }
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); e.stopPropagation(); handlers.current.accept(); return; }
      if (e.key === "Tab" && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>("button:not([disabled]), input, textarea")];
        if (!items.length) return;
        const [f, l] = [items[0]!, items[items.length - 1]!];
        e.stopPropagation();
        if (e.shiftKey && document.activeElement === f) { e.preventDefault(); l.focus(); }
        else if (!e.shiftKey && document.activeElement === l) { e.preventDefault(); f.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  }, []);

  const Icon = req.danger ? AlertTriangle : req.kind === "alert" ? Info : HelpCircle;
  const confirmLabel = req.confirmLabel ?? (req.kind === "alert" ? "Tamam" : req.kind === "prompt" ? "Devam" : "Evet");
  const cancelLabel = req.cancelLabel ?? "Vazgeç";
  return (
    <div className="modal-layer">
      <div className="modal-backdrop" onClick={cancel} />
      <div className={`modal ${req.danger ? "modal-danger" : ""}`} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={req.message ? msgId : undefined} ref={ref}>
        <div className="modal-head">
          <span className="modal-icon" aria-hidden><Icon size={20} /></span>
          <h2 id={titleId}>{req.title}</h2>
        </div>
        {req.message && <div className="modal-body" id={msgId}>{req.message}</div>}
        {req.kind === "alert" && req.copyValue && (
          <div className="modal-body"><input className="input mono" readOnly value={req.copyValue} onFocus={(e) => e.currentTarget.select()} aria-label="Değer" /></div>
        )}
        {req.kind === "prompt" && (
          <div className="modal-body field">
            <label htmlFor={inputId}>{req.inputLabel ?? "Gerekçe"}{req.required && <span className="req" aria-hidden>*</span>}</label>
            {req.multiline ? (
              <textarea id={inputId} className="textarea" rows={3} value={value} maxLength={req.maxLength ?? 500} aria-invalid={!!error} aria-required={req.required}
                onChange={(e) => { setValue(e.target.value); setError(null); }} />
            ) : (
              <input id={inputId} className="input" value={value} maxLength={req.maxLength ?? 500} aria-invalid={!!error} aria-required={req.required}
                onChange={(e) => { setValue(e.target.value); setError(null); }} />
            )}
            {error && <span className="err">{error}</span>}
          </div>
        )}
        <div className="modal-foot">
          {req.kind !== "alert" && <button className="btn" onClick={cancel}>{cancelLabel}</button>}
          <button className={`btn ${req.danger ? "btn-danger" : "btn-primary"}`} onClick={accept} data-primary>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
