import { describe, expect, it } from "vitest";
import { automationGraphSchema, nodeConfigSchemas, triggerConfigSchemas } from "./schemas.ts";

const msg = (extra: Record<string, unknown>) => ({ mode: "text", text: "Oi", ...extra });
const btn = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: "Sim", kind: "path", ...extra });

describe("message node", () => {
  const s = nodeConfigSchemas.message;
  it("aceita texto simples com prazo padrão de 24h", () => {
    const r = s.parse(msg({}));
    expect((r as { replyTimeoutHours: number }).replyTimeoutHours).toBe(24);
  });
  it("aceita modo ai", () => {
    expect(s.safeParse({ mode: "ai" }).success).toBe(true);
  });
  it("rejeita 4 botões", () => {
    expect(s.safeParse(msg({ buttons: ["a", "b", "c", "d"].map((i) => btn(i)) })).success).toBe(false);
    expect(s.safeParse(msg({ buttons: ["a", "b", "c"].map((i) => btn(i)) })).success).toBe(true);
  });
  it("rejeita botões e respostas rápidas juntos", () => {
    expect(s.safeParse(msg({ buttons: [btn("a")], quickReplies: [{ id: "q", title: "x" }] })).success).toBe(false);
  });
  it("rejeita título com 21 caracteres", () => {
    expect(s.safeParse(msg({ buttons: [btn("a", { title: "x".repeat(21) })] })).success).toBe(false);
    expect(s.safeParse(msg({ buttons: [btn("a", { title: "x".repeat(20) })] })).success).toBe(true);
  });
  it("botão url exige https", () => {
    expect(s.safeParse(msg({ buttons: [btn("a", { kind: "url", url: "http://x.com" })] })).success).toBe(false);
    expect(s.safeParse(msg({ buttons: [btn("a", { kind: "url", url: "https://x.com" })] })).success).toBe(true);
    expect(s.safeParse(msg({ buttons: [btn("a", { kind: "url" })] })).success).toBe(false);
  });
  it("ids únicos e no formato", () => {
    expect(s.safeParse(msg({ buttons: [btn("a"), btn("a")] })).success).toBe(false);
    expect(s.safeParse(msg({ buttons: [btn("A")] })).success).toBe(false);
  });
  it("até 13 respostas rápidas e prazo 1..168", () => {
    const qs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i}`, title: "x" }));
    expect(s.safeParse(msg({ quickReplies: qs(13) })).success).toBe(true);
    expect(s.safeParse(msg({ quickReplies: qs(14) })).success).toBe(false);
    expect(s.safeParse(msg({ replyTimeoutHours: 169 })).success).toBe(false);
    expect(s.safeParse(msg({ replyTimeoutHours: 0 })).success).toBe(false);
  });
});

describe("delay / condition / outros", () => {
  it("delay 1..10080", () => {
    expect(nodeConfigSchemas.delay.safeParse({ minutes: 10080 }).success).toBe(true);
    expect(nodeConfigSchemas.delay.safeParse({ minutes: 10081 }).success).toBe(false);
    expect(nodeConfigSchemas.delay.safeParse({ minutes: 0 }).success).toBe(false);
  });
  it("business_hours valida HH:MM", () => {
    const ok = { kind: "business_hours", days: [1, 2], start: "09:00", end: "18:00" };
    expect(nodeConfigSchemas.condition.safeParse(ok).success).toBe(true);
    expect(nodeConfigSchemas.condition.safeParse({ ...ok, end: "25:00" }).success).toBe(false);
    expect(nodeConfigSchemas.condition.safeParse({ ...ok, days: [8] }).success).toBe(false);
  });
  it("business_hours exige dias únicos e início antes do fim", () => {
    const base = { kind: "business_hours", days: [1, 2], start: "09:00", end: "18:00" };
    expect(nodeConfigSchemas.condition.safeParse({ ...base, days: [1, 1] }).success).toBe(false);
    const r = nodeConfigSchemas.condition.safeParse({ ...base, start: "18:00" });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("O horário final deve ser depois do inicial.");
    expect(nodeConfigSchemas.condition.safeParse({ ...base, start: "20:00", end: "08:00" }).success).toBe(false);
  });
  it("webhook só https", () => {
    expect(nodeConfigSchemas.webhook.safeParse({ url: "http://a.com" }).success).toBe(false);
    expect(nodeConfigSchemas.webhook.safeParse({ url: "https://a.com/x" }).success).toBe(true);
  });
  it("lead_score_gte 0..100", () => {
    expect(nodeConfigSchemas.condition.safeParse({ kind: "lead_score_gte", value: 101 }).success).toBe(false);
  });
});

describe("triggers", () => {
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  it("keyword_detected exige 1..20 palavras", () => {
    expect(triggerConfigSchemas.keyword_detected.safeParse({ keywords: [], mode: "contains" }).success).toBe(false);
    expect(triggerConfigSchemas.keyword_detected.safeParse({ keywords: ["a"], mode: "equals" }).success).toBe(true);
    expect(triggerConfigSchemas.keyword_detected.safeParse({ keywords: ["a".repeat(101)], mode: "equals" }).success).toBe(false);
  });
  it("keyword_detected aceita anyKeyword ou mode any sem palavras", () => {
    expect(triggerConfigSchemas.keyword_detected.safeParse({ anyKeyword: true, keywords: [], mode: "contains" }).success).toBe(true);
    expect(triggerConfigSchemas.keyword_detected.safeParse({ keywords: [], mode: "any" }).success).toBe(true);
  });
  it("instagram_comment", () => {
    expect(
      triggerConfigSchemas.instagram_comment.safeParse({ channelId: uuid, mediaId: null, keywords: ["a"], mode: "contains" }).success,
    ).toBe(true);
    expect(
      triggerConfigSchemas.instagram_comment.safeParse({ channelId: uuid, mediaId: null, anyKeyword: true, keywords: [], mode: "any" }).success,
    ).toBe(true);
    expect(
      triggerConfigSchemas.instagram_comment.safeParse({ channelId: uuid, mediaId: null, keywords: [], mode: "contains" }).success,
    ).toBe(false);
  });
  describe("instagram_comment publicReplies", () => {
    const base = { channelId: uuid, mediaId: null, keywords: ["a"], mode: "contains" };
    const parse = (publicReplies: unknown) => triggerConfigSchemas.instagram_comment.safeParse({ ...base, publicReplies });
    const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues.map((i) => i.message) ?? [];
    it("é opcional e aceita lista vazia", () => {
      expect(triggerConfigSchemas.instagram_comment.safeParse(base).success).toBe(true);
      expect(parse([]).success).toBe(true);
    });
    it("aceita de 1 a 10 variações e apara espaços", () => {
      const r = triggerConfigSchemas.instagram_comment.parse({ ...base, publicReplies: ["  Te mandei no Direct!  "] }) as { publicReplies?: string[] };
      expect(r.publicReplies).toEqual(["Te mandei no Direct!"]);
      expect(parse(Array.from({ length: 10 }, (_, i) => `Resposta ${i}`)).success).toBe(true);
    });
    it("rejeita mais de 10 variações", () => {
      expect(messages(parse(Array.from({ length: 11 }, (_, i) => `Resposta ${i}`)))).toContain("Máximo de 10 variações.");
    });
    it("rejeita texto em branco", () => {
      expect(messages(parse(["   "]))).toContain("Informe o texto da resposta.");
    });
    it("rejeita texto com mais de 300 caracteres", () => {
      expect(parse(["a".repeat(300)]).success).toBe(true);
      expect(messages(parse(["a".repeat(301)]))).toContain("A resposta deve ter no máximo 300 caracteres.");
    });
  });
  it("tag_added aceita null", () => {
    expect(triggerConfigSchemas.tag_added.safeParse({ tagId: null }).success).toBe(true);
    expect(triggerConfigSchemas.contact_created.safeParse({}).success).toBe(true);
  });
});

describe("automationGraphSchema", () => {
  const graph = (sourceHandle: string) => ({
    nodes: [
      { id: "n1", type: "trigger", config: {}, position: { x: 0, y: 0 } },
      { id: "n2", type: "end", config: {}, position: { x: 0, y: 100 } },
    ],
    edges: [{ id: "e1", source: "n1", target: "n2", sourceHandle }],
  });
  it("handle opt:ABC falha, opt:a1 passa", () => {
    expect(automationGraphSchema.safeParse(graph("opt:ABC")).success).toBe(false);
    expect(automationGraphSchema.safeParse(graph("opt:a1")).success).toBe(true);
    expect(automationGraphSchema.safeParse(graph("no_reply")).success).toBe(true);
    expect(automationGraphSchema.safeParse(graph("weird")).success).toBe(false);
  });
  it("rejeita tipo de nó desconhecido", () => {
    const g = graph("default");
    (g.nodes[0] as { type: string }).type = "bogus";
    expect(automationGraphSchema.safeParse(g).success).toBe(false);
  });
});
