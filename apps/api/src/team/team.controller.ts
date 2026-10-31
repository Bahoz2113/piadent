import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { InvitationCreate, MembershipRevoke, PasswordReset, RoleChange, ROLE_LABELS, type Role } from "@viadent/contracts";
import { hashPassword, newSessionToken } from "@viadent/db";
import { randomBytes } from "node:crypto";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";
import { AuthService } from "../auth/auth.service.js";

const mId = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound("Üyelik") });

@Controller("team")
export class TeamController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  @Require("team.manage")
  list(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select m.id, m.role, m.status, m.created_at, m.revoked_at, u.full_name, u.email, (u.mfa_enabled_at is not null) as mfa
           from memberships m join users u on u.id = m.user_id
          where m.tenant_id = $1 order by m.status, u.full_name`,
        [ctx.tenantId],
      );
      return {
        items: r.rows.map((m) => ({
          id: m.id, role: m.role as Role, roleLabel: ROLE_LABELS[m.role as Role], status: m.status,
          fullName: m.full_name, email: m.email, createdAt: m.created_at, revokedAt: m.revoked_at, isSelf: m.id === ctx.membershipId, mfaEnabled: m.mfa,
        })),
      };
    });
  }

  /** Rol değişikliği: üyelik her istekte okunduğundan bir sonraki istekte geçerlidir. */
  @Post(":id/role")
  @HttpCode(200)
  @Require("team.manage")
  changeRole(@Ctx() ctx: RequestContext, @Param("id", mId) id: string, @Body() body: unknown) {
    const { role } = parse(RoleChange, body);
    if (id === ctx.membershipId) throw new AppError(422, "CANNOT_CHANGE_SELF", "Kendi rolünüzü değiştiremezsiniz.");
    return this.db.tx(ctx, async (c) => {
      const cur = await c.query("select role from memberships where id = $1 and tenant_id = $2 and status = 'active' for update", [id, ctx.tenantId]);
      if (!cur.rowCount) throw Errors.notFound("Üyelik");
      if (cur.rows[0].role === role) return { ok: true };
      await c.query("update memberships set role = $2 where id = $1", [id, role]);
      await audit(c, ctx, { action: "membership.role", entityType: "membership", entityId: id, changes: { role: { from: cur.rows[0].role, to: role } } });
      return { ok: true };
    });
  }

  @Get("invitations")
  @Require("team.manage")
  invitations(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select i.id, i.email, i.full_name, i.role, i.expires_at, i.created_at, u.full_name as created_by
           from invitations i join users u on u.id = i.created_by
          where i.accepted_at is null and i.revoked_at is null and i.expires_at > now() order by i.created_at desc`,
      );
      return { items: r.rows.map((i) => ({ id: i.id, email: i.email, fullName: i.full_name, role: i.role, roleLabel: ROLE_LABELS[i.role as Role],
        expiresAt: i.expires_at, createdAt: i.created_at, createdBy: i.created_by })) };
    });
  }

  /**
   * Davet oluşturur. E-posta sağlayıcısı bağlı olmadığından mesaj GÖNDERİLMEZ; tek kullanımlık
   * bağlantı yalnız bu yanıtta bir kez döner ve yönetici tarafından güvenli kanaldan iletilir.
   */
  @Post("invitations")
  @Require("team.manage")
  invite(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const input = parse(InvitationCreate, body);
    return this.db.tx(ctx, async (c) => {
      const member = await c.query(
        "select 1 from memberships m join users u on u.id = m.user_id where m.status = 'active' and lower(u.email) = lower($1)",
        [input.email],
      );
      if (member.rowCount) throw new AppError(409, "ALREADY_MEMBER", "Bu e-postayla etkin bir ekip üyesi zaten var.", { email: "Zaten ekipte." });
      const { token, hash } = newSessionToken();
      const expiresAt = new Date(Date.now() + 72 * 3600_000);
      try {
        const r = await c.query(
          "insert into invitations(tenant_id, email, full_name, role, token_hash, expires_at, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
          [ctx.tenantId, input.email.toLowerCase(), input.fullName, input.role, hash, expiresAt, ctx.userId],
        );
        await audit(c, ctx, { action: "invitation.create", entityType: "invitation", entityId: r.rows[0].id,
          changes: { role: { from: null, to: input.role } } });
        return { id: r.rows[0].id, acceptPath: `/davet/${token}`, expiresAt, delivery: "manual" };
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new AppError(409, "INVITATION_EXISTS", "Bu e-postaya açık bir davet zaten var. Önce iptal edin.", { email: "Açık davet var." });
        throw e;
      }
    });
  }

  @Post("invitations/:id/revoke")
  @HttpCode(200)
  @Require("team.manage")
  revokeInvitation(@Ctx() ctx: RequestContext, @Param("id", mId) id: string) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query("update invitations set revoked_at = now() where id = $1 and accepted_at is null and revoked_at is null returning id", [id]);
      if (!r.rowCount) throw Errors.notFound("Davet");
      await audit(c, ctx, { action: "invitation.revoke", entityType: "invitation", entityId: id });
      return { ok: true };
    });
  }

  /** Erişim kaldırma: açık oturumlar bir sonraki istekte reddedilir (AT-20). */
  @Post(":id/revoke")
  @HttpCode(200)
  @Require("team.manage")
  revoke(@Ctx() ctx: RequestContext, @Param("id", mId) id: string, @Body() body: unknown) {
    const input = parse(MembershipRevoke, body ?? {});
    if (id === ctx.membershipId) throw new AppError(422, "CANNOT_REVOKE_SELF", "Kendi erişiminizi kaldıramazsınız.");
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        "update memberships set status = 'revoked', revoked_at = now() where id = $1 and tenant_id = $2 and status = 'active' returning user_id",
        [id, ctx.tenantId],
      );
      if (!r.rowCount) throw Errors.notFound("Üyelik");
      await audit(c, ctx, { action: "membership.revoke", entityType: "membership", entityId: id,
        changes: { status: { from: "active", to: "revoked" }, ...(input.reason ? { reason: { from: null, to: input.reason } } : {}) } });
      return { ok: true };
    });
  }

  /** Kaybolan doğrulayıcı: yönetici başka bir üyenin MFA'sını sıfırlar; kullanıcının tüm oturumları kapanır, yeniden kurması gerekir. */
  @Post(":id/mfa-reset")
  @HttpCode(200)
  @Require("team.manage")
  mfaReset(@Ctx() ctx: RequestContext, @Param("id", mId) id: string, @Body() body: unknown) {
    const input = parse(MembershipRevoke, body ?? {});
    if (id === ctx.membershipId) throw new AppError(422, "CANNOT_RESET_SELF", "Kendi doğrulayıcınızı Hesabım sayfasından yönetin; sıfırlama başka bir yönetici tarafından yapılır.");
    if (!input.reason) throw Errors.validation({ reason: "Gerekçe gerekli (kimlik doğrulaması nasıl yapıldı?)." });
    return this.db.tx(ctx, async (c) => {
      const m = (await c.query("select user_id from memberships where id = $1 and tenant_id = $2 and status = 'active'", [id, ctx.tenantId])).rows[0];
      if (!m) throw Errors.notFound("Üyelik");
      // Kullanıcı başka bir klinikte de üyeyse tek klinik yöneticisi onun hesabının güvenliğini düşüremez (platform destek süreci).
      const others = (await this.auth.listMemberships(m.user_id)).filter((x) => x.tenantId !== ctx.tenantId);
      if (others.length) throw new AppError(409, "MFA_RESET_MULTI_CLINIC", "Bu kullanıcı başka bir klinikte de üye; doğrulayıcı sıfırlaması VİADENT destek süreciyle (kimlik doğrulamalı) yapılır.");
      await c.query("update users set mfa_secret_enc = null, mfa_pending_enc = null, mfa_enabled_at = null, mfa_last_step = null where id = $1", [m.user_id]);
      await c.query("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [m.user_id]);
      await audit(c, ctx, { action: "mfa.reset", entityType: "membership", entityId: id, changes: { mfa: { from: true, to: false }, reason: { from: null, to: input.reason } } });
      return { ok: true };
    });
  }

  /**
   * Parola sıfırlama (yönetici): kimlik yüz yüze/telefonla doğrulandıktan sonra tek kullanımlık geçici parola üretilir, yalnız bir kez
   * gösterilir, kullanıcının tüm oturumları kapanır ve ilk girişte parola değiştirmesi zorunludur. Kendi parolası Hesabım'dan.
   */
  @Post(":id/password-reset")
  @HttpCode(200)
  @Require("team.manage")
  passwordReset(@Ctx() ctx: RequestContext, @Param("id", mId) id: string, @Body() body: unknown) {
    const input = parse(PasswordReset, body ?? {});
    if (id === ctx.membershipId) throw new AppError(422, "CANNOT_RESET_SELF", "Kendi parolanızı Hesabım sayfasından değiştirin.");
    return this.db.tx(ctx, async (c) => {
      const m = (await c.query("select user_id from memberships where id = $1 and tenant_id = $2 and status = 'active'", [id, ctx.tenantId])).rows[0];
      if (!m) throw Errors.notFound("Üyelik");
      const others = (await this.auth.listMemberships(m.user_id)).filter((x) => x.tenantId !== ctx.tenantId);
      if (others.length) throw new AppError(409, "PASSWORD_RESET_MULTI_CLINIC", "Bu kullanıcı başka bir klinikte de üye; parola sıfırlaması VİADENT destek süreciyle yapılır.");
      const temp = `gecici-${randomBytes(9).toString("base64url")}`;
      await c.query("update users set password_hash = $2, must_change_password = true where id = $1", [m.user_id, await hashPassword(temp)]);
      await c.query("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [m.user_id]);
      await audit(c, ctx, { action: "password.reset", entityType: "membership", entityId: id, changes: { reason: { from: null, to: input.reason } } });
      return { temporaryPassword: temp, note: "Geçici parola yalnız şimdi gösterilir; kullanıcıya güvenli kanaldan iletin. İlk girişte değiştirmesi zorunludur." };
    });
  }
}
