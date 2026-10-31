/**
 * Serverless giriş noktası (Görev 15, ADR-078): Nest/Express uygulaması tek sefer oluşturulur ve Node (req, res) çiftine verilir.
 * Worker ayrı süreç olarak koşamadığından "satır içi tik": her yazma isteğinden sonra kuyruk işlenir (koşarken gelen istekler bir tur daha tetikler), tarama ≥120 sn aralıkla.
 * Dosya deposu geçici diske yazılır (STORAGE_DIR); kalıcı nesne depolama adaptörü ayrı iş (deployment.md §8).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import pg from "pg";
import { guardPool, processIntegrationJobs } from "@viadent/db";
import { createApp } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { processOutbox, scanAllTenants } from "../../worker/src/jobs.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handlerP: Promise<Handler> | null = null;
let workerPool: pg.Pool | null = null;
let lastScan = 0, ticking = false, pending = false;

/** Vercel'de yanıt sonrası iş `waitUntil` ile canlı tutulur; başka ortamda düz çalışır. */
function keepAlive(p: Promise<unknown>) {
  try { (require("@vercel/functions") as { waitUntil(p: Promise<unknown>): void }).waitUntil(p); } catch { /* Vercel dışı */ }
}

async function tick() {
  if (ticking) { pending = true; return; } // koşan tur bitince bir tur daha (ara istekler kaybolmaz)
  ticking = true;
  try {
    const url = process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) return;
    if (!workerPool) guardPool((workerPool = new pg.Pool({ connectionString: url, max: 2, application_name: "viadent-inline-worker" })), "inline-worker");
    do {
      pending = false;
      for (let i = 0; i < 5; i++) { if ((await processOutbox(workerPool, 25)) + (await processIntegrationJobs(workerPool)) === 0) break; }
      if (Date.now() - lastScan > 120_000) { await scanAllTenants(workerPool); lastScan = Date.now(); }
    } while (pending);
  } catch (e) { console.error(`[inline-worker] ${(e as Error).message.slice(0, 200)}`); }
  finally { ticking = false; }
}

export function getHandler(): Promise<Handler> {
  handlerP ??= (async () => {
    const app = await createApp(loadConfig({ port: 0 }));
    await app.init();
    const express = app.getHttpAdapter().getInstance() as Handler;
    return (req, res) => {
      if (req.method && req.method !== "GET" && req.method !== "HEAD") res.on("finish", () => { keepAlive(tick()); });
      express(req, res);
    };
  })();
  return handlerP;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  (await getHandler())(req, res);
}
