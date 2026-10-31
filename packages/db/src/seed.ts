/**
 * TAMAMEN SENTETİK demo verisi: iki tenant, farklı roller, hasta ve randevular.
 * Gerçek kişi, telefon veya kimlik numarası içermez (telefonlar +90 555 000 xx xx test bloğu,
 * e-postalar ayrılmış .test alan adı). Parola koda gömülmez.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { normalizeSearch, zonedToUtc, localDate, addDays, normalizeDocumentText } from "@viadent/contracts";
import { createHash } from "node:crypto";
import { encryptSecret, newWebhookSecret } from "./bridge.js";
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
          if (i === 7) phone = null; // eksik iletişim → PİA Akış görevi
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
        // Randevular: bugün ve yarın (klinik saatiyle). Bazıları geçmiş saatte "planned" → PİA Akış.
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
        // Görev 4: PİA-DENT belge türü kataloğu (kendi sınıflandırmamız; Ek B başlıkları yalnız izlenebilirlikte eşlenir),
        // iki SENTETİK DEMO şablon (gerçek bilgilendirme/onam metni DEĞİL), PİA Hazır kuralları, iletişim izni ve kontrol.
        const docTypes: [string, string, string, boolean, string | null][] = [
          ["GENEL-ONAM", "Genel tedavi bilgilendirme ve onam", "consent", true, null],
          ["CERRAHI-ONAM", "Cerrahi işlem bilgilendirme ve onam", "consent", true, null],
          ["ENDO-ONAM", "Kanal tedavisi bilgilendirme ve onam", "consent", true, null],
          ["RESTORATIF-ONAM", "Restoratif ve estetik işlem bilgilendirme ve onam", "consent", true, null],
          ["PROTEZ-ONAM", "Protez işlemleri bilgilendirme ve onam", "consent", true, null],
          ["IMPLANT-ONAM", "İmplant tedavisi bilgilendirme ve onam", "consent", true, null],
          ["PERIO-ONAM", "Periodontal tedavi bilgilendirme ve onam", "consent", true, null],
          ["ORTO-ONAM", "Ortodontik tedavi bilgilendirme ve onam", "consent", true, null],
          ["PEDO-ONAM", "Çocuk hasta (veli/vasi) bilgilendirme ve onam", "consent", true, null],
          ["TRAVMA-ONAM", "Acil / travma tedavisi bilgilendirme ve onam", "consent", true, null],
          ["OZEL-ISLEM-ONAM", "İşleme özgü bilgilendirme ve onam (diğer)", "consent", true, null],
          ["ISLEM-SONRASI", "İşlem sonrası bakım ve kullanım bilgilendirmesi", "information", false, null],
          ["KVKK-AYDINLATMA", "Kişisel verilerin işlenmesine ilişkin aydınlatma", "privacy", false, null],
          ["GORSEL-IZIN", "Görsel kayıt ve kullanım izni", "privacy", true, null],
          ["HASTA-BILGI", "Hasta bilgi formu", "administrative", false, null],
          ["ISTIRAHAT", "İstirahat / durum belgesi", "administrative", false, "dentist"],
          ["SIGORTA-BILGI", "Özel sağlık sigortası bilgi formu", "insurance", false, null],
        ];
        const typeIds: Record<string, string> = {};
        for (const [code, name, cat, acc, issuer] of docTypes) {
          const r = await c.query("insert into document_types(tenant_id, code, name, category, requires_acceptance, issuer_role) values ($1,$2,$3,$4,$5,$6) returning id",
            [tenantId, code, name, cat, acc, issuer]);
          typeIds[code] = r.rows[0].id;
        }
        const demoBody = (title: string) => normalizeDocumentText(
          `SENTETİK DEMO BELGESİ — klinik veya hukuki içerik değildir.\n\nBelge: ${title} (DEMO)\nHasta: {{hasta.ad_soyad}} (Dosya {{hasta.dosya_no}}, doğum tarihi {{hasta.dogum_tarihi}})\n` +
          `Klinik: {{klinik.ad}} · Hekim: {{hekim.ad}} · Tarih: {{belge.tarih}}\n\nBağlı plan kalemleri:\n{{plan.kalemler}}\n\n` +
          `Bu bölüm, kliniğin klinik ve hukuk danışmanlarınca onaylanmış gerçek metinle değiştirilmelidir. PİA-DENT bu metnin içeriğini üretmez ve hukuki uygunluk iddiası taşımaz.`);
        for (const [code, title] of [["GENEL-ONAM", "Genel tedavi bilgilendirme ve onam"], ["ENDO-ONAM", "Kanal tedavisi bilgilendirme ve onam"]] as const) {
          const tp = await c.query("insert into templates(tenant_id, document_type_id, name, created_by) values ($1,$2,$3,$4) returning id",
            [tenantId, typeIds[code], `${title} — DEMO şablon`, creator]);
          const body = demoBody(title);
          await c.query(
            `insert into template_versions(tenant_id, template_id, version, status, body, body_hash, is_demo, change_note, created_by, approved_by, approved_at)
             values ($1,$2,1,'approved',$3,$4,true,'Sentetik ilk sürüm',$5,$5, now())`,
            [tenantId, tp.rows[0].id, body, createHash("sha256").update(body, "utf8").digest("hex"), creator]);
        }
        await c.query(
          `insert into readiness_rules(tenant_id, kind, procedure_id, document_type_id, created_by) values ($1,'document_for_procedure',$2,$3,$4)`,
          [tenantId, procIds["KAN-01"], typeIds["ENDO-ONAM"], creator]);
        await c.query("insert into readiness_rules(tenant_id, kind, max_age_days, created_by) values ($1,'anamnesis_reviewed',365,$2)", [tenantId, creator]);
        await c.query(
          `insert into communication_preferences(tenant_id, patient_id, purpose, channel, status, source, note, recorded_by)
           values ($1,$2,'appointment_reminder','sms','granted','in_person','Sentetik demo izni',$3)`, [tenantId, patientIds[0], creator]);
        if (patientIds.length > 1) {
          await c.query("insert into follow_ups(tenant_id, patient_id, due_date, reason, practitioner_id, created_by) values ($1,$2,$3,'6 aylık rutin kontrol (sentetik)',$4,$5)",
            [tenantId, patientIds[1], addDays(localDate(now, tz), 10), pracIds[0], creator]);
        }
        // Görev 5: PİA Köprü — MOCK SMS ve online ödeme bağlantıları (gerçek gönderim/çekim yok), sağlayıcı tahsilat hesabı,
        // erişim bekleyen sağlayıcılar “blocked” olarak kayıtlı (dürüst durum).
        for (const kind of ["sms", "payment"]) {
          await c.query(
            "insert into integration_connections(tenant_id, kind, provider, mode, status, webhook_secret_enc, secret_rotated_at) values ($1,$2,'mock','mock','active',$3, now())",
            [tenantId, kind, encryptSecret(newWebhookSecret())]);
        }
        await c.query("insert into cash_accounts(tenant_id, name, kind) values ($1,'Online ödeme — MOCK sağlayıcı','provider')", [tenantId]);
        for (const [kind, reason] of [["e_invoice", "Yetkili e-belge entegratörü sözleşmesi ve test hesabı yok"], ["health_registry", "DHBS/SBYS güncel kapsam teyidi ve test erişimi yok"],
          ["whatsapp", "Resmî WhatsApp Business Platform erişimi yok"]] as const) {
          await c.query("insert into integration_connections(tenant_id, kind, provider, mode, status, blocked_reason) values ($1,$2,'erisim-bekleniyor','sandbox','blocked',$3)",
            [tenantId, kind, reason]);
        }
        // Görev 6: sentetik laboratuvarlar ve tedarikçi, iş emirleri (gecikmiş / kabul bekleyen / taslak), maliyet → cari borç,
        // stok kalemleri (lot takipli implant ve anestezi kartuşu, takipsiz eldiven), girişler ve bir hasta kullanımı.
        const sup = async (kind: string, name: string) => (await c.query(
          "insert into suppliers(tenant_id, kind, name, contact_name, phone, note, created_by) values ($1,$2,$3,'Sentetik yetkili','+905550009999','Sentetik demo kaydı',$4) returning id",
          [tenantId, kind, name, creator])).rows[0].id as string;
        const labA = await sup("lab", `Ege Diş Laboratuvarı (sentetik ${t.key})`);
        const labB = await sup("lab", `Mavi Protez Lab (sentetik ${t.key})`);
        const med = await sup("medical", `Medikal Depo A.Ş. (sentetik ${t.key})`);
        const today6 = localDate(now, tz);
        const order = async (pIdx: number, supplierId: string, work: string, teeth: string[], status: string, target: string | null, extra: Record<string, unknown> = {}) => {
          if (pIdx >= patientIds.length) return null;
          const no = (await c.query(
            `insert into tenant_counters(tenant_id, name, value) values ($1,'lab_order_no',1)
             on conflict (tenant_id, name) do update set value = tenant_counters.value + 1 returning value`, [tenantId])).rows[0].value;
          const r = await c.query(
            `insert into lab_orders(tenant_id, order_no, patient_id, practitioner_id, supplier_id, work_type, teeth, shade, instructions, target_date, status,
               sent_at, received_at, created_by, created_at)
             values ($1,$2,$3,$4,$5,$6,$7,'A2','Sentetik demo talimatı',$8,$9,$10,$11,$12, now() - interval '6 days') returning id`,
            [tenantId, no, patientIds[pIdx], pracIds[0], supplierId, work, teeth, target, status, extra.sent ?? null, extra.received ?? null, creator]);
          await c.query("insert into lab_events(tenant_id, lab_order_id, kind, to_status, at, by_user) values ($1,$2,'created','draft', now() - interval '6 days',$3)",
            [tenantId, r.rows[0].id, creator]);
          if (status !== "draft") await c.query("insert into lab_events(tenant_id, lab_order_id, kind, from_status, to_status, at, by_user) values ($1,$2,'sent','draft','sent', now() - interval '5 days',$3)",
            [tenantId, r.rows[0].id, creator]);
          if (status === "received") await c.query("insert into lab_events(tenant_id, lab_order_id, kind, from_status, to_status, by_user) values ($1,$2,'received','sent','received',$3)",
            [tenantId, r.rows[0].id, creator]);
          return r.rows[0].id as string;
        };
        await order(0, labA, "Zirkonyum kron", ["16"], "sent", addDays(today6, -1), { sent: new Date(now.getTime() - 5 * 86400000) });
        const recvId = await order(1, labB, "Gece plağı (sentetik)", [], "received", addDays(today6, 1),
          { sent: new Date(now.getTime() - 5 * 86400000), received: now });
        await order(2, labA, "Geçici kron", ["21", "22"], "draft", null);
        if (recvId) {
          const costId = (await c.query("select gen_random_uuid() as id")).rows[0].id;
          const bill = await c.query(
            `insert into supplier_entries(tenant_id, supplier_id, kind, amount, description, source, source_id, occurred_at, created_by)
             values ($1,$2,'bill',1800.00,'İş emri 2 · Gece plağı (sentetik)','lab_cost',$3, now(),$4) returning id`, [tenantId, labB, costId, creator]);
          await c.query(
            "insert into lab_costs(id, tenant_id, lab_order_id, stage, amount, description, supplier_entry_id, created_by) values ($1,$2,$3,'initial',1800.00,'Gece plağı (sentetik)',$4,$5)",
            [costId, tenantId, recvId, bill.rows[0].id, creator]);
        }
        const item = async (code: string, name: string, unit: string, track: boolean, min: string) => (await c.query(
          "insert into stock_items(tenant_id, code, name, unit, category, track_lots, min_level, created_by) values ($1,$2,$3,$4,'Sentetik',$5,$6,$7) returning id",
          [tenantId, code, name, unit, track, min, creator])).rows[0].id as string;
        const imp = await item("IMP-01", "İmplant fikstürü 4.0×10 (sentetik)", "adet", true, "2");
        const ans = await item("ANS-01", "Anestezi kartuşu (sentetik)", "kartus", true, "20");
        const eld = await item("ELD-01", "Muayene eldiveni (sentetik)", "kutu", false, "5");
        const lot = async (itemId: string, no: string, exp: string) => (await c.query(
          "insert into stock_lots(tenant_id, item_id, lot_no, expiry_date) values ($1,$2,$3,$4) returning id", [tenantId, itemId, no, exp])).rows[0].id as string;
        const impLot = await lot(imp, "IMPL-2026-A", addDays(today6, 400));
        const ansLot = await lot(ans, "KRT-2611", addDays(today6, 20));
        const mv = async (itemId: string, lotId: string | null, kind: string, qty: string, extra: { cost?: string; supplier?: string; patient?: string; reason?: string } = {}) =>
          (await c.query(
            `insert into stock_movements(tenant_id, item_id, lot_id, kind, quantity, unit_cost, supplier_id, patient_id, reason, occurred_at, created_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - interval '2 days',$10) returning id`,
            [tenantId, itemId, lotId, kind, qty, extra.cost ?? null, extra.supplier ?? null, extra.patient ?? null, extra.reason ?? null, creator])).rows[0].id as string;
        const impRcpt = await mv(imp, impLot, "receipt", "5", { cost: "1500.00", supplier: med });
        await c.query(
          `insert into supplier_entries(tenant_id, supplier_id, kind, amount, description, document_no, source, source_id, occurred_at, created_by)
           values ($1,$2,'bill',7500.00,'Stok girişi · İmplant fikstürü × 5 (sentetik)','SNT-0001','stock_receipt',$3, now() - interval '2 days',$4)`, [tenantId, med, impRcpt, creator]);
        await mv(ans, ansLot, "receipt", "30", { supplier: med });
        await mv(eld, null, "receipt", "4", { supplier: med });
        await mv(imp, impLot, "usage", "-1", { patient: patientIds[0], reason: "Sentetik demo kullanımı" });
        const bankId = cash.rows.find((r) => r.kind === "bank")!.id;
        const sp = await c.query(
          `insert into supplier_entries(tenant_id, supplier_id, kind, amount, description, cash_account_id, occurred_at, created_by)
           values ($1,$2,'payment',3000.00,'Sentetik kısmi ödeme',$3, now() - interval '1 day',$4) returning id, occurred_at`, [tenantId, med, bankId, creator]);
        await c.query("insert into cash_movements(tenant_id, cash_account_id, amount, source, source_id, occurred_at) values ($1,$2,-3000.00,'supplier_payment',$3,$4)",
          [tenantId, bankId, sp.rows[0].id, sp.rows[0].occurred_at]);
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

if (/[\\/]seed\.(ts|js)$/.test(process.argv[1] ?? "")) {
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
