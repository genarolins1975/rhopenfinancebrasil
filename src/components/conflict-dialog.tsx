import { Input, Select, Table, Textarea, td, th } from "@/components/ui";
import type { ConflictView } from "@/modules/office/decisions";

/*
 * Diálogo de conflito (DIR-016): reservas incompatíveis com decisão por linha. Sem decisão em toda linha,
 * o servidor recusa a confirmação. Funciona sem JavaScript: campos nativos, um por reserva.
 */
export function ConflictTable({ conflicts, allowRealloc = true }: { conflicts: ConflictView[]; allowRealloc?: boolean }) {
  if (conflicts.length === 0) {
    return <p className="text-sm text-success">Nenhuma reserva incompatível.</p>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm font-medium">
        {conflicts.length} reserva(s) incompatível(is). Decida cada uma: cancelar com motivo e mensagem, {allowRealloc ? "ou realocar para mesa disponível para a pessoa na data. " : "sem realocação neste tipo de operação. "}
        Nada é cancelado em silêncio.
      </p>
      <Table caption="Reservas incompatíveis">
        <thead>
          <tr>
            <th className={th}>Data</th>
            <th className={th}>Recurso</th>
            <th className={th}>Pessoa</th>
            <th className={th}>Origem</th>
            <th className={th}>Por quê</th>
            <th className={th}>Decisão</th>
          </tr>
        </thead>
        <tbody>
          {conflicts.map((c) => (
            <tr key={c.bookingId}>
              <td className={td}>
                {c.date.split("-").reverse().join("/")}
                {c.slot ? <span className="block text-xs text-text-muted">{c.slot}</span> : null}
              </td>
              <td className={td}>
                {c.resourceCode}
                {c.kind === "space" ? <span className="block text-xs text-text-muted">sala ou cabine</span> : null}
              </td>
              <td className={td}>{c.employeeName}</td>
              <td className={td}>{c.origin}</td>
              <td className={td}>{c.why}</td>
              <td className={td}>
                <div className="flex min-w-[220px] flex-col gap-1">
                  <label className="text-xs font-medium" htmlFor={`decision-${c.bookingId}`}>
                    Ação
                  </label>
                  <Select id={`decision-${c.bookingId}`} name={`decision:${c.bookingId}`} defaultValue="" required>
                    <option value="">Escolha</option>
                    <option value="cancel">Cancelar com comunicação</option>
                    {allowRealloc && c.kind !== "space" && c.options.length ? <option value="realloc">Realocar</option> : null}
                  </Select>
                  {allowRealloc && c.kind !== "space" && c.options.length ? (
                    <>
                      <label className="text-xs font-medium" htmlFor={`target-${c.bookingId}`}>
                        Mesa de destino
                      </label>
                      <Select id={`target-${c.bookingId}`} name={`target:${c.bookingId}`} defaultValue="">
                        <option value="">Só para realocar</option>
                        {c.options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.code}
                          </option>
                        ))}
                      </Select>
                    </>
                  ) : null}
                  <label className="text-xs font-medium" htmlFor={`reason-${c.bookingId}`}>
                    Motivo
                  </label>
                  <Input id={`reason-${c.bookingId}`} name={`reason:${c.bookingId}`} required minLength={3} />
                  <label className="text-xs font-medium" htmlFor={`message-${c.bookingId}`}>
                    Mensagem à pessoa
                  </label>
                  <Textarea id={`message-${c.bookingId}`} name={`message:${c.bookingId}`} rows={2} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
