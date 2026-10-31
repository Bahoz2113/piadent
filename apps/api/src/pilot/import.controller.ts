/**
 * İçe aktarma (VD-014, AT-16). Akış: dosya → dry-run (ayrıştır, eşle, doğrula, mükerrer ara; hiçbir hasta/alacak yazılmaz)
 * → onay (tek transaction, geçerli satırlar yeniden doğrulanır) → gerekirse gerekçeli geri alma (bağlı işlem yoksa).
 * Aynı dosya (SHA-256) aynı türde ikinci kez yüklenirse yeni batch açılmaz; kaynak hasta no ile daha önce aktarılmış satır
 * “daha önce aktarılmış” olur ve tekrar yazılmaz → mükerrer oluşmaz. Gerçek kaynak veri yalnız yetkili klinikten gelir.
 */
import { createHash } from "node:crypto";
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import type pg from "pg";
import {
  IMPORT_FIELDS, IMPORT_MAX_ROWS, ImportCreate, ImportRollback, csvCell, isValidTckn, localDate, maskNationalId, normalizePhone, normalizeSearch, toTitleTr,
  fromMinor, toMinor, zonedToUtc, type ImportKind,
} from "@viadent/contracts";
import { Ctx, Require } from "../auth/decorators.js";
import { Db } from "../infra/db.service.js";
import { AppError, Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";
import { audit, enqueue } from "../audit/audit.js";
import { PatientsService } from "../patients/patients.service.js";
import { lockAccount } from "../finance/ledger.js";
import { mapHeaders, parseCsv, parseDate, parseGender, parseJson, parseMoney } from "./parse.js";
import { decryptField, encryptField, indexHash } from "@viadent/db";

const id = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() });
type C = pg.PoolClient;
type RowErr = { field: string; message: string };
interface Checked { rowNo: number; status: "valid" | "error" | "duplicate" | "already_imported"; errors: RowErr[]; warnings: RowErr[]; data: Record<string, unknown>; amount: string | null }

/** geldi/gelmedi/iptal → appointments.status; boş = completed. */
function parseAppointmentStatus(v: string | undefined): "completed" | "no_show" | "cancelled" | null {
  const n = (v ?? "").trim().toLowerCase().replace(/i̇/g, "i");
  if (!n || ["geldi", "tamamlandi", "tamamlandı", "completed", "done", "ok", "yapildi", "yapıldı"].includes(n)) return "completed";
  if (["gelmedi", "no_show", "noshow", "no-show", "gelmeyen"].includes(n)) return "no_show";
  if (["iptal", "iptal edildi", "cancelled", "canceled"].includes(n)) return "cancelled";
  return null;
}

const DEPENDENT_TABLES = ["appointments", "receivables", "payments", "treatment_plans", "clinical_notes", "anamnesis_versions", "patient_documents",
  "file_assets", "lab_orders", "messages", "follow_ups", "performed_procedures", "odontogram_findings", "communication_preferences"];

@Controller()
export class ImportController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(PatientsService) private readonly patients: PatientsService) {}

  // ------------------------------------------------------------ doğrulama (dry-run ve onayda aynı kurallar)
  private async check(c: C, ctx: RequestContext, kind: ImportKind, rows: Record<string, string>[], mapping: Record<string, string>): Promise<Checked[]> {
    const today = localDate(new Date(), ctx.timezone);
    const out: Checked[] = [];
    const seenRef = new Map<string, number>();
    const spans: { prac: string; s: string; e: string; row: number }[] = []; // dosya içi hekim çakışması (geçmiş randevu)
    for (const [i, raw] of rows.entries()) {
      const v: Record<string, string> = {};
      for (const [h, key] of Object.entries(mapping)) v[key] = (raw[h] ?? "").trim();
      const errors: RowErr[] = [], warnings: RowErr[] = [];
      const req = (k: string, label: string) => { if (!v[k]) errors.push({ field: k, message: `${label} boş` }); };
      let status: Checked["status"] = "valid";
      let amount: string | null = null;
      const data: Record<string, unknown> = {};
      if (kind === "patients") {
        req("external_ref", "Kaynak hasta no"); req("first_name", "Ad"); req("last_name", "Soyad");
        if (v.external_ref && v.external_ref.length > 60) errors.push({ field: "external_ref", message: "Kaynak no en çok 60 karakter" });
        data.external_ref = v.external_ref || null;
        data.first_name = v.first_name ? toTitleTr(v.first_name).slice(0, 80) : null;
        data.last_name = v.last_name ? toTitleTr(v.last_name).slice(0, 80) : null;
        if (v.birth_date) {
          const d = parseDate(v.birth_date);
          if (!d) errors.push({ field: "birth_date", message: `Doğum tarihi okunamadı: “${v.birth_date.slice(0, 20)}” (gg.aa.yyyy)` });
          else if (d > today) errors.push({ field: "birth_date", message: "Doğum tarihi gelecekte olamaz" });
          else if (d < "1900-01-01") errors.push({ field: "birth_date", message: "Doğum tarihi 1900'den önce olamaz" });
          data.birth_date = d;
        }
        if (v.gender) {
          const g = parseGender(v.gender);
          if (g === "invalid") errors.push({ field: "gender", message: `Cinsiyet tanınmadı: “${v.gender.slice(0, 20)}” (K/E)` }); else data.gender = g;
        }
        if (v.phone) {
          const p = normalizePhone(v.phone);
          if (!p) errors.push({ field: "phone", message: "Telefon geçersiz" }); else { data.phone_e164 = p.e164; data.phone_digits = p.digits; }
        }
        if (v.email) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email) || v.email.length > 200) errors.push({ field: "email", message: "E-posta geçersiz" }); else data.email = v.email.toLowerCase();
        }
        if (v.city) data.city = v.city.slice(0, 60);
        if (v.referral_source) data.referral_source = v.referral_source.slice(0, 120);
        if (v.national_id) {
          if (!isValidTckn(v.national_id)) errors.push({ field: "national_id", message: "T.C. Kimlik No geçersiz (11 hane, kontrol basamakları)" });
          else { data.national_id_type = "tckn"; data.national_id_enc = encryptField(v.national_id); data.national_id_masked = maskNationalId(v.national_id); }
        }
        if (v.external_ref) {
          const prev = seenRef.get(v.external_ref);
          if (prev) { status = "duplicate"; errors.push({ field: "external_ref", message: `Aynı kaynak no dosyada ${prev}. satırda da var` }); }
          else seenRef.set(v.external_ref, i + 1);
        }
        if (!errors.length && status === "valid") {
          const ex = await c.query("select id, file_no from patients where external_ref = $1 and status = 'active'", [v.external_ref]);
          if (ex.rowCount) {
            status = "already_imported"; data.existing_patient_id = ex.rows[0].id;
            warnings.push({ field: "external_ref", message: `Bu kaynak no daha önce aktarılmış (dosya ${ex.rows[0].file_no}); tekrar yazılmaz` });
          } else {
            const cands = await this.patients.findDuplicates(c, ctx, { firstName: String(data.first_name), lastName: String(data.last_name),
              birthDate: (data.birth_date as string) ?? null, phoneDigits: (data.phone_digits as string) ?? null,
              nationalIdType: (data.national_id_type as string) ?? undefined, nationalId: v.national_id || undefined });
            const strong = cands.find((x) => x.kind === "same_identity" || x.kind === "same_person_likely");
            if (strong) {
              status = "duplicate";
              errors.push({ field: "first_name", message: `Mükerrer aday: dosya ${strong.fileNo} · ${strong.reason} Kartı birleştirmek için kaynak no ile eşleştirin veya satırı çıkarın.` });
            } else for (const x of cands) warnings.push({ field: "phone", message: `Dosya ${x.fileNo}: ${x.reason}` });
          }
        }
      } else if (kind === "appointment_history") {
        if (!v.patient_ref && !v.file_no) errors.push({ field: "patient_ref", message: "Kaynak hasta no veya dosya no gerekli" });
        req("date", "Tarih"); req("time", "Saat"); req("practitioner", "Hekim");
        if (v.external_ref && v.external_ref.length > 60) errors.push({ field: "external_ref", message: "Kaynak randevu no en çok 60 karakter" });
        data.external_ref = v.external_ref || null;
        let date: string | null = null;
        if (v.date) {
          date = parseDate(v.date);
          if (!date) errors.push({ field: "date", message: `Tarih okunamadı: “${v.date.slice(0, 20)}” (gg.aa.yyyy)` });
          else if (date >= today) errors.push({ field: "date", message: "Yalnız geçmiş tarihli randevular aktarılır (bugün ve sonrası ajandadan girilir)" });
        }
        const tm = /^(\d{1,2})[:.](\d{2})$/.exec(v.time ?? "");
        if (v.time && (!tm || Number(tm[1]) > 23 || Number(tm[2]) > 59)) errors.push({ field: "time", message: `Saat okunamadı: “${v.time.slice(0, 10)}” (SS:DD)` });
        const dur = v.duration_min ? Number(v.duration_min.replace(",", ".")) : 30;
        if (!Number.isInteger(dur) || dur < 5 || dur > 720) errors.push({ field: "duration_min", message: "Süre 5–720 dakika arasında tam sayı olmalı" });
        const st = parseAppointmentStatus(v.status);
        if (!st) errors.push({ field: "status", message: `Durum tanınmadı: “${(v.status ?? "").slice(0, 20)}” (geldi / gelmedi / iptal)` });
        data.status = st; data.reason = v.reason ? v.reason.slice(0, 200) : null; data.note = v.note ? v.note.slice(0, 500) : null; data.duration_min = dur;
        if (date && tm) {
          const time = `${String(Number(tm[1])).padStart(2, "0")}:${tm[2]}`;
          const startsAt = zonedToUtc(date, time, ctx.timezone);
          data.starts_at = startsAt.toISOString(); data.ends_at = new Date(startsAt.getTime() + dur * 60_000).toISOString(); data.date = date; data.time = time;
        }
        if (!errors.length) {
          const p = await c.query(
            v.patient_ref ? "select id, file_no from patients where external_ref = $1 and status = 'active'" : "select id, file_no from patients where file_no::text = $1 and status = 'active'",
            [v.patient_ref || v.file_no]);
          if (!p.rowCount) errors.push({ field: v.patient_ref ? "patient_ref" : "file_no", message: "Hasta bulunamadı (önce hasta kartlarını aktarın)" });
          else { data.patient_id = p.rows[0].id; data.file_no = p.rows[0].file_no; }
          const pr = await c.query(
            `select p.id, p.display_name, p.branch_id from practitioners p left join memberships m on m.id = p.membership_id left join users u on u.id = m.user_id
              where lower(p.display_name) = lower($1) or lower(u.email) = lower($1) or lower(regexp_replace(p.display_name, '^(Dt|Dr|Prof|Doç|Uzm)\\.?\\s+', '')) = lower($1)
              order by p.active desc limit 2`, [(v.practitioner ?? "").trim()]);
          const pn = (v.practitioner ?? "").slice(0, 40);
          if (pr.rowCount !== 1) errors.push({ field: "practitioner", message: pr.rowCount ? `Hekim adı birden çok kayda uyuyor: “${pn}”` : `Hekim bulunamadı: “${pn}” (Yönetim → Hekimler'deki ad ya da e-posta)` });
          else { data.practitioner_id = pr.rows[0].id; data.practitioner_name = pr.rows[0].display_name; data.branch_id = pr.rows[0].branch_id; }
          if (!errors.length) {
            const key = v.external_ref ? `ref:${v.external_ref}` : `pt:${data.patient_id}|${data.practitioner_id}|${data.starts_at}`;
            const prev = seenRef.get(key);
            if (prev) { status = "duplicate"; errors.push({ field: "external_ref", message: `Aynı randevu dosyada ${prev}. satırda da var` }); }
            else {
              seenRef.set(key, i + 1);
              const ex = await c.query(
                `select a.id from appointments a where (($1::text is not null and a.external_ref = $1)
                    or (a.patient_id = $2 and a.practitioner_id = $3 and a.starts_at = $4::timestamptz))
                   and not exists (select 1 from import_batches b where b.id = a.import_batch_id and b.status = 'rolled_back') limit 1`,
                [v.external_ref || null, data.patient_id, data.practitioner_id, data.starts_at]);
              if (ex.rowCount) { status = "already_imported"; data.existing_appointment_id = ex.rows[0].id; warnings.push({ field: "external_ref", message: "Bu randevu zaten kayıtlı; tekrar yazılmaz" }); }
              else if (st !== "cancelled") {
                const ov = await c.query(
                  `select id from appointments where practitioner_id = $1 and status <> 'cancelled' and tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)') limit 1`,
                  [data.practitioner_id, data.starts_at, data.ends_at]);
                const inFile = spans.find((x) => x.prac === data.practitioner_id && x.s < String(data.ends_at) && String(data.starts_at) < x.e);
                if (ov.rowCount) errors.push({ field: "time", message: "Hekimin bu saatte başka randevusu var (çakışma); süreyi/saati düzeltin ya da satırı çıkarın" });
                else if (inFile) errors.push({ field: "time", message: `Dosyada ${inFile.row}. satırdaki randevuyla çakışıyor (aynı hekim)` });
                else spans.push({ prac: String(data.practitioner_id), s: String(data.starts_at), e: String(data.ends_at), row: i + 1 });
              }
            }
          }
        }
      } else if (kind === "treatment_history") {
        if (!v.patient_ref && !v.file_no) errors.push({ field: "patient_ref", message: "Kaynak hasta no veya dosya no gerekli" });
        req("date", "İşlem tarihi"); req("procedure", "İşlem"); req("practitioner", "Hekim");
        if (v.external_ref && v.external_ref.length > 60) errors.push({ field: "external_ref", message: "Kaynak işlem no en çok 60 karakter" });
        data.external_ref = v.external_ref || null;
        if (v.date) {
          const d = parseDate(v.date);
          if (!d) errors.push({ field: "date", message: `Tarih okunamadı: “${v.date.slice(0, 20)}” (gg.aa.yyyy)` });
          else if (d >= today) errors.push({ field: "date", message: "Yalnız geçmiş tarihli işlemler aktarılır" });
          else { data.date = d; data.completed_at = zonedToUtc(d, "12:00", ctx.timezone).toISOString(); }
        }
        if (v.tooth) { if (!/^[1-8][1-8]$/.test(v.tooth.trim())) errors.push({ field: "tooth", message: `Diş numarası FDI (11–48) olmalı: “${v.tooth.slice(0, 10)}”` }); else data.tooth = v.tooth.trim(); }
        const qty = v.quantity ? Number(v.quantity.replace(",", ".")) : 1;
        if (!Number.isInteger(qty) || qty < 1 || qty > 50) errors.push({ field: "quantity", message: "Adet 1–50 tam sayı olmalı" });
        data.quantity = qty;
        if (v.amount) {
          const m = parseMoney(v.amount);
          if (!m.value) errors.push({ field: "amount", message: m.error ?? "Bedel geçersiz" });
          else if (toMinor(m.value) < 0n) errors.push({ field: "amount", message: "Bedel eksi olamaz" });
          else amount = m.value;
        } else amount = "0.00";
        data.note = v.note ? v.note.slice(0, 500) : null;
        if (!errors.length) {
          const p = await c.query(
            v.patient_ref ? "select id, file_no from patients where external_ref = $1 and status = 'active'" : "select id, file_no from patients where file_no::text = $1 and status = 'active'",
            [v.patient_ref || v.file_no]);
          if (!p.rowCount) errors.push({ field: v.patient_ref ? "patient_ref" : "file_no", message: "Hasta bulunamadı (önce hasta kartlarını aktarın)" });
          else { data.patient_id = p.rows[0].id; data.file_no = p.rows[0].file_no; }
          const proc = await c.query("select id, code, name, tooth_scope from procedures where upper(code) = upper($1) or lower(name) = lower($1) order by active desc limit 2", [(v.procedure ?? "").trim()]);
          if (proc.rowCount !== 1) errors.push({ field: "procedure", message: proc.rowCount ? `İşlem adı birden çok kayda uyuyor: “${(v.procedure ?? "").slice(0, 40)}”` : `İşlem katalogda yok: “${(v.procedure ?? "").slice(0, 40)}” (Yönetim → Katalog'daki kod ya da ad)` });
          else {
            data.procedure_id = proc.rows[0].id; data.procedure_code = proc.rows[0].code; data.procedure_name = proc.rows[0].name;
            const scope = proc.rows[0].tooth_scope as string;
            if ((scope === "tooth" || scope === "surface") && !data.tooth) warnings.push({ field: "tooth", message: "Diş düzeyinde işlem; diş numarası boş — ağız düzeyinde kaydedilir" });
            data.location_kind = data.tooth ? "tooth" : "mouth";
          }
          const pr = await c.query(
            `select p.id, p.display_name from practitioners p left join memberships m on m.id = p.membership_id left join users u on u.id = m.user_id
              where lower(p.display_name) = lower($1) or lower(u.email) = lower($1) or lower(regexp_replace(p.display_name, '^(Dt|Dr|Prof|Doç|Uzm)\\.?\\s+', '')) = lower($1)
              order by p.active desc limit 2`, [(v.practitioner ?? "").trim()]);
          const pn = (v.practitioner ?? "").slice(0, 40);
          if (pr.rowCount !== 1) errors.push({ field: "practitioner", message: pr.rowCount ? `Hekim adı birden çok kayda uyuyor: “${pn}”` : `Hekim bulunamadı: “${pn}”` });
          else { data.practitioner_id = pr.rows[0].id; data.practitioner_name = pr.rows[0].display_name; }
          if (!errors.length) {
            const key = v.external_ref ? `ref:${v.external_ref}` : `tp:${data.patient_id}|${data.procedure_id}|${data.date}|${data.practitioner_id}|${data.tooth ?? ""}`;
            const prev = seenRef.get(key);
            if (prev) { status = "duplicate"; errors.push({ field: "external_ref", message: `Aynı işlem dosyada ${prev}. satırda da var` }); }
            else {
              seenRef.set(key, i + 1);
              const ex = await c.query(
                `select pp.id from performed_procedures pp where (($1::text is not null and pp.external_ref = $1)
                    or (pp.patient_id = $2 and pp.procedure_id = $3 and pp.practitioner_id = $4 and pp.completed_at = $5::timestamptz and coalesce(pp.tooth, '') = $6))
                   and pp.status <> 'cancelled' and not exists (select 1 from import_batches b where b.id = pp.import_batch_id and b.status = 'rolled_back') limit 1`,
                [v.external_ref || null, data.patient_id, data.procedure_id, data.practitioner_id, data.completed_at, data.tooth ?? ""]);
              if (ex.rowCount) { status = "already_imported"; warnings.push({ field: "external_ref", message: "Bu işlem zaten kayıtlı; tekrar yazılmaz" }); }
            }
          }
        }
      } else {
        if (!v.patient_ref && !v.file_no) errors.push({ field: "patient_ref", message: "Kaynak hasta no veya dosya no gerekli" });
        req("amount", "Tutar"); req("as_of", "Bakiye tarihi");
        if (v.amount) {
          const m = parseMoney(v.amount);
          if (!m.value) errors.push({ field: "amount", message: m.error ?? "Tutar geçersiz" });
          else {
            amount = m.value;
            if (toMinor(m.value) < 0n) errors.push({ field: "amount", message: "Alacaklı (avans) açılış bakiyesi bu sürümde aktarılmaz; mali müşavir onayıyla elle girin" });
            else if (toMinor(m.value) === 0n) { status = "duplicate"; errors.push({ field: "amount", message: "Sıfır bakiye aktarılmaz" }); }
          }
        }
        if (v.as_of) {
          const d = parseDate(v.as_of);
          if (!d) errors.push({ field: "as_of", message: `Tarih okunamadı: “${v.as_of.slice(0, 20)}”` });
          else if (d > today) errors.push({ field: "as_of", message: "Bakiye tarihi gelecekte olamaz" });
          data.as_of = d;
        }
        data.description = (v.description || "Açılış bakiyesi (önceki sistemden aktarım)").slice(0, 200);
        if (!errors.length) {
          const p = await c.query(
            v.patient_ref ? "select id, file_no from patients where external_ref = $1 and status = 'active'" : "select id, file_no from patients where file_no::text = $1 and status = 'active'",
            [v.patient_ref || v.file_no]);
          if (!p.rowCount) errors.push({ field: v.patient_ref ? "patient_ref" : "file_no", message: "Hasta bulunamadı (önce hasta kartlarını aktarın)" });
          else {
            data.patient_id = p.rows[0].id; data.file_no = p.rows[0].file_no;
            const key = String(p.rows[0].id);
            const prev = seenRef.get(key);
            if (prev) { status = "duplicate"; errors.push({ field: "patient_ref", message: `Aynı hastanın bakiyesi dosyada ${prev}. satırda da var` }); }
            else {
              seenRef.set(key, i + 1);
              const ob = await c.query("select 1 from receivables where patient_id = $1 and source = 'opening_balance' and status = 'active'", [p.rows[0].id]);
              if (ob.rowCount) { status = "already_imported"; warnings.push({ field: "amount", message: "Bu hastanın açılış bakiyesi daha önce aktarılmış; tekrar yazılmaz" }); }
            }
          }
        }
      }
      if (errors.length && status === "valid") status = "error";
      out.push({ rowNo: i + 1, status, errors, warnings, data, amount });
    }
    return out;
  }

  private summarize(kind: ImportKind, checked: Checked[], extra: Record<string, unknown>) {
    const by = (s: string) => checked.filter((r) => r.status === s);
    const sum = (rs: Checked[]) => fromMinor(rs.reduce((t, r) => t + (r.amount ? toMinor(r.amount) : 0n), 0n));
    return {
      ...extra, rows: checked.length, valid: by("valid").length, errors: by("error").length, duplicates: by("duplicate").length,
      alreadyImported: by("already_imported").length, withWarnings: checked.filter((r) => r.warnings.length).length,
      ...(kind === "opening_balances" || kind === "treatment_history" ? {
        amountSource: sum(checked), amountValid: sum(by("valid")), amountError: sum(by("error")), amountDuplicate: sum(by("duplicate")),
        amountAlreadyImported: sum(by("already_imported")), unparsedAmountRows: checked.filter((r) => !r.amount).length,
      } : {}),
    };
  }

  // ------------------------------------------------------------ uçlar
  @Post("imports")
  @Require("import.manage")
  async dryRun(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const i = parse(ImportCreate, body);
    const sha = createHash("sha256").update(i.content, "utf8").digest("hex");
    let parsed;
    try { parsed = i.format === "csv" ? parseCsv(i.content) : parseJson(i.content); }
    catch (e) { throw Errors.validation({ content: (e as Error).message }, "Dosya okunamadı."); }
    if (!parsed.rows.length) throw Errors.validation({ content: "Başlık dışında satır yok." }, "Dosyada veri satırı yok.");
    if (parsed.rows.length > IMPORT_MAX_ROWS) throw Errors.validation({ content: `En çok ${IMPORT_MAX_ROWS} satır.` }, "Dosya çok büyük; parçalara bölün.");
    const { mapping, unmapped, missing } = mapHeaders(i.kind, parsed.headers, i.mapping);
    if (missing.length) {
      const labels = missing.map((k) => IMPORT_FIELDS[i.kind].find((f) => f.key === k)!.label);
      throw new AppError(422, "IMPORT_MAPPING_INCOMPLETE", `Zorunlu sütun eşlenemedi: ${labels.join(", ")}.`, undefined, { headers: parsed.headers, mapping, unmapped, missing });
    }
    return this.db.tx(ctx, async (c) => {
      const prev = (await c.query("select id, status from import_batches where kind = $1 and file_sha256 = $2", [i.kind, sha])).rows[0];
      if (prev) return { ...(await this.load(c, prev.id)), reused: true };
      const checked = await this.check(c, ctx, i.kind, parsed.rows, mapping);
      const summary = this.summarize(i.kind, checked, { headers: parsed.headers, unmapped, delimiter: parsed.delimiter ?? null });
      const b = await c.query(
        `insert into import_batches(tenant_id, kind, format, file_name, file_sha256, mapping, summary, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [ctx.tenantId, i.kind, i.format, i.fileName, sha, JSON.stringify(mapping), JSON.stringify(summary), ctx.userId]);
      const bid = b.rows[0].id as string;
      for (let k = 0; k < checked.length; k += 500) {
        const chunk = checked.slice(k, k + 500);
        const vals: unknown[] = [];
        const ph = chunk.map((r, j) => { const o = j * 8; vals.push(ctx.tenantId, bid, r.rowNo, r.status, JSON.stringify(r.errors), JSON.stringify(r.warnings), JSON.stringify(r.data), r.amount);
          return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8})`; });
        await c.query(`insert into import_rows(tenant_id, batch_id, row_no, status, errors, warnings, data, amount) values ${ph.join(",")}`, vals);
      }
      await audit(c, ctx, { action: "import.dry_run", entityType: "import_batch", entityId: bid,
        changes: { kind: { from: null, to: i.kind }, file_sha256: { from: null, to: sha }, rows: { from: null, to: checked.length }, valid: { from: null, to: summary.valid } } });
      return { ...(await this.load(c, bid)), reused: false };
    });
  }

  private async load(c: C, bid: string) {
    const b = (await c.query(
      `select b.*, u.full_name as by, cu.full_name as committed_by_name from import_batches b join users u on u.id = b.created_by left join users cu on cu.id = b.committed_by where b.id = $1`, [bid])).rows[0];
    if (!b) throw Errors.notFound("Aktarım");
    return { id: b.id, kind: b.kind, format: b.format, fileName: b.file_name, fileSha256: b.file_sha256, status: b.status, mapping: b.mapping, summary: b.summary,
      createdAt: b.created_at, by: b.by, committedAt: b.committed_at, committedBy: b.committed_by_name, rolledBackAt: b.rolled_back_at, rollbackReason: b.rollback_reason, rowsPurgedAt: b.rows_purged_at };
  }

  @Get("imports")
  @Require("import.manage")
  list(@Ctx() ctx: RequestContext) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query("select b.id from import_batches b order by b.created_at desc limit 100");
      const items = [];
      for (const x of r.rows) items.push(await this.load(c, x.id));
      return { items };
    });
  }

  @Get("imports/:id")
  @Require("import.manage")
  detail(@Ctx() ctx: RequestContext, @Param("id", id) bid: string, @Query("status") status?: string, @Query("offset") offset?: string) {
    return this.db.tx(ctx, async (c) => {
      const b = await this.load(c, bid);
      const rows = await c.query(
        `select row_no, status, errors, warnings, data, amount::text, target_id from import_rows where batch_id = $1 and ($2::text is null or status = $2)
          order by row_no offset $3 limit 200`, [bid, status && /^[a-z_]{3,20}$/.test(status) ? status : null, Math.max(0, Number(offset) || 0)]);
      return { ...b, rows: rows.rows.map((r) => ({ rowNo: r.row_no, status: r.status, errors: r.errors, warnings: r.warnings, data: r.data, amount: r.amount, targetId: r.target_id })) };
    });
  }

  /** Hata satırları CSV: düzeltip yeniden yüklemek için (formül enjeksiyonu korumalı, “;” ayırıcı, BOM). */
  @Get("imports/:id/errors.csv")
  @Require("import.manage")
  async errorsCsv(@Ctx() ctx: RequestContext, @Param("id", id) bid: string, @Res() res: Response) {
    const out = await this.db.tx(ctx, async (c) => {
      const b = await this.load(c, bid);
      const rows = (await c.query("select row_no, status, errors, data from import_rows where batch_id = $1 and status in ('error','duplicate') order by row_no", [bid])).rows;
      return { b, rows };
    });
    const keys = IMPORT_FIELDS[out.b.kind as ImportKind].map((f) => f.key);
    const lines = [["satir", "durum", "hatalar", ...keys].map(csvCell).join(";")];
    for (const r of out.rows) lines.push([r.row_no, r.status, (r.errors as RowErr[]).map((e) => `${e.field}: ${e.message}`).join(" | "), ...keys.map((k) => r.data[k] ?? r.data[`${k}_masked`] ?? "")].map(csvCell).join(";"));
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="viadent-aktarim-hatalari-${bid.slice(0, 8)}.csv"`);
    res.send(`﻿${lines.join("\r\n")}\r\n`);
  }

  @Post("imports/:id/commit")
  @HttpCode(200)
  @Require("import.manage")
  commit(@Ctx() ctx: RequestContext, @Param("id", id) bid: string) {
    return this.db.tx(ctx, async (c) => {
      const b = (await c.query("select * from import_batches where id = $1 for update", [bid])).rows[0];
      if (!b) throw Errors.notFound("Aktarım");
      if (b.status !== "dry_run") throw new AppError(409, "IMPORT_ALREADY_COMMITTED", "Bu aktarım daha önce onaylanmış veya geri alınmış; tekrar yazılmaz.");
      // Aynı klinikte eşzamanlı iki onay aynı kaynak no'yu yazmasın.
      await c.query("select pg_advisory_xact_lock(hashtext('import:' || $1::text))", [ctx.tenantId]);
      const rows = (await c.query("select id, row_no, data from import_rows where batch_id = $1 and status = 'valid' order by row_no", [bid])).rows;
      let imported = 0, skipped = 0;
      let amountImported = 0n;
      for (const r of rows) {
        const d = r.data as Record<string, string | null>;
        if (b.kind === "patients") {
          // Dry-run'dan sonra değişmiş olabilir: kaynak no ve güçlü mükerrer adaylar yeniden kontrol edilir.
          const nid = d.national_id_enc ? decryptField(d.national_id_enc) : null;
          const ex = await c.query("select 1 from patients where external_ref = $1 and status = 'active'", [d.external_ref]);
          const cands = ex.rowCount ? [] : await this.patients.findDuplicates(c, ctx, { firstName: d.first_name!, lastName: d.last_name!, birthDate: d.birth_date ?? null,
            phoneDigits: d.phone_digits ?? null, nationalIdType: d.national_id_type ?? undefined, nationalId: nid ?? undefined });
          if (ex.rowCount || cands.some((x) => x.kind === "same_identity" || x.kind === "same_person_likely")) {
            await c.query("update import_rows set status = 'skipped', warnings = warnings || $2::jsonb where id = $1",
              [r.id, JSON.stringify([{ field: "external_ref", message: "Onay anında mükerrer bulundu; yazılmadı" }])]);
            skipped++; continue;
          }
          const fileNo = (await c.query(
            `insert into tenant_counters(tenant_id, name, value) values ($1,'patient_file_no',1)
             on conflict (tenant_id, name) do update set value = tenant_counters.value + 1 returning value`, [ctx.tenantId])).rows[0].value;
          const p = await c.query(
            `insert into patients(tenant_id, file_no, first_name, last_name, search_text, birth_date, gender, national_id_type, national_id_enc, national_id_hmac,
               phone_e164, phone_digits, email, city, referral_source, external_ref, import_batch_id, created_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
            [ctx.tenantId, fileNo, d.first_name, d.last_name, normalizeSearch(`${d.first_name} ${d.last_name}`), d.birth_date ?? null, d.gender ?? null,
             d.national_id_type ?? null, nid ? encryptField(nid) : null, nid ? indexHash(ctx.tenantId, nid) : null, d.phone_e164 ?? null, d.phone_digits ?? null, d.email ?? null, d.city ?? null,
             d.referral_source ?? null, d.external_ref, bid, ctx.userId]);
          await c.query("update import_rows set status = 'imported', target_id = $2 where id = $1", [r.id, p.rows[0].id]);
        } else if (b.kind === "appointment_history") {
          const ex = await c.query(
            `select 1 from appointments a where (($1::text is not null and a.external_ref = $1) or (a.patient_id = $2 and a.practitioner_id = $3 and a.starts_at = $4::timestamptz))
               and not exists (select 1 from import_batches b where b.id = a.import_batch_id and b.status = 'rolled_back') limit 1`,
            [d.external_ref, d.patient_id, d.practitioner_id, d.starts_at]);
          const pt = await c.query("select 1 from patients where id = $1 and status = 'active'", [d.patient_id]);
          const ov = d.status === "cancelled" ? { rowCount: 0 } : await c.query(
            `select 1 from appointments where practitioner_id = $1 and status <> 'cancelled' and tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)') limit 1`,
            [d.practitioner_id, d.starts_at, d.ends_at]);
          if (ex.rowCount || !pt.rowCount || ov.rowCount) {
            await c.query("update import_rows set status = 'skipped', warnings = warnings || $2::jsonb where id = $1",
              [r.id, JSON.stringify([{ field: "time", message: "Onay anında randevu zaten var, hasta yok ya da çakışma oluştu; yazılmadı" }])]);
            skipped++; continue;
          }
          const a = await c.query(
            `insert into appointments(tenant_id, branch_id, patient_id, practitioner_id, starts_at, ends_at, status, reason, note, cancel_reason, completed_at, external_ref, import_batch_id, created_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
            [ctx.tenantId, d.branch_id, d.patient_id, d.practitioner_id, d.starts_at, d.ends_at, d.status, d.reason, d.note,
             d.status === "cancelled" ? "Önceki sistemden aktarıldı (iptal)" : null, d.status === "completed" ? d.ends_at : null, d.external_ref, bid, ctx.userId]);
          await c.query("update import_rows set status = 'imported', target_id = $2 where id = $1", [r.id, a.rows[0].id]);
        } else if (b.kind === "treatment_history") {
          const ex = await c.query(
            `select 1 from performed_procedures pp where (($1::text is not null and pp.external_ref = $1)
                or (pp.patient_id = $2 and pp.procedure_id = $3 and pp.practitioner_id = $4 and pp.completed_at = $5::timestamptz and coalesce(pp.tooth, '') = $6))
               and pp.status <> 'cancelled' and not exists (select 1 from import_batches b where b.id = pp.import_batch_id and b.status = 'rolled_back') limit 1`,
            [d.external_ref, d.patient_id, d.procedure_id, d.practitioner_id, d.completed_at, d.tooth ?? ""]);
          const pt = await c.query("select 1 from patients where id = $1 and status = 'active'", [d.patient_id]);
          if (ex.rowCount || !pt.rowCount) {
            await c.query("update import_rows set status = 'skipped', warnings = warnings || $2::jsonb where id = $1",
              [r.id, JSON.stringify([{ field: "procedure", message: "Onay anında işlem zaten var ya da hasta yok; yazılmadı" }])]);
            skipped++; continue;
          }
          const amt = (await c.query("select amount::text from import_rows where id = $1", [r.id])).rows[0].amount as string | null;
          // Alacak ÜRETİLMEZ (ADR-075): bedel yalnız bilgi amaçlı snapshot; borç açılış bakiyesiyle gelir.
          const pp = await c.query(
            `insert into performed_procedures(tenant_id, patient_id, appointment_id, procedure_id, procedure_code, procedure_name, location_kind, tooth, quantity, amount, price_basis,
               practitioner_id, note, completed_by, completed_at, external_ref, import_batch_id)
             values ($1,$2,null,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11,$12,$13,$14,$15) returning id`,
            [ctx.tenantId, d.patient_id, d.procedure_id, d.procedure_code, d.procedure_name, d.location_kind, d.tooth ?? null, d.quantity, amt ?? "0.00",
             d.practitioner_id, d.note, ctx.membershipId, d.completed_at, d.external_ref, bid]);
          await c.query("update import_rows set status = 'imported', target_id = $2 where id = $1", [r.id, pp.rows[0].id]);
          amountImported += toMinor(amt ?? "0.00");
        } else {
          const st = await c.query("select 1 from patients where id = $1 and status = 'active'", [d.patient_id]);
          const ob = await c.query("select 1 from receivables where patient_id = $1 and source = 'opening_balance' and status = 'active'", [d.patient_id]);
          if (!st.rowCount || ob.rowCount) {
            await c.query("update import_rows set status = 'skipped', warnings = warnings || $2::jsonb where id = $1",
              [r.id, JSON.stringify([{ field: "amount", message: "Onay anında hasta yok veya açılış bakiyesi zaten var; yazılmadı" }])]);
            skipped++; continue;
          }
          const amt = (await c.query("select amount::text from import_rows where id = $1", [r.id])).rows[0].amount as string;
          await lockAccount(c, String(d.patient_id));
          const rc = await c.query(
            `insert into receivables(tenant_id, patient_id, source, description, amount, due_date, import_batch_id, created_by)
             values ($1,$2,'opening_balance',$3,$4,$5,$6,$7) returning id`,
            [ctx.tenantId, d.patient_id, d.description, amt, d.as_of, bid, ctx.userId]);
          await c.query("update import_rows set status = 'imported', target_id = $2 where id = $1", [r.id, rc.rows[0].id]);
          amountImported += toMinor(amt);
          await enqueue(c, ctx.tenantId, "via_net.changed", { patientId: d.patient_id });
        }
        imported++;
      }
      const summary = { ...b.summary, imported, skippedAtCommit: skipped, ...(b.kind === "opening_balances" || b.kind === "treatment_history" ? { amountImported: fromMinor(amountImported) } : {}) };
      await c.query("update import_batches set status = 'committed', committed_by = $2, committed_at = now(), summary = $3 where id = $1", [bid, ctx.userId, JSON.stringify(summary)]);
      await audit(c, ctx, { action: "import.commit", entityType: "import_batch", entityId: bid,
        changes: { kind: { from: null, to: b.kind }, imported: { from: null, to: imported }, skipped: { from: null, to: skipped },
          ...(b.kind === "opening_balances" ? { amount: { from: null, to: fromMinor(amountImported) } } : {}) } });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "import.commit" });
      return this.load(c, bid);
    });
  }

  /** Geri alma: yalnız aktarımdan sonra hiçbir işlem görmemiş kayıtlar. Hasta arşivlenir (silinmez), açılış alacağı iptal edilir. */
  @Post("imports/:id/rollback")
  @HttpCode(200)
  @Require("import.manage")
  rollback(@Ctx() ctx: RequestContext, @Param("id", id) bid: string, @Body() body: unknown) {
    const i = parse(ImportRollback, body);
    return this.db.tx(ctx, async (c) => {
      const b = (await c.query("select * from import_batches where id = $1 for update", [bid])).rows[0];
      if (!b) throw Errors.notFound("Aktarım");
      if (b.status !== "committed") throw new AppError(409, "IMPORT_NOT_COMMITTED", "Yalnız onaylanmış aktarım geri alınabilir.");
      const rows = (await c.query("select id, target_id from import_rows where batch_id = $1 and status = 'imported'", [bid])).rows;
      const blocked: string[] = [];
      for (const r of rows) {
        if (b.kind === "patients") {
          for (const t of DEPENDENT_TABLES) {
            if ((await c.query(`select 1 from ${t} where patient_id = $1 limit 1`, [r.target_id])).rowCount) { blocked.push(`${r.target_id}:${t}`); break; }
          }
          const v = (await c.query("select version from patients where id = $1", [r.target_id])).rows[0];
          if (v && v.version > 1) blocked.push(`${r.target_id}:güncellendi`);
        } else if (b.kind === "appointment_history") {
          const v = (await c.query("select version from appointments where id = $1", [r.target_id])).rows[0];
          if (v && v.version > 1) blocked.push(`${r.target_id}:güncellendi`);
          for (const t of ["performed_procedures", "clinical_notes", "lab_orders", "follow_ups"]) {
            if ((await c.query(`select 1 from ${t} where appointment_id = $1 limit 1`, [r.target_id])).rowCount) { blocked.push(`${r.target_id}:${t}`); break; }
          }
        } else if (b.kind === "treatment_history") {
          const st = (await c.query("select status from performed_procedures where id = $1", [r.target_id])).rows[0];
          if (st && st.status !== "completed") blocked.push(`${r.target_id}:düzeltildi`);
          if ((await c.query("select 1 from receivables where performed_procedure_id = $1 limit 1", [r.target_id])).rowCount) blocked.push(`${r.target_id}:alacak`);
        } else if ((await c.query("select 1 from allocations where receivable_id = $1 limit 1", [r.target_id])).rowCount) blocked.push(`${r.target_id}:dağıtım`);
      }
      if (blocked.length) {
        throw new AppError(409, "IMPORT_HAS_ACTIVITY", `Aktarılan ${blocked.length} kayıt üzerinde sonradan işlem yapılmış; aktarım geri alınamaz. Bu kayıtları tek tek düzeltin.`,
          undefined, { blocked: blocked.length });
      }
      for (const r of rows) {
        if (b.kind === "patients") await c.query("update patients set status = 'archived' where id = $1", [r.target_id]);
        else if (b.kind === "treatment_history") await c.query(
          "update performed_procedures set status = 'cancelled', status_reason = $2 where id = $1 and import_batch_id = $3", [r.target_id, `Aktarım geri alındı: ${i.reason}`, bid]);
        else if (b.kind === "appointment_history") await c.query(
          "update appointments set status = 'cancelled', cancel_reason = $2, completed_at = null, updated_by = $3, updated_at = now() where id = $1 and import_batch_id = $4",
          [r.target_id, `Aktarım geri alındı: ${i.reason}`, ctx.userId, bid]); // silme yok: iptal + gerekçe; kaynak no korunur, yeniden aktarılabilir
        else await c.query("update receivables set status = 'cancelled', cancel_reason = $2, cancelled_at = now(), cancelled_by = $3 where id = $1",
          [r.target_id, `Aktarım geri alındı: ${i.reason}`, ctx.userId]);
        await c.query("update import_rows set status = 'rolled_back' where id = $1", [r.id]);
      }
      await c.query("update import_batches set status = 'rolled_back', rolled_back_by = $2, rolled_back_at = now(), rollback_reason = $3 where id = $1", [bid, ctx.userId, i.reason]);
      await audit(c, ctx, { action: "import.rollback", entityType: "import_batch", entityId: bid, changes: { rows: { from: null, to: rows.length }, reason: { from: null, to: i.reason } } });
      return this.load(c, bid);
    });
  }
}
