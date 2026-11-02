import { deflateRawSync } from "node:zlib";

/**
 * Bağımlılıksız en küçük XLSX yazıcı (Faz 4.2, ADR-087): tek sayfa, satır içi metin hücreleri, sayısal hücreler (para 2 ondalık biçimi),
 * başlık satırı kalın. Formül yok, dış bağlantı yok. CSV ile aynı satır/toplamları yazar; biçimlendirme görüntüleme içindir.
 */
export type XlsxCell = { v: string } | { n: string | number; money?: boolean } | null;
export interface XlsxSheet { name: string; header: string[]; rows: XlsxCell[][]; footer?: XlsxCell[][] }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const col = (i: number) => { let s = ""; let n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

function cellXml(c: XlsxCell, r: number, ci: number, style: number): string {
  const ref = `${col(ci)}${r}`;
  if (c === null) return "";
  if ("n" in c) {
    const num = typeof c.n === "number" ? c.n : Number(c.n);
    if (!Number.isFinite(num)) return `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${esc(String(c.n))}</t></is></c>`;
    return `<c r="${ref}" s="${c.money ? 3 : style}"><v>${num}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
}

function sheetXml(s: XlsxSheet): string {
  const rows: string[] = [];
  let r = 1;
  rows.push(`<row r="${r}">${s.header.map((h, i) => cellXml({ v: h }, r, i, 1)).join("")}</row>`); r++;
  for (const row of s.rows) { rows.push(`<row r="${r}">${row.map((c, i) => cellXml(c, r, i, 0)).join("")}</row>`); r++; }
  if (s.footer?.length) { r++; for (const row of s.footer) { rows.push(`<row r="${r}">${row.map((c, i) => cellXml(c, r, i, 2)).join("")}</row>`); r++; } }
  const widths = s.header.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(10, ...[s.header[i]!.length, ...s.rows.slice(0, 200).map((x) => { const c = x[i]; return c ? ("v" in c ? c.v.length : String(c.n).length) : 0; })]) + 2)}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;

export function buildXlsx(sheet: XlsxSheet): Buffer {
  const name = esc(sheet.name.replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "Rapor");
  const files: [string, string][] = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", STYLES],
    ["xl/worksheets/sheet1.xml", sheetXml(sheet)],
  ];
  return zip(files.map(([n, c]) => [n, Buffer.from(c, "utf8")]));
}

// ---- ZIP (deflate, no encryption) --------------------------------------------------------------------------------------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf: Buffer): number { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dosTime(d: Date) { return { time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff, date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff }; }
function zip(files: [string, Buffer][], now = new Date()): Buffer {
  const parts: Buffer[] = []; const central: Buffer[] = []; let offset = 0; const { time, date } = dosTime(now);
  for (const [name, data] of files) {
    const nameB = Buffer.from(name, "utf8"); const comp = deflateRawSync(data); const crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameB.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameB, comp);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(time, 12); cd.writeUInt16LE(date, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameB.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, nameB);
    offset += local.length + nameB.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, end]);
}
