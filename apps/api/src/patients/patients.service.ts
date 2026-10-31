import { Inject, Injectable } from "@nestjs/common";
import type pg from "pg";
import {
  isValidTckn, localDate, maskNationalId, maskPhone, normalizePhone, normalizeSearch, toTitleTr,
  type PatientCreate, type PatientUpdate,
} from "@viadent/contracts";
import { Db } from "../infra/db.service.js";
import { AppError, Errors } from "../infra/errors.js";
import { has, type RequestContext } from "../infra/context.js";
import { audit, diff, enqueue } from "../audit/audit.js";

export interface DuplicateCandidate {
  id: string;
  fileNo: number;
  fullName: string;
  birthDate: string | null;
  phoneMasked: string | null;
  kind: "same_identity" | "same_person_likely" | "shared_phone" | "same_name";
  reason: string;
}

const COLUMNS = `p.id, p.file_no, p.first_name, p.last_name, p.birth_date, p.gender, p.national_id_type, p.national_id,
  p.phone_e164, p.email, p.city, p.preferred_language, p.primary_practitioner_id, p.referral_source, p.status,
  p.created_at, p.updated_at, p.version`;

function ageOn(birth: string | null, today: string): number | null {
  if (!birth) return null;
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty! - by!;
  if (tm! < bm! || (tm === bm && td! < bd!)) age--;
  return age >= 0 ? age : null;
}

@Injectable()
export class PatientsService {
  constructor(@Inject(Db) private readonly db: Db) {}

  present(ctx: RequestContext, r: Record<string, any>) {
    const unmask = has(ctx, "patient.identity.unmask");
    const today = localDate(new Date(), ctx.timezone);
    return {
      id: r.id,
      fileNo: r.file_no,
      firstName: r.first_name,
      lastName: r.last_name,
      fullName: `${r.first_name} ${r.last_name}`,
      birthDate: r.birth_date,
      age: ageOn(r.birth_date, today),
      gender: r.gender,
      nationalIdType: r.national_id_type,
      nationalId: unmask ? r.national_id : maskNationalId(r.national_id),
      phone: unmask ? r.phone_e164 : maskPhone(r.phone_e164),
      phoneMasked: !unmask && !!r.phone_e164,
      email: r.email,
      city: r.city,
      primaryPractitionerId: r.primary_practitioner_id,
      primaryPractitionerName: r.practitioner_name ?? null,
      referralSource: r.referral_source,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      version: r.version,
      nextAppointmentAt: r.next_appointment_at ?? null,
      lastVisitAt: r.last_visit_at ?? null,
    };
  }

  private validateCommon(ctx: RequestContext, input: { birthDate?: string | null; nationalIdType?: string; nationalId?: string; phone?: string | null }) {
    const errors: Record<string, string> = {};
    if (input.birthDate) {
      const today = localDate(new Date(), ctx.timezone);
      if (input.birthDate > today) errors.birthDate = "Doğum tarihi gelecekte olamaz.";
      else if (input.birthDate < "1900-01-01") errors.birthDate = "Doğum tarihi 01.01.1900'den önce olamaz.";
    }
    if (input.nationalIdType === "tckn" && input.nationalId && !isValidTckn(input.nationalId)) {
      errors.nationalId = "T.C. Kimlik No biçimi geçersiz (11 hane ve kontrol basamakları).";
    }
    let phone: { e164: string; digits: string } | null = null;
    if (input.phone) {
      phone = normalizePhone(input.phone);
      if (!phone) errors.phone = "Telefon numarası geçersiz.";
    }
    if (Object.keys(errors).length) throw Errors.validation(errors);
    return { phone };
  }

  async findDuplicates(c: pg.PoolClient, ctx: RequestContext, input: { firstName: string; lastName: string; birthDate?: string | null; phoneDigits?: string | null; nationalIdType?: string; nationalId?: string }, excludeId?: string): Promise<DuplicateCandidate[]> {
    const name = normalizeSearch(`${input.firstName} ${input.lastName}`);
    const r = await c.query(
      `select id, file_no, first_name, last_name, birth_date, phone_e164,
              (national_id is not null and national_id_type = $1 and national_id = $2) as same_id,
              search_text = $3 as same_name,
              similarity(search_text, $3) as sim,
              ($4::date is not null and birth_date = $4::date) as same_birth,
              ($5::text is not null and phone_digits = $5) as same_phone
         from patients
        where status = 'active' and ($6::uuid is null or id <> $6::uuid)
          and ( ($2::text is not null and national_id_type = $1 and national_id = $2)
             or ($4::date is not null and birth_date = $4::date and search_text % $3)
             or ($5::text is not null and phone_digits = $5)
             or search_text = $3 )
        order by same_id desc, sim desc
        limit 10`,
      [input.nationalIdType ?? null, input.nationalId ?? null, name, input.birthDate ?? null, input.phoneDigits ?? null, excludeId ?? null],
    );
    const unmask = has(ctx, "patient.identity.unmask");
    return r.rows.map((x) => {
      let kind: DuplicateCandidate["kind"];
      let reason: string;
      if (x.same_id) { kind = "same_identity"; reason = "Aynı kimlik numarası kayıtlı."; }
      else if ((x.same_birth && x.sim >= 0.6) || (x.same_name && x.same_phone)) { kind = "same_person_likely"; reason = x.same_birth ? "Benzer ad ve aynı doğum tarihi." : "Aynı ad ve aynı telefon."; }
      else if (x.same_phone) { kind = "shared_phone"; reason = "Aynı telefonu kullanan kayıt (aile bireyi olabilir; kayıt engellenmez)."; }
      else { kind = "same_name"; reason = "Aynı ad soyadla kayıt var."; }
      return {
        id: x.id, fileNo: x.file_no, fullName: `${x.first_name} ${x.last_name}`, birthDate: x.birth_date,
        phoneMasked: unmask ? x.phone_e164 : maskPhone(x.phone_e164), kind, reason,
      };
    });
  }

  async checkDuplicates(ctx: RequestContext, input: PatientCreate) {
    const { phone } = this.validateCommon(ctx, input);
    return this.db.tx(ctx, (c) =>
      this.findDuplicates(c, ctx, { ...input, firstName: input.firstName, lastName: input.lastName, phoneDigits: phone?.digits ?? null }),
    );
  }

  async create(ctx: RequestContext, input: PatientCreate) {
    const { phone } = this.validateCommon(ctx, input);
    const firstName = toTitleTr(input.firstName);
    const lastName = toTitleTr(input.lastName);
    return this.db.tx(ctx, async (c) => {
      const candidates = await this.findDuplicates(c, ctx, { ...input, firstName, lastName, phoneDigits: phone?.digits ?? null });
      if (candidates.some((d) => d.kind === "same_identity")) {
        throw new AppError(409, "DUPLICATE_IDENTITY", "Bu kimlik numarasıyla kayıtlı bir hasta var.", { nationalId: "Kimlik numarası başka bir hastada kayıtlı." }, { candidates });
      }
      if (!input.acknowledgeDuplicates && candidates.some((d) => d.kind === "same_person_likely")) {
        throw new AppError(409, "DUPLICATE_CANDIDATES", "Aynı kişi olabilecek kayıtlar bulundu. Kontrol edip onaylayın.", undefined, { candidates });
      }
      if (input.primaryPractitionerId) await this.assertPractitioner(c, input.primaryPractitionerId);
      const fileNo = await c.query(
        `insert into tenant_counters(tenant_id, name, value) values ($1,'patient_file_no',1)
         on conflict (tenant_id, name) do update set value = tenant_counters.value + 1 returning value`,
        [ctx.tenantId],
      );
      const r = await c.query(
        `insert into patients(tenant_id, file_no, first_name, last_name, search_text, birth_date, gender, national_id_type, national_id,
            phone_e164, phone_digits, email, city, primary_practitioner_id, referral_source, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         returning ${COLUMNS.replace(/p\./g, "")}`,
        [ctx.tenantId, fileNo.rows[0].value, firstName, lastName, normalizeSearch(`${firstName} ${lastName}`), input.birthDate ?? null,
         input.gender ?? null, input.nationalIdType ?? null, input.nationalId ?? null, phone?.e164 ?? null, phone?.digits ?? null,
         input.email ?? null, input.city ?? null, input.primaryPractitionerId ?? null, input.referralSource ?? null, ctx.userId],
      );
      const row = r.rows[0];
      await audit(c, ctx, {
        action: "patient.create", entityType: "patient", entityId: row.id, patientId: row.id,
        changes: diff(null, row, ["first_name", "last_name", "birth_date", "gender", "national_id", "phone_e164", "email", "city", "primary_practitioner_id", "referral_source"],
          { national_id: (v) => maskNationalId(v as string | null), phone_e164: (v) => maskPhone(v as string | null) }),
      });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "patient.create" });
      return { patient: this.present(ctx, row), warnings: candidates.filter((d) => d.kind !== "same_person_likely") };
    });
  }

  private async assertPractitioner(c: pg.PoolClient, id: string) {
    const r = await c.query("select 1 from practitioners where id = $1 and active", [id]);
    if (!r.rowCount) throw Errors.validation({ primaryPractitionerId: "Hekim bulunamadı." });
  }

  async search(ctx: RequestContext, q: string | undefined, limit: number) {
    return this.db.tx(ctx, async (c) => {
      const term = (q ?? "").trim();
      const digits = term.replace(/\D+/g, "");
      const norm = normalizeSearch(term);
      const tokens = norm ? norm.split(" ").map((t) => `%${t}%`) : [];
      const isNumeric = !!term && /^[\d\s+()-]+$/.test(term);
      const r = await c.query(
        `select ${COLUMNS}, pr.display_name as practitioner_name,
                (select min(a.starts_at) from appointments a where a.patient_id = p.id and a.starts_at >= now() and a.status not in ('cancelled','no_show')) as next_appointment_at,
                (select max(a.starts_at) from appointments a where a.patient_id = p.id and a.status in ('checked_in','in_progress','completed')) as last_visit_at
           from patients p left join practitioners pr on pr.id = p.primary_practitioner_id
          where p.status = 'active' and (
                $1::boolean is false
             or ($2::boolean and (p.file_no::text = $3 or (length($3) >= 4 and p.phone_digits like '%' || $3 || '%') or p.national_id = $3))
             or (not $2::boolean and p.search_text like all ($4::text[])) )
          order by case when $5 <> '' then similarity(p.search_text, $5) else 0 end desc, p.last_name, p.first_name
          limit $6`,
        [!!term, isNumeric, digits, tokens, norm, limit],
      );
      return r.rows.map((row) => this.present(ctx, row));
    });
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(
        `select ${COLUMNS}, pr.display_name as practitioner_name,
                (select min(a.starts_at) from appointments a where a.patient_id = p.id and a.starts_at >= now() and a.status not in ('cancelled','no_show')) as next_appointment_at,
                (select max(a.starts_at) from appointments a where a.patient_id = p.id and a.status in ('checked_in','in_progress','completed')) as last_visit_at
           from patients p left join practitioners pr on pr.id = p.primary_practitioner_id where p.id = $1`,
        [id],
      );
      if (!r.rowCount) {
        // Başka kliniğin kaydı RLS nedeniyle "yok" görünür; varlık bilgisi sızdırılmaz ama girişim kaydedilir (AT-01).
        await audit(c, ctx, { action: "access.denied_or_missing", entityType: "patient", entityId: id });
        return null;
      }
      const openTasks = await c.query("select count(*)::int as n from tasks where patient_id = $1 and status in ('open','in_progress','blocked')", [id]);
      return { ...this.present(ctx, r.rows[0]), openTaskCount: openTasks.rows[0].n };
    });
  }

  async update(ctx: RequestContext, id: string, input: PatientUpdate) {
    const { phone } = this.validateCommon(ctx, { birthDate: input.birthDate, phone: input.phone });
    return this.db.tx(ctx, async (c) => {
      const cur = await c.query(`select ${COLUMNS.replace(/p\./g, "")} from patients where id = $1 for update`, [id]);
      const before = cur.rows[0];
      if (!before) throw Errors.notFound("Hasta");
      if (before.version !== input.version) throw Errors.versionConflict();
      if (input.primaryPractitionerId) await this.assertPractitioner(c, input.primaryPractitionerId);
      const next = { ...before };
      if (input.firstName !== undefined) next.first_name = toTitleTr(input.firstName);
      if (input.lastName !== undefined) next.last_name = toTitleTr(input.lastName);
      if (input.birthDate !== undefined) next.birth_date = input.birthDate;
      if (input.gender !== undefined) next.gender = input.gender;
      if (input.phone !== undefined) next.phone_e164 = phone?.e164 ?? null;
      if (input.email !== undefined) next.email = input.email;
      if (input.city !== undefined) next.city = input.city;
      if (input.primaryPractitionerId !== undefined) next.primary_practitioner_id = input.primaryPractitionerId;
      if (input.referralSource !== undefined) next.referral_source = input.referralSource;
      const changes = diff(before, next, ["first_name", "last_name", "birth_date", "gender", "phone_e164", "email", "city", "primary_practitioner_id", "referral_source"],
        { phone_e164: (v) => maskPhone(v as string | null) });
      if (!Object.keys(changes).length) return this.present(ctx, before);
      const r = await c.query(
        `update patients set first_name=$2, last_name=$3, search_text=$4, birth_date=$5, gender=$6, phone_e164=$7, phone_digits=$8,
           email=$9, city=$10, primary_practitioner_id=$11, referral_source=$12, updated_at=now(), updated_by=$13, version = version + 1
         where id = $1 returning ${COLUMNS.replace(/p\./g, "")}`,
        [id, next.first_name, next.last_name, normalizeSearch(`${next.first_name} ${next.last_name}`), next.birth_date, next.gender,
         next.phone_e164, next.phone_e164 ? next.phone_e164.slice(1) : null, next.email, next.city, next.primary_practitioner_id,
         next.referral_source, ctx.userId],
      );
      await audit(c, ctx, { action: "patient.update", entityType: "patient", entityId: id, patientId: id, changes });
      await enqueue(c, ctx.tenantId, "via_akis.refresh", { reason: "patient.update" });
      return this.present(ctx, r.rows[0]);
    });
  }

  /** VİA İz: okunabilir hasta geçmişi. Klinik içerik değişiklikleri yalnız sağlık yetkisiyle görünür. */
  async history(ctx: RequestContext, id: string) {
    return this.db.tx(ctx, async (c) => {
      const exists = await c.query("select 1 from patients where id = $1", [id]);
      if (!exists.rowCount) return null;
      const r = await c.query(
        `select e.id, e.action, e.entity_type, e.entity_id, e.changes, e.created_at, u.full_name as actor_name
           from audit_events e left join users u on u.id = e.actor_user_id
          where e.patient_id = $1 and ($2::boolean or e.entity_type <> 'clinical_note')
          order by e.created_at desc, e.id desc limit 200`,
        [id, has(ctx, "patient.health.read")],
      );
      return r.rows.map((e) => ({
        id: String(e.id), action: e.action, entityType: e.entity_type, entityId: e.entity_id,
        actorName: e.actor_name ?? "Sistem", at: e.created_at, changes: e.changes,
      }));
    });
  }
}
