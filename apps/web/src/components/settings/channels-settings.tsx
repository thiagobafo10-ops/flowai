"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SimulateForm } from "@/components/inbox/simulate-dialog";
import { createSimulatorChannel, setSimulatorActive } from "@/lib/inbox/channel-actions";
import type { ChannelRow } from "@/lib/inbox/queries";
import type { InstagramConnectionView } from "@/lib/instagram/queries";
import { InstagramSettings } from "./instagram/instagram-settings";

export function ChannelsSettings({ channels, instagram }: { channels: ChannelRow[]; instagram: { connections: InstagramConnectionView[] } }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const simulator = channels.find((c) => c.type === "simulator");
  const active = simulator?.status === "active";

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <section
        data-testid="simulator-channel"
        aria-labelledby="simulator-heading"
        aria-busy={pending}
        className="space-y-4 rounded-lg border p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="simulator-heading" className="text-lg font-medium">
            Simulador
          </h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Simulador</span>
          {simulator ? (
            <span className="text-sm text-muted-foreground">{active ? "Ativo" : "Desativado"}</span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Canal de teste: simule mensagens recebidas sem conectar uma conta real.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {simulator ? (
          <>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => run(() => setSimulatorActive(simulator.id, !active))}
            >
              {active ? "Desativar" : "Reativar"}
            </Button>
            <div className="max-w-md">
              <SimulateForm idPrefix="sim" />
            </div>
          </>
        ) : (
          <Button disabled={pending} onClick={() => run(() => createSimulatorChannel())}>
            Criar canal Simulador
          </Button>
        )}
      </section>

      <InstagramSettings connections={instagram.connections} />
      <section aria-labelledby="social-heading" className="space-y-2 rounded-lg border p-4">
        <h2 id="social-heading" className="text-lg font-medium">
          WhatsApp
        </h2>
        <p className="text-sm text-muted-foreground">Disponível em breve</p>
      </section>
    </div>
  );
}
