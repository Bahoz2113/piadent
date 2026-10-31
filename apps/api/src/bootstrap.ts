import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { json } from "express";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module.js";
import { observe } from "./infra/metrics.js";
import { sanitizeBody } from "./infra/sanitize.js";
import type { AppConfig } from "./config.js";

export async function createApp(config: AppConfig, opts: { logger?: boolean } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forConfig(config), {
    logger: opts.logger === false ? false : ["error", "warn", "log"],
    rawBody: true, // webhook imzası ham gövde üzerinden doğrulanır
  });
  // Ters vekil arkasında gerçek istemci IP'si (giriş sınırlayıcısı ve denetim için). Sayıysa hop sayısı.
  app.set("trust proxy", /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy.split(",").map((x) => x.trim()));
  app.disable("x-powered-by");
  app.use(cookieParser());
  // Webhook gövdesi JSON olarak ayrıştırılmadan ham alınır: imza ham bayt üzerinde doğrulanır, bozuk JSON da kayıtlı ret olur.
  app.use("/api/v1/webhooks", (req: Request & { rawBody?: Buffer; _body?: boolean }, res: Response, next: NextFunction) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (b: Buffer) => {
      size += b.length;
      if (size > 256 * 1024) { res.status(413).json({ code: "PAYLOAD_TOO_LARGE", message: "İstek gövdesi çok büyük." }); req.destroy(); return; }
      chunks.push(b);
    });
    req.on("end", () => { if (res.headersSent) return; req.rawBody = Buffer.concat(chunks); req.body = {}; req._body = true; next(); });
    req.on("error", next);
  });
  // İçe aktarma dosyası JSON gövdede metin olarak gelir (en çok 5 MB + kodlama payı); diğer uçlar 256 KB ile sınırlı.
  app.use("/api/v1/imports", json({ limit: "6mb" }));
  app.useBodyParser("json", { limit: "256kb" });
  // Dosya içeriği yalnız application/octet-stream ile ve 20 MB + pay sınırıyla kabul edilir (PUT /files/:id/content).
  app.useBodyParser("raw", { type: "application/octet-stream", limit: "21mb" });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const t0 = process.hrtime.bigint();
    res.on("finish", () => observe(req.method, res.statusCode, Number(process.hrtime.bigint() - t0) / 1e9));
    const incoming = req.get("x-correlation-id");
    req.correlationId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("x-correlation-id", req.correlationId);
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    // API yalnız JSON/CSV/dosya döner: hiçbir içerik çalıştırılmaz ve çerçeveye alınmaz.
    // (Dosya içeriği hariç: tarayıcının PDF görüntüleyicisi katı CSP altında açılmaz; o uç attachment/nosniff ile korunur.)
    if (!/\/files\/[^/]+\/content$/.test(req.path)) res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("cross-origin-resource-policy", "same-origin");
    if (config.production) res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    next();
  });
  app.use(sanitizeBody); // JSON ayrıştırıldıktan sonra, denetleyicilerden önce
  app.setGlobalPrefix("api/v1");
  return app;
}
