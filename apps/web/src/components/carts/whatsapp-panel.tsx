"use client";
import { useState } from "react";
import { toast } from "sonner";
import { whatsappUrl } from "@flowai/core";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { confirmSent, prepareWhatsapp } from "@/lib/carts/actions";
import { useRun } from "./use-run";

const textarea = "w-full rounded-lg border border-input bg-transparent p-2 text-sm disabled:opacity-50";

export function WhatsappPanel({ cartId, blockReason }: { cartId: string; blockReason: string | null }) {
  const prepare = useRun();
  const confirm = useRun();
  const [draft, setDraft] = useState<{ phone: string; text: string } | null>(null);
  const [askRepeat, setAskRepeat] = useState(false);
  const reason = blockReason;

  function sent(repeat: boolean) {
    confirm.run(repeat ? "sent-repeat" : "sent", (key) => confirmSent(cartId, key, repeat), (d) => {
      if (d.repeatRequired) { setAskRepeat(true); return; }
      setAskRepeat(false);
      setDraft(null);
      toast.success("Envio registrado.");
    });
  }

  return (
    <section aria-labelledby="wa-title" className="space-y-3">
      <h3 id="wa-title" className="font-medium">WhatsApp</h3>
      {reason && <p className="text-sm text-muted-foreground">Contato indisponível: {reason}</p>}
      {!draft || reason ? (
        <Button disabled={!!reason || prepare.pending} onClick={() => prepare.run("prepare", (key) => prepareWhatsapp(cartId, key), (d) => {
          if ("blocked" in d) prepare.setError(`Contato indisponível: ${d.blocked}`);
          else setDraft({ phone: d.phone, text: d.message });
        })}>
          {prepare.pending ? "Preparando…" : "Preparar mensagem"}
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="wa-message">Mensagem</Label>
            <textarea id="wa-message" rows={6} className={textarea} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          </div>
          <a href={whatsappUrl(draft.phone, draft.text)} target="_blank" rel="noopener noreferrer"
            className={buttonVariants({ variant: "default" })}>
            Abrir WhatsApp
          </a>
          <p className="text-sm text-muted-foreground">Abrir o WhatsApp não registra envio. Depois de enviar, confirme abaixo.</p>
          {askRepeat ? (
            <div role="alertdialog" aria-labelledby="wa-repeat" className="space-y-2 rounded-lg border p-3">
              <p id="wa-repeat">Já houve envio para este carrinho. Registrar outro envio?</p>
              <div className="flex gap-2">
                <Button disabled={confirm.pending} onClick={() => sent(true)}>Registrar outro envio</Button>
                <Button variant="outline" disabled={confirm.pending} onClick={() => setAskRepeat(false)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" disabled={confirm.pending} onClick={() => sent(false)}>
              {confirm.pending ? "Registrando…" : "Confirmar que enviei"}
            </Button>
          )}
        </div>
      )}
      {(prepare.error || confirm.error) && <p role="alert" className="text-sm text-destructive">{prepare.error ?? confirm.error}</p>}
    </section>
  );
}
