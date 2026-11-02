/**
 * QA-110 (ADR-092): PİA Hazır kuralına bağlanabilecek belge türleri. Klinik çıktı belgeleri (ADR-085: epikriz, hasta bilgi föyü,
 * reçete yazısı) işlem sonrası hekim çıktısıdır ve sağlık verisidir; ziyaret hazırlığı önkoşulu olamaz (API de 422 ile reddeder).
 */
export function readinessRuleDocTypes<T extends { active: boolean; category: string }>(types: readonly T[]): T[] {
  return types.filter((t) => t.active && t.category !== "clinical_output");
}
