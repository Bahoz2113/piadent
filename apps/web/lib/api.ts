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

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { accept: "application/json" };
  if (pageContext) headers["x-viadent-context"] = pageContext;
  if (method !== "GET") {
    headers["x-viadent-request"] = "1";
    headers["content-type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined, credentials: "same-origin", signal: init.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    // Bağlantı yokken kayıt başarılı gibi gösterilmez (Plan §01).
    const f = new ApiFailure(0, { code: "NETWORK", message: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin; işlem kaydedilmedi." });
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
