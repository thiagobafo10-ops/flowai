import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../context";
import { dbError, registerTool, toolOk } from "./result";

const DEFAULT_LIMIT = 20;
const LOAD_ERROR = "Não foi possível carregar os contatos agora. Tente novamente em instantes.";

type ContactRow = { id?: unknown; name?: unknown; username?: unknown; lastInteractionAt?: unknown; automations?: unknown };

function toContact(row: ContactRow) {
  const username = typeof row.username === "string" && row.username ? `@${row.username}` : null;
  return {
    id: String(row.id ?? ""),
    nome: typeof row.name === "string" ? row.name : null,
    usuario: username,
    ultimaInteracao: typeof row.lastInteractionAt === "string" ? row.lastInteractionAt : null,
    automacoes: Array.isArray(row.automations) ? row.automations.filter((n): n is string => typeof n === "string") : [],
  };
}

type Contact = ReturnType<typeof toContact>;

function describe(c: Contact): string {
  const who = [c.nome, c.usuario].filter(Boolean).join(" ") || "(sem nome)";
  const last = c.ultimaInteracao ? ` · última interação ${c.ultimaInteracao}` : "";
  const autos = c.automacoes.length ? ` · recebeu: ${c.automacoes.join(", ")}` : "";
  return `• ${who}${last}${autos}`;
}

export function registerContactTools(server: McpServer, ctx: McpContext): void {
  registerTool(
    server,
    "listar_contatos",
    {
      description:
        "Lista os contatos que interagiram com a conta (nome, @usuário, última interação e automações que receberam), " +
        "do mais recente ao mais antigo. Use para saber quem recebeu uma automação, procurar uma pessoa pelo nome ou @, " +
        "ou ver quem interagiu por último.",
      inputSchema: {
        busca: z.string().max(100, "busca deve ter até 100 caracteres.").optional().describe("Parte do nome ou do @usuário."),
        automacaoId: z.uuid("automacaoId deve ser o id de uma automação.").optional().describe("Só contatos que receberam esta automação."),
        limite: z
          .number()
          .int("limite deve ser um número inteiro.")
          .min(1, "limite deve ser de 1 a 100.")
          .max(100, "limite deve ser de 1 a 100.")
          .optional()
          .describe(`Quantidade de contatos, de 1 a 100 (padrão ${DEFAULT_LIMIT}).`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ busca, automacaoId, limite }) => {
      const search = busca?.trim() ? busca.trim() : null;
      // p_search/p_automation aceitam null no banco (filtro desligado); os tipos gerados não marcam isso.
      const { data, error } = await ctx.supabase.rpc("mcp_contacts", {
        p_org: ctx.orgId,
        p_search: search as string,
        p_automation: (automacaoId ?? null) as string,
        p_limit: limite ?? DEFAULT_LIMIT,
      });
      if (error) return dbError("listar_contatos", error, LOAD_ERROR);
      const contatos = (Array.isArray(data) ? (data as ContactRow[]) : []).map(toContact);
      const text = contatos.length ? contatos.map(describe).join("\n") : "Nenhum contato encontrado.";
      return toolOk(text, { contatos });
    },
  );
}
