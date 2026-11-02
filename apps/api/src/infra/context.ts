import type { Permission, Role } from "@viadent/contracts";

export interface RequestContext {
  correlationId: string;
  sessionId: string;
  userId: string;
  userName: string;
  membershipId: string;
  tenantId: string;
  tenantName: string;
  timezone: string;
  role: Role;
  permissions: Set<Permission>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId?: string;
      ctx?: RequestContext;
      sessionInfo?: { sessionId: string; userId: string; userName: string; email: string; activeMembershipId: string | null; mfaEnabled: boolean; mustChangePassword: boolean; appearance: unknown };
    }
  }
}

export function has(ctx: RequestContext, p: Permission): boolean {
  return ctx.permissions.has(p);
}
