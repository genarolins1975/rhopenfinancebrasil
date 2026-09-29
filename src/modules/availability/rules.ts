import { TZDate } from "@date-fns/tz";
import { addDays as addDaysFns, format, startOfWeek } from "date-fns";
import type { OfficeSettings } from "@/modules/office/shared";
import { TZ, localToday } from "@/modules/shared/dates";

/*
 * Regras puras de disponibilidade (DIR-019, DIR-031). Sem banco: os carregadores vivem em service.ts.
 * A mesma tabela de casos é executada contra as funções SQL is_eligible e is_bookable (DIR-031-T1).
 */

export type AssignmentOnDate = {
  id: string;
  mode: "individual" | "group";
  holderEmployeeId: string | null;
  accessGroupId: string | null;
  needsReview: boolean;
  validFrom: string;
  validTo: string | null;
};

export type ExceptionOnDate = {
  id: string;
  kind: "release_to_shared" | "release_to_employee";
  beneficiaryEmployeeId: string | null;
  endsOn?: string;
};

export type Policy = {
  assignment: AssignmentOnDate | null;
  exception: ExceptionOnDate | null;
  /** Integrantes do grupo com vigência na data. */
  members: ReadonlySet<string>;
};

export const SHARED_POLICY: Policy = { assignment: null, exception: null, members: new Set() };

/** Regra literal de DIR-031. */
export function isEligible(employeeId: string, policy: Policy): boolean {
  const a = policy.assignment;
  if (!a) return true;
  if (a.mode === "individual" && a.needsReview) return false;
  const x = policy.exception;
  if (x) {
    if (x.kind === "release_to_shared") return true;
    return x.beneficiaryEmployeeId === employeeId;
  }
  if (a.mode === "individual") return a.holderEmployeeId === employeeId;
  return policy.members.has(employeeId);
}

/** Classe da mesa numa data (DIR-026), mesma ordem de desk_class no banco. */
export function deskClass(r: { retired: boolean; period: { status: "maintenance" | "admin_block" } | null; policy: Policy }): "retired" | "maintenance" | "blocked" | "exclusive" | "shared" {
  if (r.retired) return "retired";
  if (r.period?.status === "maintenance") return "maintenance";
  if (r.period?.status === "admin_block") return "blocked";
  // Mesa em revisão (titular desativado): ninguém é elegível, nem pela liberação ao compartilhado; conta como exclusiva
  // (DIR-018, DIR-026), como o desk_class da migração 0015.
  if (r.policy.assignment && (r.policy.assignment.needsReview || r.policy.exception?.kind !== "release_to_shared")) return "exclusive";
  return "shared";
}

export type BookingOnDate = { id: string; employeeId: string; status: "held" | "confirmed"; holdExpiresAt: Date | null; origin: string };

export type ResourceOnDate = {
  id: string;
  code: string;
  type: "desk" | "room" | "booth";
  zoneCode: string | null;
  zoneName: string | null;
  capacity: number | null;
  attributes: Record<string, unknown>;
  retired: boolean;
  period: { id: string; status: "maintenance" | "admin_block"; publicReason: string | null } | null;
  policy: Policy;
  booking: BookingOnDate | null;
};

export type Person = { id: string; status: string; canBookSelf: boolean };

export type DayContext = {
  date: string;
  now: Date;
  officeOpen: boolean;
  closedReason: string | null;
  window: { open: boolean; opensAt: Date | null };
  /** Reserva ativa da pessoa em qualquer mesa na data. */
  personBooking: { resourceId: string; id: string; status?: "confirmed" | "held" } | null;
  /** Realocação e cancelamento administrativos são isentos da janela (PAR-29). */
  windowExempt?: boolean;
};

export type AvailabilityCode = "inactive" | "office_closed" | "window_closed" | "retired" | "maintenance" | "blocked" | "exclusive" | "reserved" | "mine" | "daily_limit" | "available";

export type Availability = {
  code: AvailabilityCode;
  /** Texto do estado, sem depender de cor. */
  label: string;
  /** Razão exibida: o primeiro impedimento da ordem de cálculo. */
  reason: string;
  canBook: boolean;
  mine: boolean;
  /** Titular da atribuição individual vigente: "Sua mesa de uso exclusivo". */
  exclusiveMine: boolean;
  opensAt: Date | null;
  publicReason: string | null;
  bookingId: string | null;
  /** A "minha" reserva é uma oferta da fila ainda não aceita (retenção). */
  offerPending?: boolean;
};

const EXCLUSIVE_LABEL = "Uso exclusivo — Diretoria";

/** Ordem fixa de DIR-019; o primeiro impedimento é a razão. */
export function explain(person: Person, r: ResourceOnDate, ctx: DayContext): Availability {
  const mine = !!r.booking && r.booking.employeeId === person.id;
  const exclusiveMine = !!r.policy.assignment && r.policy.assignment.mode === "individual" && r.policy.assignment.holderEmployeeId === person.id && !r.policy.exception;
  // DIR-035: a resposta carrega o id da reserva só quando é minha.
  const base = { mine, exclusiveMine, opensAt: null as Date | null, publicReason: null as string | null, bookingId: mine ? (r.booking?.id ?? null) : null };
  if (person.status !== "active" || !person.canBookSelf) {
    return { ...base, code: "inactive", label: "Indisponível", reason: "conta inativa ou sem permissão", canBook: false };
  }
  if (!ctx.officeOpen) {
    return { ...base, code: "office_closed", label: "Escritório fechado", reason: ctx.closedReason ? `escritório fechado: ${ctx.closedReason}` : "escritório fechado", canBook: false };
  }
  if (!ctx.window.open && !ctx.windowExempt) {
    const when = ctx.window.opensAt ? format(new TZDate(ctx.window.opensAt, TZ), "dd/MM/yyyy 'às' HH:mm") : "data ainda não definida";
    return { ...base, code: "window_closed", label: "Fora da janela", reason: `reservas para esta data abrem em ${when}`, canBook: false, opensAt: ctx.window.opensAt };
  }
  if (r.retired) return { ...base, code: "retired", label: "Desativada", reason: "recurso desativado", canBook: false };
  if (r.period?.status === "maintenance") return { ...base, code: "maintenance", label: "Em manutenção", reason: "em manutenção", canBook: false, publicReason: r.period.publicReason };
  if (r.period?.status === "admin_block") return { ...base, code: "blocked", label: "Bloqueada", reason: "bloqueada administrativamente", canBook: false, publicReason: r.period.publicReason };
  if (!isEligible(person.id, r.policy)) {
    const a = r.policy.assignment;
    const x = r.policy.exception;
    // Titular durante liberação nominal a outra pessoa (PAR-26): o texto explica, em vez do rótulo genérico.
    if (a?.mode === "individual" && a.holderEmployeeId === person.id && x?.kind === "release_to_employee") {
      const until = x.endsOn ? ` até ${x.endsOn.split("-").reverse().slice(0, 2).join("/")}` : "";
      return { ...base, code: "exclusive", label: `Liberada a outra pessoa${until}`, reason: "sua mesa está liberada a outra pessoa nesta data", canBook: false };
    }
    return { ...base, code: "exclusive", label: EXCLUSIVE_LABEL, reason: "uso exclusivo da diretoria", canBook: false };
  }
  if (r.booking && r.booking.employeeId !== person.id) return { ...base, code: "reserved", label: "Reservada", reason: "reservada", canBook: false };
  if (mine && r.booking?.status === "held") return { ...base, code: "mine", label: "Oferecida a você", reason: "oferta da fila: aceite ou recuse em Minhas reservas", canBook: false, offerPending: true };
  if (mine) return { ...base, code: "mine", label: "Sua reserva", reason: "sua reserva", canBook: false };
  if (ctx.personBooking && ctx.personBooking.resourceId !== r.id) return { ...base, code: "daily_limit", label: exclusiveMine ? "Sua mesa de uso exclusivo" : "Disponível", reason: ctx.personBooking.status === "held" ? "você tem uma oferta da fila pendente neste dia (aceite ou recuse em Minhas reservas)" : "você já tem reserva neste dia", canBook: false };
  return { ...base, code: "available", label: exclusiveMine ? "Sua mesa de uso exclusivo" : "Disponível", reason: "disponível para você", canBook: true };
}

/** Segunda-feira da semana de uma data ISO, em dia local. */
export function weekStartOf(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const local = new TZDate(y, m - 1, d, TZ);
  return format(startOfWeek(local, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Instante de abertura da semana de uma data (PAR-01): dia e hora configurados da semana anterior, em horário local. */
/** Só a parte da janela dos parâmetros (PAR-01). */
export type WindowSettings = Pick<OfficeSettings, "bookingOpenWeekday" | "bookingOpenTime" | "bookingHorizonWeeks">;

export function bookingWindowOpensAt(isoDate: string, s: WindowSettings): Date {
  const [y, m, d] = weekStartOf(isoDate).split("-").map(Number);
  const [hh, mm] = s.bookingOpenTime.split(":").map(Number);
  const monday = new TZDate(y, m - 1, d, TZ);
  const openDay = addDaysFns(monday, -7 + (s.bookingOpenWeekday - 1));
  return new TZDate(openDay.getFullYear(), openDay.getMonth(), openDay.getDate(), hh, mm, 0, TZ);
}

export function bookingWindow(isoDate: string, now: Date, s: WindowSettings): { open: boolean; opensAt: Date | null } {
  const today = localToday(now);
  if (isoDate < today) return { open: false, opensAt: null };
  const weeksAhead = Math.floor(daysBetween(weekStartOf(today), weekStartOf(isoDate)) / 7);
  if (weeksAhead > s.bookingHorizonWeeks) return { open: false, opensAt: null };
  if (weeksAhead <= 0) return { open: true, opensAt: null };
  const opensAt = bookingWindowOpensAt(isoDate, s);
  return { open: now.getTime() >= opensAt.getTime(), opensAt };
}
