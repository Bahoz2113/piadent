import { z } from "zod";
import { isoDate } from "./zdate";

/** ADR-110 (12.11.2026): Hekimler → aylık çalışma listesi. */
const uuid = z.uuid("Geçersiz kimlik");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Saat SS:DD biçiminde olmalı");
export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const ROSTER_KINDS = ["work", "off"] as const;
export const ROSTER_KIND_LABELS: Record<(typeof ROSTER_KINDS)[number], string> = { work: "Çalışıyor", off: "Çalışmıyor" };
export const ROSTER_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const cell = z.object({
  practitionerId: uuid,
  date: isoDate,
  kind: z.enum(ROSTER_KINDS),
  start: hhmm.optional(),
  end: hhmm.optional(),
  chairId: uuid.optional(),
  note: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(120).optional()),
}).superRefine((v, ctx) => {
  if (v.kind === "work") {
    if (!v.start) ctx.addIssue({ code: "custom", path: ["start"], message: "Başlangıç saati gerekli" });
    if (!v.end) ctx.addIssue({ code: "custom", path: ["end"], message: "Bitiş saati gerekli" });
    if (v.start && v.end) {
      if (toMin(v.end) <= toMin(v.start)) ctx.addIssue({ code: "custom", path: ["end"], message: "Bitiş başlangıçtan sonra olmalı" });
      if (toMin(v.start) % 15 || toMin(v.end) % 15) ctx.addIssue({ code: "custom", path: ["start"], message: "Saatler 15 dakikalık adımlarla girilir" });
    }
  } else if (v.start || v.end || v.chairId) {
    ctx.addIssue({ code: "custom", path: ["kind"], message: "Çalışılmayan güne saat veya ünite girilmez" });
  }
});

/** Tek ya da çoklu hücre (aynı ay) yazımı. `acknowledgeAppointments`: planın dışında kalan randevular bilinerek onaylandı. */
export const WorkRosterSave = z.object({
  cells: z.array(cell).min(1, "En az bir gün seçin").max(400),
  acknowledgeAppointments: z.boolean().optional(),
});
export const WorkRosterClear = z.object({ cells: z.array(z.object({ practitionerId: uuid, date: isoDate })).min(1).max(400) });
