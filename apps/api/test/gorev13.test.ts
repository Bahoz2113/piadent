/**
 * Görev 13 — geçmiş randevu içe aktarımı (ADR-072): ön kontrol → onay → geri alma; hasta/hekim eşleme, çakışma, tekrar güvenliği, çapraz klinik.
 * Gerçek PostgreSQL (viadent_test).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, login, ownerQuery, startApp, useLegacyAdmin, type Client } from "./helpers.js";

let app: INestApplication;
let admin: Client, dentist: Client, bAdmin: Client;
let tenantA: string;
const run = randomUUID().slice(0, 6).toUpperCase();
const imp = (c: Client, body: Record<string, unknown>) => c.post("/imports", { format: "csv", fileName: `sentetik-${randomUUID().slice(0, 8)}.csv`, ...body });
const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [y, m, d] = t.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + offset));
  return `${String(dt.getUTCDate()).padStart(2, "0")}.${String(dt.getUTCMonth() + 1).padStart(2, "0")}.${dt.getUTCFullYear()}`;
};

beforeAll(async () => {
  app = await startApp();
  // ADR-098: yönetici artık her şeyi görür; bu dosya sağlık yetkisiz rolün süzgecini sınadığından eski yönetici kümesi kullanılır.
  await useLegacyAdmin(app);
  [admin, dentist, bAdmin] = await Promise.all([login(app, EMAILS.aAdmin), login(app, EMAILS.aDentist), login(app, EMAILS.bAdmin)]);
  tenantA = admin.session.activeMembership.tenantId;
  // hasta kartları (kaynak no ile)
  await imp(admin, { kind: "patients", content: `Kaynak_No;Adı;Soyadı;Doğum Tarihi\r\n${run}-P1;Geçmiş;Randevu${run};03.04.1985\r\n${run}-P2;İkinci;Randevu${run};05.06.1990\r\n` })
    .expect(201).then(async (r) => admin.post(`/imports/${r.body.id}/commit`).expect(200));
});
afterAll(async () => { await app.close(); });

describe("geçmiş randevu içe aktarımı", () => {
  let bid: string;
  it("ön kontrol: hasta/hekim eşleşir; gelecek tarih, bilinmeyen hekim, çakışma ve dosya içi mükerrer hatalı; hiçbir şey yazılmaz", async () => {
    const d1 = day(-10), d2 = day(-3);
    const content = [
      "Randevu_No;Kaynak_No;Tarih;Saat;Süre;Hekim;Durum;İşlem",
      `${run}-R1;${run}-P1;${d1};09:00;30;Dt. Elif Aras;geldi;Kontrol`,
      `${run}-R2;${run}-P2;${d1};09:15;30;Elif Aras;gelmedi;`,                       // çakışma (09:00–09:30 ile), unvansız ad eşleşir
      `${run}-R3;${run}-P2;${d2};14:00;45;elif.aras@demo-yesil.test;iptal;Dolgu`,   // e-posta ile hekim
      `${run}-R1;${run}-P1;${d2};16:00;30;Dt. Elif Aras;geldi;`,                     // dosya içi mükerrer randevu no
      `${run}-R5;${run}-P1;${day(1)};10:00;30;Dt. Elif Aras;geldi;`,                 // gelecek
      `${run}-R6;${run}-P1;${d2};11:00;30;Dt. Olmayan Hekim;geldi;`,                 // hekim yok
      `${run}-R7;YOK-${run};${d2};12:00;30;Dt. Elif Aras;belirsiz;`,                 // hasta yok + durum tanınmadı
      "",
    ].join("\r\n");
    const r0 = await imp(admin, { kind: "appointment_history", content }).expect(201);
    bid = r0.body.id;
    const r = await admin.get(`/imports/${bid}`).expect(200);
    const rows = r.body.rows as { rowNo: number; status: string; errors: { field: string; message: string }[]; data: Record<string, unknown> }[];
    const st = (n: number) => rows.find((x) => x.rowNo === n)!;
    expect(st(1).status).toBe("valid"); expect(st(1).data.practitioner_name).toBe("Dt. Elif Aras"); expect(st(1).data.status).toBe("completed");
    expect(st(2).status).toBe("error"); expect(st(2).errors.map((e) => e.field)).toContain("time");
    expect(st(3).status).toBe("valid"); expect(st(3).data.status).toBe("cancelled");
    expect(st(4).status).toBe("duplicate");
    expect(st(5).errors[0]!.message).toMatch(/geçmiş tarihli/);
    expect(st(6).errors[0]!.field).toBe("practitioner");
    expect(st(7).errors.map((e) => e.field)).toEqual(["status"]); // biçim hataları önce; hasta eşlemesi biçim doğruysa yapılır
    expect(r.body.summary).toMatchObject({ rows: 7, valid: 2, duplicates: 1 });
    const [{ n }] = await ownerQuery(tenantA, "select count(*)::int as n from appointments where import_batch_id = $1", [bid]);
    expect(n).toBe(0);
  });

  it("onay: geçerli satırlar geçmiş randevu olur (tamamlandı/iptal), Hasta 360 geçmişinde görünür, PİA Akış görevi üretmez", async () => {
    const r = await admin.post(`/imports/${bid}/commit`).expect(200);
    expect(r.body.summary).toMatchObject({ imported: 2, skippedAtCommit: 0 });
    const ap = await ownerQuery(tenantA, "select status, external_ref, completed_at, cancel_reason, reason from appointments where import_batch_id = $1 order by starts_at", [bid]);
    expect(ap.map((a) => a.status)).toEqual(["completed", "cancelled"]);
    expect(ap[0]!.completed_at).toBeTruthy(); expect(ap[0]!.reason).toBe("Kontrol"); expect(ap[1]!.cancel_reason).toMatch(/aktarıldı/);
    const pid = (await ownerQuery(tenantA, "select id from patients where external_ref = $1", [`${run}-P1`]))[0]!.id;
    const hist = (await dentist.get(`/patients/${pid}/appointments`).expect(200)).body;
    const items = (hist.items ?? hist) as { id: string; status: string }[];
    expect(items.some((x) => x.status === "completed")).toBe(true);
    const [{ t }] = await ownerQuery(tenantA, "select count(*)::int as t from tasks where source_type = 'appointment' and source_id in (select id from appointments where import_batch_id = $1)", [bid]);
    expect(t).toBe(0);
  });

  it("tekrar aktarım: aynı randevu no → 'daha önce aktarılmış'; randevu no yoksa hasta+hekim+zaman eşleşmesi", async () => {
    const content = `Randevu_No;Kaynak_No;Tarih;Saat;Hekim\r\n${run}-R1;${run}-P1;${day(-10)};09:00;Dt. Elif Aras\r\n;${run}-P2;${day(-3)};14:00;Dt. Elif Aras\r\n`;
    const r0 = await imp(admin, { kind: "appointment_history", content }).expect(201);
    const r = await admin.get(`/imports/${r0.body.id}`).expect(200);
    expect(r.body.rows.map((x: { status: string }) => x.status)).toEqual(["already_imported", "already_imported"]);
  });

  it("çapraz klinik: Mavi yöneticisi Yeşil'in kaynak hasta no'sunu göremez (hasta bulunamadı); geri alma randevuları siler, işlem görmüşse reddeder", async () => {
    const r0 = await imp(bAdmin, { kind: "appointment_history", content: `Kaynak_No;Tarih;Saat;Hekim\r\n${run}-P1;${day(-3)};09:00;Dt. Murat İnce\r\n` }).expect(201);
    const r = await bAdmin.get(`/imports/${r0.body.id}`).expect(200);
    expect(r.body.rows[0].errors[0].field).toBe("patient_ref");
    // geri alma
    const before = (await ownerQuery(tenantA, "select count(*)::int as n from appointments where import_batch_id = $1", [bid]))[0]!.n;
    expect(before).toBe(2);
    await admin.post(`/imports/${bid}/rollback`, { reason: "Sentetik geri alma denemesi" }).expect(200);
    const after = await ownerQuery(tenantA, "select status, cancel_reason, external_ref from appointments where import_batch_id = $1", [bid]);
    expect(after.every((a) => a.status === "cancelled" && String(a.cancel_reason).startsWith("Aktarım geri alındı"))).toBe(true); // silme yok
    expect(after.map((a) => a.external_ref).sort()).toEqual([`${run}-R1`, `${run}-R3`].sort());
    expect((await admin.get(`/imports/${bid}`).expect(200)).body.rows.filter((x: { status: string }) => x.status === "rolled_back")).toHaveLength(2);
    // yeniden aktar ve bir randevuyu değiştir → geri alma reddedilir
    // geri alınan kaynak no yeniden aktarılabilir (aynı R1)
    const again = await imp(admin, { kind: "appointment_history", fileName: `tekrar-${run}.csv`, content: `Randevu_No;Kaynak_No;Tarih;Saat;Hekim\r\n${run}-R1;${run}-P1;${day(-10)};09:00;Dt. Elif Aras\r\n` }).expect(201);
    expect(again.body.summary.valid).toBe(1);
    await admin.post(`/imports/${again.body.id}/commit`).expect(200);
    await ownerQuery(tenantA, "update appointments set note = 'sonradan düzenlendi', version = version + 1 where import_batch_id = $1", [again.body.id]);
    const rb = await admin.post(`/imports/${again.body.id}/rollback`, { reason: "Deneme" });
    expect(rb.status).toBe(409); expect(rb.body.code).toBe("IMPORT_HAS_ACTIVITY");
  });
});

describe("ADR-073: PİA Akış eşikleri klinik ayarı", () => {
  it("varsayılan 10 dk; 30 dk yapılınca 20 dk geciken randevu görev üretmez, 40 dk geciken üretir; sınır dışı 422; hekim değiştiremez; çapraz klinik etkilenmez", async () => {
    const { refreshViaAkis, withContext } = await import("@viadent/db");
    const pg = (await import("pg")).default;
    const { WORKER_URL } = await import("./env.js");
    const sec = await login(app, EMAILS.aSecretary);
    const def = (await admin.get("/security/akis").expect(200)).body;
    expect(def.settings.overdueCheckinMinutes).toBe(10);
    expect((await dentist.get("/security/akis")).status).toBe(403);
    expect((await admin.put("/security/akis", { ...def.settings, overdueCheckinMinutes: 3 })).status).toBe(422);
    await admin.put("/security/akis", { ...def.settings, overdueCheckinMinutes: 30 }).expect(200);
    expect((await bAdmin.get("/security/akis").expect(200)).body.settings.overdueCheckinMinutes).toBe(10); // Mavi etkilenmez
    // bugün 20 dk ve 40 dk önce başlamış planlı randevu (doğrudan DB; çalışma saati kuralından bağımsız)
    const pid = (await ownerQuery(tenantA, "select id from patients where external_ref = $1", [`${run}-P1`]))[0]!.id;
    // Saat-bağımsızlık: son 45 dk penceresinde seed randevusu olmayan bir hekim seçilir (çakışma kısıtı: appointments_practitioner_no_overlap).
    const prac = (await ownerQuery(tenantA, `select p.id, p.branch_id from practitioners p where p.active
      and not exists (select 1 from appointments a where a.practitioner_id = p.id and a.status not in ('cancelled','no_show')
                        and a.starts_at < now() + interval '5 minutes' and a.ends_at > now() - interval '45 minutes') order by p.display_name limit 1`))[0]!;
    const now = new Date();
    const mk = async (minsAgo: number) => (await ownerQuery(tenantA,
      `insert into appointments(tenant_id, branch_id, patient_id, practitioner_id, starts_at, ends_at, status, created_by)
       values ($1,$2,$3,$4,$5,$6,'planned',(select id from users where email = $7)) returning id`,
      [tenantA, prac.branch_id, pid, prac.id, new Date(now.getTime() - minsAgo * 60_000).toISOString(), new Date(now.getTime() - (minsAgo - 5) * 60_000).toISOString(), EMAILS.aAdmin]))[0]!.id as string; // 5 dk'lık, çakışmayan
    const a20 = await mk(20), a40 = await mk(40);
    const pool = new pg.Pool({ connectionString: WORKER_URL, max: 2 });
    try { await withContext(pool, { tenantId: tenantA, userId: null }, (c) => refreshViaAkis(c, tenantA, now)); } finally { await pool.end(); }
    const tasks = await ownerQuery(tenantA, "select source_id from tasks where kind = 'overdue_checkin' and source_id = any($1::uuid[]) and status in ('open','in_progress')", [[a20, a40]]);
    expect(tasks.map((t) => t.source_id)).toEqual([a40]);
    const aud = await ownerQuery(tenantA, "select changes from audit_events where action = 'settings.akis_update' order by created_at desc limit 1");
    expect(aud[0]!.changes).toMatchObject({ overdueCheckinMinutes: { from: 10, to: 30 } });
    // temizlik: varsayılana dön; sekreter izinsiz
    expect((await sec.put("/security/akis", def.settings)).status).toBe(403);
    await admin.put("/security/akis", def.settings).expect(200);
  });
});

describe("ADR-075: tedavi geçmişi içe aktarımı (alacak üretmez)", () => {
  let bid: string;
  it("ön kontrol: katalog kodu/adı ve hekim eşleşir; FDI, adet, bedel doğrulanır; onayda işlem yazılır, alacak/bakiye değişmez; Hasta 360 tedavi sekmesinde görünür", async () => {
    const d1 = day(-20), d2 = day(-15);
    const content = [
      "İşlem_No;Kaynak_No;Tarih;İşlem;Diş;Adet;Bedel;Hekim;Not",
      `${run}-T1;${run}-P1;${d1};DOL-01;36;1;1.800,00;Dt. Elif Aras;Önceki sistem`,
      `${run}-T2;${run}-P1;${d1};Diş taşı temizliği (tüm ağız);;1;1200;Elif Aras;`,
      `${run}-T3;${run}-P2;${d2};KAN-01;;1;3500;Dt. Elif Aras;`,                 // diş boş → uyarı (ağız düzeyi)
      `${run}-T4;${run}-P2;${d2};OLMAYAN-99;11;1;100;Dt. Elif Aras;`,            // katalogda yok
      `${run}-T5;${run}-P2;${d2};DOL-01;99;1;100;Dt. Elif Aras;`,                // FDI geçersiz
      `${run}-T1;${run}-P1;${d1};DOL-01;36;1;1800;Dt. Elif Aras;`,               // dosya içi mükerrer
      "",
    ].join("\r\n");
    const r0 = await imp(admin, { kind: "treatment_history", content }).expect(201);
    bid = r0.body.id;
    const r = await admin.get(`/imports/${bid}`).expect(200);
    const rows = r.body.rows as { rowNo: number; status: string; errors: { field: string }[]; warnings: { field: string }[]; data: Record<string, unknown>; amount: string | null }[];
    const st = (n: number) => rows.find((x) => x.rowNo === n)!;
    expect(st(1).status).toBe("valid"); expect(st(1).data.procedure_code).toBe("DOL-01"); expect(st(1).data.location_kind).toBe("tooth"); expect(st(1).amount).toBe("1800.00");
    expect(st(2).status).toBe("valid"); expect(st(2).data.procedure_code).toBe("TEM-01");
    expect(st(3).status).toBe("valid"); expect(st(3).warnings.map((w) => w.field)).toContain("tooth"); expect(st(3).data.location_kind).toBe("mouth");
    expect(st(4).errors[0]!.field).toBe("procedure"); expect(st(5).errors[0]!.field).toBe("tooth"); expect(st(6).status).toBe("duplicate");
    expect(r.body.summary).toMatchObject({ rows: 6, valid: 3, errors: 2, duplicates: 1, amountValid: "6500.00" });
    const pid = (await ownerQuery(tenantA, "select id from patients where external_ref = $1", [`${run}-P1`]))[0]!.id;
    const before = (await ownerQuery(tenantA, "select count(*)::int as n from receivables where patient_id = $1", [pid]))[0]!.n;
    const c = await admin.post(`/imports/${bid}/commit`).expect(200);
    expect(c.body.summary).toMatchObject({ imported: 3, skippedAtCommit: 0, amountImported: "6500.00" });
    const pp = await ownerQuery(tenantA, "select status, appointment_id, price_basis, external_ref, amount::text as amount from performed_procedures where import_batch_id = $1 order by external_ref", [bid]);
    expect(pp).toHaveLength(3); expect(pp.every((x) => x.status === "completed" && x.appointment_id === null && x.price_basis === "manual")).toBe(true);
    // finans etkisi YOK
    expect((await ownerQuery(tenantA, "select count(*)::int as n from receivables where patient_id = $1", [pid]))[0]!.n).toBe(before);
    expect((await ownerQuery(tenantA, "select count(*)::int as n from receivables where performed_procedure_id in (select id from performed_procedures where import_batch_id = $1)", [bid]))[0]!.n).toBe(0);
    const chart = (await dentist.get(`/patients/${pid}/chart`).expect(200)).body;
    const mine = chart.performed.filter((x: { code: string; imported?: boolean }) => x.imported);
    expect(mine.length).toBeGreaterThanOrEqual(2); expect(mine.some((x: { code: string }) => x.code === "DOL-01")).toBe(true);
  });

  it("tekrar: aynı işlem no 'daha önce aktarılmış'; geri alma iptal eder (silmez); düzeltilmiş/iptal edilmiş kayıt geri almayı engeller", async () => {
    const r0 = await imp(admin, { kind: "treatment_history", content: `İşlem_No;Kaynak_No;Tarih;İşlem;Hekim\r\n${run}-T1;${run}-P1;${day(-20)};DOL-01;Dt. Elif Aras\r\n` }).expect(201);
    expect((await admin.get(`/imports/${r0.body.id}`).expect(200)).body.rows[0].status).toBe("already_imported");
    await admin.post(`/imports/${bid}/rollback`, { reason: "Sentetik geri alma" }).expect(200);
    const pp = await ownerQuery(tenantA, "select status, status_reason from performed_procedures where import_batch_id = $1", [bid]);
    expect(pp.every((x) => x.status === "cancelled" && String(x.status_reason).startsWith("Aktarım geri alındı"))).toBe(true);
    // yeniden aktarılabilir; sonra hekim iptal ederse (durum değişti) geri alma reddedilir
    const again = await imp(admin, { kind: "treatment_history", fileName: `tekrar-t-${run}.csv`, content: `İşlem_No;Kaynak_No;Tarih;İşlem;Hekim;Not\r\n${run}-T1;${run}-P1;${day(-20)};DOL-01;Dt. Elif Aras;yeniden\r\n` }).expect(201); // farklı içerik (aynı dosya = aynı batch kuralı)
    expect(again.body.summary.valid).toBe(1);
    await admin.post(`/imports/${again.body.id}/commit`).expect(200);
    const ppId = (await ownerQuery(tenantA, "select id from performed_procedures where import_batch_id = $1", [again.body.id]))[0]!.id;
    await dentist.post(`/procedures/${ppId}/cancel`, { reason: "Hatalı giriş (sentetik)" }).expect(200).catch(async () => {
      await ownerQuery(tenantA, "update performed_procedures set status = 'cancelled', status_reason = 'Hatalı giriş' where id = $1", [ppId]);
    });
    const rb = await admin.post(`/imports/${again.body.id}/rollback`, { reason: "Deneme" });
    expect(rb.status).toBe(409);
  });
});

describe("ADR-076: dağıtılan/iade toplamları alacak ve ödemede tutulur", () => {
  it("ödeme + dağıtım + iade sonrası sütunlar hesaplanan toplamlarla aynı; doğrudan değiştirme reddedilir; borç raporu aynı sayıyı verir", async () => {
    const fin = await login(app, EMAILS.aFinance);
    const key = () => `t-${randomUUID()}`;
    const pid = (await ownerQuery(tenantA, "select id from patients where external_ref = $1", [`${run}-P2`]))[0]!.id;
    const prac = (await ownerQuery(tenantA, "select id from practitioners where display_name = 'Dt. Elif Aras'"))[0]!.id;
    const cashId = (await fin.get("/cash-accounts").expect(200)).body.items.find((a: { kind: string }) => a.kind === "cash").id;
    const rc = (await fin.post("/receivables", { patientId: pid, amount: "1000.00", description: "Sentetik alacak (ADR-076)", practitionerId: prac }).set("idempotency-key", key()).expect(201)).body.id;
    const py = (await fin.post("/payments", { patientId: pid, amount: "700.00", method: "cash", cashAccountId: cashId, allocations: [{ receivableId: rc, amount: "600.00" }] }).set("idempotency-key", key()).expect(201)).body;
    const payId = (py.id ?? py.payment?.id) as string;
    await fin.post(`/payments/${payId}/refunds`, { amount: "50.00", method: "cash", cashAccountId: cashId, reason: "Sentetik iade (ADR-076)" }).set("idempotency-key", key()).expect(201);
    const r = (await ownerQuery(tenantA, "select allocated_amount::text as a from receivables where id = $1", [rc]))[0]!;
    const p = (await ownerQuery(tenantA, "select allocated_amount::text as a, refunded_amount::text as f from payments where id = $1", [payId]))[0]!;
    expect(r.a).toBe("600.00"); expect(p.a).toBe("600.00"); expect(p.f).toBe("50.00");
    expect(await ownerQuery(tenantA, "select * from app.receivable_alloc_check")).toEqual([]);
    await expect(ownerQuery(tenantA, "update receivables set allocated_amount = 1 where id = $1", [rc])).rejects.toThrow(/receivable_allocated_readonly/);
    // açık borç: 1000 − 600 = 400; avans: 700 − 600 − 50 = 50 → borç raporunda görünür
    const rep = (await fin.get("/reports/borc-bakiye").expect(200)).body;
    const row = rep.rows.find((x: { _drill?: { patientId: string } }) => x._drill?.patientId === pid);
    expect(row).toBeTruthy(); expect(row.debt).toBe("400.00"); expect(row.advance).toBe("50.00");
  });
});
