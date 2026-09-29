import { db } from "@/db/client";
import { handleCron } from "@/modules/operations/cron-route";
import { env } from "@/modules/shared/env";

/*
 * Ciclo de operação chamado pela tarefa agendada da hospedagem (vercel.json), onde não há processo de fundo contínuo
 * (DEC-45). Fechada por segredo; a resposta traz só contagens, nunca dados de pessoas.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleCron(db, request, env().CRON_SECRET);
}
