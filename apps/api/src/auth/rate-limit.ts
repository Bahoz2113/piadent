/**
 * Basit bellek içi giriş denemesi sınırlayıcı (tek süreç). Çok örnekli dağıtımda
 * paylaşılan depoya taşınmalı — docs/decisions.md ADR-007.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const fails = new Map<string, { count: number; first: number }>();

export function isLocked(key: string, now = Date.now()): boolean {
  const e = fails.get(key);
  if (!e) return false;
  if (now - e.first > WINDOW_MS) {
    fails.delete(key);
    return false;
  }
  return e.count >= MAX_FAILS;
}

export function recordFail(key: string, now = Date.now()) {
  const e = fails.get(key);
  if (!e || now - e.first > WINDOW_MS) fails.set(key, { count: 1, first: now });
  else e.count++;
}

export function clearFails(key: string) {
  fails.delete(key);
}

export function resetRateLimiter() {
  fails.clear();
}
