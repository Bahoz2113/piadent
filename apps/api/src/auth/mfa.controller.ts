/**
 * Hesabım: iki adımlı doğrulama (TOTP) kurulumu. Klinik bağlamı gerektirmez (NoTenant) — böylece MFA zorunlu rolde
 * henüz kurulmamış kullanıcı kurulumu tamamlayabilir. Sır yalnız kurulumda bir kez gösterilir; şifreli saklanır.
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { MfaCode, PasswordChange, passwordProblem } from "@viadent/contracts";
import { decryptSecret, encryptSecret, hashPassword, newTotpSecret, otpauthUri, verifyPassword, verifyTotp } from "@viadent/db";
import { clearFails, isLocked, recordFail } from "./rate-limit.js";
import { NoTenant } from "./decorators.js";
import { AuthService } from "./auth.service.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import { CONFIG, type AppConfig } from "../config.js";

@Controller("me")
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

  /** Kod denemeleri sınırlı (kullanıcı başına 5 / 15 dk): ele geçirilmiş oturumla 6 haneli kod taranamaz. */
  private async guardCode(userId: string, ok: () => boolean | Promise<boolean>): Promise<void> {
    const key = `mfa-code|${userId}`;
    if (await isLocked(this.db.pool, key)) throw new AppError(429, "TOO_MANY_ATTEMPTS", "Çok sayıda hatalı kod. 15 dakika sonra tekrar deneyin.");
    if (!(await ok())) { await recordFail(this.db.pool, key); throw Errors.validation({ code: "Kod hatalı. Telefon saatinin doğru olduğundan emin olun." }); }
    await clearFails(this.db.pool, key);
  }

  private async required(req: Request) {
    const s = req.sessionInfo!;
    const ms = await this.auth.listMemberships(s.userId);
    return ms.some((m) => this.config.requireMfaRoles.includes(m.role));
  }

  @NoTenant()
  @Get("mfa")
  async status(@Req() req: Request) {
    const u = (await this.db.pool.query("select mfa_enabled_at, (mfa_pending_enc is not null) as pending from users where id = $1", [req.sessionInfo!.userId])).rows[0];
    return { enabled: !!u.mfa_enabled_at, enabledAt: u.mfa_enabled_at, pending: u.pending, required: await this.required(req) };
  }

  @NoTenant()
  @Post("mfa/setup")
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
  @Post("mfa/enable")
  @HttpCode(200)
  async enable(@Req() req: Request, @Body() body: unknown) {
    const { code } = parse(MfaCode, body);
    const s = req.sessionInfo!;
    const u = (await this.db.pool.query("select mfa_pending_enc, mfa_enabled_at from users where id = $1", [s.userId])).rows[0];
    if (u.mfa_enabled_at) throw new AppError(409, "MFA_ALREADY_ENABLED", "İki adımlı doğrulama zaten açık.");
    if (!u.mfa_pending_enc) throw new AppError(409, "MFA_SETUP_REQUIRED", "Önce kurulumu başlatın.");
    let step: number | null = null;
    await this.guardCode(s.userId, () => (step = verifyTotp(decryptSecret(u.mfa_pending_enc), code)) !== null);
    await this.db.pool.query("update users set mfa_secret_enc = mfa_pending_enc, mfa_pending_enc = null, mfa_enabled_at = now(), mfa_last_step = $2 where id = $1", [s.userId, step]);
    await this.auditSelf(req, "mfa.enable");
    return { enabled: true };
  }

  @NoTenant()
  @Post("mfa/disable")
  @HttpCode(200)
  async disable(@Req() req: Request, @Body() body: unknown) {
    const { code } = parse(MfaCode, body);
    const s = req.sessionInfo!;
    if (await this.required(req)) throw new AppError(409, "MFA_REQUIRED_BY_POLICY", "Rolünüz için iki adımlı doğrulama zorunlu; kapatılamaz.");
    const u = (await this.db.pool.query("select mfa_secret_enc from users where id = $1", [s.userId])).rows[0];
    if (!u.mfa_secret_enc) throw new AppError(409, "MFA_NOT_ENABLED", "İki adımlı doğrulama kapalı.");
    await this.guardCode(s.userId, () => verifyTotp(decryptSecret(u.mfa_secret_enc), code) !== null);
    await this.db.pool.query("update users set mfa_secret_enc = null, mfa_enabled_at = null, mfa_last_step = null where id = $1", [s.userId]);
    await this.auditSelf(req, "mfa.disable");
    return { enabled: false };
  }

  /** Açık oturumlar (bu cihaz işaretli): kullanıcı tanımadığı oturumu görüp hepsini kapatabilir. Belirteç gösterilmez. */
  @NoTenant()
  @Get("sessions")
  async sessions(@Req() req: Request) {
    const s = req.sessionInfo!;
    const r = await this.db.pool.query(
      "select id, created_at, last_seen_at, expires_at from sessions where user_id = $1 and revoked_at is null and expires_at > now() order by last_seen_at desc", [s.userId]);
    return { items: r.rows.map((x) => ({ id: x.id, createdAt: x.created_at, lastSeenAt: x.last_seen_at, expiresAt: x.expires_at, current: x.id === s.sessionId })) };
  }

  /** Bu cihaz dışındaki tüm oturumları kapat. */
  @NoTenant()
  @Post("sessions/revoke-others")
  @HttpCode(200)
  async revokeOthers(@Req() req: Request) {
    const s = req.sessionInfo!;
    const r = await this.db.pool.query("update sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null", [s.userId, s.sessionId]);
    await this.auditSelf(req, "session.revoke_others");
    return { revoked: r.rowCount ?? 0 };
  }

  /** Parola değişikliği: mevcut parola (+ MFA açıksa kod) ile. Diğer tüm oturumlar kapatılır (ADR-056). */
  @NoTenant()
  @Post("password")
  @HttpCode(200)
  async changePassword(@Req() req: Request, @Body() body: unknown) {
    const i = parse(PasswordChange, body);
    const s = req.sessionInfo!;
    const key = `pw-change|${s.userId}`;
    if (await isLocked(this.db.pool, key)) throw new AppError(429, "TOO_MANY_ATTEMPTS", "Çok sayıda hatalı deneme. 15 dakika sonra tekrar deneyin.");
    const u = (await this.db.pool.query("select password_hash, mfa_secret_enc from users where id = $1", [s.userId])).rows[0];
    if (!(await verifyPassword(i.currentPassword, u.password_hash))) { await recordFail(this.db.pool, key); throw Errors.validation({ currentPassword: "Mevcut parola hatalı." }); }
    if (u.mfa_secret_enc) {
      if (!i.code) throw Errors.validation({ code: "İki adımlı doğrulama kodu gerekli." });
      if (verifyTotp(decryptSecret(u.mfa_secret_enc), i.code) === null) { await recordFail(this.db.pool, key); throw Errors.validation({ code: "Kod hatalı." }); }
    }
    await clearFails(this.db.pool, key);
    const weak = passwordProblem(i.newPassword, { email: s.email, name: s.userName });
    if (weak) throw Errors.validation({ newPassword: weak });
    await this.db.pool.query("update users set password_hash = $2, password_changed_at = now(), must_change_password = false where id = $1", [s.userId, await hashPassword(i.newPassword)]);
    // Diğer oturumlar kapanır (parola sızdıysa saldırganın oturumu da düşer); bu oturum kalır.
    await this.db.pool.query("update sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null", [s.userId, s.sessionId]);
    await this.auditSelf(req, "password.change");
    return { ok: true };
  }
}
