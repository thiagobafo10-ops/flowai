"use client";

import { memo, type ComponentType } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  ArchiveIcon, BotIcon, ClockIcon, FlagIcon, GitBranchIcon, HeadsetIcon, KanbanIcon, MessageSquareIcon,
  TagIcon, UserPlusIcon, WebhookIcon, XIcon, ZapIcon, type LucideIcon,
} from "lucide-react";
import type { NodeType } from "@flowai/core";
import { cn } from "@/lib/utils";
import { nodeHandles, type FlowNode, type HandleSpec } from "../graph-mapping";
import { PLACEHOLDER_MESSAGE } from "@/lib/automation/placeholders";
import { useEditorContext } from "./context";
import { NODE_LABEL } from "./labels";
import { nodeSummary, triggerSummary } from "./summary";

const ICON: Record<NodeType, LucideIcon> = {
  trigger: ZapIcon,
  message: MessageSquareIcon,
  condition: GitBranchIcon,
  delay: ClockIcon,
  tag: TagIcon,
  remove_tag: XIcon,
  assign_user: UserPlusIcon,
  move_stage: KanbanIcon,
  webhook: WebhookIcon,
  close_conversation: ArchiveIcon,
  handoff_ai: BotIcon,
  handoff_human: HeadsetIcon,
  end: FlagIcon,
};

const TRIGGER_HANDLES: HandleSpec[] = [{ id: "default", label: "" }];

/** Cartão de um passo: título, resumo da configuração, avisos e uma saída por `requiredHandles`. */
function makeNode(type: NodeType): ComponentType<NodeProps<FlowNode>> {
  function AutomationNode({ id, data, selected }: NodeProps<FlowNode>) {
    const { refs, issuesByNode, triggerType, triggerConfig } = useEditorContext();
    const issues = issuesByNode.get(id) ?? [];
    const handles = type === "trigger" ? TRIGGER_HANDLES : nodeHandles({ type, config: data.config });
    const lines = type === "trigger" ? triggerSummary(triggerType, triggerConfig, refs) : [nodeSummary(type, data.config, refs)];
    const placeholder = issues.some((i) => i.code === "placeholder");
    const others = issues.filter((i) => i.code !== "placeholder").length;
    const Icon = ICON[type];
    return (
      <div
        style={{ width: Math.max(150, handles.length * 72) }}
        className={cn(
          "rounded-xl border bg-card text-sm text-card-foreground shadow-sm",
          issues.length > 0 && "border-destructive ring-1 ring-destructive",
          selected && "ring-2 ring-ring",
        )}
      >
        {type !== "trigger" && <Handle type="target" position={Position.Top} className="size-3!" />}
        <div className="flex items-center gap-2 border-b px-3 py-2 font-medium">
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{NODE_LABEL[type]}</span>
        </div>
        <div className="space-y-0.5 px-3 py-2 text-muted-foreground">
          {lines.map((line, i) => (
            <p key={i} className={cn("break-words", i === 0 && type === "trigger" && "text-foreground")}>{line}</p>
          ))}
          {placeholder && <p className="text-xs font-medium text-destructive">{PLACEHOLDER_MESSAGE}</p>}
          {others > 0 && <p className="text-xs font-medium text-destructive">{others === 1 ? "1 problema" : `${others} problemas`}</p>}
        </div>
        {handles.length > 0 && (
          <div className="flex border-t">
            {handles.map((h) => (
              <div key={h.id} className="relative min-w-0 flex-1 px-1 pt-1 pb-2 text-center text-xs text-muted-foreground">
                <span className="block truncate" title={h.label || undefined}>{h.label || " "}</span>
                <Handle
                  type="source"
                  id={h.id}
                  position={Position.Bottom}
                  className="size-3!"
                  aria-label={h.label ? `Saída ${h.label}` : "Saída"}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  AutomationNode.displayName = `AutomationNode(${type})`;
  return memo(AutomationNode);
}

const ALL_TYPES = Object.keys(ICON) as NodeType[];

/** Um componente de nó por tipo, no formato esperado por `nodeTypes` do React Flow. */
export const nodeTypes = Object.fromEntries(ALL_TYPES.map((t) => [t, makeNode(t)])) as Record<
  NodeType,
  ComponentType<NodeProps<FlowNode>>
>;
