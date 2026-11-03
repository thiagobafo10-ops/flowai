import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmUnsubscribe } from "./confirm-unsubscribe";

export const metadata: Metadata = { title: "Descadastro de e-mails", robots: { index: false, follow: false } };

export default function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md space-y-4 rounded-lg border p-6 text-center">
        <p className="text-sm font-semibold tracking-tight text-muted-foreground">FlowAI</p>
        <Suspense fallback={<p>Carregando…</p>}>
          <UnsubscribeContent params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function UnsubscribeContent({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConfirmUnsubscribe token={token} />;
}
