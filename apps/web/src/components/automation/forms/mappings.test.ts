import { describe, expect, test } from "vitest";
import { nodeConfigSchemas, triggerConfigSchemas } from "@flowai/core";
import {
  conditionToConfig, conditionToValues, delayToConfig, delayToValues, messageToConfig, messageToValues, triggerToConfig, triggerToValues,
} from "./mappings";

const issues = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues.map((i) => i.message) ?? [];

describe("mensagem", () => {
  test("ida e volta de uma mensagem com botões", () => {
    const config = {
      mode: "text",
      text: "Oi",
      buttons: [
        { id: "quero", title: "Quero", kind: "path" },
        { id: "abrir", title: "Abrir", kind: "url", url: "https://a.com.br" },
      ],
      replyTimeoutHours: 12,
    };
    expect(messageToConfig(messageToValues(config))).toEqual(config);
  });

  test("botão de link sem URL fica sem url e o schema pede a URL", () => {
    const v = messageToValues({ mode: "text", text: "Oi", replyTimeoutHours: 24 });
    const config = messageToConfig({ ...v, options: "buttons", buttons: [{ id: "b1", title: "Site", kind: "url", url: "  " }] });
    expect((config as { buttons: unknown[] }).buttons).toEqual([{ id: "b1", title: "Site", kind: "url" }]);
    expect(issues(nodeConfigSchemas.message.safeParse(config))).toContain("Informe a URL do botão.");
  });

  test("prazo em branco não vira 24 silenciosamente", () => {
    const v = messageToValues({ mode: "text", text: "Oi", quickReplies: [{ id: "a", title: "A" }], replyTimeoutHours: 24 });
    const config = messageToConfig({ ...v, replyTimeoutHours: NaN });
    expect((config as { replyTimeoutHours: unknown }).replyTimeoutHours).toBeNull();
    expect(nodeConfigSchemas.message.safeParse(config).success).toBe(false);
  });

  test("modo IA descarta o resto e opções escondidas não vão para a config", () => {
    const v = messageToValues({ mode: "text", text: "Oi", quickReplies: [{ id: "a", title: "A" }], replyTimeoutHours: 24 });
    expect(messageToConfig({ ...v, mode: "ai" })).toEqual({ mode: "ai" });
    expect(messageToConfig({ ...v, options: "none" })).toEqual({ mode: "text", text: "Oi", replyTimeoutHours: 24 });
  });
});

describe("condição", () => {
  test("dias marcados (texto) viram números ordenados", () => {
    const v = conditionToValues({ kind: "business_hours", days: [1, 2], start: "08:00", end: "12:00" });
    expect(v.days).toEqual(["1", "2"]);
    expect(conditionToConfig({ ...v, days: ["5", "1"] })).toEqual({ kind: "business_hours", days: [1, 5], start: "08:00", end: "12:00" });
  });

  test("pontuação em branco gera erro em vez de valor padrão", () => {
    const config = conditionToConfig({ ...conditionToValues({ kind: "lead_score_gte", value: 30 }), value: NaN });
    expect(config).toEqual({ kind: "lead_score_gte", value: null });
    expect(nodeConfigSchemas.condition.safeParse(config).success).toBe(false);
  });

  test("palavras-chave sem linhas vazias", () => {
    const v = conditionToValues({ kind: "keyword", keywords: ["a"], mode: "equals" });
    expect(conditionToConfig({ ...v, keywords: [" preço ", "", "  "] })).toEqual({ kind: "keyword", keywords: ["preço"], mode: "equals" });
  });
});

describe("espera", () => {
  test("converte unidade em minutos e escolhe a maior unidade exata", () => {
    expect(delayToConfig({ amount: 2, unit: "hours" })).toEqual({ minutes: 120 });
    expect(delayToConfig({ amount: 3, unit: "days" })).toEqual({ minutes: 4320 });
    expect(delayToValues({ minutes: 1440 })).toEqual({ amount: 1, unit: "days" });
    expect(delayToValues({ minutes: 120 })).toEqual({ amount: 2, unit: "hours" });
    expect(delayToValues({ minutes: 90 })).toEqual({ amount: 90, unit: "minutes" });
  });

  test("quantidade em branco gera erro", () => {
    const config = delayToConfig({ amount: NaN, unit: "minutes" });
    expect(config).toEqual({ minutes: null });
    expect(nodeConfigSchemas.delay.safeParse(config).success).toBe(false);
  });
});

describe("gatilho", () => {
  test("mediaId aparado e vazio vira null", () => {
    const v = triggerToValues({ channelId: "c", mediaId: null, keywords: ["quero"], mode: "contains" });
    expect(triggerToConfig("instagram_comment", { ...v, mediaId: "  123 " })).toEqual({ channelId: "c", mediaId: "123", oncePerUser: true, keywords: ["quero"], mode: "contains", publicReplies: [] });
    expect(triggerToConfig("instagram_comment", { ...v, mediaId: "   " })).toMatchObject({ mediaId: null });
  });

  test("qualquer comentário / palavra mapeia anyKeyword e mode any", () => {
    const v = triggerToValues({ channelId: "c", anyKeyword: true, keywords: ["teste"], mode: "any" });
    expect(v.anyKeyword).toBe(true);
    expect(v.mode).toBe("any");
    expect(triggerToConfig("instagram_comment", v)).toEqual({ channelId: "c", mediaId: null, oncePerUser: true, anyKeyword: true, keywords: [], mode: "any", publicReplies: [] });
    const dm = triggerToValues({ anyKeyword: true, keywords: ["teste"], mode: "any" }, "keyword_detected");
    expect(triggerToConfig("keyword_detected", dm)).toEqual({ anyKeyword: true, keywords: [], mode: "any" });
  });

  test("oncePerUser em DM e story: ida e volta, desligado quando ausente", () => {
    const dm = { keywords: ["preco"], mode: "contains", oncePerUser: true };
    const dmValues = triggerToValues(dm, "keyword_detected");
    expect(dmValues.oncePerUser).toBe(true);
    expect(triggerToConfig("keyword_detected", dmValues)).toEqual(dm);
    expect(triggerToValues(triggerToConfig("keyword_detected", dmValues), "keyword_detected").oncePerUser).toBe(true);
    expect(triggerConfigSchemas.keyword_detected.safeParse(triggerToConfig("keyword_detected", dmValues)).success).toBe(true);

    const story = { channelId: "c", oncePerUser: true };
    const storyValues = triggerToValues(story, "instagram_story");
    expect(storyValues.oncePerUser).toBe(true);
    expect(triggerToConfig("instagram_story", storyValues)).toEqual(story);

    // automações antigas do painel (sem o campo) continuam disparando sempre
    expect(triggerToValues({ keywords: ["a"], mode: "contains" }, "keyword_detected").oncePerUser).toBe(false);
    expect(triggerToValues({ channelId: "c" }, "instagram_story").oncePerUser).toBe(false);
    expect(triggerToConfig("instagram_story", triggerToValues({ channelId: "c" }, "instagram_story"))).toEqual({ channelId: "c" });
    expect(triggerToConfig("keyword_detected", { ...dmValues, oncePerUser: false })).toEqual({ keywords: ["preco"], mode: "contains" });
    // comentário mantém o padrão ligado
    expect(triggerToValues({ channelId: "c" }, "instagram_comment").oncePerUser).toBe(true);
  });

  test("etiqueta e etapa em branco significam qualquer uma", () => {
    const v = triggerToValues({});
    expect(triggerToConfig("tag_added", v)).toEqual({ tagId: null });
    expect(triggerToConfig("stage_changed", v)).toEqual({ stageId: null });
    expect(triggerConfigSchemas.tag_added.safeParse({ tagId: null }).success).toBe(true);
  });
});
