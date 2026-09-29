import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvent, deskBooking, exclusiveAssignment, outboxEvent } from "@/db/schema";
import { stateForPerson } from "@/modules/availability/service";
import { bookDesk } from "@/modules/booking/service";
import { deactivateEmployee, suspendEmployee } from "@/modules/employees/service";
import { addGroupMember, batchAssign, cancelAssignment, createAssignment, createException, endAssignment, history, listAssignments, needsReviewList, previewAssignment, previewException, previewRemoveMember, previewRevokeException, previewTransfer, removeGroupMember, revokeException, transferAssignment } from "@/modules/exclusivity/service";
import { closeDay, createStatusPeriod, previewStatusPeriod, retireResource } from "@/modules/workplace/service";
import { pendingConflicts } from "@/modules/office/conflicts";
import { ConflictError, ForbiddenError } from "@/modules/shared/errors";
import { addDays, localToday } from "@/modules/shared/dates";
import { directorsGroupId, privilegedActor, resetDb, seedDesk, seedEmployee } from "./helpers";

const today = localToday();
const d = (n: number) => addDays(today, n);
const actorOf = (e: { id: string }) => ({ employeeId: e.id, userId: `u-${e.id}`, requestId: randomUUID() });

const rhWithMfa = () => privilegedActor({ roles: ["hr"], permissions: ["booking.on_behalf.create", "booking.admin.manage", "resource.status.manage", "resource.manage"] });

const book = (p: { id: string }, resourceId: string, date: string) => bookDesk(db, actorOf(p), { employeeId: p.id, resourceId, date, idempotencyKey: randomUUID() });

describe("exclusividade da diretoria", () => {
  beforeEach(resetDb);

  it("DIR-004-T1: travar sem reservas incompatíveis aplica a restrição em todos os canais e notifica o titular", async () => {
    const rh = await rhWithMfa();
    const holder = await seedEmployee({ orgCondition: "director" });
    const common = await seedEmployee();
    const desk = await seedDesk("M001");
    const preview = await previewAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "diretoria", responsible: "Diretoria executiva" });
    expect(preview.conflicts).toEqual([]);
    expect(preview.blockers).toEqual([]);
    const id = await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "diretoria", responsible: "Diretoria executiva" });
    expect((await stateForPerson(db, common.id, d(1))).items[0].availability.label).toBe("Uso exclusivo — Diretoria");
    expect((await stateForPerson(db, holder.id, d(1))).items[0].availability.label).toBe("Sua mesa de uso exclusivo");
    await expect(book(common, desk.id, d(1))).rejects.toThrow(/uso exclusivo/);
    const [a] = await listAssignments(db, { resourceId: desk.id });
    expect(a).toMatchObject({ id, state: "active", holderName: holder.name, responsible: "Diretoria executiva" });
    const mails = await db.select().from(outboxEvent).where(eq(outboxEvent.eventType, "email.exclusivity"));
    expect(mails).toHaveLength(1);
    expect(JSON.stringify(mails[0].payload)).toContain(holder.email);
    expect(JSON.stringify(mails[0].payload)).not.toMatch(/\d{11}/);
  });

  it("titular precisa ser diretor ativo (PAR-23); só quem tem a permissão trava; diretor não remove a própria exclusividade (DIR-015)", async () => {
    const rh = await rhWithMfa();
    const notDirector = await seedEmployee();
    const holder = await seedEmployee({ orgCondition: "director" });
    const desk = await seedDesk();
    await expect(createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: notDirector.id, validFrom: today, reason: "x", responsible: "RH" })).rejects.toThrow(/diretor/);
    await expect(createAssignment(db, actorOf(holder), { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "x", responsible: "RH" })).rejects.toBeInstanceOf(ForbiddenError);
    const id = await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "x", responsible: "RH" });
    await expect(endAssignment(db, actorOf(holder), { assignmentId: id, validTo: today, reason: "quero liberar" })).rejects.toBeInstanceOf(ForbiddenError);
    const fac = await privilegedActor({ roles: ["facilities"] });
    await expect(endAssignment(db, actorOf(fac), { assignmentId: id, validTo: today, reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("DIR-016-T1 a T3: trava com reservas incompatíveis: conflito explícito, opções e revalidação na confirmação", async () => {
    const rh = await rhWithMfa();
    const holder = await seedEmployee({ orgCondition: "director" });
    const p1 = await seedEmployee();
    const p2 = await seedEmployee();
    const desk = await seedDesk("M001");
    const other = await seedDesk("M002");
    const b1 = await book(p1, desk.id, d(2));
    const b2 = await book(p2, desk.id, d(5));
    await book(holder, desk.id, d(3)); // reserva do próprio titular: compatível
    const input = { resourceId: desk.id, mode: "individual" as const, holderEmployeeId: holder.id, validFrom: d(1), reason: "trava", responsible: "RH" };
    const preview = await previewAssignment(db, rh.actor, input);
    expect(preview.conflicts.map((c) => [c.bookingId, c.employeeName])).toEqual([
      [b1.bookingId, p1.name],
      [b2.bookingId, p2.name],
    ]);
    // T1: sem decisão nada é aplicado
    await expect(createAssignment(db, rh.actor, input)).rejects.toThrow(/sem decisão/);
    expect(await db.select().from(exclusiveAssignment)).toHaveLength(0);
    expect((await db.select().from(deskBooking).where(eq(deskBooking.status, "confirmed"))).length).toBe(3);
    // T2: opção "iniciar após a última reserva incompatível"
    const later = await previewAssignment(db, rh.actor, { ...input, validFrom: d(6) });
    expect(later.conflicts).toEqual([]);
    // T2: tratamento por reserva: cancelar uma com motivo, realocar outra para mesa disponível
    const decisions = [
      { bookingId: b1.bookingId, action: "cancel" as const, reason: "mesa passa à diretoria", message: "Pedimos desculpas." },
      { bookingId: b2.bookingId, action: "realloc" as const, reason: "mesa passa à diretoria", targetResourceId: other.id },
    ];
    // T3: entre a prévia e a confirmação surge nova reserva incompatível: a confirmação é recusada e nada é aplicado
    const p3 = await seedEmployee();
    const b3 = await book(p3, desk.id, d(4));
    await expect(createAssignment(db, rh.actor, input, decisions)).rejects.toThrow(/sem decisão/);
    expect(await db.select().from(exclusiveAssignment)).toHaveLength(0);
    expect((await db.select().from(deskBooking).where(inArray(deskBooking.status, ["confirmed"]))).length).toBe(4);
    const id = await createAssignment(db, rh.actor, input, [...decisions, { bookingId: b3.bookingId, action: "cancel", reason: "mesa passa à diretoria" }]);
    expect(id).toBeTruthy();
    const rows = await db.select({ id: deskBooking.id, status: deskBooking.status, resourceId: deskBooking.resourceId, origin: deskBooking.origin }).from(deskBooking);
    expect(rows.find((r) => r.id === b1.bookingId)?.status).toBe("cancelled");
    expect(rows.find((r) => r.id === b2.bookingId)?.status).toBe("cancelled");
    expect(rows.find((r) => r.resourceId === other.id && r.origin === "admin_realloc")?.status).toBe("confirmed");
    const mails = await db.select().from(outboxEvent).where(eq(outboxEvent.eventType, "email.booking_changed"));
    expect(mails.map((m) => JSON.stringify(m.payload).includes("cancelada") ? "cancel" : "realloc").sort()).toEqual(["cancel", "cancel", "realloc"]);
    expect(await pendingConflicts(db, today)).toEqual([]);
    const audits = (await db.select({ a: auditEvent.action }).from(auditEvent)).map((x) => x.a);
    expect(audits).toEqual(expect.arrayContaining(["booking.cancelled_by_conflict", "booking.reallocated", "exclusivity.assignment_created"]));
  });

  it("realocação para mesa indisponível para a pessoa é recusada e nada é aplicado", async () => {
    const rh = await rhWithMfa();
    const holder = await seedEmployee({ orgCondition: "director" });
    const other = await seedEmployee({ orgCondition: "director" });
    const p = await seedEmployee();
    const desk = await seedDesk();
    const otherDesk = await seedDesk();
    await createAssignment(db, rh.actor, { resourceId: otherDesk.id, mode: "individual", holderEmployeeId: other.id, validFrom: today, reason: "x", responsible: "RH" });
    const b = await book(p, desk.id, d(2));
    await expect(createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: d(1), reason: "x", responsible: "RH" }, [{ bookingId: b.bookingId, action: "realloc", reason: "x", targetResourceId: otherDesk.id }])).rejects.toThrow(/não está disponível/);
    expect((await db.select().from(exclusiveAssignment)).length).toBe(1);
    const [still] = await db.select({ status: deskBooking.status }).from(deskBooking).where(eq(deskBooking.id, b.bookingId));
    expect(still.status).toBe("confirmed");
  });

  it("agendar: reservas até o início continuam válidas; DIR-036: encerrar grava só o término; anular só antes do início", async () => {
    const rh = await rhWithMfa();
    const holder = await seedEmployee({ orgCondition: "director" });
    const p = await seedEmployee();
    const desk = await seedDesk();
    const pb = await book(p, desk.id, d(1));
    const preview = await previewAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: d(3), reason: "x", responsible: "RH" });
    expect(preview.conflicts).toEqual([]);
    const id = await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: d(3), reason: "x", responsible: "RH" });
    expect((await listAssignments(db))[0].state).toBe("scheduled");
    await cancelAssignment(db, rh.actor, { assignmentId: id, reason: "mudou o plano" });
    expect(await listAssignments(db)).toEqual([]);
    const id2 = await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "x", responsible: "RH" }, [{ bookingId: pb.bookingId, action: "cancel", reason: "trava imediata" }]);
    await expect(cancelAssignment(db, rh.actor, { assignmentId: id2, reason: "x" })).rejects.toThrow(/agendada/);
    await endAssignment(db, rh.actor, { assignmentId: id2, validTo: d(2), reason: "encerrada" });
    const row = (await listAssignments(db, { includeClosed: true })).find((r) => r.id === id2);
    expect(row).toMatchObject({ validTo: d(2), endReason: "ended", state: "active" });
    // DIR-036-T1: encerrar e criar nova sobreposta é rejeitado; nova a partir do dia seguinte é aceita
    await expect(createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: d(2), reason: "x", responsible: "RH" })).rejects.toThrow(/Já existe atribuição/);
    await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: d(3), reason: "x", responsible: "RH" });
    expect((await stateForPerson(db, p.id, d(3))).items[0].availability.code).toBe("exclusive");
    expect((await stateForPerson(db, p.id, d(2))).items[0].availability.code).toBe("exclusive");
  });

  it("DIR-017-T1: transferência avalia as reservas do titular anterior; sucessora contígua; anular sucessora exige decisão", async () => {
    const rh = await rhWithMfa();
    const h1 = await seedEmployee({ orgCondition: "director" });
    const h2 = await seedEmployee({ orgCondition: "director" });
    const desk = await seedDesk("M001");
    const spare = await seedDesk("M002");
    const id = await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: h1.id, validFrom: today, reason: "x", responsible: "RH" });
    const b = await book(h1, desk.id, d(3));
    await book(h2, spare.id, d(3));
    const preview = await previewTransfer(db, rh.actor, { assignmentId: id, newHolderEmployeeId: h2.id, from: d(2), reason: "troca", responsible: "RH" });
    expect(preview.conflicts.map((c) => c.bookingId)).toEqual([b.bookingId]);
    expect(preview.newHolderElsewhere).toHaveLength(1);
    await expect(transferAssignment(db, rh.actor, { assignmentId: id, newHolderEmployeeId: h2.id, from: d(2), reason: "troca", responsible: "RH" })).rejects.toThrow(/sem decisão/);
    const succ = await transferAssignment(db, rh.actor, { assignmentId: id, newHolderEmployeeId: h2.id, from: d(2), reason: "troca", responsible: "RH" }, [{ bookingId: b.bookingId, action: "cancel", reason: "transferência" }]);
    const rows = await listAssignments(db, { resourceId: desk.id, includeClosed: true });
    expect(rows.map((r) => [r.holderName, r.validFrom, r.validTo, r.endReason])).toEqual([
      [h2.name, d(2), null, null],
      [h1.name, today, d(1), "transferred"],
    ]);
    expect((await stateForPerson(db, h1.id, d(2))).items.find((i) => i.resource.code === "M001")?.availability.code).toBe("exclusive");
    expect((await stateForPerson(db, h2.id, d(2))).items.find((i) => i.resource.code === "M001")?.availability.label).toBe("Sua mesa de uso exclusivo");
    await expect(cancelAssignment(db, rh.actor, { assignmentId: succ, reason: "x" })).rejects.toThrow(/sucessora/);
    await cancelAssignment(db, rh.actor, { assignmentId: succ, reason: "desistiu", successorDecision: "reopen" });
    const after = await listAssignments(db, { resourceId: desk.id });
    expect(after.map((r) => [r.holderName, r.validFrom, r.endReason])).toEqual([
      [h1.name, d(2), null],
      [h1.name, today, "transfer_cancelled"],
    ]);
    const mails = await db.select().from(outboxEvent).where(eq(outboxEvent.eventType, "email.exclusivity"));
    expect(mails.length).toBeGreaterThanOrEqual(3);
  });

  it("liberação temporária: ao compartilhado mantém reservas do titular; nominal trata reservas do titular (PAR-26); revogar avalia reservas do beneficiário", async () => {
    const rh = await rhWithMfa();
    const holder = await seedEmployee({ orgCondition: "director" });
    const guest = await seedEmployee();
    const common = await seedEmployee();
    const desk = await seedDesk();
    const spare = await seedDesk();
    const id = await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "x", responsible: "RH" });
    const hb = await book(holder, desk.id, d(2));
    const shared = await previewException(db, rh.actor, { assignmentId: id, kind: "release_to_shared", startsOn: d(1), endsOn: d(3), reason: "viagem" });
    expect(shared.conflicts).toEqual([]);
    const nominal = await previewException(db, rh.actor, { assignmentId: id, kind: "release_to_employee", beneficiaryEmployeeId: guest.id, startsOn: d(1), endsOn: d(3), reason: "viagem" });
    expect(nominal.conflicts.map((c) => c.bookingId)).toEqual([hb.bookingId]);
    await expect(createException(db, rh.actor, { assignmentId: id, kind: "release_to_employee", beneficiaryEmployeeId: guest.id, startsOn: d(1), endsOn: d(3), reason: "viagem" })).rejects.toThrow(/sem decisão/);
    const xid = await createException(db, rh.actor, { assignmentId: id, kind: "release_to_employee", beneficiaryEmployeeId: guest.id, startsOn: d(1), endsOn: d(3), reason: "viagem" }, [{ bookingId: hb.bookingId, action: "realloc", reason: "liberação", targetResourceId: spare.id }]);
    const gb = await book(guest, desk.id, d(2));
    await expect(book(common, desk.id, d(2))).rejects.toThrow(/uso exclusivo/);
    expect((await stateForPerson(db, holder.id, d(2))).items.find((i) => i.resource.id === desk.id)?.availability.code).toBe("exclusive");
    expect((await stateForPerson(db, holder.id, d(4))).items.find((i) => i.resource.id === desk.id)?.availability.label).toBe("Sua mesa de uso exclusivo");
    const rev = await previewRevokeException(db, rh.actor, xid);
    expect(rev.conflicts.map((c) => c.bookingId)).toEqual([gb.bookingId]);
    await expect(revokeException(db, rh.actor, { exceptionId: xid, reason: "voltou" })).rejects.toThrow(/sem decisão/);
    await revokeException(db, rh.actor, { exceptionId: xid, reason: "voltou" }, [{ bookingId: gb.bookingId, action: "cancel", reason: "liberação revogada" }]);
    expect((await stateForPerson(db, holder.id, d(3))).items.find((i) => i.resource.id === desk.id)?.availability.label).toBe("Sua mesa de uso exclusivo");
    // na data em que o titular foi realocado, a mesa volta a ser dele mas o limite diário se aplica
    expect((await stateForPerson(db, holder.id, d(2))).items.find((i) => i.resource.id === desk.id)?.availability).toMatchObject({ code: "daily_limit", exclusiveMine: true, label: "Sua mesa de uso exclusivo" });
    // duração máxima (PAR-35)
    await expect(createException(db, rh.actor, { assignmentId: id, kind: "release_to_shared", startsOn: d(1), endsOn: d(40), reason: "x" })).rejects.toThrow(/acima de 30 dias/);
  });

  it("DIR-032: remover integrante do grupo lista as reservas futuras dele nas mesas do grupo e exige decisão", async () => {
    const rh = await rhWithMfa();
    const m1 = await seedEmployee({ orgCondition: "director" });
    const m2 = await seedEmployee({ orgCondition: "director" });
    const group = await directorsGroupId();
    const mid1 = await addGroupMember(db, rh.actor, { groupId: group, employeeId: m1.id, validFrom: today, reason: "x" });
    await addGroupMember(db, rh.actor, { groupId: group, employeeId: m2.id, validFrom: today, reason: "x" });
    await expect(addGroupMember(db, rh.actor, { groupId: group, employeeId: (await seedEmployee()).id, validFrom: today, reason: "x" })).rejects.toThrow(/diretor/);
    const d1 = await seedDesk("G1");
    const d2 = await seedDesk("G2");
    await batchAssign(db, rh.actor, [
      { resourceId: d1.id, mode: "group", accessGroupId: group, validFrom: today, reason: "x", responsible: "RH" },
      { resourceId: d2.id, mode: "group", accessGroupId: group, validFrom: today, reason: "x", responsible: "RH" },
    ]);
    const b = await book(m1, d2.id, d(5));
    await book(m1, d1.id, d(1));
    const preview = await previewRemoveMember(db, rh.actor, { memberId: mid1, validTo: d(2) });
    expect(preview.conflicts.map((c) => c.bookingId)).toEqual([b.bookingId]);
    await expect(removeGroupMember(db, rh.actor, { memberId: mid1, validTo: d(2), reason: "saiu" })).rejects.toThrow(/sem decisão/);
    await removeGroupMember(db, rh.actor, { memberId: mid1, validTo: d(2), reason: "saiu" }, [{ bookingId: b.bookingId, action: "cancel", reason: "saída do grupo" }]);
    expect((await stateForPerson(db, m1.id, d(3))).items.map((i) => i.availability.code)).toEqual(["exclusive", "exclusive"]);
    expect((await stateForPerson(db, m1.id, d(1))).items.find((i) => i.resource.code === "G1")?.availability.code).toBe("mine");
    expect((await stateForPerson(db, m2.id, d(3))).items.map((i) => i.availability.code)).toEqual(["available", "available"]);
  });

  it("DIR-027: lote atômico: um conflito sem decisão bloqueia o lote inteiro", async () => {
    const rh = await rhWithMfa();
    const group = await directorsGroupId();
    const p = await seedEmployee();
    const a = await seedDesk("L1");
    const b = await seedDesk("L2");
    const c = await seedDesk("L3");
    await book(p, b.id, d(2));
    const inputs = [a, b, c].map((r) => ({ resourceId: r.id, mode: "group" as const, accessGroupId: group, validFrom: d(1), reason: "lote", responsible: "RH" }));
    await expect(batchAssign(db, rh.actor, inputs)).rejects.toThrow(/sem decisão/);
    expect(await db.select().from(exclusiveAssignment)).toHaveLength(0);
    const [bk] = await db.select({ id: deskBooking.id }).from(deskBooking);
    const ids = await batchAssign(db, rh.actor, inputs, [{ bookingId: bk.id, action: "cancel", reason: "lote" }]);
    expect(ids).toHaveLength(3);
  });

  it("DIR-018-T1: titular desativado: reservas futuras canceladas, vínculo em revisão, mesa permanece restrita a todos, inclusive reserva em nome", async () => {
    const rh = await rhWithMfa();
    const holder = await seedEmployee({ orgCondition: "director" });
    const common = await seedEmployee();
    const desk = await seedDesk();
    await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "x", responsible: "RH" });
    await book(holder, desk.id, d(2));
    await suspendEmployee(db, rh.actor, holder.id, "afastamento");
    // EMP-02-T1: suspensão mantém reservas
    expect((await db.select({ s: deskBooking.status }).from(deskBooking))[0].s).toBe("confirmed");
    await deactivateEmployee(db, rh.actor, holder.id, { reason: "desligamento" });
    expect((await db.select({ s: deskBooking.status }).from(deskBooking))[0].s).toBe("cancelled");
    const review = await needsReviewList(db);
    expect(review).toHaveLength(1);
    expect(review[0].needsReview).toBe(true);
    await expect(book(common, desk.id, d(3))).rejects.toThrow(/uso exclusivo/);
    await expect(bookDesk(db, rh.actor, { employeeId: common.id, resourceId: desk.id, date: d(3), idempotencyKey: randomUUID() })).rejects.toThrow(/uso exclusivo/);
    expect((await stateForPerson(db, common.id, d(3))).items[0].availability.code).toBe("exclusive");
  });

  it("DIR-033: manutenção, fechamento do dia e desativação de recurso passam pelo diálogo de conflito; DIR-003: mesa exclusiva em manutenção mantém as duas informações", async () => {
    const rh = await rhWithMfa();
    const holder = await seedEmployee({ orgCondition: "director" });
    const p = await seedEmployee();
    const desk = await seedDesk("X1");
    const spare = await seedDesk("X2");
    await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "x", responsible: "RH" });
    const hb = await book(holder, desk.id, d(2));
    const pb = await book(p, spare.id, d(2));
    const pv = await previewStatusPeriod(db, rh.actor, { resourceId: desk.id, status: "maintenance", startsOn: d(1), endsOn: d(3), reason: "x" });
    expect(pv.conflicts.map((c) => c.bookingId)).toEqual([hb.bookingId]);
    await expect(createStatusPeriod(db, rh.actor, { resourceId: desk.id, status: "maintenance", startsOn: d(1), endsOn: d(3), reason: "x" })).rejects.toThrow(/sem decisão/);
    await createStatusPeriod(db, rh.actor, { resourceId: desk.id, status: "maintenance", startsOn: d(1), endsOn: d(3), reason: "reparo", publicReason: "reparo elétrico" }, [{ bookingId: hb.bookingId, action: "cancel", reason: "reparo" }]);
    const st = (await stateForPerson(db, holder.id, d(2), { holderView: true })).items.find((i) => i.resource.code === "X1")!;
    expect(st.availability.code).toBe("maintenance");
    expect(st.availability.publicReason).toBe("reparo elétrico");
    expect(st.deskClass).toBe("maintenance");
    expect(st.holder?.name).toBe(holder.name);
    expect(st.availability.exclusiveMine).toBe(true);
    // fechamento do dia: só cancelamento, nunca realocação
    await expect(closeDay(db, rh.actor, { date: d(2), reason: "feriado" }, [{ bookingId: pb.bookingId, action: "realloc", reason: "x", targetResourceId: desk.id }])).rejects.toThrow(/realocação/);
    await expect(closeDay(db, rh.actor, { date: d(2), reason: "feriado" })).rejects.toThrow(/sem decisão/);
    await closeDay(db, rh.actor, { date: d(2), reason: "feriado" }, [{ bookingId: pb.bookingId, action: "cancel", reason: "feriado" }]);
    await expect(book(p, spare.id, d(2))).rejects.toThrow(/escritório fechado/);
    // desativar recurso com atribuição aberta é recusado; sem atribuição, trata reservas
    await expect(retireResource(db, rh.actor, desk.id, { reason: "x" })).rejects.toThrow(/atribuições/);
    const nb = await book(p, spare.id, d(4));
    await expect(retireResource(db, rh.actor, spare.id, { reason: "quebrou" })).rejects.toThrow(/sem decisão/);
    await retireResource(db, rh.actor, spare.id, { reason: "quebrou" }, [{ bookingId: nb.bookingId, action: "cancel", reason: "quebrou" }]);
    expect((await stateForPerson(db, p.id, d(4))).items.find((i) => i.resource.code === "X2")?.availability.code).toBe("retired");
  });

  it("DIR-028 e histórico: toda alteração administrativa gera auditoria com ator, motivo e antes e depois", async () => {
    const rh = await rhWithMfa();
    const holder = await seedEmployee({ orgCondition: "director" });
    const desk = await seedDesk();
    const id = await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "início", responsible: "RH" });
    const x = await createException(db, rh.actor, { assignmentId: id, kind: "release_to_shared", startsOn: d(1), endsOn: d(1), reason: "evento" });
    await revokeException(db, rh.actor, { exceptionId: x, reason: "cancelado" });
    await endAssignment(db, rh.actor, { assignmentId: id, validTo: d(5), reason: "fim" });
    const h = await history(db, desk.id);
    expect(h.events.map((e) => e.action)).toEqual(["exclusivity.assignment_ended", "exclusivity.exception_revoked", "exclusivity.exception_created", "exclusivity.assignment_created"]);
    expect(h.events.every((e) => e.actorName === rh.name && !!e.reason)).toBe(true);
    expect(h.assignments[0].exceptions[0].revokedAt).toBeTruthy();
    expect(new ConflictError("x").message).toBe("x");
  });
});

describe("correções da revisão da Etapa 2", () => {
  beforeEach(resetDb);

  it("R4: titular desativado com liberação ao compartilhado e reserva de terceiro: prévia lista a reserva; desativação cancela com comunicação, marca revisão e comunica o gestor (DIR-018, PAR-25)", async () => {
    const rh = await rhWithMfa();
    const manager = await seedEmployee();
    const holder = await seedEmployee({ orgCondition: "director" });
    const { employee } = await import("@/db/schema");
    await db.update(employee).set({ managerEmployeeId: manager.id }).where(eq(employee.id, holder.id));
    const common = await seedEmployee();
    const desk = await seedDesk("D1");
    const id = await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "x", responsible: "RH" });
    await createException(db, rh.actor, { assignmentId: id, kind: "release_to_shared", startsOn: d(1), endsOn: d(3), reason: "viagem" });
    const cb = await book(common, desk.id, d(2));
    const hb = await book(holder, desk.id, d(5));
    const { deactivationOfficePreview } = await import("@/modules/exclusivity/service");
    const preview = await deactivationOfficePreview(db, holder.id);
    expect(preview.ownBookings.map((b) => b.bookingId)).toEqual([hb.bookingId]);
    expect(preview.thirdPartyBookings.map((b) => b.bookingId)).toEqual([cb.bookingId]);
    expect(preview.assignments.map((a) => a.code)).toEqual(["D1"]);
    await deactivateEmployee(db, rh.actor, holder.id, { reason: "desligamento" });
    const rows = await db.select({ id: deskBooking.id, status: deskBooking.status }).from(deskBooking);
    expect(rows.every((r) => r.status === "cancelled")).toBe(true);
    expect((await needsReviewList(db)).map((r) => r.code)).toEqual(["D1"]);
    expect((await stateForPerson(db, common.id, d(2))).items[0].availability.code).toBe("exclusive");
    const mails = await db.select().from(outboxEvent);
    const texts = mails.map((m) => JSON.stringify(m.payload));
    expect(texts.some((t) => t.includes(common.email) && t.includes("cancelada"))).toBe(true);
    expect(texts.some((t) => t.includes(manager.email) && t.includes("desativad"))).toBe(true);
    const audits = (await db.select({ a: auditEvent.action, e: auditEvent.entityId }).from(auditEvent)).map((x) => x.a);
    expect(audits.filter((a) => a === "booking.cancelled_by_conflict")).toHaveLength(2);
    expect(await pendingConflicts(db, today)).toEqual([]);
  });

  it("realocação com retenção vencida no destino: a retenção é expirada antes de gravar (DIR-034); a prévia oferece mesas livres ignorando a reserva em conflito", async () => {
    const rh = await rhWithMfa();
    const holder = await seedEmployee({ orgCondition: "director" });
    const p = await seedEmployee();
    const other = await seedEmployee();
    const desk = await seedDesk("A1");
    const target = await seedDesk("A2");
    const b = await book(p, desk.id, d(2));
    await db.insert(deskBooking).values({ resourceId: target.id, employeeId: other.id, bookingDate: d(2), status: "held", origin: "waitlist_offer", actorEmployeeId: other.id, holdExpiresAt: new Date(Date.now() - 1000) });
    const { withReallocOptions } = await import("@/modules/office/decisions");
    const input = { resourceId: desk.id, mode: "individual" as const, holderEmployeeId: holder.id, validFrom: d(1), reason: "x", responsible: "RH" };
    const preview = await previewAssignment(db, rh.actor, input);
    const [view] = await withReallocOptions(db, preview.conflicts, [desk.id]);
    expect(view.options.map((o) => o.code)).toEqual(["A2"]);
    expect(preview.startAfter).toBe(d(3));
    await createAssignment(db, rh.actor, input, [{ bookingId: b.bookingId, action: "realloc", reason: "trava", targetResourceId: target.id }]);
    const rows = await db.select({ resourceId: deskBooking.resourceId, status: deskBooking.status, employeeId: deskBooking.employeeId }).from(deskBooking);
    expect(rows.find((r) => r.employeeId === other.id)?.status).toBe("expired");
    expect(rows.find((r) => r.employeeId === p.id && r.status === "confirmed")?.resourceId).toBe(target.id);
  });

  it("capacidade por classe sem dupla contagem (DIR-026-T1, T2, T4): igual ao desk_class do banco", async () => {
    const rh = await rhWithMfa();
    const holder = await seedEmployee({ orgCondition: "director" });
    const holder2 = await seedEmployee({ orgCondition: "director" });
    const p = await seedEmployee();
    const q = await seedEmployee();
    const exclusiveMaint = await seedDesk("K1");
    const overlapped = await seedDesk("K2");
    const exclusiveBooked = await seedDesk("K3");
    const sharedHeld = await seedDesk("K4");
    const exclusiveReleased = await seedDesk("K5");
    await seedDesk("K6");
    const { resourceStatusPeriod, accessException } = await import("@/db/schema");
    const a1 = await createAssignment(db, rh.actor, { resourceId: exclusiveMaint.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "x", responsible: "RH" });
    await db.insert(resourceStatusPeriod).values({ resourceId: exclusiveMaint.id, status: "maintenance", startsOn: d(1), endsOn: d(1), reason: "t" });
    await db.insert(resourceStatusPeriod).values({ resourceId: overlapped.id, status: "maintenance", startsOn: d(1), endsOn: d(2), reason: "t" });
    await db.insert(resourceStatusPeriod).values({ resourceId: overlapped.id, status: "admin_block", startsOn: today, endsOn: d(3), reason: "t" });
    await createAssignment(db, rh.actor, { resourceId: exclusiveBooked.id, mode: "individual", holderEmployeeId: holder2.id, validFrom: today, reason: "x", responsible: "RH" });
    await book(holder2, exclusiveBooked.id, d(1));
    await db.insert(deskBooking).values({ resourceId: sharedHeld.id, employeeId: q.id, bookingDate: d(1), status: "held", origin: "waitlist_offer", actorEmployeeId: q.id, holdExpiresAt: new Date(Date.now() + 60_000) });
    const a5 = await createAssignment(db, rh.actor, { resourceId: exclusiveReleased.id, mode: "individual", holderEmployeeId: holder.id, validFrom: d(2), reason: "x", responsible: "RH" });
    void a1;
    void a5;
    await db.insert(accessException).values({ assignmentId: a5, resourceId: exclusiveReleased.id, kind: "release_to_shared", startsOn: d(2), endsOn: d(2), reason: "t" });
    await book(p, exclusiveReleased.id, d(2));
    const { capacityOn } = await import("@/modules/availability/service");
    const c1 = await capacityOn(db, d(1));
    expect(c1.desks).toEqual({ total: 6, shared: 3, exclusive: 1, maintenance: 2, blocked: 0, retired: 0 });
    expect(c1).toMatchObject({ sharedConfirmed: 0, exclusiveConfirmed: 1, heldExcluded: 1 });
    const c2 = await capacityOn(db, d(2));
    // d+2: K1 volta a exclusiva (manutenção só em d+1); K2 segue em manutenção (vence o bloqueio sobreposto);
    // K5 liberada ao compartilhado conta como compartilhada, e a reserva do comum como confirmada no compartilhado
    expect(c2.desks).toEqual({ total: 6, shared: 3, exclusive: 2, maintenance: 1, blocked: 0, retired: 0 });
    expect(c2.sharedConfirmed).toBe(1);
    for (const date of [d(1), d(2)]) {
      const sqlClasses = await db.execute(sql`select code, desk_class(id, ${date}::date) as c from resource order by code`);
      const { loadResourcesOnDate } = await import("@/modules/availability/service");
      const { deskClass } = await import("@/modules/availability/rules");
      const rs = await loadResourcesOnDate(db, date, { types: ["desk"] });
      expect(rs.map((r) => [r.code, deskClass(r)])).toEqual((sqlClasses.rows as Array<{ code: string; c: string }>).map((r) => [r.code, r.c]));
    }
  });

  it("parâmetros configuráveis (DEC-19): updateSetting muda a abertura da semana no SQL e no serviço; só settings.manage altera", async () => {
    const adm = await privilegedActor({ roles: ["admin"] });
    const rh = await rhWithMfa();
    const { updateSetting } = await import("@/modules/workplace/service");
    await expect(updateSetting(db, rh.actor, "booking_open_weekday", "1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateSetting(db, adm.actor, "booking_open_time", "25:00")).rejects.toThrow(/inválida/);
    await expect(updateSetting(db, adm.actor, "chave_estranha", "1")).rejects.toThrow(/desconhecida/);
    // abertura na segunda às 08:00: a semana seguinte já está aberta na terça
    await updateSetting(db, adm.actor, "booking_open_weekday", "1");
    await updateSetting(db, adm.actor, "booking_open_time", "08:00");
    const { readSettings } = await import("@/modules/office/shared");
    const { bookingWindow } = await import("@/modules/availability/rules");
    const s = await readSettings(db);
    expect(s).toMatchObject({ bookingOpenWeekday: 1, bookingOpenTime: "08:00" });
    const now = new Date("2026-10-06T12:00:00Z"); // terça 09:00 local
    expect(bookingWindow("2026-10-14", now, s).open).toBe(true);
    const r = await db.execute(sql`select booking_window_open('2026-10-14'::date, '2026-10-06T12:00:00Z'::timestamptz) as ok`);
    expect((r.rows[0] as { ok: boolean }).ok).toBe(true);
    const audits = (await db.select({ a: auditEvent.action }).from(auditEvent)).map((x) => x.a);
    expect(audits.filter((a) => a === "settings.updated")).toHaveLength(2);
  });

  it("identidade da atribuição e da liberação não muda depois de criada; o papel da aplicação não apaga registros do escritório (DEC-14)", async () => {
    const rh = await rhWithMfa();
    const holder = await seedEmployee({ orgCondition: "director" });
    const other = await seedEmployee({ orgCondition: "director" });
    const desk = await seedDesk();
    const desk2 = await seedDesk();
    const id = await createAssignment(db, rh.actor, { resourceId: desk.id, mode: "individual", holderEmployeeId: holder.id, validFrom: today, reason: "x", responsible: "RH" });
    const rule = (p: Promise<unknown>) => p.then(() => "ok").catch((e) => String((e as { cause?: { message?: string; code?: string } }).cause?.message ?? (e as Error).message));
    expect(await rule(db.update(exclusiveAssignment).set({ holderEmployeeId: other.id }).where(eq(exclusiveAssignment.id, id)))).toBe("assignment_identity_immutable");
    expect(await rule(db.update(exclusiveAssignment).set({ resourceId: desk2.id }).where(eq(exclusiveAssignment.id, id)))).toBe("assignment_identity_immutable");
    expect(await rule(db.delete(exclusiveAssignment).where(eq(exclusiveAssignment.id, id)))).toMatch(/permission denied/);
    expect(await rule(db.delete(deskBooking))).toMatch(/permission denied/);
    const x = await createException(db, rh.actor, { assignmentId: id, kind: "release_to_shared", startsOn: d(1), endsOn: d(1), reason: "t" });
    const { accessException } = await import("@/db/schema");
    expect(await rule(db.update(accessException).set({ endsOn: d(5) }).where(eq(accessException.id, x)))).toBe("exception_identity_immutable");
    await revokeException(db, rh.actor, { exceptionId: x, reason: "ok" });
  });
});
