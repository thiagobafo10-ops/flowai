import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { approveConsent, denyConsent } from "./actions";
import { loadConsent } from "./load-consent";

export const metadata: Metadata = { title: "Autorizar acesso | FlowAI" };

type Props = {
  searchParams: Promise<{ authorization_id?: string | string[]; erro?: string | string[] }>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function Message({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

async function ConsentContent({ searchParams }: Props) {
  const params = await searchParams;
  const state = await loadConsent(first(params.authorization_id));

  if (state.kind === "login") redirect(state.to);
  if (state.kind === "redirect") redirect(state.url);
  if (state.kind === "invalid") {
    return <Message title="Pedido inválido" description="Este link de autorização está incompleto. Volte ao Claude e conecte novamente." />;
  }
  if (state.kind === "error") {
    return <Message title="Pedido expirado" description="Não foi possível carregar este pedido de autorização. Volte ao Claude e conecte novamente." />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{state.clientName}</CardTitle>
        <CardDescription>Permitir que o Claude gerencie suas automações do Instagram?</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">{state.clientName}</strong> poderá criar, editar, pausar e consultar
          automações e resultados da sua organização no FlowAI, com as mesmas permissões da sua conta.
        </p>
        {first(params.erro) && (
          <p role="alert" className="text-destructive">
            Não foi possível concluir. Tente novamente.
          </p>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <form action={denyConsent} className="flex-1">
          <input type="hidden" name="authorization_id" value={state.authorizationId} />
          <Button type="submit" variant="outline" className="w-full">
            Recusar
          </Button>
        </form>
        <form action={approveConsent} className="flex-1">
          <input type="hidden" name="authorization_id" value={state.authorizationId} />
          <Button type="submit" className="w-full">
            Permitir
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}

export default function OAuthConsentPage(props: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <Suspense fallback={<Message title="Autorizar acesso" description="Carregando…" />}>
          <ConsentContent {...props} />
        </Suspense>
      </div>
    </main>
  );
}
