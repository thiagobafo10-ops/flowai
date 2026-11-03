"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { unsubscribe, type UnsubscribeResult } from "./actions";

export function ConfirmUnsubscribe({ token }: { token: string }) {
  const [result, confirm, pending] = useActionState<UnsubscribeResult | null>(() => unsubscribe(token), null);
  if (result === "Link inválido")
    return (
      <div role="alert" className="space-y-2">
        <h1 className="text-xl font-semibold">Link inválido</h1>
        <p className="text-sm text-muted-foreground">Este link não existe ou expirou.</p>
      </div>
    );
  if (result)
    return (
      <div role="status" className="space-y-2">
        <h1 className="text-xl font-semibold">Descadastro confirmado</h1>
        <p className="text-sm text-muted-foreground">Você não vai mais receber estes e-mails.</p>
      </div>
    );
  return (
    <form action={confirm} className="space-y-4">
      <h1 className="text-xl font-semibold">Não quer mais receber estes e-mails?</h1>
      <p className="text-sm text-muted-foreground">Confirme abaixo para parar de receber os e-mails desta loja.</p>
      <Button type="submit" disabled={pending}>{pending ? "Confirmando…" : "Confirmar descadastro"}</Button>
    </form>
  );
}
