/** Türkçe yerel biçim: tarih gg.aa.yyyy, saat 24 saat, klinik saat dilimi (Plan §04). */
export function fmtDate(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "Belirtilmedi";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
  }
  return new Intl.DateTimeFormat("tr-TR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}
export function fmtTime(iso: string, tz?: string): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}
export function fmtDateTime(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "Belirtilmedi";
  return `${fmtDate(iso, tz)} ${fmtTime(iso, tz)}`;
}
export function fmtLongDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}
export function minutesOfDay(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return Number(parts.find((p) => p.type === "hour")!.value) * 60 + Number(parts.find((p) => p.type === "minute")!.value);
}
export function initials(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]!.toLocaleUpperCase("tr-TR")).join("");
}
