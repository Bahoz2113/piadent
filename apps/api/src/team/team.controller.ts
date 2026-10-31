import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { MembershipRevoke, ROLE_LABELS, type Role } from "@viadent/contracts";
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
