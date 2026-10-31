/**
 * Serverless köprüsü (Görev 15, ADR-078): /api/v1/* istekleri aynı Vercel fonksiyonu içinde gömülü Nest/Express uygulamasına verilir.
 * Yalnız VIADENT_SERVERLESS=1 iken etkindir; klasik kurulumda next.config rewrites ayrı API sürecine yönlendirir ve bu dosya 404 döner.
 * Gövde ayrıştırma kapalı: ham gövde (webhook imzası, dosya içeriği) Nest'in kendi ayrıştırıcılarına gider.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

export const config = { api: { bodyParser: false, externalResolver: true, responseLimit: false }, maxDuration: 300 };

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
let api: Handler | null = null;
function load(): Handler {
  if (api) return api;
  // Paket çalışma zamanında diskten yüklenir (outputFileTracingIncludes ile fonksiyona dahil); yol dinamik olduğundan webpack gömmez.
  // webpack createRequire'ı ezdiğinden Node'un yerleşik modül erişimi kullanılır (Node ≥ 22.3).
  const nodeModule = (process as unknown as { getBuiltinModule(n: string): { createRequire(p: string): NodeRequire } }).getBuiltinModule("node:module");
  const nodeRequire = nodeModule.createRequire(join(process.cwd(), "package.json"));
  const mod = nodeRequire(join(process.cwd(), "vendor", "viadent-api.cjs")) as { default?: Handler } | Handler;
  api = (typeof mod === "function" ? mod : mod.default) as Handler;
  return api;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (process.env.VIADENT_SERVERLESS !== "1") { res.statusCode = 404; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ code: "NOT_FOUND", message: "Adres bulunamadı." })); return; }
  await load()(req, res);
}
