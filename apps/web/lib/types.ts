import type { AppointmentStatus } from "@viadent/contracts";

export interface Task {
  id: string; kind: string; sourceType: string; sourceId: string | null; patientId: string | null; patientName: string | null; patientFileNo: number | null;
  title: string; reason: string; nextStep: string; assigneeRole: string | null; dueAt: string | null; status: string; mine: boolean;
}
export interface Appt {
  id: string; patientId: string; patientName?: string; patientFileNo?: number; practitionerId: string; practitionerName?: string;
  chairId: string | null; chairName: string | null; startsAt: string; endsAt: string; status: AppointmentStatus;
  appointmentTypeId?: string | null; contactOutcome: "not_contacted" | "informed" | "unreachable"; reason: string | null; note: string | null; cancelReason?: string | null; version: number;
}
export interface Resources {
  practitioners: { id: string; name: string }[];
  chairs: { id: string; name: string }[];
  appointmentTypes: { id: string; name: string; defaultMinutes: number }[];
}
export interface AgendaContext {
  schedules: { practitionerId: string; weekday: number; start: number; end: number }[];
  closures: { id: string; scope: "clinic" | "practitioner" | "chair"; practitionerId: string | null; chairId: string | null; startsAt: string; endsAt: string; reason: string }[];
}
