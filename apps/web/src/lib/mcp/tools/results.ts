import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../context";
import { statusLabel } from "./automations-read";
import { dbError, registerTool, toolError, toolOk } from "./result";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_ERROR = `O período máximo é de ${MAX_DAYS} dias, e "de" deve ser anterior a "ate".`;
const LOAD_ERROR = "Não foi possível carregar os resultados agora. Tente novamente em instantes.";

const dateInput = (field: string) =>
  z
    .string()
    .max(40)
    .refine((v) => !Number.isNaN(Date.parse(v)), `${field} deve ser uma data AAAA-MM-DD ou ISO 8601.`);

/** Data AAAA-MM-DD vale o dia inteiro (UTC): início para "de", fim para "ate". */
function parseDate(value: string, edge: "start" | "end"): Date {
  if (DATE_ONLY.test(value)) return new Date(`${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  return new Date(value);
}

type ButtonRow = { title?: unknown; kind?: unknown; clicks?: unknown };
type ResultRow = {
  automationId?: unknown;
  name?: unknown;
  status?: unknown;
  runs?: unknown;
  dmsSent?: unknown;
  publicReplies?: unknown;
  uniqueContacts?: unknown;
  clicks?: { total?: unknown; byButton?: unknown };
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

function toResult(row: ResultRow) {
  const buttons: ButtonRow[] = Array.isArray(row.clicks?.byButton) ? row.clicks.byButton : [];
  return {
    id: String(row.automationId ?? ""),
    nome: String(row.name ?? ""),
    status: statusLabel(String(row.status ?? "")),
    disparos: num(row.runs),
    dmsEnviadas: num(row.dmsSent),
    respostasPublicas: num(row.publicReplies),
    contatosUnicos: num(row.uniqueContacts),
    cliques: {
      total: num(row.clicks?.total),
      porBotao: buttons.map((b) => ({
        titulo: String(b.title ?? ""),
        tipo: b.kind === "path" ? "caminho" : "link",
        cliques: num(b.clicks),
      })),
    },
  };
}

type AutomationResult = ReturnType<typeof toResult>;

function describe(r: AutomationResult): string {
  const buttons = r.cliques.porBotao.length
    ? ` (${r.cliques.porBotao.map((b) => `${b.titulo}: ${b.cliques}`).join(", ")})`
    : "";
  return (
    `• ${r.nome} (id: ${r.id}, ${r.status}) — ${r.disparos} disparo(s), ${r.dmsEnviadas} DM(s) enviada(s), ` +
    `${r.respostasPublicas} resposta(s) pública(s), ${r.cliques.total} clique(s)${buttons}, ${r.contatosUnicos} contato(s) único(s)`
  );
}

export function registerResultTools(server: McpServer, ctx: McpContext): void {
  registerTool(
    server,
    "ver_resultados",
    {
      description:
        "Mostra os resultados das automações num período: disparos, DMs enviadas, respostas públicas, cliques por botão " +
        "e contatos únicos. Use quando o usuário perguntar como uma automação está indo, quantas pessoas receberam a DM " +
        `ou clicaram no link. Padrão: últimos ${DEFAULT_DAYS} dias; período máximo de ${MAX_DAYS} dias.`,
      inputSchema: {
        automacaoId: z.uuid("automacaoId deve ser o id de uma automação.").optional().describe("Id da automação (sem ele, mostra todas)."),
        de: dateInput("de").optional().describe("Início do período (AAAA-MM-DD ou ISO 8601)."),
        ate: dateInput("ate").optional().describe("Fim do período (AAAA-MM-DD ou ISO 8601). Padrão: agora."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ automacaoId, de, ate }) => {
      const to = ate ? parseDate(ate, "end") : new Date();
      const from = de ? parseDate(de, "start") : new Date(to.getTime() - DEFAULT_DAYS * DAY_MS);
      if (from > to || to.getTime() - from.getTime() > MAX_DAYS * DAY_MS) return toolError(PERIOD_ERROR);

      const args = {
        p_org: ctx.orgId,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
        ...(automacaoId ? { p_automation: automacaoId } : {}),
      };
      const { data, error } = await ctx.supabase.rpc("automation_results", args);
      if (error) {
        if (error.code === "22023") return toolError(PERIOD_ERROR);
        return dbError("ver_resultados", error, LOAD_ERROR);
      }
      const rows: ResultRow[] = Array.isArray(data) ? (data as ResultRow[]) : [];
      const automacoes = rows.map(toResult);
      const periodo = { de: args.p_from, ate: args.p_to };
      const header = `Resultados de ${periodo.de} a ${periodo.ate}:`;
      const text = automacoes.length
        ? `${header}\n${automacoes.map(describe).join("\n")}`
        : automacaoId
          ? "Automação não encontrada."
          : `${header}\nNenhuma automação encontrada.`;
      return toolOk(text, { periodo, automacoes });
    },
  );
}
