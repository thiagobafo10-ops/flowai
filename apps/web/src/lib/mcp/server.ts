import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./context";
import { registerAutomationReadTools } from "./tools/automations-read";
import { registerContactTools } from "./tools/contacts";
import { registerPostTools } from "./tools/posts";
import { registerResultTools } from "./tools/results";

export { registerTool, toolError, toolOk, type ToolResult } from "./tools/result";

const INSTRUCTIONS =
  "Servidor do FlowAI para gerenciar automações de DM do Instagram da conta conectada. " +
  "Use listar_posts para achar o id de um post, listar_automacoes para ver o que já existe, " +
  "ver_resultados para números e listar_contatos para pessoas.";

/** Um servidor por requisição (modo sem sessão), com as ferramentas ligadas ao contexto do usuário. */
export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: "flowai", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  registerPostTools(server, ctx);
  registerAutomationReadTools(server, ctx);
  registerResultTools(server, ctx);
  registerContactTools(server, ctx);
  return server;
}
