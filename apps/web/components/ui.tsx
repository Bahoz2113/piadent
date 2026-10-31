"use client";
import { useEffect, useId, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2, Lock, TriangleAlert, X } from "lucide-react";
import { APPOINTMENT_STATUS_LABELS, CONTACT_OUTCOME_LABELS, type AppointmentStatus } from "@viadent/contracts";
import type { ApiFailure } from "@/lib/api";

// ---------------------------------------------------------------- çekmece
export function Drawer({ title, subtitle, onClose, children, footer, dirty }: {
  title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; dirty?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const tryClose = () => {
    if (dirty && !window.confirm("Kaydedilmemiş değişiklikler var. Çıkmak istiyor musunuz?")) return;
    onClose();
  };
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); tryClose(); }
      if (e.key === "Tab" && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])")];
        if (!items.length) return;
        const [f, l] = [items[0]!, items[items.length - 1]!];
        if (e.shiftKey && document.activeElement === f) { e.preventDefault(); l.focus(); }
        else if (!e.shiftKey && document.activeElement === l) { e.preventDefault(); f.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  return (
    <>
      <div className="drawer-backdrop" onClick={tryClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="drawer-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <div className="muted small">{subtitle}</div>}
          </div>
          <button className="btn btn-ghost icon-btn" onClick={tryClose} aria-label="Kapat" data-close><X size={20} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- form alanları
interface FieldProps { label: string; error?: string; hint?: string; required?: boolean; className?: string; }

export function TextField({ label, error, hint, required, className, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden>*</span>}</label>
      <input id={id} className="input" aria-invalid={!!error} aria-required={required} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...rest} />
      {hint && !error && <span className="hint" id={`${id}-h`}>{hint}</span>}
      {error && <span className="err" id={`${id}-e`}><AlertCircle size={14} aria-hidden />{error}</span>}
    </div>
  );
}

export function SelectField({ label, error, hint, required, className, children, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden>*</span>}</label>
      <select id={id} className="select" aria-invalid={!!error} aria-required={required} aria-describedby={error ? `${id}-e` : undefined} {...rest}>{children}</select>
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err" id={`${id}-e`}><AlertCircle size={14} aria-hidden />{error}</span>}
    </div>
  );
}

export function TextAreaField({ label, error, hint, required, className, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden>*</span>}</label>
      <textarea id={id} className="textarea" aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined} {...rest} />
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err" id={`${id}-e`}><AlertCircle size={14} aria-hidden />{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- durumlar
export function Loading({ rows = 3, label = "Yükleniyor" }: { rows?: number; label?: string }) {
  return (
    <div className="card-pad stack" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: 18, width: `${90 - i * 12}%` }} />)}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiFailure; onRetry?: () => void }) {
  if (error.status === 403) {
    return (
      <div className="state" role="alert">
        <Lock size={28} aria-hidden />
        <h3>Bu bölüm için yetkiniz yok</h3>
        <p>Erişim gerekiyorsa klinik yöneticinizle görüşün.</p>
      </div>
    );
  }
  return (
    <div className="card-pad">
      <Alert kind="error" title="Veriler yüklenemedi">
        {error.message}
        {error.body.correlation_id && <span className="small"> (Kayıt no: {error.body.correlation_id.slice(0, 8)})</span>}
        {onRetry && <div style={{ marginTop: 8 }}><button className="btn btn-sm" onClick={onRetry}>Tekrar dene</button></div>}
      </Alert>
    </div>
  );
}

export function Alert({ kind, title, children }: { kind: "error" | "warning" | "info" | "success"; title?: string; children?: ReactNode }) {
  const Icon = { error: AlertCircle, warning: TriangleAlert, info: Info, success: CheckCircle2 }[kind];
  return (
    <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon size={18} aria-hidden style={{ flex: "none", marginTop: 2 }} />
      <div>{title && <strong style={{ display: "block" }}>{title}</strong>}{children}</div>
    </div>
  );
}

export function Spinner({ label = "İşleniyor" }: { label?: string }) {
  return <Loader2 size={16} className="spin" aria-label={label} style={{ animation: "spin 1s linear infinite" }} />;
}

// ---------------------------------------------------------------- rozetler (renk + metin; yalnız renkle anlatılmaz)
const STATUS_KIND: Record<AppointmentStatus, string> = {
  planned: "neutral", confirmed: "primary", checked_in: "info", in_progress: "info", completed: "success", no_show: "error", cancelled: "neutral",
};
export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <span className={`badge badge-${STATUS_KIND[status]}`}><span className="dot" aria-hidden />{APPOINTMENT_STATUS_LABELS[status]}</span>;
}
export function ContactBadge({ outcome }: { outcome: keyof typeof CONTACT_OUTCOME_LABELS }) {
  const kind = outcome === "informed" ? "success" : outcome === "unreachable" ? "warning" : "neutral";
  return <span className={`badge badge-${kind}`}>{CONTACT_OUTCOME_LABELS[outcome]}</span>;
}

// ---------------------------------------------------------------- bildirim
export function useToast() {
  const [toast, setToast] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast ? <div className="toast" aria-live="polite"><Alert kind={toast.kind}>{toast.text}</Alert></div> : null;
  return { show: (kind: "success" | "error" | "info", text: string) => setToast({ kind, text }), node };
}
