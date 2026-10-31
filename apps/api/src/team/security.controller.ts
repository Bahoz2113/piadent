/**
 * Yönetim → Güvenlik (Görev 10): klinik MFA politikası (ADR-058) ve süreli destek erişimi (ADR-061).
 * Destek erişimi: var olan bir kullanıcıya, en çok 72 saat, gerekçeli, salt okunur `support` rolüyle üyelik; süre dolunca
 * kendiliğinden geçersiz; yönetici erken kaldırabilir; her adım denetim kaydında. Sağlık içeriği ve kimlik açma yoktur.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { AKIS_DEFAULTS, ALL_ROLES, AkisSettings, SupportGrant, TenantSecurityPolicy, ROLE_LABELS, akisSettingsFrom, type Role } from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";
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
        `select m.id, u.email, u.full_name, m.created_at, m.expires_at, m.revoked_at, m.grant_reason, m.status, m.created_by, m.approved_at,
                cb.full_name as created_by_name, ab.full_name as approved_by_name
           from memberships m join users u on u.id = m.user_id left join users cb on cb.id = m.created_by left join users ab on ab.id = m.approved_by
          where m.role = 'support' order by m.created_at desc limit 50`);
      const admins = (await c.query("select count(*)::int as n from memberships where role = 'clinic_admin' and status = 'active'")).rows[0].n as number;
      return { fourEyes: admins >= 2, items: r.rows.map((x) => ({ id: x.id, email: x.email, fullName: x.full_name, createdAt: x.created_at, expiresAt: x.expires_at, revokedAt: x.revoked_at,
        reason: x.grant_reason, status: x.status, createdBy: x.created_by_name, approvedBy: x.approved_by_name, approvedAt: x.approved_at,
        canApprove: x.status === "pending" && x.created_by !== ctx.userId,
        active: x.status === "active" && new Date(x.expires_at) > new Date() })) };
    });
  }

  @Post("support-grants")
  @Require("team.manage")
  grant(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(SupportGrant, body);
    return this.db.tx(ctx, async (c) => {
      const u = (await c.query("select id, status from users where lower(email) = lower($1)", [i.email])).rows[0];
      if (!u || u.status !== "active") throw Errors.validation({ email: "Bu e-postayla etkin bir kullanıcı yok. Destek hesabı önce PİA-DENT tarafından açılmalıdır." });
      if (u.id === ctx.userId) throw new AppError(422, "CANNOT_GRANT_SELF", "Kendinize destek erişimi veremezsiniz.");
      const existing = (await c.query("select id, role, status from memberships where user_id = $1 and tenant_id = $2", [u.id, ctx.tenantId])).rows[0];
      if (existing && existing.status === "active" && existing.role !== "support") throw new AppError(409, "ALREADY_MEMBER", "Bu kullanıcı zaten kliniğin üyesi; destek erişimi gerekmez.");
      const expiresAt = new Date(Date.now() + i.hours * 3600_000);
      // Dört göz (ADR-064): klinikte ≥2 etkin yönetici varsa erişim 'pending' açılır ve BAŞKA bir yönetici onaylayana kadar etkisizdir.
      const admins = (await c.query("select count(*)::int as n from memberships where role = 'clinic_admin' and status = 'active'")).rows[0].n as number;
      const status = admins >= 2 ? "pending" : "active";
      let id: string;
      if (existing) {
        id = existing.id;
        await c.query("update memberships set status = $2, revoked_at = null, role = 'support', expires_at = $3, grant_reason = $4, created_by = $5, approved_by = null, approved_at = null where id = $1",
          [id, status, expiresAt, i.reason, ctx.userId]);
      } else {
        id = (await c.query("insert into memberships(tenant_id, user_id, role, status, expires_at, grant_reason, created_by) values ($1,$2,'support',$3,$4,$5,$6) returning id",
          [ctx.tenantId, u.id, status, expiresAt, i.reason, ctx.userId])).rows[0].id;
      }
      await audit(c, ctx, { action: status === "pending" ? "support.grant_requested" : "support.grant", entityType: "membership", entityId: id,
        changes: { email: { from: null, to: i.email.toLowerCase() }, hours: { from: null, to: i.hours }, expires_at: { from: null, to: expiresAt.toISOString() }, reason: { from: null, to: i.reason },
          four_eyes: { from: null, to: status === "pending" } } });
      return { id, expiresAt, status };
    });
  }

  /** PİA Akış eşikleri (ADR-073). */
  @Get("akis")
  @Require("settings.manage")
  akis(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const t = (await c.query("select akis_settings from tenants where id = $1", [ctx.tenantId])).rows[0];
      return { settings: akisSettingsFrom(t.akis_settings), defaults: AKIS_DEFAULTS };
    });
  }

  @Put("akis")
  @Require("settings.manage")
  setAkis(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(AkisSettings, body);
    return this.db.tx(ctx, async (c) => {
      const before = akisSettingsFrom((await c.query("select akis_settings from tenants where id = $1 for update", [ctx.tenantId])).rows[0].akis_settings);
      await c.query("update tenants set akis_settings = $2 where id = $1", [ctx.tenantId, JSON.stringify(i)]);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of Object.keys(i) as (keyof typeof i)[]) if (before[k] !== i[k]) changes[k] = { from: before[k], to: i[k] };
      if (Object.keys(changes).length) await audit(c, ctx, { action: "settings.akis_update", entityType: "tenant", entityId: ctx.tenantId, changes });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "settings.akis_update" });
      return { settings: i, defaults: AKIS_DEFAULTS };
    });
  }

  /** Dört göz: talebi açan yönetici DIŞINDA bir yönetici onaylar; süre onay anından değil talepten sayılır. */
  @Post("support-grants/:id/approve")
  @HttpCode(200)
  @Require("team.manage")
  approve(@Ctx() ctx: RequestContext, @Param("id", new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() })) id: string) {
    return this.db.tx(ctx, async (c) => {
      const m = (await c.query("select id, created_by, expires_at from memberships where id = $1 and role = 'support' and status = 'pending' for update", [id])).rows[0];
      if (!m) throw Errors.notFound("Destek talebi");
      if (m.created_by === ctx.userId) throw new AppError(409, "FOUR_EYES_SAME_USER", "Talebi açan yönetici onaylayamaz; başka bir yönetici onaylamalı.");
      if (new Date(m.expires_at) <= new Date()) throw new AppError(409, "GRANT_EXPIRED", "Talebin süresi onaylanmadan doldu; yeniden oluşturun.");
      await c.query("update memberships set status = 'active', approved_by = $2, approved_at = now() where id = $1", [id, ctx.userId]);
      await audit(c, ctx, { action: "support.grant_approved", entityType: "membership", entityId: id, changes: { status: { from: "pending", to: "active" } } });
      return { ok: true };
    });
  }
}
