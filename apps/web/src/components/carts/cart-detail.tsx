import type { ReactNode } from "react";
import type { CartDetail } from "@/lib/carts/queries";
import { COMMERCIAL_LABELS, PERMISSION_LABELS, STAGE_LABELS, label } from "@/lib/carts/labels";
import { formatDateTime } from "@/lib/crm/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "./format";
import { CartHistory } from "./cart-history";
import { CartActions } from "./cart-actions";
import { WhatsappPanel } from "./whatsapp-panel";

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}

export function CartDetailView({ cart, timeZone, canAct }: { cart: CartDetail; timeZone: string; canAct: boolean }) {
  const c = cart.contact;
  const blocks = [
    cart.blockReason,
    c.blockedAt ? `Cliente bloqueado para contato${c.blockedReason ? `: ${c.blockedReason}` : ""}` : null,
    cart.pausedAt ? `Atendimento pausado${cart.pauseReason ? `: ${cart.pauseReason}` : ""}` : null,
    !cart.recoveryUrlAllowed ? "Link de retomada indisponível" : null,
  ].filter((b, i, all): b is string => !!b && all.indexOf(b) === i);
  const items = cart.items ?? [];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>{c.name || "Sem nome"}</CardTitle></CardHeader>
        <CardContent className="text-sm">
          <dl className="space-y-1">
            <Row k="Valor" v={money(cart.total)} />
            <Row k="Frete" v={cart.shipping === 0 ? "Grátis" : money(cart.shipping)} />
            <Row k="Abandono" v={cart.abandonedAt ? formatDateTime(cart.abandonedAt, timeZone) : "Data original não informada"} />
            <Row k="Recebido em" v={formatDateTime(cart.receivedAt, timeZone)} />
            <Row k="Estado comercial" v={label(COMMERCIAL_LABELS, cart.commercialStatus)} />
            <Row k="Estágio" v={label(STAGE_LABELS, cart.recoveryStage)} />
            <Row k="Último contato" v={cart.lastContactAt ? formatDateTime(cart.lastContactAt, timeZone) : "—"} />
            <Row k="E-mail" v={c.email ?? "—"} />
            <Row k="Telefone" v={c.phone ? `${c.phone}${c.phoneValid ? "" : " (inválido)"}` : "—"} />
          </dl>
          {cart.unreconciledPayment && (
            <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Pagamento não reconciliado: há um pedido pago deste cliente depois do abandono.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Itens</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {items.length === 0 ? <p className="text-muted-foreground">Sem itens.</p> : (
            <ul className="divide-y">
              {items.map((it, i) => (
                <li key={i} className="flex justify-between gap-2 py-1.5">
                  <span>{it.quantity ?? 1}x {it.name ?? "Item sem nome"}</span>
                  <span className="text-muted-foreground">{typeof it.price === "number" ? money(it.price) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Autorização de contato (WhatsApp)</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {cart.permission ? (
            <dl className="space-y-1">
              <Row k="Situação" v={label(PERMISSION_LABELS, cart.permission.status)} />
              <Row k="Origem" v={cart.permission.source} />
              <Row k="Evidência em" v={formatDateTime(cart.permission.evidenceAt, timeZone)} />
              <Row k="Registrada em" v={formatDateTime(cart.permission.recordedAt, timeZone)} />
            </dl>
          ) : <p className="text-muted-foreground">Sem autorização de contato registrada.</p>}
          <div>
            <p className="font-medium">Bloqueios</p>
            {blocks.length === 0 ? <p className="text-muted-foreground">Nenhum. Elegível para contato pelo WhatsApp.</p> : (
              <ul className="list-disc pl-5">{blocks.map((b) => <li key={b}>{b}</li>)}</ul>
            )}
          </div>
        </CardContent>
      </Card>
      {canAct && (
        <Card>
          <CardContent className="space-y-6 pt-4">
            <WhatsappPanel cartId={cart.id} blockReason={cart.blockReason} suggested={cart.actions.some((a) => a.action === "marked_sent") ? 2 : 1} />
            <CartActions cart={cart} />
          </CardContent>
        </Card>
      )}
      <CartHistory cart={cart} timeZone={timeZone} />
    </div>
  );
}
