import { Inject, Injectable } from "@nestjs/common";
import { verifyPassword, DUMMY_HASH, newSessionToken, hashToken } from "@viadent/db";
import { permissionsFor, ROLE_LABELS, type Role } from "@viadent/contracts";
import { Db } from "../infra/db.service.js";
import { AppError, Errors } from "../infra/errors.js";
import { CONFIG, type AppConfig } from "../config.js";
import { clearFails, isLocked, recordFail } from "./rate-limit.js";
import type { RequestContext } from "../infra/context.js";


export interface SessionRow {
  sessionId: string;
  userId: string;
  userName: string;
  email: string;
  activeMembershipId: string | null;
  lastSeenAt: Date;
}

export interface MembershipRow {
  id: string;
  tenantId: string;
  tenantName: string;
  timezone: string;
  role: Role;
}

@Injectable()
export class AuthService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(CONFIG) private readonly config: AppConfig) {}

  async login(email: string, password: string, ip: string): Promise<{ token: string; expiresAt: Date }> {
    const key = `${email.toLowerCase()}|${ip}`;
    if (isLocked(key)) {
      throw new AppError(429, "TOO_MANY_ATTEMPTS", "Çok sayıda hatalı deneme. 15 dakika sonra tekrar deneyin.");
    }
    const u = await this.db.pool.query(
      "select id, password_hash, status from users where lower(email) = lower($1)",
      [email],
    );
    const user = u.rows[0];
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || user.status !== "active") {
      recordFail(key);
      throw new AppError(401, "INVALID_CREDENTIALS", "E-posta veya parola hatalı.");
    }
    clearFails(key);
    const memberships = await this.listMemberships(user.id);
    const { token, expiresAt } = await this.createSession(user.id, memberships[0]?.id ?? null);
    if (memberships[0]) {
      await this.db.tx({ tenantId: memberships[0].tenantId, userId: user.id }, (c) =>
        c.query(
          "insert into audit_events(tenant_id, actor_user_id, actor_membership_id, action, entity_type) values ($1,$2,$3,'session.login','session')",
          [memberships[0]!.tenantId, user.id, memberships[0]!.id],
        ),
      );
    }
    return { token, expiresAt };
  }

  async createSession(userId: string, membershipId: string | null): Promise<{ token: string; expiresAt: Date }> {
    const { token, hash } = newSessionToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 3600_000);
    await this.db.pool.query(
      "insert into sessions(token_hash, user_id, active_membership_id, expires_at) values ($1,$2,$3,$4)",
      [hash, userId, membershipId, expiresAt],
    );
    return { token, expiresAt };
  }

  async logout(token: string) {
    await this.db.pool.query("update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null", [hashToken(token)]);
  }

  async resolveSession(token: string): Promise<SessionRow | null> {
    const r = await this.db.pool.query(
      `select s.id, s.user_id, s.active_membership_id, s.last_seen_at, u.full_name, u.email
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.status = 'active'`,
      [hashToken(token)],
    );
    const s = r.rows[0];
    if (!s) return null;
    if (Date.now() - new Date(s.last_seen_at).getTime() > 5 * 60_000) {
      await this.db.pool.query("update sessions set last_seen_at = now() where id = $1", [s.id]);
    }
    return { sessionId: s.id, userId: s.user_id, userName: s.full_name, email: s.email, activeMembershipId: s.active_membership_id, lastSeenAt: s.last_seen_at };
  }

  /** Üyelik her istekte yeniden doğrulanır: iptal edilen üyelik açık oturumda da hemen etkisizdir (AT-20). */
  async activeMembership(userId: string, membershipId: string): Promise<MembershipRow | null> {
    return this.db.userTx(userId, async (c) => {
      const r = await c.query(
        `select m.id, m.tenant_id, m.role, t.name as tenant_name, t.timezone
           from memberships m join tenants t on t.id = m.tenant_id
          where m.id = $1 and m.user_id = $2 and m.status = 'active' and t.status = 'active'`,
        [membershipId, userId],
      );
      const m = r.rows[0];
      return m ? { id: m.id, tenantId: m.tenant_id, tenantName: m.tenant_name, timezone: m.timezone, role: m.role } : null;
    });
  }

  async listMemberships(userId: string): Promise<MembershipRow[]> {
    return this.db.userTx(userId, async (c) => {
      const r = await c.query(
        `select m.id, m.tenant_id, m.role, t.name as tenant_name, t.timezone
           from memberships m join tenants t on t.id = m.tenant_id
          where m.user_id = $1 and m.status = 'active' and t.status = 'active'
          order by t.name`,
        [userId],
      );
      return r.rows.map((m) => ({ id: m.id, tenantId: m.tenant_id, tenantName: m.tenant_name, timezone: m.timezone, role: m.role }));
    });
  }

  async switchMembership(sessionId: string, userId: string, membershipId: string): Promise<MembershipRow> {
    const m = await this.activeMembership(userId, membershipId);
    if (!m) throw Errors.forbidden();
    await this.db.pool.query("update sessions set active_membership_id = $1 where id = $2 and user_id = $3", [m.id, sessionId, userId]);
    await this.db.tx({ tenantId: m.tenantId, userId }, (c) =>
      c.query(
        "insert into audit_events(tenant_id, actor_user_id, actor_membership_id, action, entity_type) values ($1,$2,$3,'session.switch','session')",
        [m.tenantId, userId, m.id],
      ),
    );
    return m;
  }

  buildContext(session: SessionRow, m: MembershipRow, correlationId: string): RequestContext {
    return {
      correlationId,
      sessionId: session.sessionId,
      userId: session.userId,
      userName: session.userName,
      membershipId: m.id,
      tenantId: m.tenantId,
      tenantName: m.tenantName,
      timezone: m.timezone,
      role: m.role,
      permissions: permissionsFor(m.role),
    };
  }

  describe(session: SessionRow, active: MembershipRow | null, memberships: MembershipRow[]) {
    return {
      user: { id: session.userId, fullName: session.userName, email: session.email },
      activeMembership: active
        ? { id: active.id, tenantId: active.tenantId, tenantName: active.tenantName, timezone: active.timezone, role: active.role, roleLabel: ROLE_LABELS[active.role] }
        : null,
      memberships: memberships.map((m) => ({ id: m.id, tenantName: m.tenantName, role: m.role, roleLabel: ROLE_LABELS[m.role] })),
      permissions: active ? [...permissionsFor(active.role)] : [],
    };
  }
}
