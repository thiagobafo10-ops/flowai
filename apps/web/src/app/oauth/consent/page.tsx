import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { approveConsent, denyConsent, switchAccount } from "./actions";
import { ConsentCard } from "./consent-card";
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
    <ConsentCard
      authorizationId={state.authorizationId}
      clientName={state.clientName}
      userEmail={state.userEmail}
      redirectHost={state.redirectHost}
      trustedRedirect={state.trustedRedirect}
      failed={Boolean(first(params.erro))}
      actions={{ approve: approveConsent, deny: denyConsent, switchAccount }}
    />
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
