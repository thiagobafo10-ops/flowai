"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { recordAction, setBlocked, type CartAction } from "@/lib/carts/actions";
import type { CartDetail } from "@/lib/carts/queries";
import { PermissionDialog } from "./permission-dialog";
import { useRun } from "./use-run";

type Ask = { intent: string; title: string; description: string; confirm: string; note?: string; done: string;
  submit: (key: string, note: string) => ReturnType<typeof recordAction> };

export function CartActions({ cart }: { cart: CartDetail }) {
  const { pending, error, setError, run } = useRun();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [note, setNote] = useState("");
  const act = (action: CartAction, done: string) =>
    run(action, (key) => recordAction(cart.id, action, key), () => toast.success(done));
  const open = (a: Ask) => { setError(null); setNote(""); setAsk(a); };
  const blocked = !!cart.contact.blockedAt;
  const closed = cart.recoveryStage === "closed";

  return (
    <section aria-labelledby="cart-actions-title" className="space-y-3">
      <h3 id="cart-actions-title" className="font-medium">Atendimento</h3>
      <div className="flex flex-wrap gap-2">
        {cart.pausedAt
          ? <Button variant="outline" disabled={pending} onClick={() => act("resumed", "Atendimento retomado.")}>Retomar</Button>
          : <Button variant="outline" disabled={pending} onClick={() => open({ intent: "paused", title: "Pausar atendimento", description: "O carrinho deixa de ser elegível para contato até ser retomado.", confirm: "Pausar", note: "Motivo da pausa", done: "Atendimento pausado.", submit: (k, n) => recordAction(cart.id, "paused", k, n) })}>Pausar</Button>}
        {closed
          ? <Button variant="outline" disabled={pending} onClick={() => act("reopened", "Atendimento reaberto.")}>Reabrir</Button>
          : <Button variant="outline" disabled={pending} onClick={() => act("closed", "Atendimento encerrado.")}>Encerrar</Button>}
        <Button variant="outline" disabled={pending} onClick={() => act("reply_received", "Resposta registrada.")}>Registrar resposta</Button>
        <Button variant="outline" disabled={pending} onClick={() => open({ intent: "emails_stopped", title: "Interromper também os e-mails", description: "O atendimento pelo WhatsApp e os e-mails automáticos são separados. Isto cancela só os e-mails agendados deste carrinho; o atendimento continua como está.", confirm: "Interromper e-mails", done: "E-mails interrompidos.", submit: (k) => recordAction(cart.id, "emails_stopped", k) })}>Interromper também os e-mails</Button>
        <PermissionDialog contactId={cart.contact.id} />
        {blocked
          ? <Button variant="outline" disabled={pending} onClick={() => run("unblock", () => setBlocked(cart.contact.id, false, ""), () => toast.success("Cliente desbloqueado."))}>Desbloquear cliente</Button>
          : <Button variant="destructive" disabled={pending} onClick={() => open({ intent: "block", title: "Bloquear cliente", description: "O cliente não poderá ser contatado e os e-mails agendados dele serão cancelados.", confirm: "Bloquear", note: "Motivo do bloqueio", done: "Cliente bloqueado.", submit: (_k, n) => setBlocked(cart.contact.id, true, n) })}>Bloquear cliente</Button>}
      </div>
      {!ask && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Dialog open={ask !== null} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent>
          {ask && (
            <form className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              run(ask.intent, (key) => ask.submit(key, note), () => { toast.success(ask.done); setAsk(null); });
            }}>
              <DialogHeader>
                <DialogTitle>{ask.title}</DialogTitle>
                <DialogDescription>{ask.description}</DialogDescription>
              </DialogHeader>
              {ask.note && (
                <div className="space-y-1">
                  <Label htmlFor="cart-note">{ask.note}</Label>
                  <textarea id="cart-note" rows={3} maxLength={240} value={note} onChange={(e) => setNote(e.target.value)}
                    className="w-full rounded-lg border border-input bg-transparent p-2 text-sm" />
                </div>
              )}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="submit" disabled={pending}>{pending ? "Salvando…" : ask.confirm}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
