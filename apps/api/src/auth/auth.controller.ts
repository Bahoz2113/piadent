import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { LoginInput, MfaLogin, SwitchMembershipInput } from "@viadent/contracts";
import { AuthService } from "./auth.service.js";
import { NoTenant, Public } from "./decorators.js";
import { SESSION_COOKIE } from "./auth.guard.js";
import { CONFIG, type AppConfig } from "../config.js";
import { Errors, parse } from "../infra/errors.js";
import { Db } from "../infra/db.service.js";
import { render } from "../infra/metrics.js";
import { timingSafeEqual } from "node:crypto";

const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(CONFIG) private readonly config: AppConfig, @Inject(Db) private readonly db: Db) {}

  /** Canlılık: süreç ayakta (DB'ye bakmaz; yük dengeleyici yeniden başlatma kararı için). */
  @Public()
  @Get("health")
  health() {
    return { status: "ok", version: this.config.version };
  }

  /** Hazır olma: veritabanı erişilebilir ve şema güncel mi (son migration adı). Trafik yönlendirme kararı için. */
  @Public()
  @Get("health/ready")
  async ready(@Res({ passthrough: true }) res: Response) {
    try {
      const r = await Promise.race([
        this.db.pool.query("select 1"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("zaman aşımı")), 2000)),
      ]);
      void r;
      return { status: "ready", db: "ok", version: this.config.version };
    } catch {
      res.status(503);
      return { status: "not_ready", db: "unreachable", version: this.config.version };
    }
  }

  /** Prometheus metrikleri; METRICS_TOKEN tanımlı değilse uç yok sayılır (404). */
  @Public()
  @Get("metrics")
  metrics(@Req() req: Request, @Res() res: Response) {
    const tok = this.config.metricsToken;
    const given = (req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!tok) { res.status(404).json({ code: "NOT_FOUND", message: "Adres bulunamadı." }); return; }
    if (!safeEqual(given, tok)) { res.status(401).json({ code: "UNAUTHENTICATED", message: "Yetkisiz." }); return; }
    res.setHeader("content-type", "text/plain; version=0.0.4");
    res.send(render(this.db.pool, this.config.version));
  }

  @Public()
  @Post("auth/login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = parse(LoginInput, body);
    const r = await this.auth.login(input.email, input.password, req.ip ?? "-");
    if ("mfaChallenge" in r) return { ok: false, mfaRequired: true, challenge: r.mfaChallenge };
    this.setCookie(res, r.token, r.expiresAt);
    return { ok: true };
  }

  @Public()
  @Post("auth/mfa")
  @HttpCode(200)
  async mfa(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const i = parse(MfaLogin, body);
    const r = await this.auth.verifyMfaLogin(i.challenge, i.code);
    this.setCookie(res, r.token, r.expiresAt);
    return { ok: true };
  }

  private setCookie(res: Response, token: string, expiresAt: Date) {
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: this.config.production, path: "/", expires: expiresAt });
  }

  @Public()
  @Post("auth/logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string") await this.auth.logout(token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  @NoTenant()
  @Get("session")
  async session(@Req() req: Request) {
    const s = req.sessionInfo!;
    const memberships = await this.auth.listMemberships(s.userId);
    const active = s.activeMembershipId ? memberships.find((m) => m.id === s.activeMembershipId) ?? null : null;
    return this.auth.describe({ ...s, lastSeenAt: new Date() }, active, memberships);
  }

  @NoTenant()
  @Post("session/switch")
  @HttpCode(200)
  async switch(@Body() body: unknown, @Req() req: Request) {
    const s = req.sessionInfo;
    if (!s) throw Errors.unauthenticated();
    const { membershipId } = parse(SwitchMembershipInput, body);
    const m = await this.auth.switchMembership(s.sessionId, s.userId, membershipId);
    const memberships = await this.auth.listMemberships(s.userId);
    return this.auth.describe({ ...s, activeMembershipId: m.id, lastSeenAt: new Date() }, m, memberships);
  }
}
