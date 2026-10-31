/**
 * Yönetim → Güvenlik (Görev 10): klinik MFA politikası (ADR-058) ve süreli destek erişimi (ADR-061).
 * Destek erişimi: var olan bir kullanıcıya, en çok 72 saat, gerekçeli, salt okunur `support` rolüyle üyelik; süre dolunca
 * kendiliğinden geçersiz; yönetici erken kaldırabilir; her adım denetim kaydında. Sağlık içeriği ve kimlik açma yoktur.
 */
import { Body, Controller, Get, Inject, Post, Put } from "@nestjs/common";
import { ALL_ROLES, SupportGrant, TenantSecurityPolicy, ROLE_LABELS, type Role } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";
import { CONFIG, type AppConfig } from "../config.js";

@Controller("security")
export class SecurityController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(CONFIG) private readonly config: AppConfig) {}

  @Get("policy")
  @Require("settings.manage")
  policy(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const t = (await c.query("select require_mfa_roles from tenants where id = $1", [ctx.tenantId])).rows[0];
      return { requireMfaRoles: t.require_mfa_roles as string[], platformRequireMfaRoles: this.config.requireMfaRoles,
        roles: ALL_ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r as Role] })) };
    });
  }

  /** MFA zorunlu rolleri değiştir. Yönetici kendi rolünü zorunlu yaparken MFA'sı kapalıysa reddedilir (kendini kilitlemesin). */
  @Put("policy")
  @Require("settings.manage")
  setPolicy(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(TenantSecurityPolicy, body);
    const roles = [...new Set(i.requireMfaRoles)];
    return this.db.tx(ctx, async (c) => {
      if (roles.includes(ctx.role)) {
        const me = (await c.query("select (mfa_enabled_at is not null) as on from users where id = $1", [ctx.userId])).rows[0];
        if (!me?.on) throw new AppError(409, "MFA_SELF_LOCKOUT", "Önce kendi hesabınızda iki adımlı doğrulamayı açın; aksi halde bu ayar sizi dışarıda bırakır.");
      }
      const before = (await c.query("select require_mfa_roles from tenants where id = $1 for update", [ctx.tenantId])).rows[0].require_mfa_roles as string[];
      await c.query("update tenants set require_mfa_roles = $2 where id = $1", [ctx.tenantId, roles]);
      await audit(c, ctx, { action: "security.policy_update", entityType: "tenant", entityId: ctx.tenantId, changes: { require_mfa_roles: { from: before, to: roles } } });
      return { requireMfaRoles: roles };
    });
  }

  @Get("support-grants")
  @Require("team.manage")
  grants(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select m.id, u.email, u.full_name, m.created_at, m.expires_at, m.revoked_at, m.grant_reason, m.status
           from memberships m join users u on u.id = m.user_id where m.role = 'support' order by m.created_at desc limit 50`);
      return { items: r.rows.map((x) => ({ id: x.id, email: x.email, fullName: x.full_name, createdAt: x.created_at, expiresAt: x.expires_at, revokedAt: x.revoked_at,
        reason: x.grant_reason, active: x.status === "active" && new Date(x.expires_at) > new Date() })) };
    });
  }

  @Post("support-grants")
  @Require("team.manage")
  grant(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(SupportGrant, body);
    return this.db.tx(ctx, async (c) => {
      const u = (await c.query("select id, status from users where lower(email) = lower($1)", [i.email])).rows[0];
      if (!u || u.status !== "active") throw Errors.validation({ email: "Bu e-postayla etkin bir kullanıcı yok. Destek hesabı önce VİADENT tarafından açılmalıdır." });
      if (u.id === ctx.userId) throw new AppError(422, "CANNOT_GRANT_SELF", "Kendinize destek erişimi veremezsiniz.");
      const existing = (await c.query("select id, role, status from memberships where user_id = $1 and tenant_id = $2", [u.id, ctx.tenantId])).rows[0];
      if (existing && existing.status === "active" && existing.role !== "support") throw new AppError(409, "ALREADY_MEMBER", "Bu kullanıcı zaten kliniğin üyesi; destek erişimi gerekmez.");
      const expiresAt = new Date(Date.now() + i.hours * 3600_000);
      let id: string;
      if (existing) {
        id = existing.id;
        await c.query("update memberships set status = 'active', revoked_at = null, role = 'support', expires_at = $2, grant_reason = $3 where id = $1", [id, expiresAt, i.reason]);
      } else {
        id = (await c.query("insert into memberships(tenant_id, user_id, role, expires_at, grant_reason) values ($1,$2,'support',$3,$4) returning id", [ctx.tenantId, u.id, expiresAt, i.reason])).rows[0].id;
      }
      await audit(c, ctx, { action: "support.grant", entityType: "membership", entityId: id,
        changes: { email: { from: null, to: i.email.toLowerCase() }, hours: { from: null, to: i.hours }, expires_at: { from: null, to: expiresAt.toISOString() }, reason: { from: null, to: i.reason } } });
      return { id, expiresAt };
    });
  }
}
