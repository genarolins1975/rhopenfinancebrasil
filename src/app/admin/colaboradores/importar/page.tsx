import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/modules/identity/session";
import { ImportWizard } from "./import-wizard";

export default async function ImportarPage() {
  await requirePermission("employee.import");
  return (
    <>
      <PageHeader title="Importar colaboradores" lead="Modelo, prévia com validação por linha e confirmação. O arquivo é processado em memória; a prévia fica cifrada por 30 minutos." />
      <Card className="max-w-5xl">
        <ImportWizard />
      </Card>
    </>
  );
}
