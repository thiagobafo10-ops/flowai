"use client";

import type { ReactNode } from "react";
import { CopyIcon, Trash2Icon, XIcon } from "lucide-react";
import type { GraphIssue, NodeType, TriggerType } from "@flowai/core";
import type { EditorRefs } from "@/lib/automation/queries";
import { Button } from "@/components/ui/button";
import type { FlowNode } from "./graph-mapping";
import { NODE_LABEL } from "@/lib/automation/node-labels";
import { DelayForm, RefForm, WebhookForm } from "./forms/action-forms";
import { ConditionForm } from "./forms/condition-form";
import { MessageForm } from "./forms/message-form";
import { TriggerForm } from "./forms/trigger-form";

type Props = {
  node: FlowNode;
  refs: EditorRefs;
  triggerType: TriggerType;
  triggerConfig: unknown;
  issues: GraphIssue[];
  readOnly: boolean;
  onConfigChange: (nodeId: string, config: unknown) => void;
  onTriggerChange: (type: TriggerType, config: unknown) => void;
  onDelete: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onClose: () => void;
};

const NO_CONFIG: Partial<Record<NodeType, string>> = {
  close_conversation: "Encerra a conversa do contato.",
  handoff_ai: "Devolve a conversa para a IA responder.",
  handoff_human: "Transfere a conversa para atendimento humano (fica pendente para a equipe).",
  end: "Termina a automação neste ponto.",
};

/** Painel lateral: formulário do passo selecionado (gatilho ou bloco), com os problemas dele. */
export function NodePanel({ node, refs, triggerType, triggerConfig, issues, readOnly, onConfigChange, onTriggerChange, onDelete, onDuplicate, onClose }: Props) {
  const type = node.type as NodeType;
  const config = node.data.config;
  const change = (c: unknown) => onConfigChange(node.id, c);
  const instagram = triggerType === "instagram_comment" || triggerType === "instagram_story";

  let form: ReactNode;
  switch (type) {
    case "trigger":
      form = <TriggerForm triggerType={triggerType} triggerConfig={triggerConfig} refs={refs} onChange={onTriggerChange} />;
      break;
    case "message":
      form = <MessageForm key={node.id} config={config} onChange={change} instagram={instagram} />;
      break;
    case "condition":
      form = <ConditionForm key={node.id} config={config} onChange={change} refs={refs} />;
      break;
    case "delay":
      form = <DelayForm key={node.id} config={config} onChange={change} />;
      break;
    case "tag":
    case "remove_tag":
      form = <RefForm key={node.id} type={type} kind="tags" refs={refs} config={config} onChange={change} />;
      break;
    case "move_stage":
      form = <RefForm key={node.id} type={type} kind="stages" refs={refs} config={config} onChange={change} />;
      break;
    case "assign_user":
      form = <RefForm key={node.id} type={type} kind="members" refs={refs} config={config} onChange={change} />;
      break;
    case "webhook":
      form = <WebhookForm key={node.id} config={config} onChange={change} />;
      break;
    default:
      form = <p className="text-sm text-muted-foreground">{NO_CONFIG[type]}</p>;
  }

  return (
    <aside aria-label={`Configurar ${NODE_LABEL[type]}`} className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="font-medium">{NODE_LABEL[type]}</h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Fechar painel" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {issues.length > 0 && (
          <ul aria-label="Problemas deste passo" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
            {issues.map((i, idx) => <li key={idx}>{i.message}</li>)}
          </ul>
        )}
        <fieldset disabled={readOnly} className="space-y-3">{form}</fieldset>
        {readOnly && <p className="text-sm text-muted-foreground">Somente administradores podem alterar automações.</p>}
      </div>
      {!readOnly && type !== "trigger" && (
        <div className="flex gap-2 border-t p-4">
          <Button type="button" variant="outline" size="sm" onClick={() => onDuplicate(node.id)}>
            <CopyIcon />
            Duplicar
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onDelete(node.id)}>
            <Trash2Icon />
            Excluir passo
          </Button>
        </div>
      )}
    </aside>
  );
}
