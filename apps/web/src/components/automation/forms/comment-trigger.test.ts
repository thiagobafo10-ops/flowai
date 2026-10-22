import { expect, test } from "vitest";
import { triggerConfigSchemas } from "@flowai/core";
import { triggerToConfig, triggerToValues } from "./mappings";
import { defaultTriggerConfig } from "@/lib/automation/node-labels";

const channelId = "00000000-0000-4000-8000-000000000001";

test("gatilho de comentário novo inicia com canal e palavras-chave vazias", () => {
  expect(defaultTriggerConfig("instagram_comment", channelId)).toEqual({
    channelId,
    mediaId: null,
    oncePerUser: true,
    keywords: [],
    mode: "contains",
  });
});

test("modo 'qualquer palavra ou comentário' valida sem exigir palavras-chave", () => {
  const values = triggerToValues({
    channelId,
    mediaId: null,
    anyKeyword: true,
    keywords: [],
    mode: "any",
  });

  expect(values.anyKeyword).toBe(true);
  expect(values.mode).toBe("any");
  expect(values.oncePerUser).toBe(true);

  const config = triggerToConfig("instagram_comment", values);
  expect(config).toEqual({
    channelId,
    mediaId: null,
    oncePerUser: true,
    anyKeyword: true,
    keywords: [],
    mode: "any",
    publicReplies: [],
  });

  const parsed = triggerConfigSchemas.instagram_comment.safeParse(config);
  expect(parsed.success).toBe(true);
});

test("modo específico com palavras-chave vazias falha na validação com mensagem adequada", () => {
  const values = triggerToValues({
    channelId,
    mediaId: null,
    anyKeyword: false,
    keywords: [],
    mode: "contains",
  });

  const config = triggerToConfig("instagram_comment", values);
  const parsed = triggerConfigSchemas.instagram_comment.safeParse(config);
  expect(parsed.success).toBe(false);
  if (!parsed.success) {
    expect(parsed.error.issues[0]?.message).toBe("Informe ao menos uma palavra-chave.");
  }
});

test("seleção de publicação preenche mediaId e permite limpar para qualquer publicação", () => {
  const withMedia = triggerToValues({
    channelId,
    mediaId: "17923847291823",
    anyKeyword: true,
    mode: "any",
  });
  expect(triggerToConfig("instagram_comment", withMedia)).toMatchObject({
    mediaId: "17923847291823",
  });

  const allMedia = triggerToValues({
    channelId,
    mediaId: "",
    anyKeyword: true,
    mode: "any",
  });
  expect(triggerToConfig("instagram_comment", allMedia)).toMatchObject({
    mediaId: null,
  });
});

test("permite desativar oncePerUser para responder a todos os comentários", () => {
  const values = triggerToValues({
    channelId,
    mediaId: "123",
    anyKeyword: true,
    mode: "any",
    oncePerUser: false,
  });
  expect(values.oncePerUser).toBe(false);

  const config = triggerToConfig("instagram_comment", values);
  expect(config).toMatchObject({
    oncePerUser: false,
  });

  const parsed = triggerConfigSchemas.instagram_comment.safeParse(config);
  expect(parsed.success).toBe(true);
});

test("resposta pública: variações entram no config quando o switch está ligado", () => {
  const values = triggerToValues({
    channelId,
    mediaId: null,
    anyKeyword: true,
    mode: "any",
    publicReplies: ["Te mandei no Direct!", "Confere o Direct"],
  });
  expect(values.publicReplyEnabled).toBe(true);
  expect(values.publicReplies).toEqual(["Te mandei no Direct!", "Confere o Direct"]);

  const config = triggerToConfig("instagram_comment", values);
  expect(config).toMatchObject({ publicReplies: ["Te mandei no Direct!", "Confere o Direct"] });
  expect(triggerConfigSchemas.instagram_comment.safeParse(config).success).toBe(true);
});

test("resposta pública: desligar o switch salva lista vazia", () => {
  const values = triggerToValues({
    channelId,
    mediaId: null,
    anyKeyword: true,
    mode: "any",
    publicReplies: ["Te mandei no Direct!"],
  });
  const config = triggerToConfig("instagram_comment", { ...values, publicReplyEnabled: false });
  expect(config).toMatchObject({ publicReplies: [] });
});

test("resposta pública: ausente ou vazia começa desligada; texto em branco falha com mensagem", () => {
  const off = triggerToValues({ channelId, mediaId: null, anyKeyword: true, mode: "any" });
  expect(off.publicReplyEnabled).toBe(false);
  expect(off.publicReplies).toEqual([]);

  const config = triggerToConfig("instagram_comment", { ...off, publicReplyEnabled: true, publicReplies: ["  "] });
  const parsed = triggerConfigSchemas.instagram_comment.safeParse(config);
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe("Informe o texto da resposta.");
});
