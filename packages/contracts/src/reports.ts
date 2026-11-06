/**
 * Rapor kataloğu (V09). Her rapor: filtreler + satırlar + SQL'de ayrı hesaplanan toplamlar (alt kayıtlarla mutabık testli)
 * + kaynağa iniş. Kaynak envanter ID'leri (Ek A) `sourceIds` ile izlenir. Boş "hazır" kart yoktur: listede olmayan rapor yoktur.
 */
import type { Permission } from "./permissions";
import { AUDIT_ENTITY_LABELS } from "./audit";

export type ReportFilterKind = "range" | "practitioner" | "procedure" | "supplier" | "select" | "text" | "month_range";
export interface ReportFilter { key: string; label: string; kind: ReportFilterKind; options?: [string, string][] }
export type ReportGroup = "Finans" | "Tedavi" | "Operasyon" | "Stok ve cari" | "Denetim" | "Analiz";
export interface ReportDef {
  id: string; title: string; group: ReportGroup; sourceIds: string[]; perm: Permission; description: string;
  filters: ReportFilter[]; maxDays: number;
}
export type ColumnType = "text" | "money" | "int" | "qty" | "date" | "datetime" | "percent" | "badge";
export interface ReportColumn { key: string; label: string; type: ColumnType }
/** Satırdan başka rapora (filtreli) veya kayda iniş. */
export interface Drill { report?: string; params?: Record<string, string>; patientId?: string; tab?: string; labOrderId?: string }

const R: ReportFilter = { key: "range", label: "Tarih aralığı", kind: "range" };
const PR: ReportFilter = { key: "practitionerId", label: "Hekim", kind: "practitioner" };

export const REPORTS: ReportDef[] = [
  { id: "gelir-gider", title: "Gelir – gider (nakit akışı)", group: "Finans", sourceIds: ["R01", "G05"], perm: "finance.read", maxDays: 366,
    description: "Haftalık/aylık/günlük karşılaştırma. Kasa/banka hareketlerinden: tahsilat, iade, gider, tedarikçi ödemesi, prim ödemesi, maaş ödemesi ve net nakit. Kazanılmış tedavi tutarı ayrı sütundur; nakit değildir.",
    filters: [R, { key: "groupBy", label: "Gruplama", kind: "select", options: [["month", "Ay"], ["week", "Hafta"], ["day", "Gün"]] }] },
  { id: "nakit-hareketleri", title: "Nakit hareketleri (kaynak satırlar)", group: "Finans", sourceIds: ["R01", "T07", "T08"], perm: "finance.read", maxDays: 366,
    description: "Gelir–gider raporunun kaynak satırları; her hareket kaynağına bağlıdır.",
    filters: [R, { key: "source", label: "Kaynak", kind: "select", options: [["", "Tümü"], ["payment", "Tahsilat"], ["refund", "İade"], ["expense", "Gider"], ["supplier_payment", "Tedarikçi ödemesi"], ["commission_payout", "Prim ödemesi"], ["salary_payment", "Maaş ödemesi"]] }] },
  { id: "muhasebe-donem", title: "Mali müşavir dönem dökümü", group: "Finans", sourceIds: ["F03"], perm: "finance.read", maxDays: 366,
    description: "Mali müşavire teslim için dönem hareketleri: belge no (makbuz), tür, karşı taraf, yöntem, kasa/banka, tutar (±). Resmî muhasebe fişi değildir; e-belgeler sağlayıcıdan alınır.",
    filters: [R, { key: "kind", label: "Tür", kind: "select", options: [["", "Tümü"], ["payment", "Tahsilat"], ["refund", "İade"], ["expense", "Gider"], ["supplier_payment", "Tedarikçi ödemesi"], ["commission_payout", "Prim ödemesi"], ["salary_payment", "Maaş ödemesi"]] }] },
  { id: "aylik-ciro", title: "Aylık ciro", group: "Finans", sourceIds: ["R12", "R11"], perm: "finance.read", maxDays: 731,
    description: "Ay bazında tedavi tutarı (gerçekleşen işlem snapshot'ı), tahsilat, iade ve net tahsilat. Tedavi tutarı tahsilat değildir.",
    filters: [R, PR] },
  { id: "borc-bakiye", title: "Borç bakiye sorgulama", group: "Finans", sourceIds: ["R08", "R02"], perm: "finance.read", maxDays: 1,
    description: "Açık borcu olan hastalar; avans ayrı. Vade yaşına ve en az tutara göre süzülür.",
    filters: [{ key: "bucket", label: "Vade yaşı", kind: "select", options: [["", "Tümü"], ["notDue", "Vadesi gelmemiş"], ["d0_30", "0–30 gün"], ["d31_60", "31–60 gün"], ["d61_90", "61–90 gün"], ["d90p", "90+ gün"]] },
      { key: "minAmount", label: "En az borç (₺)", kind: "text" }] },
  { id: "prim", title: "Hekim primleri", group: "Finans", sourceIds: ["R19", "R20"], perm: "finance.read", maxDays: 366,
    description: "Tahakkuk (tedavi veya tahsilat bazlı), ters prim, ödenen prim ve ödenecek bakiye. Kazanım ve ödeme ayrı harekettir.",
    filters: [R, PR, { key: "basis", label: "Prim temeli", kind: "select", options: [["", "Tümü"], ["treatment", "Tedavi bazlı (R19)"], ["collection", "Tahsilat bazlı (R20)"]] }] },
  { id: "online-odeme", title: "Online ödeme sorgulama", group: "Finans", sourceIds: ["R24"], perm: "finance.read", maxDays: 366,
    description: "Online ödeme istekleri (Deneme sağlayıcı). İstek tahsilat değildir; ödeme yalnız imzalı sağlayıcı bildirimiyle kaydedilir.",
    filters: [R, { key: "status", label: "Durum", kind: "select", options: [["", "Tümü"], ["link_ready", "Bağlantı hazır"], ["paid", "Ödendi"], ["failed", "Başarısız"], ["cancelled", "İptal"]] }] },
  { id: "tedavi", title: "Tedavi sorgulama", group: "Tedavi", sourceIds: ["R03"], perm: "report.clinical", maxDays: 366,
    description: "Gerçekleşen işlemler (snapshot bedeliyle). İptal ve düzeltilen kayıtlar ayrı gösterilir; toplam yalnız tamamlananları içerir.",
    filters: [R, PR, { key: "procedureId", label: "İşlem", kind: "procedure" },
      { key: "status", label: "Durum", kind: "select", options: [["completed", "Tamamlanan"], ["cancelled", "İptal"], ["corrected", "Düzeltilen"], ["", "Tümü"]] }] },
  { id: "aylik-islem", title: "Aylık işlem sorgulama", group: "Tedavi", sourceIds: ["R13"], perm: "report.clinical", maxDays: 731,
    description: "Ay × işlem: adet ve tutar (yalnız tamamlanan işlemler).", filters: [R, PR] },
  { id: "plan", title: "Plan sorgulama", group: "Tedavi", sourceIds: ["R04"], perm: "report.clinical", maxDays: 366,
    description: "Dönemde sunulan teklif sürümleri; kabul oranı = kabul / (kabul + ret). Kararsız ve bekleyen ayrı; sürümler hasta sayısını şişirmez.",
    filters: [R, PR, { key: "status", label: "Karar", kind: "select", options: [["", "Tümü"], ["accepted", "Kabul"], ["rejected", "Ret"], ["pending", "Bekliyor / kararsız"]] }] },
  { id: "hekim-hasta", title: "Hekim hasta sayıları", group: "Tedavi", sourceIds: ["R23"], perm: "report.clinical", maxDays: 366,
    description: "Hekim bazında tamamlanan randevu, görülen farklı hasta, gerçekleşen işlem ve yeni hasta (kayıtta birincil hekim).", filters: [R] },
  { id: "randevu", title: "Randevu ve gelmeme", group: "Operasyon", sourceIds: ["O01"], perm: "report.operations", maxDays: 366,
    description: "Durumlara göre randevular. Gelmeme oranı = gelmedi / (tamamlandı + gelmedi); iptal ve gelecek randevular paydaya girmez.",
    filters: [R, PR] },
  { id: "kontrol", title: "Kontrol sorgulama", group: "Operasyon", sourceIds: ["R05"], perm: "report.operations", maxDays: 366,
    description: "Vadesi aralıkta olan kontroller; takip tamamlama = yapıldı / (vadesi gelen − iptal).",
    filters: [R, PR, { key: "status", label: "Durum", kind: "select", options: [["", "Tümü"], ["open", "Açık"], ["scheduled", "Randevu verildi"], ["done", "Yapıldı"], ["cancelled", "İptal"]] }] },
  { id: "laboratuvar", title: "Laboratuvar sorgulama", group: "Operasyon", sourceIds: ["R09", "H12"], perm: "lab.read", maxDays: 366,
    description: "İş emirleri, aşamaları, gecikme ve (yetkiye bağlı) maliyet. Teslim ve kabul ayrı olaydır.",
    filters: [R, { key: "supplierId", label: "Laboratuvar", kind: "supplier" }, PR,
      { key: "status", label: "Durum", kind: "select", options: [["", "Tümü"], ["open", "Açık (gönderildi/üretimde/revizyon)"], ["overdue", "Geciken"], ["received", "Kabul bekliyor"], ["accepted", "Kabul edildi"], ["cancelled", "İptal"]] }] },
  { id: "mesaj", title: "SMS / mesaj sorgulama", group: "Operasyon", sourceIds: ["R14"], perm: "report.operations", maxDays: 366,
    description: "Mesajlar ve teslim durumları (alıcı maskeli). Sağlayıcı yalnız deneme; “iletildi” teslim değildir.",
    filters: [R, { key: "status", label: "Durum", kind: "select", options: [["", "Tümü"], ["submitted", "İletildi"], ["delivered", "Teslim edildi"], ["failed", "Başarısız"], ["unknown", "Bilinmiyor"], ["cancelled", "İptal"]] }] },
  { id: "onam", title: "Onam / belge sorgulama", group: "Operasyon", sourceIds: ["R22"], perm: "report.operations", maxDays: 366,
    description: "Üretilen hasta belgeleri ve karar durumları (kabul/ret/bekliyor/iptal). Belge metni gösterilmez.",
    filters: [R, { key: "status", label: "Durum", kind: "select", options: [["", "Tümü"], ["pending", "Karar bekliyor"], ["accepted", "Kabul"], ["declined", "Ret"], ["revoked", "İptal"]] }] },
  { id: "stok", title: "Stok bakiye ve lotlar", group: "Stok ve cari", sourceIds: ["V08"], perm: "stock.read", maxDays: 1,
    description: "Bakiye hareketlerden hesaplanır. En az seviye altı ve 60 gün içinde son kullanma tarihi gelen lotlar işaretlenir.",
    filters: [{ key: "flag", label: "Süz", kind: "select", options: [["", "Tümü"], ["low", "En az seviye altı"], ["expiring", "SKT yaklaşan (60 gün)"]] }] },
  { id: "cari", title: "Tedarikçi / laboratuvar carisi", group: "Stok ve cari", sourceIds: ["T18", "T15", "O03"], perm: "finance.read", maxDays: 366,
    description: "Dönem içi borç (fatura/maliyet) ve ödeme hareketleri; açılış ve kapanış bakiyesi hareketlerden.",
    filters: [R, { key: "supplierId", label: "Tedarikçi", kind: "supplier" }] },
  { id: "log", title: "İşlem kayıtları sorgulama", group: "Denetim", sourceIds: ["R15"], perm: "audit.clinic", maxDays: 92,
    description: "Klinikte kim, ne zaman, hangi kayıtta ne yaptı. Değer içerikleri gösterilmez, yalnız değişen alanların adları.",
    filters: [R, { key: "entityType", label: "Kayıt türü", kind: "select", options: [["", "Tümü"], ...Object.entries(AUDIT_ENTITY_LABELS).sort((a, b) => a[1].localeCompare(b[1], "tr"))] },
      { key: "q", label: "İşlem içinde ara", kind: "text" }] },
  { id: "isletme", title: "Klinik işletme analizi", group: "Analiz", sourceIds: ["R18"], perm: "report.analytics", maxDays: 366,
    description: "Metrik sözlüğüne (Plan §09) göre: yeni hasta, gerçekleşen randevu, gelmeme oranı, tedavi tutarı, net tahsilat, açık borç, plan kabul oranı, takip tamamlama. Her metrik kaynak rapora iner.",
    filters: [R] },
];
export const REPORT_BY_ID: Record<string, ReportDef> = Object.fromEntries(REPORTS.map((r) => [r.id, r]));

/** CSV hücresi: formül enjeksiyonuna karşı = + - @ sekme/CR ile başlayan metin tek tırnakla etkisizleştirilir (Plan §09). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
