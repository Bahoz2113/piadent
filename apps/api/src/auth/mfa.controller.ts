/**
 * Hesabım: iki adımlı doğrulama (TOTP) kurulumu. Klinik bağlamı gerektirmez (NoTenant) — böylece MFA zorunlu rolde
 * henüz kurulmamış kullanıcı kurulumu tamamlayabilir. Sır yalnız kurulumda bir kez gösterilir; şifreli saklanır.
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { MfaCode } from "@viadent/contracts";
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUri, verifyTotp } from "@viadent/db";
import { NoTenant } from "./decorators.js";
import { AuthService } from "./auth.service.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import { CONFIG, type AppConfig } from "../config.js";

@Controller("me/mfa")
export class MfaController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AuthService) private readonly auth: AuthService, @Inject(CONFIG) private readonly config: AppConfig) {}

  private async auditSelf(req: Request, action: string) {
    const s = req.sessionInfo!;
    if (!s.activeMembershipId) return;
    const m = await this.auth.activeMembership(s.userId, s.activeMembershipId);
    if (!m) return;
    await this.db.tx({ tenantId: m.tenantId, userId: s.userId }, (c) =>
      c.query("insert into audit_events(tenant_id, actor_user_id, actor_membership_id, action, entity_type, entity_id) values ($1,$2,$3,$4,'user',$2)",
        [m.tenantId, s.userId, m.id, action]));
  }

  private async required(req: Request) {
    const s = req.sessionInfo!;
    const ms = await this.auth.listMemberships(s.userId);
    return ms.some((m) => this.config.requireMfaRoles.includes(m.role));
  }

  @NoTenant()
  @Get()
  async status(@Req() req: Request) {
    const u = (await this.db.pool.query("select mfa_enabled_at, (mfa_pending_enc is not null) as pending from users where id = $1", [req.sessionInfo!.userId])).rows[0];
    return { enabled: !!u.mfa_enabled_at, enabledAt: u.mfa_enabled_at, pending: u.pending, required: await this.required(req) };
  }

  @NoTenant()
  @Post("setup")
  @HttpCode(200)
  async setup(@Req() req: Request) {
    const s = req.sessionInfo!;
    const u = (await this.db.pool.query("select mfa_enabled_at from users where id = $1", [s.userId])).rows[0];
    if (u.mfa_enabled_at) throw new AppError(409, "MFA_ALREADY_ENABLED", "İki adımlı doğrulama zaten açık.");
    const secret = newTotpSecret();
    await this.db.pool.query("update users set mfa_pending_enc = $2 where id = $1", [s.userId, encryptSecret(secret)]);
    return { secret, otpauthUri: otpauthUri(secret, s.email), note: "Kodu doğrulayıcı uygulamaya ekleyin ve üretilen 6 haneli kodla etkinleştirin. Sır yalnız şimdi gösterilir." };
  }

  @NoTenant()
  @Post("enable")
  @HttpCode(200)
  async enable(@Req() req: Request, @Body() body: unknown) {
    const { code } = parse(MfaCode, body);
    const s = req.sessionInfo!;
    const u = (await this.db.pool.query("select mfa_pending_enc, mfa_enabled_at from users where id = $1", [s.userId])).rows[0];
    if (u.mfa_enabled_at) throw new AppError(409, "MFA_ALREADY_ENABLED", "İki adımlı doğrulama zaten açık.");
    if (!u.mfa_pending_enc) throw new AppError(409, "MFA_SETUP_REQUIRED", "Önce kurulumu başlatın.");
    const step = verifyTotp(decryptSecret(u.mfa_pending_enc), code);
    if (step === null) throw Errors.validation({ code: "Kod hatalı. Telefon saatinin doğru olduğundan emin olun." });
    await this.db.pool.query("update users set mfa_secret_enc = mfa_pending_enc, mfa_pending_enc = null, mfa_enabled_at = now(), mfa_last_step = $2 where id = $1", [s.userId, step]);
    await this.auditSelf(req, "mfa.enable");
    return { enabled: true };
  }

  @NoTenant()
  @Post("disable")
  @HttpCode(200)
  async disable(@Req() req: Request, @Body() body: unknown) {
    const { code } = parse(MfaCode, body);
    const s = req.sessionInfo!;
    if (await this.required(req)) throw new AppError(409, "MFA_REQUIRED_BY_POLICY", "Rolünüz için iki adımlı doğrulama zorunlu; kapatılamaz.");
    const u = (await this.db.pool.query("select mfa_secret_enc from users where id = $1", [s.userId])).rows[0];
    if (!u.mfa_secret_enc) throw new AppError(409, "MFA_NOT_ENABLED", "İki adımlı doğrulama kapalı.");
    if (verifyTotp(decryptSecret(u.mfa_secret_enc), code) === null) throw Errors.validation({ code: "Kod hatalı." });
    await this.db.pool.query("update users set mfa_secret_enc = null, mfa_enabled_at = null, mfa_last_step = null where id = $1", [s.userId]);
    await this.auditSelf(req, "mfa.disable");
    return { enabled: false };
  }
}
