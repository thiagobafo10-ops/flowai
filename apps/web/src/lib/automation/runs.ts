import { contactDisplayName, type NodeType } from "@flowai/core";
import type { createServerClient } from "@/lib/supabase/server";
import { NODE_LABEL } from "./node-labels";
import { nodeSummary } from "./node-summary";
import type { EditorRefs } from "./queries";

type Supabase = Awaited<ReturnType<typeof createServerClient>>;

export const RUNS_LIMIT = 50;
/** Passos carregados por execução (os mais recentes: última iteração primeiro). */
export const STEPS_LIMIT = 200;
const TERMINAL = ["completed", "failed", "cancelled"];

export type RunView = {
  id: string;
  status: string;
  contactName: string | null;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
};
export type RunStepView = {
  id: string;
  nodeId: string;
  nodeLabel: string;
  nodeSummary: string;
  handle: string | null;
  status: string;
  /** Código de resultado do passo (output.result) ou o código de erro. */
  result: string | null;
  at: string;
  iteration: number;
  /** Pode reexecutar a partir deste passo (bloco existente na versão e que não é o gatilho). */
  rerunnable: boolean;
};
export type RunSteps = { steps: RunStepView[]; capped: boolean };

type RunRow = {
  id: string; status: string; error: string | null; created_at: string; updated_at: string;
  contacts: { name: string | null; phone: string | null; email: string | null } | null;
};
type StepRow = {
  id: string; node_id: string; iteration: number; status: string; handle: string | null; output: unknown; error: string | null; created_at: string;
};
type GraphNode = { id: string; type: string; config: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nodesOf = (graph: unknown): GraphNode[] =>
  isRecord(graph) && Array.isArray(graph.nodes) ? (graph.nodes.filter((n) => isRecord(n) && typeof n.id === "string") as GraphNode[]) : [];

const HANDLE_LABEL: Record<string, string> = {
  default: "Padrão", true: "Sim", false: "Não", no_reply: "Sem resposta", sent: "Enviada", handoff: "Transferência",
};

/** Saída usada pelo passo; `opt:<id>` mostra o título do botão/resposta rápida do bloco. */
export function handleLabel(handle: string | null, node: GraphNode | undefined): string | null {
  if (!handle) return null;
  if (handle.startsWith("opt:")) {
    const id = handle.slice(4);
    const config = isRecord(node?.config) ? node.config : {};
    const options = [config.buttons, config.quickReplies].flatMap((l) => (Array.isArray(l) ? l.filter(isRecord) : []));
    const title = options.find((o) => o.id === id)?.title;
    return typeof title === "string" ? title : `Opção ${id}`;
  }
  return Object.hasOwn(HANDLE_LABEL, handle) ? HANDLE_LABEL[handle]! : handle;
}

export function buildRunViews(runs: RunRow[]): RunView[] {
  return runs.map((run) => ({
    id: run.id,
    status: run.status,
    contactName: run.contacts ? contactDisplayName(run.contacts) : null,
    startedAt: run.created_at,
    endedAt: TERMINAL.includes(run.status) ? run.updated_at : null,
    error: run.error,
  }));
}

/** Passos com o resumo do bloco no grafo da versão da execução; última iteração primeiro, em ordem cronológica. */
export function buildStepViews(steps: StepRow[], graph: unknown, refs: EditorRefs): RunStepView[] {
  const nodes = new Map(nodesOf(graph).map((n) => [n.id, n]));
  return [...steps]
    .sort((a, b) => b.iteration - a.iteration || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((s) => {
      const node = nodes.get(s.node_id);
      const known = node !== undefined && Object.hasOwn(NODE_LABEL, node.type);
      const type = node?.type as NodeType | undefined;
      const result = isRecord(s.output) && typeof s.output.result === "string" ? s.output.result : s.error;
      return {
        id: s.id,
        nodeId: s.node_id,
        nodeLabel: !type ? "Bloco removido" : known ? NODE_LABEL[type] : type,
        nodeSummary: known && type ? nodeSummary(type, node.config, refs) : "",
        handle: handleLabel(s.handle, node),
        status: s.status,
        result: result ?? null,
        at: s.created_at,
        iteration: s.iteration,
        rerunnable: known && type !== "trigger",
      };
    });
}

/** Últimas 50 execuções da automação (os passos são carregados por execução, ao expandir). */
export async function listAutomationRuns(supabase: Supabase, orgId: string, automationId: string): Promise<RunView[]> {
  const runs = await supabase
    .from("automation_runs")
    .select("id, status, error, created_at, updated_at, contacts(name, phone, email)")
    .eq("organization_id", orgId)
    .eq("automation_id", automationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RUNS_LIMIT);
  if (runs.error) throw runs.error;
  return buildRunViews((runs.data ?? []) as unknown as RunRow[]);
}

/** Passos de uma execução (até STEPS_LIMIT, os mais recentes); null quando a execução não é desta automação. */
export async function loadRunSteps(
  supabase: Supabase, orgId: string, automationId: string, runId: string, refs: EditorRefs,
): Promise<RunSteps | null> {
  const run = await supabase
    .from("automation_runs")
    .select("id, version")
    .eq("organization_id", orgId)
    .eq("automation_id", automationId)
    .eq("id", runId)
    .maybeSingle();
  if (run.error) throw run.error;
  if (!run.data) return null;
  const version = run.data.version;
  const [steps, graph] = await Promise.all([
    supabase
      .from("automation_run_steps")
      .select("id, node_id, iteration, status, handle, output, error, created_at")
      .eq("organization_id", orgId)
      .eq("run_id", runId)
      .order("iteration", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(STEPS_LIMIT + 1),
    version === null
      ? Promise.resolve({ data: null, error: null })
      : supabase.from("automation_versions").select("graph").eq("organization_id", orgId).eq("automation_id", automationId)
        .eq("version", version).maybeSingle(),
  ]);
  if (steps.error) throw steps.error;
  if (graph.error) throw graph.error;
  const rows = (steps.data ?? []) as StepRow[];
  return { steps: buildStepViews(rows.slice(0, STEPS_LIMIT), graph.data?.graph ?? null, refs), capped: rows.length > STEPS_LIMIT };
}
