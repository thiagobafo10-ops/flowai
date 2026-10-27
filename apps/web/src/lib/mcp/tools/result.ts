import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

/** Resultado de ferramenta MCP (texto legível + dados estruturados, ou erro). */
export type ToolResult = CallToolResult;

const UNEXPECTED = "Não foi possível concluir agora. Tente novamente em instantes.";

/** Erro como resultado de ferramenta: mensagem curta em pt-BR, sem detalhes internos. */
export function toolError(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function toolOk(text: string, structuredContent: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent };
}

/** Erro de banco/RPC: só o código vai para o log; a IA recebe a mensagem fixa. */
export function dbError(scope: string, error: { code?: string } | null, message: string): ToolResult {
  console.error(`mcp ${scope}: query failed`, error?.code ?? "unknown");
  return toolError(message);
}

type ToolConfig<Shape extends z.ZodRawShape> = {
  description: string;
  inputSchema: Shape;
  annotations?: ToolAnnotations;
};

/**
 * Registra uma ferramenta; exceções inesperadas viram `toolError` genérico
 * (nunca stack trace nem mensagem interna para o cliente).
 */
export function registerTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: ToolConfig<Shape>,
  handler: (args: z.output<z.ZodObject<Shape>>) => Promise<ToolResult>,
): void {
  const callback = async (args: z.output<z.ZodObject<Shape>>): Promise<ToolResult> => {
    try {
      return await handler(args);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
      console.error(`mcp ${name}: unexpected failure`, code);
      return toolError(UNEXPECTED);
    }
  };
  // O SDK infere os argumentos a partir do shape; o cast evita a recursão de tipos do Zod.
  server.registerTool(name, config, callback as never);
}
