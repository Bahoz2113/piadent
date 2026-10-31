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
