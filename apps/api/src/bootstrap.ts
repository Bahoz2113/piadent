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
  });
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");
  app.use(cookieParser());
  app.useBodyParser("json", { limit: "256kb" });
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
