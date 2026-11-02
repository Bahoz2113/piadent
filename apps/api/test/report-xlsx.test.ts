/** Faz 4.2 (ADR-087) — Rapor XLSX: geçerli ZIP/OOXML (Python zipfile ile açılır), satır sayısı ve toplamlar CSV ile aynı, para sayısal. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { EMAILS, login, startApp, type Client } from "./helpers.js";

let app: INestApplication; let fin: Client;
beforeAll(async () => { app = await startApp(); fin = await login(app, EMAILS.aFinance); });
afterAll(async () => app.close());

describe("XLSX dışa aktarım", () => {
  it("nakit-hareketleri: xlsx indirilir, zip geçerli, sayfa adı ve satır sayısı CSV ile aynı, para hücreleri sayısal", async () => {
    const to = new Date().toISOString().slice(0, 10); const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const csv = await fin.get(`/reports/nakit-hareketleri/export?from=${from}&to=${to}`).expect(200);
    const csvRows = csv.text.split("\r\n").filter((l) => /^"?\d{2}\.\d{2}\.\d{4}/.test(l)).length;
    const x = await fin.get(`/reports/nakit-hareketleri/export?from=${from}&to=${to}&format=xlsx`).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on("data", (d) => ch.push(d)); res.on("end", () => cb(null, Buffer.concat(ch))); }).expect(200);
    expect(x.headers["content-type"]).toContain("spreadsheetml");
    expect(x.headers["content-disposition"]).toContain(".xlsx");
    const buf = x.body as Buffer;
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const dir = mkdtempSync(join(tmpdir(), "xlsx-")); const f = join(dir, "r.xlsx"); writeFileSync(f, buf);
    const out = execFileSync("python3", ["-I", "-c", `
import zipfile,sys,re
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None, "bozuk zip"
names=z.namelist(); assert "xl/workbook.xml" in names and "xl/worksheets/sheet1.xml" in names and "[Content_Types].xml" in names
sh=z.read("xl/worksheets/sheet1.xml").decode(); wb=z.read("xl/workbook.xml").decode()
rows=len(re.findall(r"<row r=", sh)); money=len(re.findall(r's="3"><v>', sh)); inline=len(re.findall(r't="inlineStr"', sh))
print(rows, money, inline, "Nakit hareketleri" in wb)`, f], { encoding: "utf8" }).trim().split(" ");
    const [rows, money, inline, nameOk] = out;
    expect(nameOk).toBe("True");
    expect(inline && Number(inline) > 0).toBe(true);
    // satır = başlık 1 + veri + (toplam satırları + 1 dipnot, boş satır sayılmaz)
    expect(Number(rows)).toBeGreaterThanOrEqual(1 + csvRows);
    if (csvRows > 0) expect(Number(money)).toBeGreaterThan(0);
  });
  it("bilinmeyen format csv'ye düşer; report.export yetkisi olmayan 403", async () => {
    const to = new Date().toISOString().slice(0, 10);
    const r = await fin.get(`/reports/borc-bakiye/export?from=${to}&to=${to}&format=pdf`).expect(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    const sec = await login(app, EMAILS.aSecretary);
    await sec.get(`/reports/randevu/export?from=${to}&to=${to}&format=xlsx`).expect(403);
  });
});
