import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { InvitationCreate, MembershipRevoke, RoleChange, ROLE_LABELS, type Role } from "@viadent/contracts";
import { newSessionToken } from "@viadent/db";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit } from "../audit/audit.js";

const mId = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound("Üyelik") });

@Controller("team")
export class TeamController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get()
  @Require("team.manage")
  list(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select m.id, m.role, m.status, m.created_at, m.revoked_at, u.full_name, u.email
           from memberships m join users u on u.id = m.user_id
          where m.tenant_id = $1 order by m.status, u.full_name`,
        [ctx.tenantId],
      );
      return {
        items: r.rows.map((m) => ({
          id: m.id, role: m.role as Role, roleLabel: ROLE_LABELS[m.role as Role], status: m.status,
          fullName: m.full_name, email: m.email, createdAt: m.created_at, revokedAt: m.revoked_at, isSelf: m.id === ctx.membershipId,
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
}
