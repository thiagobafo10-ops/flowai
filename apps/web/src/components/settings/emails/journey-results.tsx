import { cancelReasonLabel, JOURNEY_LABELS } from "@/lib/emails/schemas";
import type { StepResult } from "@/lib/emails/queries";

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const HEADERS = ["Jornada", "E-mail", "Agendados", "Enviados", "Entregues", "Abertos", "Cliques", "Cancelados", "Pedidos recuperados", "Valor recuperado"];

export function JourneyResults({ results }: { results: StepResult[] }) {
  if (!results.length) return <p className="text-sm text-muted-foreground">Sem resultados nos últimos 30 dias.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Resultados por e-mail nos últimos 30 dias</caption>
        <thead className="text-left text-muted-foreground">
          <tr>{HEADERS.map((h) => <th key={h} className="py-2 pr-4 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const cancelled = Object.entries(r.cancelled);
            return (
              <tr key={r.stepId} className="border-t">
                <td className="py-2 pr-4 whitespace-nowrap">{JOURNEY_LABELS[r.kind]}</td>
                <td className="py-2 pr-4">{r.position}</td>
                <td className="py-2 pr-4">{r.scheduled}</td>
                <td className="py-2 pr-4">{r.sent}</td>
                <td className="py-2 pr-4">{r.delivered}</td>
                <td className="py-2 pr-4">{r.opened}</td>
                <td className="py-2 pr-4">{r.clicked}</td>
                <td className="py-2 pr-4">
                  {cancelled.reduce((sum, [, n]) => sum + n, 0)}
                  {cancelled.length > 0 && <span className="block text-xs text-muted-foreground">{cancelled.map(([k, n]) => `${cancelReasonLabel(k)}: ${n}`).join(" · ")}</span>}
                </td>
                <td className="py-2 pr-4">{r.recoveredOrders}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{brl(Number(r.recoveredTotal))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
