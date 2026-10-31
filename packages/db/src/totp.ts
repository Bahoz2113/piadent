/**
 * TOTP (RFC 6238, HMAC-SHA1, 30 sn, 6 hane) — Google Authenticator, Microsoft Authenticator vb. ile uyumlu.
 * Sır base32; veritabanında AES-256-GCM ile şifreli tutulur (encryptSecret). Saat kayması için ±1 adım tolerans.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string { return base32Encode(randomBytes(20)); }

export function totpAt(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

export const totpStep = (ms = Date.now()) => Math.floor(ms / 30_000);

/** Doğruysa eşleşen adımı döndürür (tekrar kullanım kontrolü için); yanlışsa null. */
export function verifyTotp(secretB32: string, code: string, ms = Date.now(), window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(ms);
  for (let d = -window; d <= window; d++) {
    const exp = Buffer.from(totpAt(secretB32, now + d));
    if (timingSafeEqual(exp, Buffer.from(code))) return now + d;
  }
  return null;
}

export function otpauthUri(secretB32: string, account: string, issuer = "VİADENT") {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
