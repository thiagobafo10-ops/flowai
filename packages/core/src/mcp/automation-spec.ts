import { z } from "zod";
import {
  PUBLIC_REPLY_MAX_ITEMS,
  PUBLIC_REPLY_MAX_LENGTH,
  type AutomationGraph,
  type TriggerType,
} from "../automation/schemas.ts";

/**
 * Formato simples de automação operado pelo Claude via MCP (spec §2).
 * `specToGraph` / `specToTrigger` o convertem no grafo e no gatilho normais do motor.
 */

export const SPEC_DM_MAX_BYTES = 1000;
export const SPEC_FOLLOWUP_MIN_MINUTES = 1;
export const SPEC_FOLLOWUP_MAX_MINUTES = 10080;
const BUTTON_TEXT_MAX_CHARS = 640;
export const DEFAULT_OPENING_BUTTON = "Quero!";

const DURATION_REGEX = /^\s*(\d+)\s*(min|m|h|d)\s*$/;
const UNIT_MINUTES = { min: 1, m: 1, h: 60, d: 1440 } as const;

/** "2h" → 120, "30min" → 30, "1d" → 1440. Fora de 1 min–7 dias ou formato inválido → null. */
export function parseDuration(text: string): number | null {
  const match = DURATION_REGEX.exec(text);
  if (!match) return null;
  const minutes = Number(match[1]) * UNIT_MINUTES[match[2] as keyof typeof UNIT_MINUTES];
  if (!Number.isSafeInteger(minutes) || minutes < SPEC_FOLLOWUP_MIN_MINUTES || minutes > SPEC_FOLLOWUP_MAX_MINUTES) return null;
  return minutes;
}

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

const buttonTitle = z.string().trim().min(1, "Informe o título do botão.").max(20, "O título do botão deve ter no máximo 20 caracteres.");

const linkUrl = z
  .string()
  .trim()
  .max(2000, "URL muito longa.")
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use uma URL https válida.");

const linkButtonSchema = z.object({ titulo: buttonTitle, url: linkUrl });
const linkButtonsSchema = z.array(linkButtonSchema).max(3, "Máximo de 3 botões.");

const messageText = z
  .string()
  .trim()
  .min(1, "Informe o texto da mensagem.")
  .refine((v) => utf8Bytes(v) <= SPEC_DM_MAX_BYTES, `O texto deve ter no máximo ${SPEC_DM_MAX_BYTES} bytes (cerca de 1000 caracteres sem acentos).`);

const dmSchema = z.object({ texto: messageText, botoes: linkButtonsSchema.default([]) });

const followUpSchema = z.object({
  depois: z
    .string()
    .refine((v) => parseDuration(v) !== null, "Informe a espera entre 1 minuto e 7 dias, como 30min, 2h ou 1d."),
  texto: messageText,
  botoes: linkButtonsSchema.default([]),
});

export const automationSpecSchema = z
  .object({
    nome: z.string().trim().min(1, "Informe o nome da automação.").max(100, "O nome deve ter no máximo 100 caracteres."),
    gatilho: z.enum(["comentario", "dm", "story"], { message: 'O gatilho deve ser "comentario", "dm" ou "story".' }),
    palavras: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Informe a palavra.")
          .max(100, "Máximo de 100 caracteres por palavra."),
      )
      .max(20, "Máximo de 20 palavras.")
      .default([]),
    post: z.string().trim().min(1, "Informe o id do post ou use \"qualquer\".").default("qualquer"),
    respostaPublica: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Informe o texto da resposta.")
          .max(PUBLIC_REPLY_MAX_LENGTH, "A resposta pública deve ter no máximo 300 caracteres."),
      )
      .max(PUBLIC_REPLY_MAX_ITEMS, "Máximo de 10 respostas públicas.")
      .default([]),
    dm: dmSchema,
    botaoDeAbertura: buttonTitle.optional(),
    followUp: followUpSchema.optional(),
    umaVezPorContato: z.boolean().default(true),
  })
  .superRefine((spec, ctx) => {
    if (spec.gatilho !== "comentario") {
      if (spec.respostaPublica.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["respostaPublica"],
          message: "A resposta pública só existe para o gatilho de comentário.",
        });
      }
      if (spec.post !== "qualquer") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["post"],
          message: "Escolher um post só vale para o gatilho de comentário.",
        });
      }
    }
    // Limite do Instagram: mensagens com botões aceitam até 640 caracteres (validate.ts / instagram.ts).
    const opening = spec.gatilho === "comentario" && !!spec.followUp;
    if ((spec.dm.botoes.length > 0 || opening) && [...spec.dm.texto].length > BUTTON_TEXT_MAX_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dm", "texto"],
        message: "Com botões, o texto deve ter no máximo 640 caracteres.",
      });
    }
    if (spec.followUp && spec.followUp.botoes.length > 0 && [...spec.followUp.texto].length > BUTTON_TEXT_MAX_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["followUp", "texto"],
        message: "Com botões, o texto deve ter no máximo 640 caracteres.",
      });
    }
  });

export type AutomationSpec = z.infer<typeof automationSpecSchema>;
export type AutomationSpecInput = z.input<typeof automationSpecSchema>;

export type SpecPatch = Omit<Partial<AutomationSpec>, "followUp" | "botaoDeAbertura"> & {
  followUp?: AutomationSpec["followUp"] | null;
  botaoDeAbertura?: string | null;
};

/**
 * Patch raso: `dm` e `followUp` são substituídos inteiros; `followUp: null` e `botaoDeAbertura: null` removem.
 * O resultado NÃO é validado: quem chama deve usar `automationSpecSchema.parse(mergeSpec(...))` antes de `specToGraph`.
 */
export function mergeSpec(base: AutomationSpec, patch: SpecPatch): AutomationSpec {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if ((key === "followUp" || key === "botaoDeAbertura") && value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged as AutomationSpec;
}

const GATILHO_LABEL: Record<AutomationSpec["gatilho"], string> = {
  comentario: "comentário no Instagram",
  dm: "mensagem direta (DM)",
  story: "resposta a story",
};

/** Resumo em pt-BR de 1 a 6 linhas, para o Claude confirmar com o usuário. */
export function summarizeSpec(spec: AutomationSpec): string {
  const lines: string[] = [];
  const words = spec.palavras.length ? `com as palavras: ${spec.palavras.join(", ")}` : "com qualquer texto";
  lines.push(`"${spec.nome}": dispara em ${GATILHO_LABEL[spec.gatilho]} ${words}.`);
  if (spec.gatilho === "comentario") {
    lines.push(spec.post === "qualquer" ? "Vale para qualquer post." : `Vale só para o post ${spec.post}.`);
    if (spec.respostaPublica.length) lines.push(`Responde publicamente ao comentário (${spec.respostaPublica.length} variação(ões)).`);
  }
  const links = spec.dm.botoes.length ? ` com ${spec.dm.botoes.length} botão(ões) de link` : "";
  lines.push(`Envia uma DM${links}.`);
  if (spec.followUp) lines.push(`Follow-up após ${spec.followUp.depois}.`);
  lines.push(spec.umaVezPorContato ? "Dispara uma vez por contato." : "Pode disparar mais de uma vez por contato.");
  return lines.join("\n");
}

type Ctx = { channelId: string };
export type SpecTrigger = { type: TriggerType; config: Record<string, unknown> };

/** Gatilho (tipo + config) que acompanha o grafo, no formato do motor. */
export function specToTrigger(spec: AutomationSpec, ctx: Ctx): SpecTrigger {
  const words = spec.palavras.length
    ? { keywords: spec.palavras, mode: "contains" as const }
    : { anyKeyword: true, keywords: [] as string[], mode: "any" as const };
  const oncePerUser = spec.umaVezPorContato;
  if (spec.gatilho === "story") return { type: "instagram_story", config: { channelId: ctx.channelId, oncePerUser } };
  if (spec.gatilho === "dm") return { type: "keyword_detected", config: { ...words, oncePerUser } };
  return {
    type: "instagram_comment",
    config: {
      channelId: ctx.channelId,
      mediaId: spec.post === "qualquer" ? null : spec.post,
      ...words,
      oncePerUser,
      ...(spec.respostaPublica.length ? { publicReplies: spec.respostaPublica } : {}),
    },
  };
}

const OPENING_BUTTON_ID = "quero";
const LINKS_TEXT = "Aqui está, {primeiro_nome}! Toque no botão para acessar.";

type LinkButton = { titulo: string; url: string };
const urlButtons = (prefix: string, list: LinkButton[]) =>
  list.map((b, i) => ({ id: `${prefix}${i + 1}`, title: b.titulo, kind: "url" as const, url: b.url }));

const textMessage = (text: string, buttons: ReturnType<typeof urlButtons> | { id: string; title: string; kind: "path" }[]) => ({
  mode: "text" as const,
  text,
  ...(buttons.length ? { buttons } : {}),
  replyTimeoutHours: 24,
});

/** Converte o formato simples no grafo do motor (ids determinísticos, posições em coluna). */
export function specToGraph(spec: AutomationSpec, _ctx: Ctx): AutomationGraph {
  const nodes: AutomationGraph["nodes"] = [];
  const edges: AutomationGraph["edges"] = [];
  const add = (id: string, type: AutomationGraph["nodes"][number]["type"], config: unknown) =>
    nodes.push({ id, type, config, position: { x: 0, y: nodes.length * 160 } });
  const link = (source: string, target: string, sourceHandle: string) =>
    edges.push({ id: `e${edges.length + 1}`, source, target, sourceHandle });

  const followUpMinutes = spec.followUp ? parseDuration(spec.followUp.depois) : null;
  if (spec.followUp && followUpMinutes === null) {
    throw new Error(`Espera do follow-up inválida ("${spec.followUp.depois}"): use entre 1 minuto e 7 dias, como 30min, 2h ou 1d.`);
  }
  // Regra da Meta: após a Private Reply só cabe uma mensagem até a pessoa interagir → botão de abertura.
  const needsOpening = spec.gatilho === "comentario" && !!spec.followUp;

  add("t", "trigger", {});
  let tail = "t";

  if (needsOpening) {
    add("m1", "message", textMessage(spec.dm.texto, [{ id: OPENING_BUTTON_ID, title: spec.botaoDeAbertura ?? DEFAULT_OPENING_BUTTON, kind: "path" }]));
    link("t", "m1", "default");
    add("m2", "message", textMessage(LINKS_TEXT, urlButtons("l", spec.dm.botoes)));
    link("m1", "m2", `opt:${OPENING_BUTTON_ID}`);
    link("m1", "e", "no_reply");
    tail = "m2";
  } else {
    add("m1", "message", textMessage(spec.dm.texto, urlButtons("l", spec.dm.botoes)));
    link("t", "m1", "default");
    tail = "m1";
  }

  if (spec.followUp && followUpMinutes !== null) {
    add("d1", "delay", { minutes: followUpMinutes });
    link(tail, "d1", "default");
    add("m3", "message", textMessage(spec.followUp.texto, urlButtons("f", spec.followUp.botoes)));
    link("d1", "m3", "default");
    tail = "m3";
  }

  add("e", "end", {});
  link(tail, "e", "default");
  return { nodes, edges };
}
