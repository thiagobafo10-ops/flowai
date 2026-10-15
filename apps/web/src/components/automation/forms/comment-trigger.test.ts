import { expect, test } from "vitest";
import { triggerConfigSchemas } from "@flowai/core";
import { triggerToConfig, triggerToValues } from "./mappings";
import { defaultTriggerConfig } from "@/lib/automation/node-labels";

const channelId = "00000000-0000-4000-8000-000000000001";

test("gatilho de comentário novo inicia com canal e palavras-chave vazias", () => {
  expect(defaultTriggerConfig("instagram_comment", channelId)).toEqual({
    channelId,
    mediaId: null,
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

  const config = triggerToConfig("instagram_comment", values);
  expect(config).toEqual({
    channelId,
    mediaId: null,
    anyKeyword: true,
    keywords: [],
    mode: "any",
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
