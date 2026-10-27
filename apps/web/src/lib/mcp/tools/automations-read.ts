import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../context";
import { dbError, registerTool, toolOk } from "./result";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LOAD_ERROR = "Não foi possível carregar as automações agora. Tente novamente em instantes.";

export const STATUS_LABEL = { draft: "rascunho", active: "ativa", paused: "pausada" } as const;
type DbStatus = keyof typeof STATUS_LABEL;
const STATUS_FROM_LABEL = { rascunho: "draft", ativa: "active", pausada: "paused" } as const satisfies Record<string, DbStatus>;

const TRIGGER_LABEL: Record<string, string> = {
  instagram_comment: "comentario",
  keyword_detected: "dm",
  instagram_story: "story",
};

export function statusLabel(status: string): string {
  return Object.hasOwn(STATUS_LABEL, status) ? STATUS_LABEL[status as DbStatus] : status;
}

/** Gatilho no vocabulário do formato simples; outros gatilhos do painel ficam como "outro (<tipo>)". */
export function triggerLabel(type: string): string {
  return Object.hasOwn(TRIGGER_LABEL, type) ? TRIGGER_LABEL[type] : `outro (${type})`;
}

export function triggerWords(config: unknown): string[] {
  if (!config || typeof config !== "object") return [];
  const { keywords, anyKeyword } = config as { keywords?: unknown; anyKeyword?: unknown };
  if (anyKeyword === true || !Array.isArray(keywords)) return [];
  return keywords.filter((k): k is string => typeof k === "string");
}

export function triggerPost(type: string, config: unknown): string | null {
  if (type !== "instagram_comment") return null;
  const mediaId = config && typeof config === "object" ? (config as { mediaId?: unknown }).mediaId : null;
  return typeof mediaId === "string" && mediaId ? mediaId : "qualquer";
}

export type AutomationListItem = {
  id: string;
  nome: string;
  status: string;
  gatilho: string;
  palavras: string[];
  post: string | null;
  criadaPeloClaude: boolean;
  alteradaNoPainel: boolean;
  disparos7dias: number;
};

function describe(a: AutomationListItem): string {
  const words = a.palavras.length ? a.palavras.join(", ") : "qualquer mensagem";
  const post = a.post ? ` · post: ${a.post}` : "";
  const origin = a.criadaPeloClaude ? " · criada pelo Claude" : " · criada no painel";
  return `• ${a.nome} (id: ${a.id}) — ${a.status} · gatilho: ${a.gatilho} · palavras: ${words}${post} · ${a.disparos7dias} disparo(s) em 7 dias${origin}`;
}

export function registerAutomationReadTools(server: McpServer, ctx: McpContext): void {
  registerTool(
    server,
    "listar_automacoes",
    {
      description:
        "Lista as automações do Instagram da organização com nome, id, status, gatilho, palavras, post, " +
        "se foi criada pelo Claude e quantos disparos teve nos últimos 7 dias. Use para responder \"quais automações eu tenho\", " +
        "antes de editar, pausar, ativar ou excluir (para achar o id) e para evitar criar uma automação repetida.",
      inputSchema: {
        status: z
          .enum(["ativa", "pausada", "rascunho"], "status deve ser ativa, pausada ou rascunho.")
          .optional()
          .describe("Filtra pelo status. Sem filtro, lista todas."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status }) => {
      let query = ctx.supabase
        .from("automations")
        .select("id, name, status, trigger_type, trigger_config, mcp_spec, mcp_spec_stale, updated_at")
        .eq("organization_id", ctx.orgId);
      if (status) query = query.eq("status", STATUS_FROM_LABEL[status]);
      const since = new Date(Date.now() - WEEK_MS).toISOString();
      const [automations, runs] = await Promise.all([
        query.order("updated_at", { ascending: false }),
        ctx.supabase.rpc("automation_run_counts", { p_org: ctx.orgId, p_since: since }),
      ]);
      if (automations.error) return dbError("listar_automacoes", automations.error, LOAD_ERROR);
      if (runs.error) return dbError("listar_automacoes", runs.error, LOAD_ERROR);
      const counts = new Map((runs.data ?? []).map((r) => [r.automation_id, Number(r.runs)]));
      const items: AutomationListItem[] = (automations.data ?? []).map((a) => ({
        id: a.id,
        nome: a.name,
        status: statusLabel(a.status),
        gatilho: triggerLabel(a.trigger_type),
        palavras: triggerWords(a.trigger_config),
        post: triggerPost(a.trigger_type, a.trigger_config),
        criadaPeloClaude: a.mcp_spec !== null,
        alteradaNoPainel: a.mcp_spec_stale,
        disparos7dias: counts.get(a.id) ?? 0,
      }));
      const text = items.length ? items.map(describe).join("\n") : "Nenhuma automação encontrada.";
      return toolOk(text, { automacoes: items });
    },
  );
}
