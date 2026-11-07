import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { FILE_SENSITIVITY, FileDelete, FileInitiate } from "@viadent/contracts";
import { objectKey, sha256, storageFromEnv, type StoragePort } from "@viadent/db";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import { has, type RequestContext } from "../infra/context.js";
import { audit, enqueue, nonClinicalFileSql } from "../audit/audit.js";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
const MAX_UPLOAD_FAILURES = 5;
let storage: StoragePort | null = null;
const store = () => (storage ??= storageFromEnv());
/** `f` takma adlı file_assets satırı için görünürlük; `$2` = `patient.health.read`. */
const VISIBLE = `($2::boolean or ${nonClinicalFileSql("f")})`;
/** Testlerde geçici dizin kullanmak için. */
export function setStorageForTests(s: StoragePort) { storage = s; }

/**
 * Dosya (VD-011, AT-11). Durumlar: initiated → uploaded → (tarama) available | quarantined | rejected; → deleted.
 * Dosya seçmek "yüklendi" değildir; içerik sunucuya tam gelmeden ve tarama bitmeden dosya indirilemez.
 * Klinik kategoriler yalnız sağlık yetkili rollere görünür; yetkisiz kullanıcı varlığını da göremez (404).
 * QA-107 (ADR-089): klinik çıktı belgesine bağlı dosya da kategorisinden bağımsız klinik sayılır; tüm dosya uçları kaydı
 * `VISIBLE` koşuluyla okur, görünmeyen dosya var olmayanla aynı yanıtı (404) verir ve yan etki yazılmadan döner.
 */
@Controller()
export class FilesController {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** Yükleme başlatırken (henüz kayıt yok) kategori hassasiyeti; kayıtlı dosyalarda `VISIBLE` SQL koşulu kullanılır. */
  private visible(ctx: RequestContext, sensitivity: string) {
    return sensitivity === "administrative" || has(ctx, "patient.health.read");
  }
  private async event(c: import("pg").PoolClient, ctx: RequestContext, fileId: string, action: string, detail?: string) {
    await c.query("insert into file_access_events(tenant_id, file_id, action, actor_user_id, detail) values ($1,$2,$3,$4,$5)", [ctx.tenantId, fileId, action, ctx.userId, detail ?? null]);
  }

  @Post("files")
  @Require("file.write")
  initiate(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(FileInitiate, body);
    const sensitivity = FILE_SENSITIVITY[i.category];
    if (!this.visible(ctx, sensitivity)) throw Errors.forbidden();
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [i.patientId])).rowCount) throw Errors.notFound("Hasta");
      if (i.appointmentId && !(await c.query("select 1 from appointments where id = $1 and patient_id = $2", [i.appointmentId, i.patientId])).rowCount) {
        throw Errors.validation({ appointmentId: "Randevu bu hastaya ait değil." });
      }
      // QA-101: klinik çıktı belgesi sağlık yetkisi olmayan rol için var olmayan belgeyle aynı yanıtı verir (ADR-085).
      if (i.patientDocumentId && !(await c.query(
        `select 1 from patient_documents d join document_types dt on dt.id = d.document_type_id
          where d.id = $1 and d.patient_id = $2 and ($3::boolean or dt.category <> 'clinical_output')`,
        [i.patientDocumentId, i.patientId, has(ctx, "patient.health.read")])).rowCount) {
        throw Errors.validation({ patientDocumentId: "Belge bu hastaya ait değil." });
      }
      if (i.takenOn) {
        const today = (await c.query("select (now() at time zone $1)::date::text as d", [ctx.timezone])).rows[0].d as string;
        if (i.takenOn > today || i.takenOn < "1900-01-01") throw Errors.validation({ takenOn: "Çekim tarihi gelecekte olamaz." });
      }
      const fid = (await c.query("select gen_random_uuid() as id")).rows[0].id as string;
      await c.query(
        `insert into file_assets(id, tenant_id, patient_id, appointment_id, patient_document_id, category, sensitivity, original_name, declared_type, declared_size, object_key, uploaded_by,
                                 imaging_kind, taken_on, teeth, imaging_note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [fid, ctx.tenantId, i.patientId, i.appointmentId ?? null, i.patientDocumentId ?? null, i.category, sensitivity, i.originalName, i.contentType, i.size,
         objectKey(ctx.tenantId, fid), ctx.userId, i.imagingKind ?? null, i.imagingKind ? (i.takenOn ?? null) : null, i.teeth ?? [], i.imagingNote ?? null]);
      await this.event(c, ctx, fid, "upload_initiated");
      return { id: fid, status: "initiated", uploadPath: `/files/${fid}/content` };
    });
  }

  /** İçerik gönderimi (application/octet-stream). Eksik/fazla bayt "yüklendi" sayılmaz; tekrar denenebilir (AT-11). */
  @Put("files/:id/content")
  @Require("file.write")
  async upload(@Ctx() ctx: RequestContext, @Param("id", id) fid: string, @Req() req: Request) {
    const data = Buffer.isBuffer(req.body) ? (req.body as Buffer) : null;
    const f = await this.db.tx(ctx, async (c) => (await c.query(`select status, declared_size, object_key, upload_failures from file_assets f where f.id = $1 and ${VISIBLE}`,
      [fid, has(ctx, "patient.health.read")])).rows[0]);
    if (!f) throw Errors.notFound("Dosya");
    if (f.status !== "initiated") throw new AppError(409, "FILE_NOT_UPLOADABLE", "Bu dosyanın içeriği zaten alındı veya yükleme kapandı.");
    if (!data || data.length !== Number(f.declared_size)) {
      // Başarısız yükleme kaydı ayrı transaction'da: yanlış başarı yok, tekrar yolu açık; sınır aşılırsa reddedilir.
      const r = await this.db.tx(ctx, async (c) => {
        const u = await c.query(
          `update file_assets set upload_failures = upload_failures + 1,
                  status = case when upload_failures + 1 >= $2 then 'rejected' else status end,
                  status_reason = case when upload_failures + 1 >= $2 then 'Yükleme tekrar tekrar tamamlanamadı' else 'Son yükleme eksik/hatalı' end
            where id = $1 returning status, upload_failures`, [fid, MAX_UPLOAD_FAILURES]);
        await this.event(c, ctx, fid, "upload_failed", `beklenen ${f.declared_size} bayt, gelen ${data?.length ?? 0}`);
        return u.rows[0];
      });
      throw new AppError(422, "UPLOAD_INCOMPLETE", r.status === "rejected"
        ? "Yükleme tamamlanamadı ve deneme sınırı doldu; dosya reddedildi. Yeni yükleme başlatın."
        : "Dosya eksik veya hatalı geldi; kaydedilmedi. Tekrar deneyin.", undefined, { attempts: r.upload_failures, status: r.status });
    }
    const digest = sha256(data);
    await store().put(f.object_key, data); // içerik önce depoya; DB durumu sonra (yarım durum: initiated kalır, tekrar denenebilir)
    return this.db.tx(ctx, async (c) => {
      const u = await c.query("update file_assets set status = 'uploaded', size_bytes = $2, sha256 = $3, status_reason = null where id = $1 and status = 'initiated' returning patient_id",
        [fid, data.length, digest]);
      if (!u.rowCount) throw new AppError(409, "FILE_NOT_UPLOADABLE", "Bu dosyanın içeriği zaten alındı.");
      await this.event(c, ctx, fid, "uploaded", digest);
      await enqueue(c, ctx.tenantId, "file.scan", { fileId: fid });
      await audit(c, ctx, { action: "file.upload", entityType: "file", entityId: fid, patientId: u.rows[0].patient_id, changes: { sha256: { from: null, to: digest } } });
      return { id: fid, status: "uploaded", sha256: digest, message: "Dosya alındı; zararlı içerik taraması bitince kullanılabilir olacak." };
    });
  }

  @Get("patients/:patientId/files")
  @Require("file.read")
  list(@Ctx() ctx: RequestContext, @Param("patientId", id) patientId: string) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query("select 1 from patients where id = $1", [patientId])).rowCount) throw Errors.notFound("Hasta");
      const r = await c.query(
        `select f.id, f.category, f.sensitivity, f.original_name, f.declared_type, f.declared_size, f.size_bytes, f.sha256, f.status, f.status_reason,
                f.scan_engine, f.scanned_at, f.created_at, f.available_at, f.upload_failures, f.patient_document_id, u.full_name as uploaded_by,
                f.imaging_kind, f.taken_on::text as taken_on, f.teeth, f.imaging_note
           from file_assets f join users u on u.id = f.uploaded_by
          where f.patient_id = $1 and ${VISIBLE} order by f.created_at desc`,
        [patientId, has(ctx, "patient.health.read")]);
      return { items: r.rows.map((f) => ({ id: f.id, category: f.category, sensitivity: f.sensitivity, name: f.original_name, contentType: f.declared_type,
        size: Number(f.size_bytes ?? f.declared_size), sha256: f.sha256, status: f.status, statusReason: f.status_reason, scanEngine: f.scan_engine,
        scannedAt: f.scanned_at, createdAt: f.created_at, availableAt: f.available_at, uploadFailures: f.upload_failures, patientDocumentId: f.patient_document_id,
        uploadedBy: f.uploaded_by, imagingKind: f.imaging_kind, takenOn: f.taken_on, teeth: f.teeth ?? [], imagingNote: f.imaging_note })) };
    });
  }

  @Get("files/:id")
  @Require("file.read")
  detail(@Ctx() ctx: RequestContext, @Param("id", id) fid: string) {
    return this.db.tx(ctx, async (c) => {
      const f = (await c.query(`select id, status, status_reason, original_name, sha256, scan_engine from file_assets f where f.id = $1 and ${VISIBLE}`,
        [fid, has(ctx, "patient.health.read")])).rows[0];
      if (!f) throw Errors.notFound("Dosya");
      const ev = await c.query(
        `select e.action, e.detail, e.at, u.full_name as actor from file_access_events e left join users u on u.id = e.actor_user_id
          where e.file_id = $1 order by e.at, e.id`, [fid]);
      return { id: f.id, name: f.original_name, status: f.status, statusReason: f.status_reason, sha256: f.sha256, scanEngine: f.scan_engine,
        events: ev.rows.map((e) => ({ action: e.action, detail: e.action === "uploaded" ? null : e.detail, at: e.at, actor: e.actor ?? "Sistem" })) };
    });
  }

  @Get("files/:id/content")
  @Require("file.read")
  async download(@Ctx() ctx: RequestContext, @Param("id", id) fid: string, @Res() res: Response) {
    const f = await this.db.tx(ctx, async (c) => {
      const row = (await c.query(`select id, status, object_key, detected_type, original_name, sha256, patient_id from file_assets f where f.id = $1 and ${VISIBLE}`,
        [fid, has(ctx, "patient.health.read")])).rows[0];
      if (!row) throw Errors.notFound("Dosya");
      if (row.status !== "available") {
        await this.event(c, ctx, fid, "access_denied", `durum: ${row.status}`);
        return { denied: row.status as string };
      }
      await this.event(c, ctx, fid, "downloaded");
      return row;
    });
    if ("denied" in f) {
      // access_denied olayı kalıcı olsun diye transaction commit edildikten sonra hata döner.
      throw new AppError(409, "FILE_NOT_AVAILABLE", f.denied === "quarantined" ? "Dosya karantinada; açılamaz." : "Dosya henüz kullanılabilir değil (yükleme/tarama sürüyor veya reddedildi).");
    }
    const data = await store().get(f.object_key);
    if (sha256(data) !== f.sha256) throw new AppError(500, "INTEGRITY_FAILED", "Dosya bütünlük kontrolünden geçmedi.");
    res.setHeader("content-type", f.detected_type);
    res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    res.setHeader("content-security-policy", "default-src 'none'; sandbox");
    res.setHeader("x-content-sha256", f.sha256);
    res.send(data);
  }

  @Post("files/:id/delete")
  @HttpCode(200)
  @Require("file.delete")
  remove(@Ctx() ctx: RequestContext, @Param("id", id) fid: string, @Body() body: unknown) {
    const i = parse(FileDelete, body);
    return this.db.tx(ctx, async (c) => {
      const f = (await c.query(`select status, patient_id from file_assets f where f.id = $1 and ${VISIBLE}`, [fid, has(ctx, "patient.health.read")])).rows[0];
      if (!f) throw Errors.notFound("Dosya");
      if (f.status === "deleted") throw new AppError(409, "FILE_DELETED", "Dosya zaten silinmiş.");
      if (f.status === "uploaded") throw new AppError(409, "FILE_SCANNING", "Tarama sürerken silinemez; tarama bitince tekrar deneyin.");
      await c.query("update file_assets set status = 'deleted', status_reason = $2, deleted_at = now(), deleted_by = $3 where id = $1", [fid, i.reason, ctx.userId]);
      await this.event(c, ctx, fid, "deleted", i.reason);
      await audit(c, ctx, { action: "file.delete", entityType: "file", entityId: fid, patientId: f.patient_id, changes: { status: { from: f.status, to: "deleted" }, reason: { from: null, to: i.reason } } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "file.delete" });
      return { ok: true };
    });
  }
}
