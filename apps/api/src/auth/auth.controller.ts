import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { LoginInput, MfaLogin, SwitchMembershipInput } from "@viadent/contracts";
import { AuthService } from "./auth.service.js";
import { NoTenant, Public } from "./decorators.js";
import { SESSION_COOKIE } from "./auth.guard.js";
import { CONFIG, type AppConfig } from "../config.js";
import { Errors, parse } from "../infra/errors.js";

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(CONFIG) private readonly config: AppConfig) {}

  @Public()
  @Get("health")
  health() {
    return { status: "ok" };
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
