"use client";
import type { ApiError } from "@viadent/contracts";

/** Sayfanın yüklendiği klinik bağlamı (eski sekme koruması, AT-15). */
let pageContext = "";
export function setPageContext(id: string) { pageContext = id; }
export function getPageContext() { return pageContext; }

type Listener = (e: ApiFailure) => void;
const listeners = new Set<Listener>();
export function onApiFailure(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; }

export class ApiFailure extends Error {
  constructor(public status: number, public body: ApiError) { super(body.message); }
  get code() { return this.body.code; }
  get fieldErrors() { return this.body.field_errors ?? {}; }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; idempotencyKey?: string } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { accept: "application/json" };
  if (pageContext) headers["x-viadent-context"] = pageContext;
  if (method !== "GET") {
    headers["x-viadent-request"] = "1";
    headers["content-type"] = "application/json";
  }
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined, credentials: "same-origin", signal: init.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    // Bağlantı yokken kayıt başarılı gibi gösterilmez (Plan §01).
    // Finans komutunda yanıt gelmediyse sonuç bilinmez: aynı anahtarla tekrar göndermek çift kayıt oluşturmaz (AT-06).
    const f = new ApiFailure(0, init.idempotencyKey
      ? { code: "NETWORK", message: "Sunucudan yanıt alınamadı; işlemin kaydedilip kaydedilmediği bilinmiyor. Aynı formdan tekrar gönderin — çift kayıt oluşmaz." }
      : { code: "NETWORK", message: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin; işlem kaydedilmedi." });
    listeners.forEach((l) => l(f));
    throw f;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const f = new ApiFailure(res.status, data ?? { code: "HTTP_ERROR", message: "İstek işlenemedi." });
    listeners.forEach((l) => l(f));
    throw f;
  }
  return data as T;
}

/** Form açıldığında bir kez üretilen tekilleştirme anahtarı: çift tıklama ve ağ tekrarında aynı işlem tek kayıt olur. */
export function newIdempotencyKey(): string {
  return `w-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

/**
 * Dosya indirme (CSV/JSON): sunucu attachment döner; tarayıcıda kaydedilir. POST gövdeli dışa aktarımlar da desteklenir.
 * 07.11.2026 ("dışa aktarım çalışmıyor"): bağlantı belgeye eklenip tıklanır (belgeye eklenmemiş bağlantıda bazı tarayıcılar ve
 * uygulama içi tarayıcılar indirmeyi sessizce yok sayıyordu); nesne adresi hemen kapatılmaz. Dönen `{ url, name }` ile ekran,
 * indirme başlamazsa kullanıcıya elle indirme bağlantısı gösterir.
 */
export async function saveBlob(blob: Blob, name: string): Promise<{ url: string; name: string }> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener"; a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); }, 0);
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
  return { url, name };
}

export async function download(path: string, init: { body?: unknown; fallbackName: string }): Promise<{ url: string; name: string }> {
  const headers: Record<string, string> = {};
  if (pageContext) headers["x-viadent-context"] = pageContext;
  if (init.body !== undefined) { headers["x-viadent-request"] = "1"; headers["content-type"] = "application/json"; }
  let r: Response;
  try {
    r = await fetch(`/api/v1${path}`, { method: init.body !== undefined ? "POST" : "GET", headers, credentials: "same-origin",
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  } catch {
    throw new ApiFailure(0, { code: "NETWORK", message: "Sunucuya ulaşılamadı; dosya indirilemedi. Bağlantınızı kontrol edip tekrar deneyin." });
  }
  if (!r.ok) {
    const b = await r.json().catch(() => ({ code: "HTTP_ERROR", message: r.status === 413 ? "Dosya çok büyük; indirilemedi." : `Dosya indirilemedi (HTTP ${r.status}).` }));
    throw new ApiFailure(r.status, b);
  }
  const blob = await r.blob();
  const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? init.fallbackName;
  return saveBlob(blob, name);
}
