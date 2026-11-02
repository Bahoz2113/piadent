import { z } from "zod";
/**
 * DEMO anamnez soru seti — PİA-DENT tasarımı, klinisyen onayı ALINMAMIŞTIR (Plan §06, Ek C).
 * Pilot öncesi diş hekimiyle gözden geçirilecek; rakip formundaki soru listesi kopyalanmamıştır.
 * Yanıt üç durumludur: yanıtsız (kayıt yok) / hayır / evet (+ ayrıntı). "Bilmiyor" ayrıca tutulur.
 */
export const ANAMNESIS_QUESTIONNAIRE_VERSION = "demo-2026.10";

export interface AnamnesisQuestion { key: string; label: string; critical: boolean; detailHint?: string }

export const ANAMNESIS_QUESTIONS: readonly AnamnesisQuestion[] = [
  { key: "allergy", label: "Alerji (ilaç, lateks, lokal anestezik vb.)", critical: true, detailHint: "Neye karşı, tepki türü" },
  { key: "anticoagulant", label: "Kan sulandırıcı / pıhtılaşmayı etkileyen ilaç", critical: true, detailHint: "İlaç adı" },
  { key: "bleeding_disorder", label: "Kanama veya pıhtılaşma bozukluğu", critical: true },
  { key: "cardiovascular", label: "Kalp-damar hastalığı", critical: true, detailHint: "Tanı, cihaz (kalp pili vb.)" },
  { key: "hypertension", label: "Yüksek tansiyon", critical: false },
  { key: "diabetes", label: "Diyabet", critical: false, detailHint: "Tür, kontrol durumu" },
  { key: "bisphosphonate", label: "Kemik erimesi tedavisi (bifosfonat vb.)", critical: true },
  { key: "radiotherapy", label: "Baş-boyun bölgesine radyoterapi", critical: true },
  { key: "infectious_disease", label: "Bulaşıcı hastalık", critical: true },
  { key: "pregnancy", label: "Gebelik veya emzirme", critical: true },
  { key: "regular_medication", label: "Düzenli kullanılan diğer ilaçlar", critical: false, detailHint: "İlaç adları" },
  { key: "smoking", label: "Sigara / tütün kullanımı", critical: false },
  { key: "other", label: "Belirtmek istenen başka sağlık durumu", critical: false },
];

export const ANAMNESIS_VALUES = ["yes", "no", "unknown"] as const;
export type AnamnesisValue = (typeof ANAMNESIS_VALUES)[number];
export const ANAMNESIS_VALUE_LABELS: Record<AnamnesisValue | "unanswered", string> = {
  yes: "Evet", no: "Hayır", unknown: "Bilmiyor", unanswered: "Yanıtsız",
};
export type AnamnesisAnswers = Record<string, { value: AnamnesisValue; detail?: string }>;

/** "Evet" yanıtlanmış kritik soruların anahtarları. Tıbbi karar değildir; yalnız görünürlük. Soru seti şablondan gelir (ADR-084). */
export function criticalFlags(answers: AnamnesisAnswers, questions: readonly AnamnesisQuestion[] = ANAMNESIS_QUESTIONS): string[] {
  return questions.filter((q) => q.critical && answers[q.key]?.value === "yes").map((q) => q.key);
}

export function questionLabel(key: string, questions: readonly AnamnesisQuestion[] = ANAMNESIS_QUESTIONS): string {
  return questions.find((q) => q.key === key)?.label ?? ANAMNESIS_QUESTIONS.find((q) => q.key === key)?.label ?? key;
}

/* ---------------------------------------------------------------- anamnez şablonu (Faz 1.1, ADR-084) */
export const ANAMNESIS_TEMPLATE_STATUSES = ["draft", "published", "retired"] as const;
export const ANAMNESIS_TEMPLATE_STATUS_LABELS: Record<(typeof ANAMNESIS_TEMPLATE_STATUSES)[number], string> = { draft: "Taslak", published: "Yayında", retired: "Emekli" };
export const AnamnesisQuestionInput = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "Anahtar: küçük harf, rakam, alt çizgi (2–40)"),
  label: z.string().trim().min(3).max(200),
  critical: z.boolean(),
  detailHint: z.string().trim().max(120).optional(),
}).strict();
export const AnamnesisTemplateInput = z.object({
  title: z.string().trim().min(2).max(120),
  note: z.string().trim().max(400).optional(),
  questions: z.array(AnamnesisQuestionInput).min(1).max(60),
}).strict().superRefine((v, ctx) => {
  const keys = v.questions.map((q) => q.key);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) ctx.addIssue({ code: "custom", path: ["questions"], message: `Soru anahtarı tekrar ediyor: ${dup}` });
});
export type AnamnesisTemplateInput = z.infer<typeof AnamnesisTemplateInput>;
