/**
 * Gövde temizliği (güvenlik denetimi bulgusu). Tüm JSON metin alanlarında:
 *  - NUL ve diğer C0/C1 kontrol karakterleri (\t \n \r hariç) → 422 (PostgreSQL NUL kabul etmez → 500 oluyordu; kontrol karakteri
 *    hiçbir alanda meşru değildir).
 *  - Görünmez biçim karakterleri (sıfır genişlik, yön değiştirme U+202A–E / U+2066–69, BOM) → sessizce kaldırılır: ad/soyad gibi
 *    alanlarda görsel aldatma (ters yazım, boşluk gibi görünen ad) ve arama kaçışı önlenir. CSV içeriğindeki BOM de kaldırılır
 *    (ayrıştırıcı zaten BOM'suz okur).
 * Derinlik ve anahtar sayısı sınırlı: iç içe geçmiş devasa gövde CPU tüketemez.
 */
import type { NextFunction, Request, Response } from "express";

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const MAX_DEPTH = 12, MAX_KEYS = 5000;

export class BodyRejected extends Error { constructor(public readonly reason: "control_char" | "too_deep" | "too_many_keys") { super(reason); } }

export function sanitizeValue(v: unknown, depth = 0, counter = { n: 0 }): unknown {
  if (depth > MAX_DEPTH) throw new BodyRejected("too_deep");
  if (typeof v === "string") {
    if (CONTROL.test(v)) throw new BodyRejected("control_char");
    return v.replace(INVISIBLE, "");
  }
  if (Array.isArray(v)) return v.map((x) => sanitizeValue(x, depth + 1, counter));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (++counter.n > MAX_KEYS) throw new BodyRejected("too_many_keys");
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      if (CONTROL.test(k)) throw new BodyRejected("control_char");
      out[k.replace(INVISIBLE, "")] = sanitizeValue(x, depth + 1, counter);
    }
    return out;
  }
  return v;
}

export function sanitizeBody(req: Request, res: Response, next: NextFunction) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    try { req.body = sanitizeValue(req.body); }
    catch (e) {
      if (e instanceof BodyRejected) {
        const msg = e.reason === "control_char" ? "Metin alanlarında kontrol karakteri bulunamaz." : "İstek gövdesi çok karmaşık.";
        res.status(422).json({ code: "VALIDATION_FAILED", message: msg, correlation_id: req.correlationId });
        return;
      }
      throw e;
    }
  }
  // Sorgu dizesi: kontrol karakteri içeren parametre yok sayılır (okuma uçları; 500 yerine güvenli kırpma)
  for (const [k, v] of Object.entries(req.query)) if (typeof v === "string" && CONTROL.test(v)) delete (req.query as Record<string, unknown>)[k];
  next();
}
