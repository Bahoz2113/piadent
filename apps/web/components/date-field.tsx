"use client";
/**
 * DateField (Görev 11, ADR-066): gg.aa.yyyy metin girişi + takvim açılır penceresi.
 * - Değer sözleşmesi dışa doğru ISO (yyyy-mm-dd) kalır: onChange, yalnız `target.value` okunan ChangeEvent benzeri bir nesne alır,
 *   böylece mevcut `set("alan")` işleyicileri değişmeden çalışır. Geçersiz/eksik giriş dışa yayılmaz; alan altında yerel hata gösterilir.
 * - Yazarken noktalar kendiliğinden eklenir; ISO yapıştırma (yyyy-mm-dd) da kabul edilir (E2E ve kopyala-yapıştır uyumu).
 * - Takvim: ok tuşlarıyla gün, PageUp/PageDown ile ay, Home/End ile hafta başı/sonu; Enter seçer, Esc kapatır. min/max dışı günler kapalı.
 * - Tarayıcının yerel `type="date"` denetimi kullanılmaz: biçimi işletim sistemi diline bağlıdır ve klinik standardı gg.aa.yyyy'dir.
 */
import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { AlertCircle, Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DAYS = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TR_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

export function isoToTr(iso: string): string {
  const m = ISO_RE.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}
function pad(n: number) { return String(n).padStart(2, "0"); }
function validIso(y: number, mo: number, d: number): string | null {
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}
/** gg.aa.yyyy veya yyyy-mm-dd → ISO; takvimde olmayan gün (31.02.2026) → null. */
export function parseDateInput(text: string): string | null {
  const t = text.trim();
  let m = TR_RE.exec(t);
  if (m) return validIso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = ISO_RE.exec(t);
  if (m) return validIso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}
/** Yazarken maske: yalnız rakam ve nokta; 2 ve 4. rakamdan sonra nokta eklenir. ISO yazılıyorsa dokunulmaz. */
function maskTyping(raw: string): string {
  if (raw.includes("-")) return raw.replace(/[^\d-]/g, "").slice(0, 10);
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter((p, i) => p.length > 0 || (i === 0 && digits.length === 0));
  let out = parts.join(".");
  if ((digits.length === 2 || digits.length === 4) && raw.endsWith(".")) out += ".";
  return out;
}
function addMonths(y: number, m: number, delta: number): [number, number] {
  const t = y * 12 + (m - 1) + delta;
  return [Math.floor(t / 12), (t % 12) + 1];
}
function inRange(iso: string, min?: string, max?: string): boolean {
  return !(min && iso < min) && !(max && iso > max);
}
function shiftDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export interface DateFieldProps {
  label: string;
  /** ISO yyyy-mm-dd ya da "" */
  value: string;
  /** Yalnız `e.target.value` (ISO ya da "") güvenilir; diğer alanlar sahte. */
  onChange(e: ChangeEvent<HTMLInputElement>): void;
  min?: string; max?: string;
  required?: boolean; disabled?: boolean;
  error?: string; hint?: string; className?: string;
  /** Bugünün ISO tarihi (klinik saat dilimi); takvimin açılış ayı ve "bugün" vurgusu için. */
  today?: string;
  id?: string;
  /** Kompakt tek satır kullanım (ör. ajanda başlığı): etiket görsel olarak gizlenir. */
  hideLabel?: boolean;
  style?: React.CSSProperties;
}

export function DateField({ label, value, onChange, min, max, required, disabled, error, hint, className, today, id: idProp, hideLabel, style }: DateFieldProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [text, setText] = useState(isoToTr(value));
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const base = value || today || new Date().toISOString().slice(0, 10);
  const [view, setView] = useState<[number, number]>([Number(base.slice(0, 4)), Number(base.slice(5, 7))]);
  const [focusIso, setFocusIso] = useState(base);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Dışarıdan gelen değer değişince (form sıfırlama, takvim seçimi) metni eşitle — kullanıcı yazmaya devam ediyorsa (odakta ve metin eşleşiyorsa) dokunma.
  useEffect(() => {
    const cur = parseDateInput(text);
    if (cur !== (value || null)) { setText(isoToTr(value)); setLocalErr(null); }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focusIso}"]`)?.focus();
  }, [open, focusIso, view]);

  const emit = (iso: string) => onChange({ target: { value: iso, id } } as unknown as ChangeEvent<HTMLInputElement>);

  const commitText = (t: string, fromBlur: boolean) => {
    if (t.trim() === "") { setLocalErr(null); if (value) emit(""); return; }
    const iso = parseDateInput(t);
    if (iso) {
      setLocalErr(null);
      if (fromBlur && t !== isoToTr(iso)) setText(isoToTr(iso));
      if (iso !== value) emit(iso);
      return;
    }
    if (fromBlur) { setLocalErr("Geçerli bir tarih girin (gg.aa.yyyy)."); if (value) emit(""); }
  };

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    const t = maskTyping(e.target.value);
    setText(t);
    const iso = parseDateInput(t);
    if (iso || t === "") commitText(t, false);
  };

  const openCal = () => {
    const b = value || today || base;
    setView([Number(b.slice(0, 4)), Number(b.slice(5, 7))]);
    setFocusIso(value && inRange(value, min, max) ? value : b);
    setOpen(true);
  };
  const pick = (iso: string) => { if (!inRange(iso, min, max)) return; setText(isoToTr(iso)); setLocalErr(null); emit(iso); setOpen(false); };

  const moveFocus = (iso: string) => {
    setFocusIso(iso);
    setView([Number(iso.slice(0, 4)), Number(iso.slice(5, 7))]);
  };
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const map: Record<string, () => void> = {
      ArrowLeft: () => moveFocus(shiftDays(focusIso, -1)), ArrowRight: () => moveFocus(shiftDays(focusIso, 1)),
      ArrowUp: () => moveFocus(shiftDays(focusIso, -7)), ArrowDown: () => moveFocus(shiftDays(focusIso, 7)),
      PageUp: () => { const [y, m] = addMonths(view[0], view[1], -1); moveFocus(`${y}-${pad(m)}-${pad(Math.min(Number(focusIso.slice(8)), daysIn(y, m)))}`); },
      PageDown: () => { const [y, m] = addMonths(view[0], view[1], 1); moveFocus(`${y}-${pad(m)}-${pad(Math.min(Number(focusIso.slice(8)), daysIn(y, m)))}`); },
      Home: () => moveFocus(shiftDays(focusIso, -((weekday(focusIso) + 6) % 7))),
      End: () => moveFocus(shiftDays(focusIso, 6 - ((weekday(focusIso) + 6) % 7))),
      Enter: () => pick(focusIso), " ": () => pick(focusIso),
      Escape: () => { setOpen(false); document.getElementById(id)?.focus(); },
    };
    const fn = map[e.key];
    if (fn) { e.preventDefault(); if (e.key === "Escape") e.stopPropagation(); fn(); } // Esc yalnız takvimi kapatır, çekmeceyi değil
  };

  const [vy, vm] = view;
  const first = new Date(Date.UTC(vy, vm - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Pazartesi başlangıç
  const n = daysIn(vy, vm);
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${vy}-${pad(vm)}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const shownErr = error ?? localErr ?? undefined;
  const labelId = `${id}-l`;

  return (
    <div className={`field date-field ${className ?? ""}`} ref={wrapRef} style={style}>
      <label htmlFor={id} id={labelId} className={hideLabel ? "sr-only" : undefined}>{label}{required && <span className="req" aria-hidden>*</span>}</label>
      <div className="date-field-row">
        <input id={id} className="input" type="text" inputMode="numeric" autoComplete="off" placeholder="gg.aa.yyyy" value={text} disabled={disabled}
          aria-invalid={!!shownErr} aria-required={required} aria-describedby={shownErr ? `${id}-e` : hint ? `${id}-h` : undefined}
          onChange={onInput} onBlur={(e) => commitText(e.target.value, true)}
          onKeyDown={(e) => { if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); openCal(); } }} />
        <button type="button" className="btn btn-ghost btn-icon date-field-btn" aria-label="Takvimi aç" aria-describedby={labelId} aria-expanded={open} aria-haspopup="dialog" disabled={disabled}
          onClick={() => (open ? setOpen(false) : openCal())}><CalendarIcon size={18} aria-hidden /></button>
      </div>
      {open && (
        <div className="date-pop" role="dialog" aria-label={`${label} takvimi`} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); document.getElementById(id)?.focus(); } }}>
          <div className="date-pop-head">
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Önceki ay" onClick={() => setView(addMonths(vy, vm, -1))}><ChevronLeft size={16} aria-hidden /></button>
            <strong aria-live="polite">{MONTHS[vm - 1]} {vy}</strong>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Sonraki ay" onClick={() => setView(addMonths(vy, vm, 1))}><ChevronRight size={16} aria-hidden /></button>
          </div>
          <div className="date-grid" role="grid" aria-labelledby={labelId} ref={gridRef} onKeyDown={onGridKey}>
            <div role="row" className="date-grid-row">{DAYS.map((d) => <div key={d} role="columnheader" className="date-dow" aria-label={d}>{d}</div>)}</div>
            {Array.from({ length: cells.length / 7 }, (_, r) => (
              <div role="row" className="date-grid-row" key={r}>
                {cells.slice(r * 7, r * 7 + 7).map((iso, i) => iso ? (
                  <button key={iso} type="button" role="gridcell" data-iso={iso} tabIndex={iso === focusIso ? 0 : -1}
                    className={`date-day${iso === value ? " is-selected" : ""}${iso === today ? " is-today" : ""}`}
                    aria-selected={iso === value} aria-label={isoToTr(iso)} disabled={!inRange(iso, min, max)}
                    onClick={() => pick(iso)} onFocus={() => setFocusIso(iso)}>{Number(iso.slice(8))}</button>
                ) : <div key={`e${i}`} role="gridcell" aria-hidden className="date-day is-empty" />)}
              </div>
            ))}
          </div>
          <div className="date-pop-foot">
            {today && <button type="button" className="btn btn-sm btn-ghost" disabled={!inRange(today, min, max)} onClick={() => pick(today)}>Bugün</button>}
            {!required && value && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setText(""); setLocalErr(null); emit(""); setOpen(false); }}>Temizle</button>}
          </div>
        </div>
      )}
      {hint && !shownErr && <span className="hint" id={`${id}-h`}>{hint}</span>}
      {shownErr && <span className="err" id={`${id}-e`}><AlertCircle size={14} aria-hidden />{shownErr}</span>}
    </div>
  );
}

function daysIn(y: number, m: number) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function weekday(iso: string) { const [y, m, d] = iso.split("-").map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
