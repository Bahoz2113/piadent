import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Permission } from "@viadent/contracts";
import { AuthService } from "./auth.service.js";
import { AppError, Errors } from "../infra/errors.js";
import { NO_TENANT, PERMS, PUBLIC, WEBHOOK } from "./decorators.js";
import { CONFIG, type AppConfig } from "../config.js";

export const SESSION_COOKIE = "vd_session";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Her istek: oturum → üyelik (yeniden doğrulanır) → bağlam kontrolü → izin.
 * İstemcinin gönderdiği tenant_id'ye hiçbir koşulda güvenilmez.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const req = context.switchToHttp().getRequest<Request>();
    const mutating = !SAFE.has(req.method);

    // CSRF: değiştiren istekler özel başlık taşımalı (çerez SameSite=Lax + başlık).
    const webhook = this.reflector.getAllAndOverride<boolean>(WEBHOOK, targets);
    if (mutating && !webhook && req.get("x-viadent-request") !== "1") {
      throw new AppError(403, "CSRF_HEADER_MISSING", "İstek doğrulanamadı.");
    }
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || typeof token !== "string") throw Errors.unauthenticated();
    const session = await this.auth.resolveSession(token);
    if (!session) throw Errors.unauthenticated();
    req.sessionInfo = session;

    if (this.reflector.getAllAndOverride<boolean>(NO_TENANT, targets)) return true;

    if (!session.activeMembershipId) throw new AppError(403, "NO_ACTIVE_CLINIC", "Önce bir klinik seçin.");
    const membership = await this.auth.activeMembership(session.userId, session.activeMembershipId);
    if (!membership) throw new AppError(403, "MEMBERSHIP_REVOKED", "Bu klinikteki erişiminiz kaldırılmış.");

    // Eski sekme koruması (AT-15): sayfanın yüklendiği bağlam, oturumun aktif bağlamıyla aynı olmalı.
    const declared = req.get("x-viadent-context");
    if ((declared && declared !== membership.id) || (mutating && !declared)) {
      throw new AppError(409, "CONTEXT_CHANGED", "Aktif klinik bu sekme açıldıktan sonra değişti. Sayfayı yenileyin.", undefined, {
        activeMembershipId: membership.id,
      });
    }

    // Politika: bu roller iki adımlı doğrulama kurmadan klinik verisine erişemez (kurulum uçları NoTenant'tır).
    if (this.config.requireMfaRoles.includes(membership.role) && !session.mfaEnabled) {
      throw new AppError(403, "MFA_ENROLLMENT_REQUIRED", "Bu rol için iki adımlı doğrulama zorunlu. Hesabım sayfasından kurun.");
    }
    req.ctx = this.auth.buildContext(session, membership, req.correlationId ?? "-");
    const needed = this.reflector.getAllAndOverride<Permission[]>(PERMS, targets) ?? [];
    for (const p of needed) {
      if (!req.ctx.permissions.has(p)) throw Errors.forbidden();
    }
    return true;
  }
}
