"use client";

import "@xyflow/react/dist/style.css";
import { useMemo, useRef, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Background, Controls, Panel, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, type Connection, type Edge,
} from "@xyflow/react";
import { ArrowLeftIcon, Loader2Icon, PauseIcon, PlayIcon, SaveIcon } from "lucide-react";
import { toast } from "sonner";
import {
  validateGraph, type AutomationGraph, type GraphIssue, type GraphRefs, type NodeType, type TriggerType,
} from "@flowai/core";
import { activateAutomation, pauseAutomation, saveAutomation } from "@/lib/automation/actions";
import {
  AUTOMATION_ACTIVATED, AUTOMATION_ACTIVE_WITH_ISSUES, AUTOMATION_GONE, AUTOMATION_LOAD_FAILED, AUTOMATION_PAUSED, AUTOMATION_SAVED,
  AUTOMATION_REFRESH_FAILED, AUTOMATION_STATUS_LABEL, automationActivateBlocked,
} from "@/lib/automation/messages";
import type { AutomationStatus, EditorRefs } from "@/lib/automation/queries";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { connectEdge, fromFlow, pruneEdges, setNodeConfig, toFlow, type FlowEdge, type FlowNode } from "./graph-mapping";
import { editorView } from "./editor-view";
import { presentIssues } from "./issue-copy";
import { NodePanel } from "./node-panel";
import { AutomationRuns } from "./runs";
import { PALETTE_MIME, Palette } from "./palette";
import { placeholderIssues } from "@/lib/automation/placeholders";
import { EditorContext, type EditorContextValue } from "./nodes/context";
import { nodeTypes } from "./nodes/automation-node";
import { NODE_LABEL, PALETTE_TYPES, defaultNodeConfig } from "@/lib/automation/node-labels";
import { useUnsavedGuard } from "./use-unsaved-guard";

export type AutomationDetail = {
  automation: {
    id: string;
    name: string;
    status: AutomationStatus;
    triggerType: TriggerType;
    triggerConfig: unknown;
    currentVersion: number;
  };
  graph: AutomationGraph;
  refs: EditorRefs;
  canWrite: boolean;
};

class NotFoundError extends Error {}

async function fetchDetail(id: string): Promise<AutomationDetail> {
  const response = await fetch(`/api/automacoes/${id}`, { cache: "no-store" });
  if (response.status === 404) throw new NotFoundError(AUTOMATION_GONE);
  if (!response.ok) throw new Error(AUTOMATION_LOAD_FAILED);
  return response.json() as Promise<AutomationDetail>;
}

const STATUS_CLASS: Record<AutomationStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

const snapshot = (name: string, triggerType: TriggerType, triggerConfig: unknown, graph: AutomationGraph) =>
  JSON.stringify({ name: name.trim(), triggerType, triggerConfig, graph });

export function AutomationEditor({ orgId, id }: { orgId: string; id: string }) {
  const query = useQuery({
    queryKey: ["automation", orgId, id],
    queryFn: () => fetchDetail(id),
    // O editor copia o grafo para o estado local na montagem; uma nova abertura sempre busca o estado do servidor
    // (sem cache entre montagens) e recargas com o editor aberto só atualizam dados de exibição (versão, refs).
    staleTime: Infinity,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: (count, error) => !(error instanceof NotFoundError) && count < 2,
  });

  const view = editorView({ data: query.data, isError: query.isError });
  if (view === "loading") {
    return <div aria-busy="true" aria-label="Carregando automação" className="h-[calc(100dvh-3.5rem)] animate-pulse bg-muted/40" />;
  }
  if (view === "error" || query.data === undefined) {
    const gone = query.error instanceof NotFoundError;
    return (
      <div role="alert" className="m-6 flex flex-col items-start gap-3 rounded-xl border p-6">
        <p>{gone ? AUTOMATION_GONE : AUTOMATION_LOAD_FAILED}</p>
        <div className="flex gap-2">
          {!gone && <Button type="button" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button>}
          <Link href="/automacoes" className={buttonVariants({ variant: "outline" })}>Voltar para Automações</Link>
        </div>
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <EditorBody orgId={orgId} detail={query.data} />
    </ReactFlowProvider>
  );
}

function EditorBody({ orgId, detail }: { orgId: string; detail: AutomationDetail }) {
  const { automation, refs, canWrite } = detail;
  const readOnly = !canWrite;
  const client = useQueryClient();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();

  const [initial] = useState(() => toFlow(detail.graph));
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(initial.edges);
  const [name, setName] = useState(automation.name);
  const [status, setStatus] = useState<AutomationStatus>(automation.status);
  const [triggerType, setTriggerType] = useState<TriggerType>(automation.triggerType);
  const [triggerConfig, setTriggerConfig] = useState<unknown>(automation.triggerConfig);
  const [saved, setSaved] = useState(() =>
    snapshot(automation.name, automation.triggerType, automation.triggerConfig, fromFlow(initial.nodes, initial.edges)),
  );
  const [issuesOpen, setIssuesOpen] = useState(true);
  // O fluxo continua montado na aba "Execuções" (oculto) para não perder alterações não salvas.
  const [tab, setTab] = useState<"flow" | "runs">("flow");

  const graph = useMemo(() => fromFlow(nodes, edges), [nodes, edges]);
  const current = snapshot(name, triggerType, triggerConfig, graph);
  const dirty = !readOnly && current !== saved;
  useUnsavedGuard(dirty);

  const graphRefs = useMemo<GraphRefs>(
    () => ({
      tagIds: refs.tags.map((t) => t.id),
      stageIds: refs.stages.map((s) => s.id),
      userIds: refs.members.map((m) => m.id),
      channelIds: refs.channels.filter((c) => c.type === "instagram").map((c) => c.id),
    }),
    [refs],
  );
  const issues = useMemo<GraphIssue[]>(
    () =>
      presentIssues(
        [...validateGraph(graph, { type: triggerType, config: triggerConfig }, graphRefs), ...placeholderIssues(graph, triggerConfig)],
        graph,
      ),
    [graph, triggerType, triggerConfig, graphRefs],
  );
  const issuesByNode = useMemo(() => {
    const map = new Map<string, GraphIssue[]>();
    for (const issue of issues) if (issue.nodeId) map.set(issue.nodeId, [...(map.get(issue.nodeId) ?? []), issue]);
    return map;
  }, [issues]);
  const context = useMemo<EditorContextValue>(() => ({ refs, issuesByNode, triggerType, triggerConfig }), [refs, issuesByNode, triggerType, triggerConfig]);

  const selected = nodes.find((n) => n.selected) ?? null;
  const nodeLabel = (id: string | null) => {
    const n = id ? nodes.find((x) => x.id === id) : undefined;
    return n ? NODE_LABEL[n.type as NodeType] : "Automação";
  };

  // ── Edição do grafo ────────────────────────────────────────────────
  function addNode(type: Exclude<NodeType, "trigger">, position: { x: number; y: number }) {
    const node: FlowNode = { id: crypto.randomUUID(), type, position, data: { config: defaultNodeConfig(type) }, selected: true };
    setNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), node]);
  }
  function addAtCenter(type: Exclude<NodeType, "trigger">) {
    const rect = wrapper.current?.getBoundingClientRect();
    const point = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
    const p = screenToFlowPosition(point);
    addNode(type, { x: p.x - 110, y: p.y - 40 });
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (readOnly) return;
    const type = e.dataTransfer.getData(PALETTE_MIME) as Exclude<NodeType, "trigger">;
    if (!PALETTE_TYPES.includes(type)) return;
    addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }
  function onConnect(connection: Connection) {
    setEdges((es) => connectEdge(es, connection, () => crypto.randomUUID()));
  }
  function changeConfig(nodeId: string, config: unknown) {
    const type = nodes.find((n) => n.id === nodeId)?.type;
    if (!type) return;
    setNodes((ns) => setNodeConfig(ns, nodeId, config));
    setEdges((es) => pruneEdges(es, nodeId, type, config));
  }
  function changeTrigger(type: TriggerType, config: unknown) {
    setTriggerType(type);
    setTriggerConfig(config);
  }
  function deleteNode(nodeId: string) {
    if (nodes.find((n) => n.id === nodeId)?.type === "trigger") return;
    setNodes((ns) => ns.filter((n) => n.id !== nodeId));
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
  }
  function duplicateNode(nodeId: string) {
    const source = nodes.find((n) => n.id === nodeId);
    if (!source || source.type === "trigger") return;
    const copy: FlowNode = {
      id: crypto.randomUUID(),
      type: source.type,
      position: { x: source.position.x + 40, y: source.position.y + 40 },
      data: { config: structuredClone(source.data.config) },
      selected: true,
    };
    setNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), copy]);
  }
  function selectNode(nodeId: string | null) {
    setNodes((ns) => ns.map((n) => (n.selected === (n.id === nodeId) ? n : { ...n, selected: n.id === nodeId })));
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
    if (nodeId) void fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1.2, padding: 0.6 });
  }

  // ── Ações ──────────────────────────────────────────────────────────
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["automations", orgId] });
    // Atualiza versão/refs exibidas; o grafo local não é sobrescrito (o estado é copiado só na montagem).
    // Se a recarga falhar, o editor continua com os dados que tem (ver editorView); só avisamos.
    client
      .invalidateQueries({ queryKey: ["automation", orgId, automation.id] }, { throwOnError: true })
      .catch(() => toast.error(AUTOMATION_REFRESH_FAILED));
  };
  async function persist(): Promise<boolean> {
    const at = current;
    const result = await saveAutomation({ id: automation.id, name, triggerType, triggerConfig, graph });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setSaved(at);
    refresh();
    return true;
  }
  function save() {
    startTransition(async () => {
      if (await persist()) toast.success(AUTOMATION_SAVED);
    });
  }
  function activate() {
    if (issues.length > 0) {
      setIssuesOpen(true);
      toast.error(automationActivateBlocked(issues.length));
      return;
    }
    startTransition(async () => {
      if (dirty && !(await persist())) return;
      const result = await activateAutomation(automation.id);
      if (!result.ok) toast.error(result.error);
      else if (!result.data.activated) toast.error(automationActivateBlocked(result.data.issues.length));
      else {
        setStatus("active");
        toast.success(AUTOMATION_ACTIVATED);
      }
      refresh();
    });
  }
  function pause() {
    startTransition(async () => {
      const result = await pauseAutomation(automation.id);
      if (!result.ok) toast.error(result.error);
      else {
        setStatus("paused");
        toast.success(AUTOMATION_PAUSED);
      }
      refresh();
    });
  }

  const active = status === "active";
  const saveBlocked = active && issues.length > 0;
  const isValidConnection = (c: Edge | Connection) => c.source !== c.target;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-[520px] flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Link href="/automacoes" aria-label="Voltar para Automações" className={buttonVariants({ variant: "ghost", size: "icon" })}>
          <ArrowLeftIcon />
        </Link>
        <Input
          aria-label="Nome da automação"
          value={name}
          maxLength={100}
          readOnly={readOnly}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-64 max-w-full font-medium"
        />
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[status])}>{AUTOMATION_STATUS_LABEL[status] ?? status}</span>
        {automation.currentVersion > 0 && <span className="text-xs text-muted-foreground">Versão {automation.currentVersion}</span>}
        {dirty && <span className="text-xs text-muted-foreground">Alterações não salvas</span>}
        <div role="tablist" aria-label="Seções da automação" className="flex rounded-lg border p-0.5">
          {([["flow", "Fluxo"], ["runs", "Execuções"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn("rounded-md px-3 py-1 text-sm", tab === value ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
        {canWrite && (
          <div className="ml-auto flex items-center gap-2">
            {saveBlocked && <span className="text-xs text-destructive">{AUTOMATION_ACTIVE_WITH_ISSUES}</span>}
            <Button type="button" variant="outline" disabled={pending || !dirty || saveBlocked} onClick={save}>
              {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
              {active ? "Salvar" : "Salvar rascunho"}
            </Button>
            {active ? (
              <Button type="button" variant="outline" disabled={pending} onClick={pause}>
                <PauseIcon />
                Pausar
              </Button>
            ) : (
              <Button
                type="button"
                disabled={pending || issues.length > 0}
                title={issues.length > 0 ? automationActivateBlocked(issues.length) : undefined}
                onClick={activate}
              >
                <PlayIcon />
                Ativar
              </Button>
            )}
          </div>
        )}
      </header>

      {tab === "runs" && <AutomationRuns orgId={orgId} automationId={automation.id} />}
      <div className={cn("flex min-h-0 flex-1", tab !== "flow" && "hidden")}>
        {!readOnly && <Palette onAdd={addAtCenter} />}
        <div ref={wrapper} className="relative min-w-0 flex-1" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={onDrop}>
          <EditorContext.Provider value={context}>
            <ReactFlow<FlowNode, FlowEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              edgesFocusable={!readOnly}
              deleteKeyCode={readOnly || tab !== "flow" ? null : ["Backspace", "Delete"]}
              colorMode="system"
              fitView
              fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            >
              <Background />
              <Controls showInteractive={false} />
              <Panel position="bottom-left" className="max-w-sm">
                <IssuesList
                  issues={issues}
                  open={issuesOpen}
                  onToggle={() => setIssuesOpen((o) => !o)}
                  labelOf={nodeLabel}
                  onSelect={selectNode}
                />
              </Panel>
            </ReactFlow>
          </EditorContext.Provider>
        </div>
        {selected && (
          <NodePanel
            key={selected.id}
            node={selected}
            refs={refs}
            triggerType={triggerType}
            triggerConfig={triggerConfig}
            issues={issuesByNode.get(selected.id) ?? []}
            readOnly={readOnly}
            onConfigChange={changeConfig}
            onTriggerChange={changeTrigger}
            onDelete={deleteNode}
            onDuplicate={duplicateNode}
            onClose={() => selectNode(null)}
          />
        )}
      </div>
    </div>
  );
}

function IssuesList({ issues, open, onToggle, labelOf, onSelect }: {
  issues: GraphIssue[];
  open: boolean;
  onToggle: () => void;
  labelOf: (nodeId: string | null) => string;
  onSelect: (nodeId: string) => void;
}) {
  if (issues.length === 0) {
    return <p className="rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground shadow-sm">Nenhum problema encontrado.</p>;
  }
  return (
    <section aria-label="Problemas do fluxo" className="rounded-lg border border-destructive/40 bg-background text-sm shadow-sm">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center justify-between gap-2 px-3 py-2 font-medium text-destructive">
        {issues.length === 1 ? "1 problema" : `${issues.length} problemas`}
        <span className="text-xs text-muted-foreground">{open ? "Ocultar" : "Mostrar"}</span>
      </button>
      {open && (
        <ul className="max-h-56 space-y-1 overflow-y-auto border-t p-2">
          {issues.map((issue, i) => (
            <li key={`${issue.nodeId}-${issue.code}-${i}`}>
              {issue.nodeId ? (
                <button type="button" onClick={() => onSelect(issue.nodeId!)} className="w-full rounded-md px-2 py-1 text-left hover:bg-muted">
                  {issue.message.startsWith(`${labelOf(issue.nodeId)}:`) ? (
                    issue.message
                  ) : (
                    <>
                      <span className="font-medium">{labelOf(issue.nodeId)}:</span> {issue.message}
                    </>
                  )}
                </button>
              ) : (
                <p className="px-2 py-1">{issue.message}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
