import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module.js";
import type { AppConfig } from "./config.js";

export async function createApp(config: AppConfig, opts: { logger?: boolean } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forConfig(config), {
    logger: opts.logger === false ? false : ["error", "warn", "log"],
    rawBody: true, // webhook imzası ham gövde üzerinden doğrulanır
  });
  app.set("trust proxy", "loopback");
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
  app.useBodyParser("json", { limit: "256kb" });
  // Dosya içeriği yalnız application/octet-stream ile ve 20 MB + pay sınırıyla kabul edilir (PUT /files/:id/content).
  app.useBodyParser("raw", { type: "application/octet-stream", limit: "21mb" });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.get("x-correlation-id");
    req.correlationId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("x-correlation-id", req.correlationId);
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    next();
  });
  app.setGlobalPrefix("api/v1");
  return app;
}
