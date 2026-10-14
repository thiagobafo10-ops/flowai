import type { NodeType, TriggerType } from "@flowai/core";
import type { EditorRefs } from "@/lib/automation/queries";
import { AUTOMATION_TRIGGER_LABEL } from "@/lib/automation/messages";
import { rec, str } from "./config-utils";
import { KEYWORD_MODE_LABEL, WEEKDAY_LABEL } from "./node-labels";

const nameOf = (list: { id: string; name: string }[], id: unknown, missing: string) =>
  typeof id === "string" && id ? (list.find((o) => o.id === id)?.name ?? "Item removido") : missing;

function clip(text: string, max = 90): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function keywords(c: Record<string, unknown>): string {
  const list = Array.isArray(c.keywords) ? c.keywords.filter((k): k is string => typeof k === "string" && k.trim() !== "") : [];
  if (!list.length) return "Sem palavras-chave";
  return `${KEYWORD_MODE_LABEL[str(c.mode)] ?? "Contém"}: ${clip(list.join(", "), 60)}`;
}

export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "Defina a espera";
  if (minutes % 1440 === 0) return minutes === 1440 ? "1 dia" : `${minutes / 1440} dias`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

export function triggerSummary(type: TriggerType, config: unknown, refs: EditorRefs): string[] {
  const c = rec(config);
  const lines = [AUTOMATION_TRIGGER_LABEL[type] ?? type];
  switch (type) {
    case "message_received":
      if (c.firstMessageOnly === true) lines.push("Só na primeira mensagem");
      break;
    case "keyword_detected":
      lines.push(keywords(c));
      break;
    case "instagram_comment":
      lines.push(nameOf(refs.channels, c.channelId, "Escolha o canal"), keywords(c));
      break;
    case "instagram_story":
      lines.push(nameOf(refs.channels, c.channelId, "Escolha o canal"));
      break;
    case "tag_added":
      lines.push(c.tagId ? nameOf(refs.tags, c.tagId, "") : "Qualquer etiqueta");
      break;
    case "stage_changed":
      lines.push(c.stageId ? nameOf(refs.stages, c.stageId, "") : "Qualquer etapa");
      break;
    case "contact_created":
      break;
  }
  return lines;
}

export function nodeSummary(type: NodeType, config: unknown, refs: EditorRefs): string {
  const c = rec(config);
  switch (type) {
    case "message":
      if (c.mode === "ai") return "Resposta gerada pela IA";
      return clip(str(c.text)) || "Escreva a mensagem";
    case "condition":
      switch (c.kind) {
        case "keyword":
          return keywords(c);
        case "has_tag":
          return `Tem a etiqueta ${nameOf(refs.tags, c.tagId, "…")}`;
        case "stage_is":
          return `Está na etapa ${nameOf(refs.stages, c.stageId, "…")}`;
        case "lead_score_gte":
          return `Pontuação maior ou igual a ${typeof c.value === "number" ? c.value : "…"}`;
        case "intent_is":
          return `Intenção: ${clip(str(c.intent), 40) || "…"}`;
        case "business_hours": {
          const days = Array.isArray(c.days) ? c.days.map((d) => WEEKDAY_LABEL[d as number] ?? "").filter(Boolean).join(", ") : "";
          return `Horário comercial: ${days || "…"} ${str(c.start)}–${str(c.end)}`;
        }
        default:
          return "Escolha a condição";
      }
    case "delay":
      return `Esperar ${formatMinutes(typeof c.minutes === "number" ? c.minutes : NaN)}`;
    case "tag":
    case "remove_tag":
      return nameOf(refs.tags, c.tagId, "Escolha a etiqueta");
    case "assign_user":
      return nameOf(refs.members, c.userId, "Escolha o responsável");
    case "move_stage":
      return nameOf(refs.stages, c.stageId, "Escolha a etapa");
    case "webhook": {
      try {
        return new URL(str(c.url)).host;
      } catch {
        return "Informe a URL";
      }
    }
    case "close_conversation":
      return "Encerra a conversa";
    case "handoff_ai":
      return "A IA assume a conversa";
    case "handoff_human":
      return "Um atendente assume a conversa";
    case "sequence_enroll":
      return "Inscreve o contato na sequência";
    case "sequence_remove":
      return "Remove o contato da sequência";
    case "end":
      return "Fim do fluxo";
    case "trigger":
      return "";
  }
}
