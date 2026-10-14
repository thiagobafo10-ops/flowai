"use client";

import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import type { AutomationGraph, GraphIssue, TriggerType } from "@flowai/core";
import type { EditorRefs } from "@/lib/automation/queries";
import { toFlow } from "./graph-mapping";
import { nodeTypes } from "./nodes/automation-node";
import { EditorContext, type EditorContextValue } from "./nodes/context";
import { cn } from "@/lib/utils";

const EMPTY_REFS: EditorRefs = {
  tags: [],
  stages: [],
  members: [],
  channels: [],
  entryLinks: [],
  sequences: [],
};

type AiPreviewCanvasProps = {
  graph: AutomationGraph;
  triggerType: TriggerType;
  triggerConfig: unknown;
  issues?: GraphIssue[];
  refs?: EditorRefs;
  className?: string;
};

function InnerCanvas({
  graph,
  triggerType,
  triggerConfig,
  issues = [],
  refs = EMPTY_REFS,
  className,
}: AiPreviewCanvasProps) {
  const { nodes, edges } = useMemo(() => toFlow(graph), [graph]);

  const issuesByNode = useMemo(() => {
    const map = new Map<string, GraphIssue[]>();
    for (const issue of issues) {
      if (!issue.nodeId) continue;
      const list = map.get(issue.nodeId) ?? [];
      list.push(issue);
      map.set(issue.nodeId, list);
    }
    return map;
  }, [issues]);

  const contextValue: EditorContextValue = useMemo(
    () => ({
      refs,
      issuesByNode,
      triggerType,
      triggerConfig,
    }),
    [refs, issuesByNode, triggerType, triggerConfig],
  );

  return (
    <div className={cn("relative h-full w-full overflow-hidden rounded-lg border bg-muted/20", className)}>
      <EditorContext.Provider value={contextValue}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </EditorContext.Provider>
    </div>
  );
}

export function AutomationAiPreviewCanvas(props: AiPreviewCanvasProps) {
  return (
    <ReactFlowProvider>
      <InnerCanvas {...props} />
    </ReactFlowProvider>
  );
}
