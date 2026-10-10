import type { ContactEvent } from "@/lib/crm/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/crm/format";

function label(e: ContactEvent): string {
  switch (e.type) {
    case "contact_created":
      return "Contato criado";
    case "deal_created":
      return "Deal criado";
    case "deal_stage_changed":
      return `Mudou de etapa: ${e.fromStage ?? "etapa removida"} → ${e.toStage ?? "etapa removida"}`;
    case "deal_won":
      return "Deal ganho";
    case "deal_lost":
      return "Deal perdido";
    default:
      return e.type;
  }
}

export function HistoryCard({ events, timezone }: { events: ContactEvent[]; timezone: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {events.length === 0 ? (
          <p className="text-muted-foreground">Nenhum evento ainda.</p>
        ) : (
          <ol className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2">
                <span>{label(e)}</span>
                <time dateTime={e.createdAt} className="text-muted-foreground">
                  {formatDateTime(e.createdAt, timezone)}
                </time>
              </li>
            ))}
          </ol>
        )}
        <section className="border-t pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">Conversas</h3>
          <p className="mt-1 text-muted-foreground">Nenhuma conversa ainda.</p>
        </section>
      </CardContent>
    </Card>
  );
}
