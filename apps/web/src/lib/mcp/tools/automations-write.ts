import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  automationSpecSchema,
  mergeSpec,
  specToGraph,
  specToTrigger,
  summarizeSpec,
  type AutomationGraph,
  type AutomationSpec,
  type Database,
  type SpecPatch,
} from "@flowai/core";
import type { McpContext } from "../context";
import { statusLabel } from "./automations-read";
import { NO_CHANNEL, fetchPosts } from "./posts";
import { dbError, registerTool, toolError, toolOk, type ToolResult } from "./result";

const NOT_ADMIN =
  "Só administradores ou donos da organização podem criar, editar, pausar, ativar ou excluir automações. Peça a um administrador do FlowAI.";
const NOT_FOUND = "Automação não encontrada nesta organização.";
const PANEL_CREATED =
  "Esta automação foi criada no painel do FlowAI, então o Claude não pode editá-la. Você pode pausar, ativar ou excluir.";
const PANEL_MODIFIED =
  "Esta automação foi alterada no painel depois de criada pelo Claude. Confirme com o usuário e repita a edição com confirmarSobrescrever: true para substituir as alterações do painel.";
const SAVE_FAILED = "Não foi possível salvar a automação agora. Tente novamente em instantes.";
const DELETE_CONFIRM = "Confirme a exclusão com confirmar: true. A exclusão é definitiva.";
const EMPTY_PATCH = "Informe ao menos um campo em alteracoes para editar a automação.";
const INVALID_SPEC = "A automação salva pelo Claude está inválida. Edite-a no painel do FlowAI.";
const postNotFound = (id: string) => `O post ${id} não está na conta do Instagram conectada. Use listar_posts para ver os ids dos posts.`;

type AutomationRow = Database["public"]["Tables"]["automations"]["Row"];
type Trigger = { type: string; config: Record<string, unknown> };

const isAdmin = (ctx: McpContext) => ctx.role === "owner" || ctx.role === "admin";
const channelId = (ctx: McpContext) => ctx.channel?.id ?? "";

const FIELD_NAMES: Record<string, string> = {
  nome: "nome",
  gatilho: "gatilho",
  palavras: "palavras",
  post: "post",
  respostaPublica: "resposta pública",
  dm: "dm",
  botaoDeAbertura: "botão de abertura",
  followUp: "follow-up",
  umaVezPorContato: "uma vez por contato",
};

// ---------------------------------------------------------------- entrada

const linkButtonInput = z.object({
  titulo: z.string().describe("Texto do botão (até 20 caracteres)."),
  url: z.string().describe("URL https de destino."),
});

const followUpInput = z.object({
  depois: z.string().describe('Espera antes de enviar, de 1 minuto a 7 dias (ex.: "30min", "2h", "1d").'),
  texto: z.string(),
  botoes: z.array(linkButtonInput).optional(),
});

const specInputShape = {
  nome: z.string().describe("Nome da automação (1 a 100 caracteres)."),
  gatilho: z
    .enum(["comentario", "dm", "story"])
    .describe("comentario: palavra em comentário de post; dm: palavra em mensagem direta; story: resposta a story."),
  palavras: z.array(z.string()).optional().describe("Palavras que disparam (até 20). Vazio = qualquer texto."),
  post: z.string().optional().describe('Id do post ou "qualquer". Só no gatilho comentario.'),
  respostaPublica: z
    .array(z.string())
    .optional()
    .describe("Respostas públicas no comentário (até 10, 300 caracteres cada). Só no gatilho comentario."),
  dm: z
    .object({ texto: z.string(), botoes: z.array(linkButtonInput).optional() })
    .optional()
    .describe("DM enviada quando o gatilho casa: texto (até 1000 bytes) e até 3 botões de link."),
  botaoDeAbertura: z
    .string()
    .nullable()
    .optional()
    .describe('Título do botão que abre a janela de 24h antes dos links (padrão "Quero!").'),
  followUp: followUpInput.nullable().optional().describe("Mensagem extra enviada depois da espera."),
  umaVezPorContato: z.boolean().optional().describe("true (padrão) = não dispara de novo para o mesmo contato."),
};

const patchInputShape = {
  nome: specInputShape.nome.optional(),
  gatilho: specInputShape.gatilho.optional(),
  palavras: specInputShape.palavras,
  post: specInputShape.post,
  respostaPublica: specInputShape.respostaPublica,
  dm: specInputShape.dm,
  botaoDeAbertura: specInputShape.botaoDeAbertura,
  followUp: specInputShape.followUp,
  umaVezPorContato: specInputShape.umaVezPorContato,
};

function specErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Revise os dados da automação.";
  if (issue.code === "invalid_type") {
    const field = String(issue.path[0] ?? "");
    const label = FIELD_NAMES[field];
    return label ? `Preencha o campo "${label}" corretamente.` : "Revise os dados da automação.";
  }
  return issue.message;
}

function parseSpec(input: unknown): { ok: true; spec: AutomationSpec } | { ok: false; error: string } {
  const parsed = automationSpecSchema.safeParse(input);
  if (parsed.success) return { ok: true, spec: parsed.data };
  return { ok: false, error: specErrorMessage(parsed.error) };
}

// ---------------------------------------------------------------- conversão para o banco

/**
 * O grafo do formato simples usa ids curtos e determinísticos ("t", "m1"); o banco guarda
 * nodes/edges com id uuid, então cada envio ganha ids novos.
 */
function withUuidIds(graph: AutomationGraph): AutomationGraph {
  const ids = new Map(graph.nodes.map((node) => [node.id, randomUUID()]));
  return {
    nodes: graph.nodes.map((node) => ({ ...node, id: ids.get(node.id)! })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      id: randomUUID(),
      source: ids.get(edge.source)!,
      target: ids.get(edge.target)!,
    })),
  };
}

async function validatePost(ctx: McpContext, post: string): Promise<ToolResult | null> {
  if (post === "qualquer") return null;
  const posts = await fetchPosts(ctx);
  if (!posts.ok) return toolError(posts.error);
  if (!posts.posts.some((item) => item.id === post)) return toolError(postNotFound(post));
  return null;
}

function mapSaveError(error: { code?: string; message?: string }): ToolResult {
  if (error.code === "42501") return toolError(NOT_ADMIN);
  if (error.code === "P0002") return toolError(NOT_FOUND);
  if (error.message?.includes("panel_modified")) return toolError(PANEL_MODIFIED);
  if (error.message?.includes("not_mcp_automation")) return toolError(PANEL_CREATED);
  if (error.code === "22023") return toolError("A automação não passou na validação do FlowAI. Revise os campos e tente de novo.");
  console.error("mcp automations: save failed", error.code ?? "unknown");
  return toolError(SAVE_FAILED);
}

async function saveSpec(
  ctx: McpContext,
  spec: AutomationSpec,
  id: string | null,
  confirmOverwrite: boolean,
): Promise<{ ok: true; id: string } | { ok: false; error: ToolResult }> {
  const trigger = specToTrigger(spec, { channelId: channelId(ctx) });
  const graph = withUuidIds(specToGraph(spec, { channelId: channelId(ctx) }));
  const { data, error } = await ctx.supabase.rpc("save_mcp_automation", {
    p_org: ctx.orgId,
    // A RPC aceita null (criação); os tipos gerados não marcam o argumento como opcional.
    p_id: (id ?? null) as unknown as string,
    p_name: spec.nome,
    p_spec: spec as never,
    p_trigger_type: trigger.type as never,
    p_trigger_config: trigger.config as never,
    p_graph: graph as never,
    p_confirm_overwrite: confirmOverwrite,
  });
  if (error) return { ok: false, error: mapSaveError(error) };
  return { ok: true, id: data as string };
}

async function mutationError(
  scope: string,
  error: { code?: string },
  fallback: string,
): Promise<ToolResult> {
  if (error.code === "42501") return toolError(NOT_ADMIN);
  if (error.code === "P0002") return toolError(NOT_FOUND);
  return dbError(scope, error, fallback);
}

// ---------------------------------------------------------------- leitura e aviso de sobreposição

async function findAutomation(
  ctx: McpContext,
  id: string,
): Promise<{ ok: true; row: AutomationRow } | { ok: false; error: ToolResult }> {
  const { data, error } = await ctx.supabase
    .from("automations")
    .select("id, name, status, trigger_type, trigger_config, mcp_spec, mcp_spec_stale")
    .eq("organization_id", ctx.orgId)
    .eq("id", id)
    .limit(1);
  if (error) return { ok: false, error: dbError("automations: lookup failed", error, NOT_FOUND) };
  const row = data?.[0];
  if (!row) return { ok: false, error: toolError(NOT_FOUND) };
  return { ok: true, row: row as AutomationRow };
}

type Overlap = { id: string; name: string };

function wordsSignature(config: Record<string, unknown> | null): string {
  const keywords = config && Array.isArray(config.keywords) ? config.keywords : [];
  const list = keywords.filter((word): word is string => typeof word === "string").map((word) => word.trim().toLowerCase());
  const anyKeyword = config?.anyKeyword === true || list.filter(Boolean).length === 0;
  return anyKeyword ? "*" : [...new Set(list.filter(Boolean))].sort().join("|");
}

/** Mesmo gatilho + palavras + post, no vocabulário do motor. */
function triggerSignature(trigger: Trigger): string | null {
  if (trigger.type === "instagram_comment") {
    const media = typeof trigger.config.mediaId === "string" && trigger.config.mediaId ? trigger.config.mediaId : "*";
    return `comment:${wordsSignature(trigger.config)}:${media}`;
  }
  if (trigger.type === "keyword_detected") return `dm:${wordsSignature(trigger.config)}`;
  if (trigger.type === "instagram_story") return "story";
  return null;
}

async function activeOverlaps(ctx: McpContext, trigger: Trigger, excludeId: string | null): Promise<Overlap[]> {
  const wanted = triggerSignature(trigger);
  if (!wanted) return [];
  const { data, error } = await ctx.supabase
    .from("automations")
    .select("id, name, trigger_type, trigger_config")
    .eq("organization_id", ctx.orgId)
    .eq("status", "active");
  if (error) {
    // Aviso é acessório: não impede criar/ativar.
    console.error("mcp automations: overlap query failed", error.code ?? "unknown");
    return [];
  }
  return (data ?? [])
    .filter((row) => row.id !== excludeId)
    .filter(
      (row) =>
        triggerSignature({
          type: row.trigger_type,
          config: (row.trigger_config ?? {}) as Record<string, unknown>,
        }) === wanted,
    )
    .map((row) => ({ id: row.id, name: row.name }));
}

function overlapNote(matches: Overlap[]): string {
  if (!matches.length) return "";
  const names = matches.map((match) => `"${match.name}"`).join(", ");
  const verb = matches.length === 1 ? "já está ativa" : "já estão ativas";
  return `\n\nAtenção: ${names} ${verb} com o mesmo gatilho, palavras e post. As automações podem disparar para o mesmo contato — ajuste as palavras ou pause uma delas.`;
}

type AutomationItem = {
  id: string;
  nome: string;
  status: string;
  gatilho: string;
  palavras: string[];
  post: string | null;
  criadaPeloClaude: boolean;
  alteradaNoPainel: boolean;
};

function specItem(id: string, spec: AutomationSpec, status: string, stale = false): AutomationItem {
  return {
    id,
    nome: spec.nome,
    status: statusLabel(status),
    gatilho: spec.gatilho,
    palavras: spec.palavras,
    post: spec.gatilho === "comentario" ? spec.post : null,
    criadaPeloClaude: true,
    alteradaNoPainel: stale,
  };
}

function rowItem(row: AutomationRow, status: string) {
  return { id: row.id, nome: row.name, status: statusLabel(status) };
}

// ---------------------------------------------------------------- ferramentas

export function registerAutomationWriteTools(server: McpServer, ctx: McpContext): void {
  registerTool(
    server,
    "criar_automacao",
    {
      description:
        "Cria uma automação de DM do Instagram no formato simples e, por padrão, já a ativa. Use quando o usuário pedir " +
        "para responder comentários, mensagens diretas ou respostas a story com uma DM (com texto, botões, resposta " +
        "pública e follow-up opcionais). Confirme nome, gatilho e palavras no resumo devolvido.",
      inputSchema: {
        ...specInputShape,
        ativar: z.boolean().optional().describe("Ativa a automação logo depois de criar (padrão true)."),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ ativar = true, ...rest }) => {
      if (!isAdmin(ctx)) return toolError(NOT_ADMIN);
      const parsed = parseSpec({ ...rest, botaoDeAbertura: rest.botaoDeAbertura ?? undefined, followUp: rest.followUp ?? undefined });
      if (!parsed.ok) return toolError(parsed.error);
      const spec = parsed.spec;
      if (spec.gatilho !== "dm" && !ctx.channel) return toolError(NO_CHANNEL);
      const postError = await validatePost(ctx, spec.post);
      if (postError) return postError;

      const overlaps = await activeOverlaps(ctx, specToTrigger(spec, { channelId: channelId(ctx) }), null);
      const saved = await saveSpec(ctx, spec, null, false);
      if (!saved.ok) return saved.error;

      let status = "draft";
      if (ativar) {
        const { error } = await ctx.supabase.rpc("activate_automation", { p_id: saved.id });
        if (error) {
          if (error.code === "42501") {
            return toolError(`Automação "${spec.nome}" foi criada como rascunho, mas você não tem permissão para ativá-la.`);
          }
          console.error("mcp automations: activate after create failed", error.code ?? "unknown");
          return toolError(`Automação "${spec.nome}" foi criada como rascunho, mas não foi possível ativá-la agora. Ative no painel do FlowAI.`);
        }
        status = "active";
      }

      const headline = ativar ? `Automação "${spec.nome}" criada e ativa.` : `Automação "${spec.nome}" criada como rascunho.`;
      return toolOk(`${headline}\n\n${summarizeSpec(spec)}${overlapNote(overlaps)}`, {
        automacao: specItem(saved.id, spec, status),
      });
    },
  );

  registerTool(
    server,
    "editar_automacao",
    {
      description:
        "Edita uma automação criada pelo Claude, mudando só os campos enviados em alteracoes (os demais são mantidos). " +
        "Use quando o usuário quiser trocar palavras, mensagem, botões, resposta pública ou follow-up. Automações criadas " +
        "no painel não podem ser editadas; se o painel alterou a automação, peça confirmação e use confirmarSobrescrever: true.",
      inputSchema: {
        id: z.uuid("id deve ser o id de uma automação.").describe("Id da automação (veja em listar_automacoes)."),
        alteracoes: z.object(patchInputShape).describe("Somente os campos que mudam, no formato simples."),
        confirmarSobrescrever: z
          .boolean()
          .optional()
          .describe("true = substitui as alterações feitas no painel depois que o Claude criou a automação."),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ id, alteracoes, confirmarSobrescrever }) => {
      if (!isAdmin(ctx)) return toolError(NOT_ADMIN);
      if (Object.values(alteracoes).every((value) => value === undefined)) return toolError(EMPTY_PATCH);
      const found = await findAutomation(ctx, id);
      if (!found.ok) return found.error;
      const { row } = found;
      if (row.mcp_spec === null) return toolError(PANEL_CREATED);
      if (row.mcp_spec_stale && !confirmarSobrescrever) return toolError(PANEL_MODIFIED);

      const base = automationSpecSchema.safeParse(row.mcp_spec);
      if (!base.success) return toolError(INVALID_SPEC);
      const merged = parseSpec(mergeSpec(base.data, alteracoes as SpecPatch));
      if (!merged.ok) return toolError(merged.error);
      const spec = merged.spec;
      if (spec.gatilho !== "dm" && !ctx.channel) return toolError(NO_CHANNEL);
      const postError = await validatePost(ctx, spec.post);
      if (postError) return postError;

      const trigger = specToTrigger(spec, { channelId: channelId(ctx) });
      const overlaps = await activeOverlaps(ctx, trigger, id);
      const saved = await saveSpec(ctx, spec, id, Boolean(confirmarSobrescrever));
      if (!saved.ok) return saved.error;

      const status = row.status === "active" || row.status === "paused" ? row.status : "draft";
      const changed = Object.entries(alteracoes)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => FIELD_NAMES[key] ?? key)
        .join(", ");
      const headline = `Automação "${spec.nome}" atualizada${changed ? ` (${changed})` : ""}.`;
      return toolOk(`${headline}\n\n${summarizeSpec(spec)}${overlapNote(overlaps)}`, {
        automacao: specItem(id, spec, status, Boolean(confirmarSobrescrever)),
      });
    },
  );

  registerTool(
    server,
    "pausar_automacao",
    {
      description:
        "Pausa uma automação (do Claude ou do painel) para ela parar de disparar sem ser excluída. Use quando o usuário " +
        "pedir para parar, desligar ou pausar uma automação; confirme o nome no resumo.",
      inputSchema: {
        id: z.uuid("id deve ser o id de uma automação.").describe("Id da automação (veja em listar_automacoes)."),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ id }) => {
      if (!isAdmin(ctx)) return toolError(NOT_ADMIN);
      const found = await findAutomation(ctx, id);
      if (!found.ok) return found.error;
      const { row } = found;
      if (row.status !== "active") {
        return toolOk(`Automação "${row.name}" já está ${statusLabel(row.status)}.`, { automacao: rowItem(row, row.status) });
      }
      const { error } = await ctx.supabase.rpc("pause_automation", { p_id: id });
      if (error) return mutationError("automations: pause failed", error, "Não foi possível pausar a automação agora. Tente novamente em instantes.");
      return toolOk(`Automação "${row.name}" pausada.`, { automacao: rowItem(row, "paused") });
    },
  );

  registerTool(
    server,
    "ativar_automacao",
    {
      description:
        "Ativa uma automação pausada ou rascunho (do Claude ou do painel). Use quando o usuário pedir para ligar, ativar " +
        "ou religar uma automação; o resumo avisa se outra automação ativa usa o mesmo gatilho e palavras.",
      inputSchema: {
        id: z.uuid("id deve ser o id de uma automação.").describe("Id da automação (veja em listar_automacoes)."),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ id }) => {
      if (!isAdmin(ctx)) return toolError(NOT_ADMIN);
      const found = await findAutomation(ctx, id);
      if (!found.ok) return found.error;
      const { row } = found;
      if (row.status === "active") {
        return toolOk(`Automação "${row.name}" já está ativa.`, { automacao: rowItem(row, "active") });
      }
      const trigger: Trigger = { type: row.trigger_type, config: (row.trigger_config ?? {}) as Record<string, unknown> };
      const overlaps = await activeOverlaps(ctx, trigger, id);
      const { error } = await ctx.supabase.rpc("activate_automation", { p_id: id });
      if (error) {
        return mutationError(
          "automations: activate failed",
          error,
          "Não foi possível ativar a automação agora. Revise a automação no painel do FlowAI.",
        );
      }
      return toolOk(`Automação "${row.name}" ativada.${overlapNote(overlaps)}`, { automacao: rowItem(row, "active") });
    },
  );

  registerTool(
    server,
    "excluir_automacao",
    {
      description:
        "Exclui uma automação definitivamente (do Claude ou do painel). Só use depois de o usuário confirmar claramente; " +
        "envie confirmar: true. Para apenas parar os disparos, prefira pausar_automacao.",
      inputSchema: {
        id: z.uuid("id deve ser o id de uma automação.").describe("Id da automação (veja em listar_automacoes)."),
        confirmar: z.boolean().optional().describe("true = confirma a exclusão definitiva."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ id, confirmar }) => {
      if (!isAdmin(ctx)) return toolError(NOT_ADMIN);
      if (confirmar !== true) return toolError(DELETE_CONFIRM);
      const found = await findAutomation(ctx, id);
      if (!found.ok) return found.error;
      const { row } = found;
      const { error } = await ctx.supabase.rpc("delete_automation", { p_id: id });
      if (error) return mutationError("automations: delete failed", error, "Não foi possível excluir a automação agora. Tente novamente em instantes.");
      return toolOk(`Automação "${row.name}" excluída definitivamente.`, {
        automacao: { id: row.id, nome: row.name, excluida: true },
      });
    },
  );
}
