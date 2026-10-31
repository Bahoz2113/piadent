import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { InvitationAccept, ROLE_LABELS, type Role } from "@viadent/contracts";
import { hashPassword, hashToken, verifyPassword, DUMMY_HASH } from "@viadent/db";
import { Public } from "../auth/decorators.js";
import { AuthService } from "../auth/auth.service.js";
import { SESSION_COOKIE } from "../auth/auth.guard.js";
import { clearFails, isLocked, recordFail } from "../auth/rate-limit.js";
import { CONFIG, type AppConfig } from "../config.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";

const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

/**
 * Davet kabulü (oturumsuz). Token yalnız özetiyle aranır; dar bir SECURITY DEFINER fonksiyonu
 * tenant'ı çözer, gerisi o tenant'ın RLS bağlamında yürür. Token tek kullanımlıktır.
 */
@Controller("invitations")
export class InvitationsController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AuthService) private readonly auth: AuthService, @Inject(CONFIG) private readonly config: AppConfig) {}

  private async resolve(token: string) {
    if (!TOKEN_RE.test(token)) return null;
    const hash = hashToken(token);
    const t = await this.db.pool.query("select app.invitation_tenant($1) as tenant_id", [hash]);
    const tenantId: string | null = t.rows[0]?.tenant_id ?? null;
    return tenantId ? { tenantId, hash } : null;
  }

  @Public()
  @Get(":token")
  async show(@Param("token") token: string) {
    const r = await this.resolve(token);
    if (!r) throw new AppError(404, "INVITATION_INVALID", "Davet bağlantısı geçersiz, kullanılmış veya süresi dolmuş.");
    return this.db.tx({ tenantId: r.tenantId, userId: null }, async (c) => {
      const i = await c.query(
        "select i.email, i.full_name, i.role, i.expires_at, t.name as tenant_name from invitations i join tenants t on t.id = i.tenant_id where i.token_hash = $1",
        [r.hash],
      );
      const inv = i.rows[0];
      const u = await this.db.pool.query("select 1 from users where lower(email) = lower($1)", [inv.email]);
      return { tenantName: inv.tenant_name, email: inv.email, fullName: inv.full_name, role: inv.role, roleLabel: ROLE_LABELS[inv.role as Role],
        expiresAt: inv.expires_at, userExists: !!u.rowCount };
    });
  }

  @Public()
  @Post(":token/accept")
  @HttpCode(200)
  async accept(@Param("token") token: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = parse(InvitationAccept, body);
    const r = await this.resolve(token);
    if (!r) throw new AppError(404, "INVITATION_INVALID", "Davet bağlantısı geçersiz, kullanılmış veya süresi dolmuş.");
    const result = await this.db.tx({ tenantId: r.tenantId, userId: null }, async (c) => {
      const i = await c.query(
        "select id, email, full_name, role from invitations where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now() for update",
        [r.hash],
      );
      const inv = i.rows[0];
      if (!inv) throw new AppError(404, "INVITATION_INVALID", "Davet bağlantısı geçersiz, kullanılmış veya süresi dolmuş.");
      const key = `${inv.email.toLowerCase()}|${req.ip ?? "-"}`;
      if (isLocked(key)) throw new AppError(429, "TOO_MANY_ATTEMPTS", "Çok sayıda hatalı deneme. 15 dakika sonra tekrar deneyin.");
      const existing = await c.query("select id, password_hash, status from users where lower(email) = lower($1)", [inv.email]);
      let userId: string;
      if (existing.rowCount) {
        // Var olan hesap: davet, hesabın mevcut parolasıyla kabul edilir (hesap sahipliği kanıtı).
        const ok = await verifyPassword(input.password, existing.rows[0].password_hash);
        if (!ok || existing.rows[0].status !== "active") {
          recordFail(key);
          throw new AppError(401, "INVALID_CREDENTIALS", "Bu e-postaya ait hesabın parolası hatalı.", { password: "Mevcut hesabınızın parolasını girin." });
        }
        clearFails(key);
        userId = existing.rows[0].id;
      } else {
        await verifyPassword(input.password, DUMMY_HASH);
        const u = await c.query("insert into users(email, password_hash, full_name) values ($1,$2,$3) returning id",
          [inv.email.toLowerCase(), await hashPassword(input.password), inv.full_name]);
        userId = u.rows[0].id;
      }
      await c.query("select set_config('app.user_id', $1, true)", [userId]);
      const m = await c.query("select id, status from memberships where tenant_id = $1 and user_id = $2 for update", [r.tenantId, userId]);
      let membershipId: string;
      if (m.rows[0]?.status === "active") throw new AppError(409, "ALREADY_MEMBER", "Bu klinikte zaten etkin bir üyeliğiniz var.");
      if (m.rowCount) {
        await c.query("update memberships set status = 'active', role = $2, revoked_at = null where id = $1", [m.rows[0].id, inv.role]);
        membershipId = m.rows[0].id;
      } else {
        const n = await c.query("insert into memberships(tenant_id, user_id, role) values ($1,$2,$3) returning id", [r.tenantId, userId, inv.role]);
        membershipId = n.rows[0].id;
      }
      await c.query("update invitations set accepted_at = now(), accepted_user_id = $2 where id = $1", [inv.id, userId]);
      await c.query(
        `insert into audit_events(tenant_id, actor_user_id, actor_membership_id, action, entity_type, entity_id, changes)
         values ($1,$2,$3,'invitation.accept','membership',$3,$4)`,
        [r.tenantId, userId, membershipId, JSON.stringify({ role: { from: null, to: inv.role } })],
      );
      return { userId, membershipId };
    });
    const { token: sessionToken, expiresAt } = await this.auth.createSession(result.userId, result.membershipId);
    res.cookie(SESSION_COOKIE, sessionToken, { httpOnly: true, sameSite: "lax", secure: this.config.production, path: "/", expires: expiresAt });
    return { ok: true };
  }
}
