"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, ChevronRightIcon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { rerunFrom } from "@/lib/automation/actions";
import {
  AUTOMATION_RERUN_STARTED, AUTOMATION_RUN_STEPS_LOAD_FAILED, AUTOMATION_RUNS_LOAD_FAILED, RUN_STATUS_LABEL, runStepsCapped,
} from "@/lib/automation/messages";
import { STEPS_LIMIT, type RunSteps, type RunView } from "@/lib/automation/runs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RunsResponse = { runs: RunView[]; canRerun: boolean };

async function fetchJson<T>(url: string, failure: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(failure);
  return response.json() as Promise<T>;
}

const RERUNNABLE = ["failed", "completed"];
const STATUS_CLASS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  cancelled: "bg-muted text-muted-foreground",
};
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[status] ?? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300")}>
      {RUN_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Aba "Execuções": últimas 50 execuções; os passos de cada uma são carregados ao expandir. */
export function AutomationRuns({ orgId, automationId }: { orgId: string; automationId: string }) {
  const client = useQueryClient();
  const queryKey = ["automation-runs", orgId, automationId];
  const query = useQuery({
    queryKey,
    queryFn: () => fetchJson<RunsResponse>(`/api/automacoes/${automationId}/runs`, AUTOMATION_RUNS_LOAD_FAILED),
    refetchOnWindowFocus: false,
  });
  const [open, setOpen] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function rerun(runId: string, nodeId: string) {
    startTransition(async () => {
      const result = await rerunFrom(runId, nodeId);
      if (!result.ok) toast.error(result.error);
      else toast.success(AUTOMATION_RERUN_STARTED);
      // a lista e os passos (chave com o mesmo prefixo) são recarregados
      await client.invalidateQueries({ queryKey });
    });
  }

  if (query.isPending) return <div aria-busy="true" aria-label="Carregando execuções" className="m-6 h-40 animate-pulse rounded-xl bg-muted/40" />;
  if (query.isError) {
    return (
      <div role="alert" className="m-6 flex flex-col items-start gap-3 rounded-xl border p-6">
        <p>{AUTOMATION_RUNS_LOAD_FAILED}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button>
      </div>
    );
  }
  const { runs, canRerun } = query.data;
  if (runs.length === 0) return <p className="m-6 text-sm text-muted-foreground">Nenhuma execução ainda.</p>;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-busy={pending || query.isFetching}>
      <ul aria-label="Execuções" className="mx-auto max-w-4xl divide-y rounded-xl border">
        {runs.map((run) => {
          const expanded = open === run.id;
          return (
            <li key={run.id} data-testid="automation-run">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : run.id)}
                className="grid w-full grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-muted/50 sm:grid-cols-[auto_8rem_1fr_9rem_9rem]"
              >
                {expanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
                <StatusBadge status={run.status} />
                <span className="col-start-2 truncate sm:col-start-auto">{run.contactName ?? "Sem contato"}</span>
                <span className="col-start-2 text-xs text-muted-foreground sm:col-start-auto">Início: {dateTime.format(new Date(run.startedAt))}</span>
                <span className="col-start-2 text-xs text-muted-foreground sm:col-start-auto">
                  {run.endedAt ? `Fim: ${dateTime.format(new Date(run.endedAt))}` : "Em andamento"}
                </span>
              </button>
              {expanded && (
                <RunStepsPanel
                  queryKey={[...queryKey, run.id]}
                  url={`/api/automacoes/${automationId}/runs/${run.id}`}
                  error={run.error}
                  canRerun={canRerun && RERUNNABLE.includes(run.status)}
                  busy={pending}
                  onRerun={(nodeId) => rerun(run.id, nodeId)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RunStepsPanel({ queryKey, url, error, canRerun, busy, onRerun }: {
  queryKey: string[]; url: string; error: string | null; canRerun: boolean; busy: boolean; onRerun: (nodeId: string) => void;
}) {
  const query = useQuery({ queryKey, queryFn: () => fetchJson<RunSteps>(url, AUTOMATION_RUN_STEPS_LOAD_FAILED), refetchOnWindowFocus: false });
  return (
    <div className="space-y-2 border-t bg-muted/20 px-4 py-3" aria-busy={query.isFetching}>
      {error && <p className="text-sm text-destructive">Erro: {error}</p>}
      {query.isPending ? (
        <div aria-label="Carregando passos" className="h-16 animate-pulse rounded-lg bg-muted/60" />
      ) : query.isError ? (
        <div role="alert" className="flex items-center gap-2 text-sm">
          <span>{AUTOMATION_RUN_STEPS_LOAD_FAILED}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button>
        </div>
      ) : query.data.steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum passo registrado.</p>
      ) : (
        <>
          {query.data.capped && <p className="text-xs text-muted-foreground">{runStepsCapped(STEPS_LIMIT)}</p>}
          <ol aria-label="Passos" className="space-y-2">
            {query.data.steps.map((step) => (
              <li key={step.id} data-testid="automation-run-step" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{step.nodeLabel}</p>
                  {step.nodeSummary && <p className="truncate text-xs text-muted-foreground">{step.nodeSummary}</p>}
                </div>
                <StatusBadge status={step.status} />
                {step.handle && <span className="text-xs">Saída: {step.handle}</span>}
                {step.result && <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{step.result}</code>}
                <time dateTime={step.at} className="text-xs text-muted-foreground">{time.format(new Date(step.at))}</time>
                {canRerun && step.rerunnable && (
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onRerun(step.nodeId)}>
                    <RotateCcwIcon />
                    Reexecutar a partir deste passo
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
