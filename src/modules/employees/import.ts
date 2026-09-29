import { eq, inArray } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { employee, employeeSensitive, importBatch } from "@/db/schema";
import { loadAccess } from "@/modules/access/can";
import { recordAudit } from "@/modules/audit/audit";
import { createInvitation } from "@/modules/identity/invitations";
import { decryptGcm, encryptGcm, keyFromBase64 } from "@/modules/shared/crypto";
import { env } from "@/modules/shared/env";
import { ConflictError, ForbiddenError, ValidationError } from "@/modules/shared/errors";
import { newId } from "@/modules/shared/ids";
import { cpfHmac, maskCpf, normalizeCpf, protectCpf } from "./cpf";
import { ensureArea, type Actor } from "./service";
import { employeeOrgAssignment, employmentPeriod } from "@/db/schema";

export const IMPORT_COLUMNS = ["nome", "email", "cpf", "area", "cargo", "gestor_email", "condicao", "data_admissao"] as const;
const PRIVILEGED_COLUMNS = ["perfil", "perfis", "permissao", "permissoes", "permissão", "permissões", "role", "roles", "admin"];
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_PREVIEW_TTL_MS = 30 * 60 * 1000;

export function csvTemplate(): string {
  return [
    IMPORT_COLUMNS.join(";"),
    "Maria Exemplo;maria.exemplo@dominio-corporativo.exemplo;00000000000;Tecnologia;Analista;gestor@dominio-corporativo.exemplo;colaborador;01/02/2026",
  ].join("\n");
}

/** Leitor CSV mínimo: detecta ; , ou tabulação pelo cabeçalho, trata aspas e BOM. */
export function parseCsv(text: string): { header: string[]; rows: string[][]; delimiter: string } {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", ",", "\t"].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  return { header, rows, delimiter };
}

export type ImportRowValues = {
  nome: string;
  email: string;
  cpf: string;
  area: string;
  cargo: string;
  gestorEmail: string;
  condicao: "standard" | "director";
  dataAdmissao: string;
};

export type ImportRowResult = {
  line: number;
  status: "ok" | "erro" | "duplicado";
  messages: string[];
  display: { nome: string; email: string; cpf: string; area: string; cargo: string; gestorEmail: string; condicao: string; dataAdmissao: string };
};

function parseDate(value: string): string | null {
  const v = value.trim();
  let m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return v;
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

type Parsed = { line: number; values?: ImportRowValues; errors: string[]; raw: Record<string, string> };

function parseRows(header: string[], rows: string[][]): { parsed: Parsed[]; warnings: string[] } {
  const warnings: string[] = [];
  const missing = IMPORT_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new ValidationError(`Colunas obrigatórias ausentes: ${missing.join(", ")}. Use o modelo.`);
  const ignored = header.filter((h) => PRIVILEGED_COLUMNS.includes(h));
  if (ignored.length) warnings.push(`Colunas de perfil ou permissão são ignoradas na importação: ${ignored.join(", ")}. Perfis são concedidos em Acessos.`);
  const idx = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof IMPORT_COLUMNS)[number], number>;
  const parsed: Parsed[] = rows.map((r, i) => {
    const get = (c: (typeof IMPORT_COLUMNS)[number]) => (r[idx[c]] ?? "").trim();
    const raw = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, get(c)]));
    const errors: string[] = [];
    const nome = get("nome");
    if (nome.length < 3) errors.push("nome ausente ou curto");
    const email = get("email").toLowerCase();
    if (!EMAIL_RE.test(email)) errors.push("email inválido");
    const cpf = normalizeCpf(get("cpf"));
    if (!cpf) errors.push("CPF inválido");
    const dataAdmissao = parseDate(get("data_admissao"));
    if (!dataAdmissao) errors.push("data de admissão inválida (use dd/mm/aaaa)");
    const condRaw = get("condicao").toLowerCase();
    const condicao: "standard" | "director" = condRaw === "diretor" || condRaw === "director" ? "director" : "standard";
    if (condRaw && !["diretor", "director", "colaborador", "standard", ""].includes(condRaw)) errors.push("condição deve ser colaborador ou diretor");
    const gestorEmail = get("gestor_email").toLowerCase();
    if (gestorEmail && !EMAIL_RE.test(gestorEmail)) errors.push("email do gestor inválido");
    const values: ImportRowValues | undefined =
      errors.length === 0 && cpf && dataAdmissao
        ? { nome, email, cpf, area: get("area"), cargo: get("cargo"), gestorEmail, condicao, dataAdmissao }
        : undefined;
    return { line: i + 2, values, errors, raw };
  });
  return { parsed, warnings };
}

function display(p: Parsed): ImportRowResult["display"] {
  const v = p.values;
  const cpfNorm = normalizeCpf(p.raw.cpf);
  return {
    nome: p.raw.nome,
    email: p.raw.email ? maskEmail(p.raw.email.toLowerCase()) : "",
    cpf: cpfNorm ? maskCpf(cpfNorm.slice(9)) : "•••.•••.•••-••",
    area: p.raw.area,
    cargo: p.raw.cargo,
    gestorEmail: p.raw.gestor_email ? maskEmail(p.raw.gestor_email.toLowerCase()) : "",
    condicao: v?.condicao === "director" ? "diretor" : "colaborador",
    dataAdmissao: p.raw.data_admissao,
  };
}

/**
 * Valida cada linha e detecta duplicidade no arquivo e no cadastro sem funcionar como oráculo:
 * o conflito diz apenas "conflita com cadastro existente".
 */
async function validateAgainstDb(db: DbOrTx, parsed: Parsed[]): Promise<ImportRowResult[]> {
  const valid = parsed.filter((p) => p.values);
  const hmacs = valid.map((p) => cpfHmac(p.values!.cpf));
  const emails = valid.map((p) => p.values!.email);
  const existingHmac = hmacs.length
    ? new Set((await db.select({ h: employeeSensitive.cpfHmac }).from(employeeSensitive).where(inArray(employeeSensitive.cpfHmac, hmacs))).map((r) => r.h.toString("hex")))
    : new Set<string>();
  const existingEmail = emails.length
    ? new Set((await db.select({ e: employee.corporateEmail }).from(employee).where(inArray(employee.corporateEmail, emails))).map((r) => r.e.toLowerCase()))
    : new Set<string>();
  const seenCpf = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  return parsed.map((p) => {
    const messages = [...p.errors];
    let status: ImportRowResult["status"] = p.errors.length ? "erro" : "ok";
    if (p.values) {
      const h = cpfHmac(p.values.cpf).toString("hex");
      if (existingHmac.has(h) || existingEmail.has(p.values.email)) {
        status = "duplicado";
        messages.push("conflita com cadastro existente");
      }
      const prevCpf = seenCpf.get(h);
      const prevEmail = seenEmail.get(p.values.email);
      if (prevCpf !== undefined || prevEmail !== undefined) {
        status = "duplicado";
        messages.push(`repetida no arquivo (linha ${prevCpf ?? prevEmail})`);
      }
      seenCpf.set(h, p.line);
      seenEmail.set(p.values.email, p.line);
    }
    return { line: p.line, status, messages, display: display(p) };
  });
}

export type ImportPreview = {
  batchId: string;
  expiresAt: Date;
  summary: { total: number; ok: number; erro: number; duplicado: number };
  rows: ImportRowResult[];
  warnings: string[];
};

function importKey(): Buffer {
  return keyFromBase64(env().IMPORT_ENC_KEY_V1);
}

/** Prévia: valida, cifra as linhas válidas por 30 minutos e devolve o resultado por linha com dados mascarados. */
export async function previewImport(db: Db, actor: Actor, csvText: string): Promise<ImportPreview> {
  const access = await loadAccess(db, actor.employeeId);
  if (!access.permissions.has("employee.import")) throw new ForbiddenError();
  if (Buffer.byteLength(csvText, "utf8") > IMPORT_MAX_BYTES) throw new ValidationError("Arquivo acima de 2 MB.");
  const { header, rows } = parseCsv(csvText);
  if (rows.length === 0) throw new ValidationError("Arquivo sem linhas de dados.");
  if (rows.length > IMPORT_MAX_ROWS) throw new ValidationError(`Arquivo com mais de ${IMPORT_MAX_ROWS} linhas. Divida em partes.`);
  const { parsed, warnings } = parseRows(header, rows);
  const results = await validateAgainstDb(db, parsed);
  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    erro: results.filter((r) => r.status === "erro").length,
    duplicado: results.filter((r) => r.status === "duplicado").length,
  };
  const batchId = newId();
  const okValues = parsed.filter((p, i) => p.values && results[i].status === "ok").map((p) => ({ line: p.line, ...p.values! }));
  const ciphertext = encryptGcm(importKey(), 1, Buffer.from(JSON.stringify(okValues), "utf8"), Buffer.from(batchId, "utf8"));
  const expiresAt = new Date(Date.now() + IMPORT_PREVIEW_TTL_MS);
  await db.insert(importBatch).values({ id: batchId, createdBy: actor.employeeId, rowsCiphertext: ciphertext, rowCount: okValues.length, summary, expiresAt });
  await recordAudit(db, {
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    action: "employee.import.previewed",
    entityType: "import_batch",
    entityId: batchId,
    after: { ...summary, duplicateLines: results.filter((r) => r.status === "duplicado").map((r) => r.line) },
    requestId: actor.requestId,
  });
  return { batchId, expiresAt, summary, rows: results, warnings };
}

/** Confirmação: decifra, revalida tudo e aplica em uma única transação. Qualquer conflito novo cancela o lote inteiro. */
export async function applyImport(db: Db, actor: Actor, batchId: string): Promise<{ created: number }> {
  const access = await loadAccess(db, actor.employeeId);
  if (!access.permissions.has("employee.import")) throw new ForbiddenError();
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(importBatch).where(eq(importBatch.id, batchId)).for("update");
    if (!batch || batch.createdBy !== actor.employeeId) throw new ValidationError("Prévia não encontrada.");
    if (batch.status !== "previewed") throw new ValidationError("Esta prévia já foi usada.");
    if (batch.expiresAt.getTime() <= Date.now()) throw new ValidationError("Prévia expirada. Envie o arquivo de novo.");
    const rows = JSON.parse(decryptGcm({ 1: importKey() }, batch.rowsCiphertext, Buffer.from(batchId, "utf8")).toString("utf8")) as (ImportRowValues & { line: number })[];
    const parsed: Parsed[] = rows.map((r) => ({ line: r.line, values: r, errors: [], raw: {} }));
    const revalidated = await validateAgainstDb(tx, parsed);
    const conflicts = revalidated.filter((r) => r.status !== "ok");
    if (conflicts.length) {
      throw new ConflictError(`Houve mudanças no cadastro desde a prévia (${conflicts.length} linha(s) em conflito). Gere nova prévia.`, {
        lines: conflicts.map((c) => c.line),
      });
    }
    const emailToId = new Map<string, string>();
    for (const r of rows) {
      const areaId = r.area ? await ensureArea(tx, r.area) : null;
      const [emp] = await tx
        .insert(employee)
        .values({ fullName: r.nome, corporateEmail: r.email, areaId, jobTitle: r.cargo || null, orgCondition: r.condicao, status: "invited" })
        .returning({ id: employee.id });
      emailToId.set(r.email, emp.id);
      await tx.insert(employeeSensitive).values({ employeeId: emp.id, ...protectCpf(r.cpf, emp.id) });
      await tx.insert(employmentPeriod).values({ employeeId: emp.id, hireDate: r.dataAdmissao });
      await tx.insert(employeeOrgAssignment).values({ employeeId: emp.id, areaId, jobTitle: r.cargo || null, orgCondition: r.condicao, validFrom: r.dataAdmissao, createdBy: actor.employeeId, reason: "importação" });
    }
    // Gestores: resolvidos após criar todos, por email, no arquivo ou no cadastro.
    for (const r of rows) {
      if (!r.gestorEmail) continue;
      let managerId = emailToId.get(r.gestorEmail);
      if (!managerId) {
        const [m] = await tx.select({ id: employee.id }).from(employee).where(eq(employee.corporateEmail, r.gestorEmail));
        managerId = m?.id;
      }
      const empId = emailToId.get(r.email)!;
      if (managerId && managerId !== empId) {
        await tx.update(employee).set({ managerEmployeeId: managerId }).where(eq(employee.id, empId));
        await tx.update(employeeOrgAssignment).set({ managerEmployeeId: managerId }).where(eq(employeeOrgAssignment.employeeId, empId));
      }
    }
    for (const id of emailToId.values()) await createInvitation(tx, actor, id);
    await tx.update(importBatch).set({ status: "applied", appliedAt: new Date(), rowsCiphertext: Buffer.alloc(0) }).where(eq(importBatch.id, batchId));
    await recordAudit(tx, {
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      action: "employee.import.applied",
      entityType: "import_batch",
      entityId: batchId,
      after: { created: rows.length, employeeIds: [...emailToId.values()] },
      requestId: actor.requestId,
    });
    return { created: rows.length };
  });
}

export async function discardImport(db: Db, actor: Actor, batchId: string): Promise<void> {
  await db
    .update(importBatch)
    .set({ status: "discarded", rowsCiphertext: Buffer.alloc(0) })
    .where(eq(importBatch.id, batchId));
  await recordAudit(db, { actorUserId: actor.userId, actorEmployeeId: actor.employeeId, action: "employee.import.discarded", entityType: "import_batch", entityId: batchId, requestId: actor.requestId });
}
