/**
 * Demo ortamı işletim ucu (Görev 15, ADR-078): dışa açık demo kurulumunda migration + sentetik seed'i çalıştırır.
 * Yalnız VIADENT_DEMO_BOOTSTRAP=1 ve doğru OPS_TOKEN (sabit zamanlı karşılaştırma) ile; üretim kurulumunda kapalıdır (404).
 * Gerçek klinik verisi olan bir ortamda ASLA açılmaz: seed yalnız boş veritabanına yazar (kiracı varsa atlar); silme yok.
 */
import { timingSafeEqual } from "node:crypto";
import { Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import pg from "pg";
import { migrate, seed } from "@viadent/db";
import { Public } from "../auth/decorators.js";

const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

@Controller("ops")
export class OpsController {
  @Public()
  @Post("bootstrap")
  @HttpCode(200)
  async bootstrap(@Req() req: Request, @Res() res: Response) {
    const token = process.env.OPS_TOKEN ?? "";
    if (process.env.VIADENT_DEMO_BOOTSTRAP !== "1" || !token) { res.status(404).json({ code: "NOT_FOUND", message: "Adres bulunamadı." }); return; }
    if (!safeEqual(req.get("x-ops-token") ?? "", token)) { res.status(401).json({ code: "UNAUTHENTICATED", message: "Yetkisiz." }); return; }
    const url = process.env.MIGRATION_DATABASE_URL;
    if (!url) { res.status(500).json({ code: "CONFIG", message: "MIGRATION_DATABASE_URL yok." }); return; }
    const log: string[] = [];
    const applied = await migrate(url, (m) => log.push(String(m)));
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    let seeded = false;
    try {
      const n = (await c.query("select count(*)::int as n from tenants")).rows[0].n as number;
      if (n === 0) { await seed(url, { password: process.env.VIADENT_DEMO_PASSWORD || undefined, quiet: true }); seeded = true; }
    } finally { await c.end(); }
    res.json({ applied, seeded, log });
  }
}
