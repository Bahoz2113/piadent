import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { zodFieldErrors, type ApiError } from "@viadent/contracts";

/** Güvenli, sözleşmeli hata. Mesaj kullanıcıya gösterilebilir olmalı (SQL/token/hasta verisi içermez). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const Errors = {
  unauthenticated: () => new AppError(401, "UNAUTHENTICATED", "Oturum bulunamadı veya süresi doldu. Lütfen yeniden giriş yapın."),
  forbidden: () => new AppError(403, "FORBIDDEN", "Bu işlem için yetkiniz yok."),
  notFound: (what = "Kayıt") => new AppError(404, "NOT_FOUND", `${what} bulunamadı.`),
  versionConflict: () => new AppError(409, "VERSION_CONFLICT", "Kayıt siz düzenlerken değişti. Güncel hâlini yükleyip tekrar deneyin."),
  validation: (fieldErrors: Record<string, string>, message = "Lütfen işaretli alanları düzeltin.") =>
    new AppError(422, "VALIDATION_FAILED", message, fieldErrors),
};

export function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: ZodError } }, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw Errors.validation(zodFieldErrors(r.error));
  return r.data;
}

interface PgError { code?: string; constraint?: string; message?: string }

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger("api");

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const correlation_id = (req as Request & { correlationId?: string }).correlationId;
    let status = 500;
    let body: ApiError = { code: "INTERNAL", message: "Beklenmeyen bir hata oluştu. Tekrar deneyin; sürerse destekle paylaşın.", correlation_id };

    const pg = exception as PgError;
    if (exception instanceof AppError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, field_errors: exception.fieldErrors, details: exception.details, correlation_id };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = { code: status === 404 ? "NOT_FOUND" : "HTTP_ERROR", message: status === 404 ? "Adres bulunamadı." : "İstek işlenemedi.", correlation_id };
    } else if (pg?.code === "23P01" && pg.constraint === "work_schedules_no_overlap") {
      status = 422;
      body = { code: "VALIDATION_FAILED", message: "Aynı güne ait çalışma blokları çakışıyor.", field_errors: { blocks: "Bloklar çakışmamalı." }, correlation_id };
    } else if (pg?.code === "23P01") {
      status = 409;
      const resource = pg.constraint?.includes("chair") ? "koltuk" : "hekim";
      body = { code: "APPOINTMENT_CONFLICT", message: `Seçilen saatte ${resource} dolu. Başka bir saat veya ${resource} seçin.`, details: { resource }, correlation_id };
    } else if (pg?.code === "23505") {
      status = 409;
      body = { code: "UNIQUE_CONFLICT", message: "Aynı bilgilerle başka bir kayıt mevcut.", correlation_id };
    } else if (pg?.code === "23514" && pg.message?.includes("birth_date_in_future")) {
      status = 422;
      body = { code: "VALIDATION_FAILED", message: "Doğum tarihi gelecekte olamaz.", field_errors: { birthDate: "Doğum tarihi gelecekte olamaz." }, correlation_id };
    } else if (pg?.code === "55000" && /_(not_draft|frozen|invalid_transition|immutable|closed)/.test(pg.message ?? "")) {
      // DB değişmezlik tetikleyicisi (API kontrolünün arkasındaki ikinci savunma).
      status = 409;
      body = { code: "IMMUTABLE_RECORD", message: "Bu kayıt kilitli (teklif edilmiş/kabul edilmiş/yayınlanmış) ve değiştirilemez.", correlation_id };
    } else if (pg?.code === "40001" || pg?.code === "40P01") {
      status = 409;
      body = { code: "RETRY", message: "Eşzamanlı bir işlem nedeniyle kaydedilemedi. Tekrar deneyin.", correlation_id };
    }
    if (status >= 500) {
      // Yalnız hata türü/kodu loglanır; istek gövdesi ve parametreler (hasta verisi) loglanmaz.
      this.log.error(`${correlation_id} ${req.method} ${req.route?.path ?? "?"} ${pg?.code ?? ""} ${(exception as Error)?.name ?? ""}: ${(exception as Error)?.message?.slice(0, 200) ?? ""}`);
    }
    res.status(status).json(body);
  }
}
