import { contactDisplayName, type NodeType } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";
import { NODE_LABEL } from "@/components/automation/nodes/labels";
import { nodeSummary } from "@/components/automation/nodes/summary";
import type { EditorRefs } from "./queries";

type Supabase = Awaited<ReturnType<typeof createServerClient>>;

export const RUNS_LIMIT = 50;
const TERMINAL = ["completed", "failed", "cancelled"];

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
};
export type RunView = {
  id: string;
  status: string;
  contactName: string | null;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  steps: RunStepView[];
};

type RunRow = {
  id: string; status: string; version: number | null; error: string | null; created_at: string; updated_at: string;
  contacts: { name: string | null; phone: string | null; email: string | null } | null;
};
type StepRow = {
  id: string; run_id: string; node_id: string; status: string; handle: string | null; output: unknown; error: string | null; created_at: string;
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

export function buildRunViews(runs: RunRow[], steps: StepRow[], graphs: Map<number, unknown>, refs: EditorRefs): RunView[] {
  return runs.map((run) => {
    const nodes = new Map(nodesOf(run.version === null ? null : graphs.get(run.version)).map((n) => [n.id, n]));
    return {
      id: run.id,
      status: run.status,
      contactName: run.contacts ? contactDisplayName(run.contacts) : null,
      startedAt: run.created_at,
      endedAt: TERMINAL.includes(run.status) ? run.updated_at : null,
      error: run.error,
      steps: steps
        .filter((s) => s.run_id === run.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        .map((s) => {
          const node = nodes.get(s.node_id);
          const type = node?.type as NodeType | undefined;
          const result = isRecord(s.output) && typeof s.output.result === "string" ? s.output.result : s.error;
          return {
            id: s.id,
            nodeId: s.node_id,
            nodeLabel: type ? (Object.hasOwn(NODE_LABEL, type) ? NODE_LABEL[type] : type) : "Bloco removido",
            nodeSummary: type && Object.hasOwn(NODE_LABEL, type) ? nodeSummary(type, node?.config, refs) : "",
            handle: handleLabel(s.handle, node),
            status: s.status,
            result: result ?? null,
            at: s.created_at,
          };
        }),
    };
  });
}

/** Últimas 50 execuções da automação com os passos e o grafo da versão de cada execução. */
export async function listAutomationRuns(supabase: Supabase, orgId: string, automationId: string, refs: EditorRefs): Promise<RunView[]> {
  const runs = await supabase
    .from("automation_runs")
    .select("id, status, version, error, created_at, updated_at, contacts(name, phone, email)")
    .eq("organization_id", orgId)
    .eq("automation_id", automationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RUNS_LIMIT);
  if (runs.error) throw runs.error;
  const rows = (runs.data ?? []) as unknown as RunRow[];
  if (rows.length === 0) return [];
  const versions = [...new Set(rows.map((r) => r.version).filter((v): v is number => v !== null))];
  const [steps, graphs] = await Promise.all([
    supabase
      .from("automation_run_steps")
      .select("id, run_id, node_id, status, handle, output, error, created_at")
      .eq("organization_id", orgId)
      .in("run_id", rows.map((r) => r.id))
      .order("created_at"),
    versions.length
      ? supabase.from("automation_versions").select("version, graph").eq("organization_id", orgId).eq("automation_id", automationId).in("version", versions)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (steps.error) throw steps.error;
  if (graphs.error) throw graphs.error;
  const graphMap = new Map<number, unknown>((graphs.data ?? []).map((g: { version: number; graph: unknown }) => [g.version, g.graph]));
  return buildRunViews(rows, (steps.data ?? []) as StepRow[], graphMap, refs);
}
