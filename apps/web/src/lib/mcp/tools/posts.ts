import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../context";
import { instagramActionMessage } from "@/lib/instagram/messages";
import { registerTool, toolError, toolOk } from "./result";

export const NO_CHANNEL = "Nenhuma conta do Instagram conectada. Conecte a conta em Canais no painel do FlowAI.";
const CAPTION_MAX = 300;
const FALLBACK = "Não foi possível listar os posts do Instagram agora. Tente novamente em instantes.";

const EDGE_ERRORS: Record<string, string> = {
  forbidden: "Só administradores da organização podem listar os posts do Instagram.",
};

type Media = { id?: unknown; caption?: unknown; mediaType?: unknown; permalink?: unknown; timestamp?: unknown };
export type PostItem = { id: string; legenda: string; tipo: string; data: string | null; link: string | null };

function edgeMessage(code: unknown): string {
  if (typeof code === "string" && Object.hasOwn(EDGE_ERRORS, code)) return EDGE_ERRORS[code];
  const known = instagramActionMessage(code);
  return known === instagramActionMessage(undefined) ? FALLBACK : known;
}

function toPost(item: Media): PostItem {
  const caption = typeof item.caption === "string" ? item.caption : "";
  return {
    id: String(item.id ?? ""),
    legenda: caption.slice(0, CAPTION_MAX),
    tipo: typeof item.mediaType === "string" ? item.mediaType : "IMAGE",
    data: typeof item.timestamp === "string" ? item.timestamp : null,
    link: typeof item.permalink === "string" ? item.permalink : null,
  };
}

/** Lista os posts pela ação `list_media` da Edge `meta-connection`, com o JWT do usuário. */
export async function fetchPosts(ctx: McpContext): Promise<{ ok: true; posts: PostItem[] } | { ok: false; error: string }> {
  if (!ctx.channel) return { ok: false, error: NO_CHANNEL };
  const { data, error } = await ctx.supabase.functions.invoke("meta-connection", {
    body: { organizationId: ctx.orgId, connectionId: ctx.channel.connectionId, channelId: ctx.channel.id, action: "list_media" },
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
  });
  if (error) {
    let code: unknown;
    try {
      if (error.context instanceof Response) code = (await error.context.clone().json()).error;
    } catch {
      /* resposta genérica */
    }
    return { ok: false, error: edgeMessage(code) };
  }
  if (data?.error) return { ok: false, error: edgeMessage(data.error) };
  const media: Media[] = Array.isArray(data?.media) ? data.media : [];
  return { ok: true, posts: media.filter((m) => m && typeof m === "object").map(toPost).filter((p) => p.id) };
}

export function registerPostTools(server: McpServer, ctx: McpContext): void {
  registerTool(
    server,
    "listar_posts",
    {
      description:
        "Lista os posts mais recentes da conta do Instagram conectada (id, legenda, tipo, data e link). " +
        "Use antes de criar ou editar uma automação de comentário para um post específico, para descobrir o id do post " +
        "que o usuário descreveu (ex.: \"o último reel\", \"o post do ebook\").",
      inputSchema: {
        limite: z
          .number()
          .int("limite deve ser um número inteiro.")
          .min(1, "limite deve ser de 1 a 50.")
          .max(50, "limite deve ser de 1 a 50.")
          .optional()
          .describe("Quantidade de posts, de 1 a 50 (padrão 12)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limite }) => {
      const result = await fetchPosts(ctx);
      if (!result.ok) return toolError(result.error);
      const posts = result.posts.slice(0, limite ?? 12);
      const text = posts.length
        ? posts
            .map((p) => `• ${p.id} — ${p.tipo}${p.data ? ` · ${p.data}` : ""}${p.link ? ` · ${p.link}` : ""}\n  ${p.legenda || "(sem legenda)"}`)
            .join("\n")
        : "Nenhum post encontrado na conta do Instagram.";
      return toolOk(text, { posts });
    },
  );
}
