"use client";
import type { Appt } from "@/lib/types";

/** Saati geçmiş ama sonuçlandırılmamış (Planlandı/Teyitli) randevu: "Geçmiş" altında "Sonuç bekliyor" olarak gösterilir (madde 5, ADR-094). */
export function isPastPending(a: Pick<Appt, "status" | "endsAt">, now = Date.now()): boolean {
  return (a.status === "planned" || a.status === "confirmed") && new Date(a.endsAt).getTime() < now;
}

export function PastPendingBadge() {
  return <span className="badge badge-warning" title="Randevu saati geçti; Geldi/Tamamlandı ya da Gelmedi olarak sonuçlandırın.">Sonuç bekliyor</span>;
}
