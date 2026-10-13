"use client";

import { useQuery } from "@tanstack/react-query";
import type { AiAgentPayload } from "@/lib/ai/types";
import { Button } from "@/components/ui/button";
import { AgentForm } from "./agent-form";
import { AgentStatus } from "./agent-status";
import { Playground } from "./playground";

async function fetchAgent(): Promise<AiAgentPayload> {
  const response = await fetch("/api/ia", { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível carregar o agente de IA.");
  return response.json() as Promise<AiAgentPayload>;
}

export function AgentView({ orgId }: { orgId: string }) {
  const query = useQuery({ queryKey: ["ai-agent", orgId], queryFn: fetchAgent });

  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="Carregando agente de IA" className="space-y-3">
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted/60" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border p-6">
        <p>Não foi possível carregar o agente de IA.</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button>
      </div>
    );
  }
  const { agent, quota, documentsReady, canWrite } = query.data;
  return (
    <div className="space-y-6">
      <AgentStatus orgId={orgId} quota={quota} documentsReady={documentsReady} />
      {agent ? (
        <AgentForm orgId={orgId} agent={agent} canWrite={canWrite} />
      ) : (
        <p role="alert" className="rounded-xl border p-4">Agente de IA não encontrado para esta organização.</p>
      )}
      <Playground orgId={orgId} canTest={canWrite && !!agent} />
    </div>
  );
}
