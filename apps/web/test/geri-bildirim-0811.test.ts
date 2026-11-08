/**
 * 08.11.2026 geri bildirimi: randevuda işlem isteğe bağlı ve birden fazla (ADR-107), ziyarete birden fazla tanı, Koltuk → Ünite,
 * Panel başlığı klinik adı + tarih ve bugünün randevuları, PİA Akış ayrı "İş akışı" sekmesinde.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const booking = read("components/appointment/new-appointment-page.tsx");
const ajanda = read("app/(app)/ajanda/page.tsx");
const panel = read("app/(app)/bugun/page.tsx");
const flow = read("app/(app)/is-akisi/page.tsx");
const shell = read("components/shell.tsx");

describe("randevu ver: işlem isteğe bağlı, birden fazla", () => {
  it("işlem zorunlu değil; istemci 'İşlem seçin' engeli yok; procedureIds gönderilir", () => {
    expect(booking).not.toMatch(/label="İşlem" required/);
    expect(booking).not.toMatch(/message: "İşlem seçin\."/);
    expect(booking).toMatch(/label="İşlemler \(isteğe bağlı\)"/);
    expect(booking).toMatch(/procedureIds: f\.procedureIds\.length \? f\.procedureIds : undefined/);
    expect(booking).toMatch(/aria-label="Seçilen işlemler"/);
    expect(booking).toMatch(/işlemini kaldır/);
  });
  it("toplam fiyat yalnız her işlemin fiyatı varsa (kesin para toplamı)", () => {
    expect(booking).toMatch(/chosen\.every\(\(p\) => priceOf\(p\)\) \? addMoney\(/);
  });
});

describe("randevu ayrıntısı: planlanan işlemler listesi, ziyarete birden fazla tanı", () => {
  it("planlanan işlemler ayrı satırlar; tanı bölümü ve dişe işlem kaydı", () => {
    expect(ajanda).toMatch(/<dt>Planlanan işlemler<\/dt>/);
    expect(ajanda).toMatch(/Henüz belirlenmedi \(hekim muayenede girer\)/);
    expect(ajanda).toMatch(/<VisitDiagnoses appointmentId=\{appt\.id\}/);
    expect(ajanda).toMatch(/plannedIds=\{appt\.procedures\?\.map/);
    const vd = read("components/appointment/visit-diagnoses.tsx");
    expect(vd).toMatch(/can\("diagnosis\.write"\) && can\("patient\.health\.read"\)/);
    expect(vd).toMatch(/multiSelected=\{teeth\}/);
    expect(vd).toMatch(/appointmentId, description/);
  });
});

describe("Koltuk → Ünite", () => {
  it("randevu formu, ayrıntı, yönetim ve kapatma ekranında 'Ünite'", () => {
    expect(booking).toMatch(/label="Ünite"/);
    expect(ajanda).toMatch(/<dt>Ünite<\/dt>/);
    for (const f of ["app/(app)/ajanda/page.tsx", "components/appointment/new-appointment-page.tsx", "components/admin/resources.tsx", "components/admin/agenda-settings.tsx", "app/(app)/yonetim/page.tsx"]) {
      expect(read(f), f).not.toMatch(/Koltuk/);
    }
  });
});

describe("Panel ve İş akışı", () => {
  it("Panel başlığı klinik adı + bugünün tarihi; 'Panel' başlığı yok; bugünün randevuları saat · hasta · hekim", () => {
    expect(panel).not.toMatch(/<h1>Panel<\/h1>/);
    expect(panel).toMatch(/<h1>\{session\.activeMembership\?\.tenantName/);
    expect(panel).toMatch(/<p>\{fmtLongDay\(today\)\}<\/p>/);
    expect(panel).toMatch(/Bugünün randevuları/);
    expect(panel).toMatch(/fmtTime\(a\.startsAt, tz\)/);
    expect(panel).toMatch(/a\.patientName/);
    expect(panel).toMatch(/a\.practitionerName/);
    expect(panel).not.toMatch(/PİA Akış<\/h2>/);
  });
  it("PİA Akış ayrı menü sekmesinde", () => {
    expect(shell).toMatch(/\{ href: "\/is-akisi", label: "İş akışı"/);
    expect(flow).toMatch(/<h2 id="akis-h">PİA Akış<\/h2>/);
    expect(flow).toMatch(/function TaskList/);
  });
});
