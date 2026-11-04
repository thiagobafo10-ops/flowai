import type { CartDetail } from "@/lib/carts/queries";
import { ACTION_LABELS, EMAIL_STATE_LABELS, label } from "@/lib/carts/labels";
import { cancelReasonLabel } from "@/lib/emails/schemas";
import { formatDateTime } from "@/lib/crm/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function emailMoments(e: CartDetail["emails"][number], tz: string) {
  const at = (l: string, v: string | null) => (v ? `${l} ${formatDateTime(v, tz)}` : null);
  return [at("enviado", e.sentAt), at("entregue", e.deliveredAt), at("aberto", e.openedAt), at("clicado", e.clickedAt), at("devolvido", e.bouncedAt)]
    .filter(Boolean).join(" · ") || `agendado para ${formatDateTime(e.sendAt, tz)}`;
}

export function CartHistory({ cart, timeZone }: { cart: CartDetail; timeZone: string }) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle>E-mails automáticos</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {cart.emails.length === 0 ? (
            <p className="text-muted-foreground">Nenhum e-mail para este carrinho.</p>
          ) : (
            <ol className="space-y-3">
              {cart.emails.map((e) => (
                <li key={e.id}>
                  <p className="font-medium">{e.stepPosition}º e-mail · {e.subject}</p>
                  <p className="text-muted-foreground">
                    {label(EMAIL_STATE_LABELS, e.state)}
                    {e.state === "cancelled" && e.cancelReason ? ` (${cancelReasonLabel(e.cancelReason)})` : ""} · {emailMoments(e, timeZone)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Atendimento manual</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {cart.actions.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma ação registrada ainda.</p>
          ) : (
            <ol className="space-y-3">
              {cart.actions.map((a) => (
                <li key={a.id}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{label(ACTION_LABELS, a.action)}</span>
                    <time dateTime={a.createdAt} className="text-muted-foreground">{formatDateTime(a.createdAt, timeZone)}</time>
                  </div>
                  <p className="text-muted-foreground">{a.actorName ?? "Operador removido"}{a.note ? ` — ${a.note}` : ""}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
