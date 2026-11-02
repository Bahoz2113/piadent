import { Body, Controller, Get, HttpCode, Inject, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { Appearance, normalizeAppearance } from "@viadent/contracts";
import { NoTenant } from "./decorators.js";
import { Db } from "../infra/db.service.js";
import { Errors, parse } from "../infra/errors.js";

/** Görünüm tercihi (ADR-082): kullanıcıya ait, kiracıdan bağımsız; kişisel/sağlık verisi değildir, denetim kaydı gerektirmez. */
@Controller("me")
export class AppearanceController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @NoTenant()
  @Get("appearance")
  async get(@Req() req: Request) {
    const s = req.sessionInfo;
    if (!s) throw Errors.unauthenticated();
    const r = (await this.db.pool.query("select appearance from users where id = $1", [s.userId])).rows[0];
    return normalizeAppearance(r?.appearance);
  }

  @NoTenant()
  @Put("appearance")
  @HttpCode(200)
  async put(@Req() req: Request, @Body() body: unknown) {
    const s = req.sessionInfo;
    if (!s) throw Errors.unauthenticated();
    const a = parse(Appearance, body);
    await this.db.pool.query("update users set appearance = $2::jsonb where id = $1", [s.userId, JSON.stringify(a)]);
    return a;
  }
}
