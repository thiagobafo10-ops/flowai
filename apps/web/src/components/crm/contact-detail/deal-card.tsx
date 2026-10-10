import Link from "next/link";
import { formatBRL } from "@flowai/core";
import type { ContactDeal } from "@/lib/crm/queries";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/crm/format";

type Props = { contactId: string; deals: ContactDeal[]; canCreate: boolean; timezone: string };

export function DealCard({ contactId, deals, canCreate, timezone }: Props) {
  const open = deals.find((d) => d.status === "open");
  const closed = deals.filter((d) => d.status !== "open");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {open ? (
          <div className="space-y-1">
            <p className="font-medium">{open.title}</p>
            <p className="text-muted-foreground">
              Etapa: {open.stageName} · Valor: {formatBRL(open.value)} · Responsável: {open.ownerName ?? "—"}
            </p>
            <Link href="/pipeline" className="text-sm font-medium underline underline-offset-2">
              Ver no pipeline
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-muted-foreground">Nenhum deal aberto.</p>
            {canCreate && (
              <Link
                href={`/pipeline?novo=${contactId}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Criar deal
              </Link>
            )}
          </div>
        )}
        {closed.length > 0 && (
          <div className="space-y-1 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Deals encerrados</p>
            <ul className="space-y-1">
              {closed.map((d) => (
                <li key={d.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {d.title} · {formatBRL(d.value)}
                  </span>
                  <span className="text-muted-foreground">
                    {d.status === "won" ? "Ganho" : "Perdido"} em {formatDateTime(d.updatedAt, timezone)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
