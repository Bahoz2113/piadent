/**
 * TAMAMEN SENTETİK demo verisi: iki tenant, farklı roller, hasta ve randevular.
 * Gerçek kişi, telefon veya kimlik numarası içermez (telefonlar +90 555 000 xx xx test bloğu,
 * e-postalar ayrılmış .test alan adı). Parola koda gömülmez.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { normalizeSearch, zonedToUtc, localDate, addDays } from "@viadent/contracts";
import { loadEnv, requireEnv } from "./env.js";
import { hashPassword } from "./password.js";

export interface SeedResult {
  password: string;
  tenants: Record<string, { id: string; branchId: string }>;
  users: Record<string, string>;
}

const FIRST = ["Ayşe", "Mehmet", "Zeynep", "Mustafa", "Elif", "Ahmet", "Şule", "Emre", "Gülşen", "Burak", "İrem", "Oğuz", "Çağla", "Kaan", "Ümran", "Selin", "Yusuf", "Deniz", "Hülya", "Barış"];
const LAST = ["Demir", "Yıldız", "Kaya", "Şahin", "Çelik", "Öztürk", "Aydın", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Koç", "Kurt", "Özdemir"];

export async function seed(connectionString: string, opts: { password?: string; now?: Date; quiet?: boolean } = {}): Promise<SeedResult> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const password = opts.password || randomBytes(9).toString("base64url");
  const now = opts.now ?? new Date();
  const log = opts.quiet ? () => undefined : console.log;
  const hash = await hashPassword(password);
  const result: SeedResult = { password, tenants: {}, users: {} };

  const client = await pool.connect();
  try {
    await client.query("begin");
    const exists = await client.query("select 1 from users where lower(email) = 'yonetici@demo-yesil.test'");
    if (exists.rowCount) throw new Error("Demo verisi zaten var. Sıfırlamak için: pnpm db:reset && pnpm db:seed");

    const userDefs: [string, string, string][] = [
      ["yonetici@demo-yesil.test", "Selma Tekin", "a_admin"],
      ["elif.aras@demo-yesil.test", "Dt. Elif Aras", "a_dentist"],
      ["kerem.tunc@demo-yesil.test", "Dt. Kerem Tunç", "a_dentist2"],
      ["sekreter@demo-yesil.test", "Nur Ekinci", "a_secretary"],
      ["asistan@demo-yesil.test", "Can Ulu", "a_assistant"],
      ["finans@demo-yesil.test", "Ece Bal", "a_finance"],
      ["yonetici@demo-mavi.test", "Orhan Sezer", "b_admin"],
      ["hekim@demo-mavi.test", "Dt. Lale Önal", "b_dentist"],
      ["coklu@demo.test", "Dt. Murat İnce (iki klinik)", "multi"],
    ];
    for (const [email, name, key] of userDefs) {
      const r = await client.query("insert into users(email, password_hash, full_name) values ($1,$2,$3) returning id", [email, hash, name]);
      result.users[key] = r.rows[0].id;
    }

    const tenantDefs = [
      { key: "A", slug: "demo-yesil", name: "Yeşilvadi Ağız ve Diş Sağlığı (Demo)", patients: 24,
        members: [["a_admin", "clinic_admin"], ["a_dentist", "dentist"], ["a_dentist2", "dentist"], ["a_secretary", "secretary"], ["a_assistant", "assistant"], ["a_finance", "finance"], ["multi", "dentist"]],
        practitioners: [["a_dentist", "Dt. Elif Aras"], ["a_dentist2", "Dt. Kerem Tunç"], ["multi", "Dt. Murat İnce"]],
        chairs: ["Koltuk 1", "Koltuk 2", "Koltuk 3"] },
      { key: "B", slug: "demo-mavi", name: "Mavikent Diş Kliniği (Demo)", patients: 8,
        members: [["b_admin", "clinic_admin"], ["b_dentist", "dentist"], ["multi", "clinic_admin"]],
        practitioners: [["b_dentist", "Dt. Lale Önal"]],
        chairs: ["Ünit A", "Ünit B"] },
    ] as const;

    let phoneSeq = 0;
    for (const t of tenantDefs) {
      const tr = await client.query("insert into tenants(slug, name, is_demo) values ($1,$2,true) returning id, timezone", [t.slug, t.name]);
      const tenantId: string = tr.rows[0].id;
      const tz: string = tr.rows[0].timezone;
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      await (async (c: pg.PoolClient) => {
        const br = await c.query("insert into branches(tenant_id, name) values ($1,'Merkez') returning id", [tenantId]);
        const branchId: string = br.rows[0].id;
        result.tenants[t.key] = { id: tenantId, branchId };
        const membershipIds: Record<string, string> = {};
        for (const [uk, role] of t.members) {
          const m = await c.query("insert into memberships(tenant_id, user_id, role) values ($1,$2,$3) returning id", [tenantId, result.users[uk], role]);
          membershipIds[uk] = m.rows[0].id;
        }
        const pracIds: string[] = [];
        for (const [uk, name] of t.practitioners) {
          const p = await c.query(
            "insert into practitioners(tenant_id, branch_id, membership_id, display_name) values ($1,$2,$3,$4) returning id",
            [tenantId, branchId, membershipIds[uk], name],
          );
          pracIds.push(p.rows[0].id);
        }
        const chairIds: string[] = [];
        for (const name of t.chairs) {
          const ch = await c.query("insert into chairs(tenant_id, branch_id, name) values ($1,$2,$3) returning id", [tenantId, branchId, name]);
          chairIds.push(ch.rows[0].id);
        }
        const creator = result.users[t.members[0][0]];
        const patientIds: string[] = [];
        let familyPhone: string | null = null;
        for (let i = 0; i < t.patients; i++) {
          const first = FIRST[(i * 7 + (t.key === "B" ? 3 : 0)) % FIRST.length]!;
          const last = LAST[(i * 5 + (t.key === "B" ? 2 : 0)) % LAST.length]!;
          let phone: string | null = `+905550${String(100000 + phoneSeq++).slice(-6)}`;
          if (i === 3) familyPhone = phone;
          if (i === 4) phone = familyPhone; // aile: ortak telefon (AT-04)
          if (i === 7) phone = null; // eksik iletişim → VİA Akış görevi
          const year = 1950 + ((i * 13) % 65);
          const birth = i === 9 ? null : `${year}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`;
          const counter = await c.query(
            `insert into tenant_counters(tenant_id, name, value) values ($1,'patient_file_no',1)
             on conflict (tenant_id, name) do update set value = tenant_counters.value + 1 returning value`,
            [tenantId],
          );
          const p = await c.query(
            `insert into patients(tenant_id, file_no, first_name, last_name, search_text, birth_date, gender,
               phone_e164, phone_digits, primary_practitioner_id, created_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
            [tenantId, counter.rows[0].value, first, last, normalizeSearch(`${first} ${last}`), birth,
             i % 3 === 0 ? "male" : i % 3 === 1 ? "female" : "unspecified",
             phone, phone?.slice(1) ?? null, pracIds[i % pracIds.length], creator],
          );
          patientIds.push(p.rows[0].id);
        }
        // Randevular: bugün ve yarın (klinik saatiyle). Bazıları geçmiş saatte "planned" → VİA Akış.
        const today = localDate(now, tz);
        const tomorrow = addDays(today, 1);
        const slots: [string, string, number, number, number, string][] = [
          [today, "09:00", 0, 0, 0, "completed"],
          [today, "09:30", 1, 1, 1, "checked_in"],
          [today, "10:00", 0, 2, 0, "planned"],
          [today, "11:00", 1, 3, 1, "confirmed"],
          [today, "14:00", 0, 4, 2, "planned"],
          [today, "15:30", 2, 5, 2, "planned"],
          [tomorrow, "09:00", 0, 6, 0, "planned"],
          [tomorrow, "10:00", 1, 7, 1, "planned"],
          [tomorrow, "11:30", 0, 8, 0, "confirmed"],
        ];
        for (const [day, time, pi, pati, ci, status] of slots) {
          if (pi >= pracIds.length || pati >= patientIds.length) continue;
          const start = zonedToUtc(day, time, tz);
          const end = new Date(start.getTime() + 30 * 60000);
          await c.query(
            `insert into appointments(tenant_id, branch_id, patient_id, practitioner_id, chair_id, starts_at, ends_at,
               status, reason, created_by, checked_in_at, completed_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [tenantId, branchId, patientIds[pati], pracIds[pi], chairIds[ci % chairIds.length], start, end, status,
             ["Kontrol muayenesi", "Dolgu", "Diş taşı temizliği", "Kanal tedavisi seansı"][pati % 4],
             creator,
             ["checked_in", "completed"].includes(status) ? start : null,
             status === "completed" ? end : null],
          );
        }
        // Görev 1: işlem türleri, çalışma saatleri (Pzt–Cum 09:00–18:00, Cmt 09:00–13:00), aile ilişkisi, demo anamnez.
        for (const [name, minutes] of [["Kontrol muayenesi", 20], ["Dolgu", 45], ["Diş taşı temizliği", 30], ["Kanal tedavisi seansı", 60], ["Diş çekimi", 30]] as const) {
          await c.query("insert into appointment_types(tenant_id, name, default_minutes) values ($1,$2,$3)", [tenantId, name, minutes]);
        }
        for (const pid of pracIds) {
          for (let wd = 1; wd <= 6; wd++) {
            await c.query("insert into work_schedules(tenant_id, practitioner_id, weekday, start_min, end_min) values ($1,$2,$3,$4,$5)",
              [tenantId, pid, wd, 9 * 60, wd === 6 ? 13 * 60 : 18 * 60]);
          }
        }
        // Ortak telefonu kullanan 3. ve 4. hasta: kardeş ilişkisi (yasal temsil işareti YOK; kanıt gerektirir).
        if (patientIds.length > 4) {
          await c.query(
            `insert into patient_relations(tenant_id, patient_id, related_patient_id, relation, can_receive_info, note, created_by)
             values ($1,$2,$3,'sibling',true,'Sentetik demo ilişkisi',$4)`,
            [tenantId, patientIds[4], patientIds[3], creator],
          );
        }
        const dentistKey = t.key === "A" ? "a_dentist" : "b_dentist";
        await c.query(
          `insert into anamnesis_versions(tenant_id, patient_id, version, questionnaire_version, answers, critical_flags, recorded_by)
           values ($1,$2,1,'demo-2026.10',$3,$4,$5)`,
          [tenantId, patientIds[0], JSON.stringify({ allergy: { value: "yes", detail: "Penisilin (sentetik demo)" }, anticoagulant: { value: "no" }, diabetes: { value: "no" } }),
           ["allergy"], membershipIds[dentistKey]],
        );
        // Görev 2: DEMO işlem kataloğu (klinik içi kodlar; resmî kod sistemi değildir) ve yayınlanmış sentetik tarife.
        const catalog: [string, string, string, string, number, string][] = [
          ["MUA-01", "Muayene ve tedavi planlama", "Muayene", "mouth", 20, "600.00"],
          ["RAD-01", "Periapikal röntgen", "Radyoloji", "tooth", 10, "250.00"],
          ["TEM-01", "Diş taşı temizliği (tüm ağız)", "Periodontoloji", "mouth", 30, "1200.00"],
          ["DOL-01", "Kompozit dolgu (tek yüz)", "Restoratif", "surface", 30, "1800.00"],
          ["DOL-02", "Kompozit dolgu (iki yüz)", "Restoratif", "surface", 45, "2300.00"],
          ["KAN-01", "Kanal tedavisi (tek kanal)", "Endodonti", "tooth", 60, "3500.00"],
          ["CEK-01", "Diş çekimi (basit)", "Cerrahi", "tooth", 30, "1500.00"],
          ["KRN-01", "Zirkonyum kron", "Protez", "tooth", 45, "7500.00"],
          ["FLU-01", "Flor uygulaması (çene)", "Koruyucu", "arch", 15, "500.00"],
        ];
        const procIds: Record<string, string> = {};
        for (const [code, name, cat, scope, min] of catalog) {
          const r = await c.query(
            "insert into procedures(tenant_id, code, name, category, tooth_scope, default_minutes) values ($1,$2,$3,$4,$5,$6) returning id",
            [tenantId, code, name, cat, scope, min],
          );
          procIds[code] = r.rows[0].id;
        }
        const tv = await c.query(
          `insert into tariff_versions(tenant_id, name, valid_from, created_by) values ($1,'2026 Genel Tarife (sentetik)','2026-01-01',$2) returning id`,
          [tenantId, creator],
        );
        for (const [code, , , , , price] of catalog) {
          await c.query("insert into tariff_items(tenant_id, tariff_version_id, procedure_id, price) values ($1,$2,$3,$4)", [tenantId, tv.rows[0].id, procIds[code], price]);
        }
        await c.query("update tariff_versions set status = 'published', published_at = now(), published_by = $2 where id = $1", [tv.rows[0].id, creator]);
        // İlk hastaya kabul edilmiş sentetik plan: 16 numaralı dişe kanal + kron, 26 MO dolgu.
        const dentistMembership = membershipIds[t.key === "A" ? "a_dentist" : "b_dentist"]!;
        const plan = await c.query("insert into treatment_plans(tenant_id, patient_id, title, created_by) values ($1,$2,'Başlangıç tedavi planı (sentetik)',$3) returning id",
          [tenantId, patientIds[0], creator]);
        const pv = await c.query(
          "insert into plan_versions(tenant_id, plan_id, version, tariff_version_id, practitioner_id, created_by) values ($1,$2,1,$3,$4,$5) returning id",
          [tenantId, plan.rows[0].id, tv.rows[0].id, pracIds[0], creator],
        );
        const items: [string, string | null, string[], number, string][] = [
          ["KAN-01", "16", [], 1, "3500.00"], ["KRN-01", "16", [], 2, "7500.00"], ["DOL-02", "26", ["M", "O"], 1, "2300.00"],
        ];
        for (const [i, [code, tooth, surf, session, price]] of items.entries()) {
          const name = catalog.find((x) => x[0] === code)![1];
          await c.query(
            `insert into plan_items(tenant_id, plan_version_id, procedure_id, procedure_code, procedure_name, location_kind, tooth, surfaces, unit_price, price_source, session_no, sort)
             values ($1,$2,$3,$4,$5,'tooth',$6,$7,$8,'tariff',$9,$10)`,
            [tenantId, pv.rows[0].id, procIds[code], code, name, tooth, surf, price, session, i],
          );
        }
        await c.query("update plan_versions set status = 'proposed', proposed_at = now(), proposed_by = $2 where id = $1", [pv.rows[0].id, creator]);
        await c.query("insert into plan_decisions(tenant_id, plan_version_id, decision, note, recorded_by) values ($1,$2,'accepted','Sentetik demo kabulü',$3)",
          [tenantId, pv.rows[0].id, dentistMembership]);
        await c.query("update plan_versions set status = 'accepted', decided_at = now() where id = $1", [pv.rows[0].id]);
        await c.query(
          `insert into odontogram_findings(tenant_id, patient_id, tooth, surfaces, finding_type, note, recorded_by) values
             ($1,$2,'16','{}','caries','Derin çürük (sentetik)',$3), ($1,$2,'36','{}','missing',null,$3), ($1,$2,'46','{O}','filling',null,$3)`,
          [tenantId, patientIds[0], dentistMembership],
        );
        // Görev 3: sentetik kasa/banka, DEMO prim kuralı ve küçük bir hesap senaryosu (1.000 alacak / 600 tahsilat / 300 avans).
        const cash = await c.query(
          `insert into cash_accounts(tenant_id, name, kind) values ($1,'Ana kasa (sentetik)','cash'), ($1,'Banka hesabı (sentetik)','bank'),
             ($1,'POS — manuel kayıt (sentetik)','pos_manual') returning id, kind`, [tenantId]);
        const cashId = cash.rows.find((r) => r.kind === "cash")!.id;
        const rule = await c.query(
          `insert into commission_rule_versions(tenant_id, rate, valid_from, note, created_by) values ($1, 10, '2026-01-01', 'DEMO: tahsilat bazlı %10 (sentetik)', $2) returning id`,
          [tenantId, creator]);
        if (patientIds.length >= 5) {
          const due = addDays(localDate(now, tz), -40);
          const rcv = await c.query(
            `insert into receivables(tenant_id, patient_id, source, description, amount, practitioner_id, due_date, created_by, created_at)
             values ($1,$2,'manual','Sentetik demo alacağı (protez ön ödemesi)',1000.00,$3,$4,$5, now() - interval '40 days') returning id`,
            [tenantId, patientIds[3], pracIds[0], due, creator]);
          await c.query(
            `insert into receivables(tenant_id, patient_id, source, description, amount, practitioner_id, due_date, created_by)
             values ($1,$2,'manual','Sentetik demo alacağı (kontrol paketi)',850.00,$3,$4,$5)`,
            [tenantId, patientIds[2], pracIds[0], addDays(localDate(now, tz), 14), creator]);
          const pay = await c.query(
            `insert into payments(tenant_id, patient_id, amount, method, cash_account_id, paid_at, note, received_by)
             values ($1,$2,600.00,'cash',$3, now() - interval '3 days','Sentetik demo tahsilatı',$4) returning id, paid_at`,
            [tenantId, patientIds[3], cashId, creator]);
          await c.query("insert into cash_movements(tenant_id, cash_account_id, amount, source, source_id, occurred_at) values ($1,$2,600.00,'payment',$3,$4)",
            [tenantId, cashId, pay.rows[0].id, pay.rows[0].paid_at]);
          const al = await c.query("insert into allocations(tenant_id, payment_id, receivable_id, amount, created_by, created_at) values ($1,$2,$3,600.00,$4, now() - interval '3 days') returning id",
            [tenantId, pay.rows[0].id, rcv.rows[0].id, creator]);
          await c.query(
            `insert into commission_accruals(tenant_id, practitioner_id, allocation_id, rule_version_id, base_amount, rate, amount, created_at)
             values ($1,$2,$3,$4,600.00,10,60.00, now() - interval '3 days')`, [tenantId, pracIds[0], al.rows[0].id, rule.rows[0].id]);
          const adv = await c.query(
            `insert into payments(tenant_id, patient_id, amount, method, cash_account_id, paid_at, note, received_by)
             values ($1,$2,300.00,'bank_transfer',$3, now() - interval '1 day','Sentetik demo ön ödeme (avans)',$4) returning id, paid_at`,
            [tenantId, patientIds[4], cash.rows.find((r) => r.kind === "bank")!.id, creator]);
          await c.query("insert into cash_movements(tenant_id, cash_account_id, amount, source, source_id, occurred_at) values ($1,$2,300.00,'payment',$3,$4)",
            [tenantId, cash.rows.find((r) => r.kind === "bank")!.id, adv.rows[0].id, adv.rows[0].paid_at]);
        }
        await c.query(
          "insert into audit_events(tenant_id, actor_user_id, action, entity_type, changes) values ($1,$2,'seed.synthetic','tenant',$3)",
          [tenantId, creator, JSON.stringify({ note: "Sentetik demo verisi yüklendi" })],
        );
      })(client);
      log(`tenant hazır: ${t.slug}`);
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
  return result;
}

if (process.argv[1]?.endsWith("seed.ts")) {
  loadEnv();
  const provided = process.env.VIADENT_DEMO_PASSWORD || undefined;
  seed(requireEnv("MIGRATION_DATABASE_URL"), { password: provided })
    .then((r) => {
      if (!provided) {
        const file = resolve(process.cwd(), "../../.demo-credentials");
        writeFileSync(file, `# Sentetik demo hesapları (git'e girmez)\nparola=${r.password}\n` +
          Object.keys(r.users).map((k) => `# ${k}`).join("\n") + "\n", { mode: 0o600 });
        console.log(`Demo parolası .demo-credentials dosyasına yazıldı.`);
      }
      console.log("Sentetik seed tamam. Giriş: yonetici@demo-yesil.test, elif.aras@demo-yesil.test, sekreter@demo-yesil.test, ...");
    })
    .catch((e) => {
      console.error("Seed başarısız:", e.message);
      process.exit(1);
    });
}
