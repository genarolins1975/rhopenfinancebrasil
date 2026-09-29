import { db } from "@/db/client";
import { cronAuthorized } from "@/modules/operations/cron-auth";
import { drainOutbox, runOfficeSweep } from "@/modules/operations/cycle";
import { env } from "@/modules/shared/env";
import { logger } from "@/modules/shared/logger";

/*
 * Ciclo de operação chamado pela tarefa agendada da hospedagem (vercel.json, a cada minuto), onde não há processo de
 * fundo contínuo (DEC-45). Fechada por segredo; a resposta traz só contagens, nunca dados de pessoas.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), env().CRON_SECRET)) {
    return new Response(null, { status: 401 });
  }
  const sweep = await runOfficeSweep(db).catch((e) => {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "erro na varredura do escritório (rota agendada)");
    return null;
  });
  const delivered = await drainOutbox(db, 5);
  return Response.json({ ok: true, sweep, delivered }, { headers: { "Cache-Control": "no-store" } });
}
