import { describe, expect, it } from "vitest";
import { TZDate } from "@date-fns/tz";
import { type DayContext, type Person, type Policy, type ResourceOnDate, SHARED_POLICY, bookingWindow, bookingWindowOpensAt, deskClass, explain, isEligible, weekStartOf } from "@/modules/availability/rules";

const TZ = "America/Sao_Paulo";
const settings = { bookingOpenWeekday: 4, bookingOpenTime: "10:00", bookingHorizonWeeks: 4, exceptionMaxDays: 30 };

const holder = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const member = "33333333-3333-4333-8333-333333333333";
const individual = (over: Partial<Policy["assignment"] & object> = {}): Policy["assignment"] => ({ id: "a", mode: "individual", holderEmployeeId: holder, accessGroupId: null, needsReview: false, validFrom: "2026-10-01", validTo: null, ...over });
const group = (): Policy["assignment"] => ({ id: "g", mode: "group", holderEmployeeId: null, accessGroupId: "grp", needsReview: false, validFrom: "2026-10-01", validTo: null });

/** DIR-031-T1: tabela de casos da regra de elegibilidade. A mesma tabela roda contra o SQL em office-db.test.ts. */
export const ELIGIBILITY_CASES: Array<{ name: string; policy: Policy; person: string; expected: boolean }> = [
  { name: "sem atribuição: qualquer conta", policy: SHARED_POLICY, person: other, expected: true },
  { name: "individual sem exceção: titular", policy: { assignment: individual(), exception: null, members: new Set() }, person: holder, expected: true },
  { name: "individual sem exceção: outra pessoa", policy: { assignment: individual(), exception: null, members: new Set() }, person: other, expected: false },
  { name: "individual em revisão: ninguém, nem o titular", policy: { assignment: individual({ needsReview: true }), exception: null, members: new Set() }, person: holder, expected: false },
  { name: "liberada ao compartilhado: qualquer conta", policy: { assignment: individual(), exception: { id: "x", kind: "release_to_shared", beneficiaryEmployeeId: null }, members: new Set() }, person: other, expected: true },
  { name: "liberada ao compartilhado: titular incluído", policy: { assignment: individual(), exception: { id: "x", kind: "release_to_shared", beneficiaryEmployeeId: null }, members: new Set() }, person: holder, expected: true },
  { name: "liberada a pessoa: beneficiário", policy: { assignment: individual(), exception: { id: "x", kind: "release_to_employee", beneficiaryEmployeeId: other }, members: new Set() }, person: other, expected: true },
  { name: "liberada a pessoa: titular excluído nessa data (PAR-26)", policy: { assignment: individual(), exception: { id: "x", kind: "release_to_employee", beneficiaryEmployeeId: other }, members: new Set() }, person: holder, expected: false },
  { name: "liberada a pessoa: terceiro", policy: { assignment: individual(), exception: { id: "x", kind: "release_to_employee", beneficiaryEmployeeId: other }, members: new Set() }, person: member, expected: false },
  { name: "grupo sem exceção: integrante vigente", policy: { assignment: group(), exception: null, members: new Set([member]) }, person: member, expected: true },
  { name: "grupo sem exceção: não integrante", policy: { assignment: group(), exception: null, members: new Set([member]) }, person: other, expected: false },
  { name: "grupo sem exceção: diretor que não integra o grupo", policy: { assignment: group(), exception: null, members: new Set([member]) }, person: holder, expected: false },
];

describe("regra única de elegibilidade (DIR-031)", () => {
  for (const c of ELIGIBILITY_CASES) {
    it(c.name, () => {
      expect(isEligible(c.person, c.policy)).toBe(c.expected);
    });
  }
});

const desk = (over: Partial<ResourceOnDate> = {}): ResourceOnDate => ({ id: "r1", code: "M001", type: "desk", zoneCode: null, zoneName: null, capacity: null, attributes: {}, retired: false, period: null, policy: SHARED_POLICY, booking: null, ...over });
const active: Person = { id: other, status: "active", canBookSelf: true };
const ctx = (over: Partial<DayContext> = {}): DayContext => ({ date: "2026-10-05", now: new Date("2026-10-01T12:00:00Z"), officeOpen: true, closedReason: null, window: { open: true, opensAt: null }, personBooking: null, ...over });

/** DIR-019-T1: ordem fixa; o primeiro impedimento é a razão. */
describe("ordem de cálculo de disponibilidade (DIR-019)", () => {
  it("conta inativa vem antes de tudo, mesmo com escritório fechado e mesa em manutenção", () => {
    const a = explain({ ...active, status: "suspended" }, desk({ period: { id: "p", status: "maintenance", publicReason: null } }), ctx({ officeOpen: false }));
    expect(a.code).toBe("inactive");
  });
  it("sem permissão de reserva: inativa", () => {
    expect(explain({ ...active, canBookSelf: false }, desk(), ctx()).code).toBe("inactive");
  });
  it("escritório fechado vem antes da janela e da manutenção", () => {
    expect(explain(active, desk({ period: { id: "p", status: "maintenance", publicReason: null } }), ctx({ officeOpen: false, closedReason: "feriado", window: { open: false, opensAt: null } })).reason).toContain("feriado");
  });
  it("janela fechada informa o instante de abertura e vem antes da manutenção", () => {
    const opensAt = new TZDate(2026, 9, 1, 10, 0, 0, TZ);
    const a = explain(active, desk({ period: { id: "p", status: "maintenance", publicReason: null } }), ctx({ window: { open: false, opensAt } }));
    expect(a.code).toBe("window_closed");
    expect(a.reason).toBe("reservas para esta data abrem em 01/10/2026 às 10:00");
  });
  it("realocação administrativa é isenta da janela (PAR-29)", () => {
    expect(explain(active, desk(), ctx({ window: { open: false, opensAt: null }, windowExempt: true })).code).toBe("available");
  });
  it("manutenção vem antes do bloqueio e da exclusividade, inclusive para o titular (DIR-020)", () => {
    const r = desk({ period: { id: "p", status: "maintenance", publicReason: "troca de tampo" }, policy: { assignment: individual(), exception: null, members: new Set() } });
    const a = explain({ ...active, id: holder }, r, ctx());
    expect(a.code).toBe("maintenance");
    expect(a.publicReason).toBe("troca de tampo");
    expect(a.exclusiveMine).toBe(true);
  });
  it("bloqueio vem antes da exclusividade", () => {
    const r = desk({ period: { id: "p", status: "admin_block", publicReason: null }, policy: { assignment: individual(), exception: null, members: new Set() } });
    expect(explain(active, r, ctx()).code).toBe("blocked");
  });
  it("mesa exclusiva de outra pessoa: rótulo literal e sem reserva, antes de olhar reservas", () => {
    const r = desk({ policy: { assignment: individual(), exception: null, members: new Set() }, booking: { id: "b", employeeId: holder, status: "confirmed", holdExpiresAt: null, origin: "self" } });
    const a = explain(active, r, ctx());
    expect(a.code).toBe("exclusive");
    expect(a.label).toBe("Uso exclusivo — Diretoria");
    expect(a.canBook).toBe(false);
  });
  it("titular vê a própria mesa como disponível com o rótulo próprio", () => {
    const a = explain({ ...active, id: holder }, desk({ policy: { assignment: individual(), exception: null, members: new Set() } }), ctx());
    expect(a.code).toBe("available");
    expect(a.label).toBe("Sua mesa de uso exclusivo");
  });
  it("reservada por outra pessoa vem antes do limite diário", () => {
    const r = desk({ booking: { id: "b", employeeId: holder, status: "confirmed", holdExpiresAt: null, origin: "self" } });
    expect(explain(active, r, ctx({ personBooking: { id: "z", resourceId: "r9" } })).code).toBe("reserved");
  });
  it("retenção viva de terceiro aparece como reservada", () => {
    const r = desk({ booking: { id: "b", employeeId: holder, status: "held", holdExpiresAt: new Date(Date.now() + 60_000), origin: "waitlist_offer" } });
    expect(explain(active, r, ctx()).code).toBe("reserved");
  });
  it("minha reserva", () => {
    const r = desk({ booking: { id: "b", employeeId: other, status: "confirmed", holdExpiresAt: null, origin: "self" } });
    const a = explain(active, r, ctx({ personBooking: { id: "b", resourceId: "r1" } }));
    expect(a.code).toBe("mine");
    expect(a.mine).toBe(true);
  });
  it("já tenho reserva em outra mesa no dia: limite diário (DIR-012)", () => {
    const a = explain(active, desk(), ctx({ personBooking: { id: "z", resourceId: "r9" } }));
    expect(a.code).toBe("daily_limit");
    expect(a.reason).toBe("você já tem reserva neste dia");
  });
  it("oferta da fila pendente em outra mesa: a razão diz oferta, não reserva (DEC-40)", () => {
    const a = explain(active, desk(), ctx({ personBooking: { id: "z", resourceId: "r9", status: "held" } }));
    expect(a.code).toBe("daily_limit");
    expect(a.reason).toMatch(/oferta da fila pendente/);
  });
  it("disponível para você", () => {
    expect(explain(active, desk(), ctx()).canBook).toBe(true);
  });
  it("DIR-005: vínculo não é reserva; mesa exclusiva sem reserva não aparece como ocupada", () => {
    const a = explain({ ...active, id: holder }, desk({ policy: { assignment: individual(), exception: null, members: new Set() } }), ctx());
    expect(a.mine).toBe(false);
    expect(a.bookingId).toBeNull();
  });
});

describe("classe da mesa (DIR-026)", () => {
  it("manutenção vence exclusividade: mesa exclusiva em manutenção conta uma única vez", () => {
    expect(deskClass({ retired: false, period: { status: "maintenance" }, policy: { assignment: individual(), exception: null, members: new Set() } })).toBe("maintenance");
  });
  it("exceção ao compartilhado devolve a mesa ao conjunto compartilhado nessa data", () => {
    expect(deskClass({ retired: false, period: null, policy: { assignment: individual(), exception: { id: "x", kind: "release_to_shared", beneficiaryEmployeeId: null }, members: new Set() } })).toBe("shared");
  });
  it("liberação nominal mantém a mesa fora do compartilhado", () => {
    expect(deskClass({ retired: false, period: null, policy: { assignment: individual(), exception: { id: "x", kind: "release_to_employee", beneficiaryEmployeeId: other }, members: new Set() } })).toBe("exclusive");
  });
  it("desativada vence tudo", () => {
    expect(deskClass({ retired: true, period: { status: "maintenance" }, policy: SHARED_POLICY })).toBe("retired");
  });
});

describe("janela de abertura (PAR-01)", () => {
  it("segunda-feira da semana em dia local", () => {
    expect(weekStartOf("2026-10-07")).toBe("2026-10-05");
    expect(weekStartOf("2026-10-05")).toBe("2026-10-05");
    expect(weekStartOf("2026-10-11")).toBe("2026-10-05");
  });
  it("a semana seguinte abre na quinta às 10h locais da semana corrente", () => {
    const opensAt = bookingWindowOpensAt("2026-10-12", settings);
    expect(new TZDate(opensAt, TZ).toISOString().startsWith("2026-10-08T10:00")).toBe(true);
    // quinta 09:59 local: fechada; 10:00: aberta
    expect(bookingWindow("2026-10-12", new TZDate(2026, 9, 8, 9, 59, 0, TZ), settings).open).toBe(false);
    expect(bookingWindow("2026-10-12", new TZDate(2026, 9, 8, 10, 0, 0, TZ), settings).open).toBe(true);
  });
  it("semana corrente sempre aberta para datas de hoje em diante; passado fechado", () => {
    const now = new TZDate(2026, 9, 6, 8, 0, 0, TZ);
    expect(bookingWindow("2026-10-06", now, settings).open).toBe(true);
    expect(bookingWindow("2026-10-09", now, settings).open).toBe(true);
    expect(bookingWindow("2026-10-05", now, settings).open).toBe(false);
  });
  it("duas semanas à frente permanece fechada até a quinta da semana seguinte", () => {
    expect(bookingWindow("2026-10-19", new TZDate(2026, 9, 9, 12, 0, 0, TZ), settings).open).toBe(false);
    expect(bookingWindow("2026-10-19", new TZDate(2026, 9, 15, 10, 0, 0, TZ), settings).open).toBe(true);
  });
  it("DIR-029: virada de dia em Brasília, não em UTC: 23:30 local de quarta ainda é quarta", () => {
    // 2026-10-08 23:30 em São Paulo é 2026-10-09 02:30 UTC; a segunda seguinte já está aberta desde as 10h de quinta
    const now = new Date("2026-10-09T02:30:00Z");
    expect(bookingWindow("2026-10-12", now, settings).open).toBe(true);
    // 2026-10-08 02:30 UTC é quarta 23:30 local: ainda fechada
    expect(bookingWindow("2026-10-12", new Date("2026-10-08T02:30:00Z"), settings).open).toBe(false);
  });
});

describe("oferta da fila como estado próprio (INT-03)", () => {
  it("retenção da própria pessoa aparece como oferta, não como reserva", () => {
    const person = { id: "p1", status: "active", canBookSelf: true };
    const r = { id: "r1", code: "F001", type: "desk" as const, zoneCode: null, zoneName: null, capacity: null, attributes: {}, retired: false, period: null, policy: SHARED_POLICY, booking: { id: "b1", employeeId: "p1", status: "held" as const, holdExpiresAt: new Date(Date.now() + 60_000), origin: "waitlist_offer" } };
    const a = explain(person, r, { date: "2026-10-06", now: new Date(), officeOpen: true, closedReason: null, window: { open: true, opensAt: null }, personBooking: { id: "b1", resourceId: "r1" } });
    expect(a).toMatchObject({ code: "mine", label: "Oferecida a você", offerPending: true, canBook: false });
  });
});
