import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { Permission } from "@viadent/contracts";
import { Errors } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";

export const PUBLIC = "viadent:public";
export const NO_TENANT = "viadent:no-tenant";
export const PERMS = "viadent:perms";
export const WEBHOOK = "viadent:webhook";

/** Oturum gerektirmeyen uç (giriş, sağlık kontrolü). */
export const Public = () => SetMetadata(PUBLIC, true);
/** Oturum gerekir ama aktif klinik seçimi gerekmez (oturum bilgisi, klinik değiştirme). */
export const NoTenant = () => SetMetadata(NO_TENANT, true);
/** Sağlayıcı webhook'u: oturum/çerez yok (CSRF uygulanmaz); kimlik HMAC imzasıyla doğrulanır. */
export const Webhook = () => SetMetadata(WEBHOOK, true);
/** Sunucu tarafı izin kontrolü (tümü gerekli). */
export const Require = (...perms: Permission[]) => SetMetadata(PERMS, perms);

export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): RequestContext => {
  const req = host.switchToHttp().getRequest<Request>();
  if (!req.ctx) throw Errors.unauthenticated();
  return req.ctx;
});
