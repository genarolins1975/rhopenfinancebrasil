import { csvTemplate } from "@/modules/employees/import";
import { requirePermission } from "@/modules/identity/session";

export async function GET() {
  await requirePermission("employee.import");
  return new Response(`﻿${csvTemplate()}\n`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="modelo-importacao.csv"' },
  });
}
