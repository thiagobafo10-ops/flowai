"use client";

import { useAiStatus } from "@/lib/ai/use-ai-status";
import type { AiQuota } from "@/lib/ai/types";

export function AgentStatus({ orgId, quota, documentsReady }: { orgId: string; quota: AiQuota; documentsReady: number }) {
  const status = useAiStatus(orgId);
  const label = status.data?.configured === false
    ? "IA não configurada na plataforma"
    : status.isError
      ? "Não foi possível verificar a configuração da IA."
      : status.isPending
        ? "Verificando…"
        : documentsReady === 0
          ? "Base de conhecimento vazia"
          : "Pronto";
  return (
    <section aria-labelledby="ai-status-title" className="space-y-1 rounded-xl border p-4">
      <h2 id="ai-status-title" className="font-medium">Situação</h2>
      <p role="status">{label}</p>
      <p className="text-sm text-muted-foreground">
        {quota.replies} de {quota.repliesLimit} respostas · {quota.tests} de {quota.testsLimit} testes hoje
      </p>
    </section>
  );
}
