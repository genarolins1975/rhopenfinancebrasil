import type { Db } from "@/db/client";
import { cronAuthorized } from "@/modules/operations/cron-auth";
import { drainOutbox, runOfficeSweep } from "@/modules/operations/cycle";
import { logger } from "@/modules/shared/logger";

/** Atendimento da rota agendada (DEC-45): 401 sem o segredo; com ele, um ciclo de operação e só contagens na resposta. */
export async function handleCron(db: Db, request: Request, secret: string | undefined): Promise<Response> {
  if (!cronAuthorized(request.headers.get("authorization"), secret)) return new Response(null, { status: 401 });
  const sweep = await runOfficeSweep(db).catch((e) => {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "erro na varredura do escritório (rota agendada)");
    return null;
  });
  const delivered = await drainOutbox(db, 5);
  return Response.json({ ok: true, sweep, delivered }, { headers: { "Cache-Control": "no-store" } });
}
