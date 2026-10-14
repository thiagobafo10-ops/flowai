import { describe, expect, it } from "vitest";
import { evaluateCondition, executeNode, MAX_STEPS, nextNode, resolveReply, type RunContext } from "./engine.ts";
import type { AutomationGraph } from "./schemas.ts";

const TAG = "11111111-1111-4111-8111-111111111111";
const STAGE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

const ctx = (over: Partial<RunContext> = {}): RunContext => ({
  contact: { name: "Maria Silva", tagIds: [], stageId: null, leadScore: null },
  lastInboundText: null,
  lastIntent: null,
  now: "2026-10-13T15:00:00.000Z",
  timezone: "America/Sao_Paulo",
  channelType: "simulator",
  ...over,
});

const node = (id: string, type: AutomationGraph["nodes"][number]["type"], config: unknown = {}) => ({
  id,
  type,
  config,
  position: { x: 0, y: 0 },
});
const graphOf = (nodes: AutomationGraph["nodes"], edges: AutomationGraph["edges"] = []): AutomationGraph => ({ nodes, edges });
const run = (type: AutomationGraph["nodes"][number]["type"], config: unknown, c = ctx()) =>
  executeNode(graphOf([node("n", type, config)]), "n", c);

describe("executeNode", () => {
  it("MAX_STEPS é 50", () => expect(MAX_STEPS).toBe(50));

  it("trigger -> default sem efeitos", () => {
    expect(run("trigger", {})).toEqual({ effects: [], route: { handle: "default" } });
  });

  it("mensagem de texto simples envia e segue default, com variáveis", () => {
    expect(run("message", { mode: "text", text: "Oi {primeiro_nome}!" })).toEqual({
      effects: [{ type: "send_text", text: "Oi Maria!" }],
      route: { handle: "default" },
    });
  });

  it("botões só de url seguem default", () => {
    const out = run("message", {
      mode: "text",
      text: "Veja",
      buttons: [{ id: "a", title: "Site", kind: "url", url: "https://x.com" }],
    });
    expect(out.route).toEqual({ handle: "default" });
    expect(out.effects).toEqual([
      { type: "send_text", text: "Veja", buttons: [{ id: "a", title: "Site", kind: "url", url: "https://x.com" }] },
    ]);
  });

  it("botões path aguardam resposta com prazo (padrão 24h)", () => {
    const out = run("message", { mode: "text", text: "Escolha", buttons: [{ id: "sim", title: "Sim", kind: "path" }] });
    expect(out.route).toEqual({ waitReply: { until: "2026-10-14T15:00:00.000Z" } });
    expect(out.effects).toHaveLength(1);
  });

  it("respostas rápidas aguardam com prazo configurado", () => {
    const out = run("message", {
      mode: "text",
      text: "Escolha",
      quickReplies: [{ id: "a", title: "A" }],
      replyTimeoutHours: 2,
    });
    expect(out.route).toEqual({ waitReply: { until: "2026-10-13T17:00:00.000Z" } });
    expect(out.effects).toEqual([{ type: "send_text", text: "Escolha", quickReplies: [{ id: "a", title: "A" }] }]);
  });

  it("mensagem ai e webhook aguardam efeito", () => {
    expect(run("message", { mode: "ai" })).toEqual({ effects: [{ type: "ai_message" }], route: { awaitEffect: true } });
    expect(run("webhook", { url: "https://x.com/h" })).toEqual({
      effects: [{ type: "webhook", url: "https://x.com/h" }],
      route: { awaitEffect: true },
    });
  });

  it("delay aguarda now + minutos", () => {
    expect(run("delay", { minutes: 30 })).toEqual({
      effects: [],
      route: { waitDelay: { until: "2026-10-13T15:30:00.000Z" } },
    });
  });

  it("ações simples geram efeito e default", () => {
    expect(run("tag", { tagId: TAG })).toEqual({ effects: [{ type: "add_tag", tagId: TAG }], route: { handle: "default" } });
    expect(run("remove_tag", { tagId: TAG }).effects).toEqual([{ type: "remove_tag", tagId: TAG }]);
    expect(run("assign_user", { userId: USER }).effects).toEqual([{ type: "assign_user", userId: USER }]);
    expect(run("move_stage", { stageId: STAGE }).effects).toEqual([{ type: "move_stage", stageId: STAGE }]);
    expect(run("close_conversation", {}).effects).toEqual([{ type: "close_conversation" }]);
    expect(run("handoff_ai", {}).effects).toEqual([{ type: "handoff_ai" }]);
    expect(run("handoff_human", {}).effects).toEqual([{ type: "handoff_human" }]);
  });

  it("end termina", () => {
    expect(run("end", {})).toEqual({ effects: [], route: { end: true } });
  });

  it("condição roteia true/false sem efeitos", () => {
    const cfg = { kind: "has_tag", tagId: TAG };
    expect(run("condition", cfg, ctx({ contact: { name: null, tagIds: [TAG], stageId: null, leadScore: null } }))).toEqual({
      effects: [],
      route: { handle: "true" },
    });
    expect(run("condition", cfg)).toEqual({ effects: [], route: { handle: "false" } });
  });

  it("config inválida lança invalid_node_config; nó inexistente também", () => {
    expect(() => run("delay", { minutes: 0 })).toThrow(/invalid_node_config/);
    expect(() => run("message", { mode: "text" })).toThrow(/invalid_node_config/);
    expect(() => executeNode(graphOf([]), "x", ctx())).toThrow(/node_not_found/);
  });
});

describe("evaluateCondition", () => {
  it("keyword usa lastInboundText (null -> false)", () => {
    const cfg = { kind: "keyword", keywords: ["preço"], mode: "contains" };
    expect(evaluateCondition(cfg, ctx({ lastInboundText: "Qual o PRECO?" }))).toBe(true);
    expect(evaluateCondition(cfg, ctx({ lastInboundText: "oi" }))).toBe(false);
    expect(evaluateCondition(cfg, ctx())).toBe(false);
  });

  it("stage_is, lead_score_gte, intent_is", () => {
    expect(evaluateCondition({ kind: "stage_is", stageId: STAGE }, ctx({ contact: { name: null, tagIds: [], stageId: STAGE, leadScore: null } }))).toBe(true);
    expect(evaluateCondition({ kind: "stage_is", stageId: STAGE }, ctx())).toBe(false);
    const score = (s: number | null) => ctx({ contact: { name: null, tagIds: [], stageId: null, leadScore: s } });
    expect(evaluateCondition({ kind: "lead_score_gte", value: 50 }, score(50))).toBe(true);
    expect(evaluateCondition({ kind: "lead_score_gte", value: 50 }, score(49))).toBe(false);
    expect(evaluateCondition({ kind: "lead_score_gte", value: 0 }, score(null))).toBe(false);
    expect(evaluateCondition({ kind: "intent_is", intent: "Compra" }, ctx({ lastIntent: " compra " }))).toBe(true);
    expect(evaluateCondition({ kind: "intent_is", intent: "compra" }, ctx({ lastIntent: null }))).toBe(false);
  });

  it("business_hours em America/Sao_Paulo (início inclusivo, fim exclusivo)", () => {
    // 2026-10-13 é terça (ISO 2). 15:00Z = 12:00 em São Paulo (UTC-3).
    const cfg = { kind: "business_hours", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
    expect(evaluateCondition(cfg, ctx())).toBe(true);
    expect(evaluateCondition(cfg, ctx({ now: "2026-10-13T12:00:00.000Z" }))).toBe(true); // 09:00 exato
    expect(evaluateCondition(cfg, ctx({ now: "2026-10-13T11:59:00.000Z" }))).toBe(false); // 08:59
    expect(evaluateCondition(cfg, ctx({ now: "2026-10-13T21:00:00.000Z" }))).toBe(false); // 18:00 exato
    expect(evaluateCondition(cfg, ctx({ now: "2026-10-13T20:59:00.000Z" }))).toBe(true); // 17:59
    // domingo (ISO 7) 2026-10-18 15:00Z
    expect(evaluateCondition(cfg, ctx({ now: "2026-10-18T15:00:00.000Z" }))).toBe(false);
    expect(evaluateCondition({ ...cfg, days: [7] }, ctx({ now: "2026-10-18T15:00:00.000Z" }))).toBe(true);
  });

  it("business_hours usa o dia local, não o UTC", () => {
    // 2026-10-14T01:00Z = terça 22:00 em São Paulo
    const cfg = { kind: "business_hours", days: [2], start: "20:00", end: "23:00" };
    expect(evaluateCondition(cfg, ctx({ now: "2026-10-14T01:00:00.000Z" }))).toBe(true);
    expect(evaluateCondition({ ...cfg, days: [3] }, ctx({ now: "2026-10-14T01:00:00.000Z" }))).toBe(false);
  });

  it("config inválida lança", () => {
    expect(() => evaluateCondition({ kind: "nope" }, ctx())).toThrow(/invalid_node_config/);
  });
});

describe("resolveReply", () => {
  const msg = node("m", "message", {
    mode: "text",
    text: "Quer?",
    buttons: [
      { id: "sim", title: "Sim", kind: "path" },
      { id: "nao", title: "Não", kind: "path" },
      { id: "site", title: "Site", kind: "url", url: "https://x.com" },
    ],
  });
  const quick = node("q", "message", { mode: "text", text: "Qual?", quickReplies: [{ id: "a", title: "Opção A" }] });

  it("optionId do nó -> opt:<id>", () => {
    expect(resolveReply(msg, { optionId: "sim", text: null })).toBe("opt:sim");
    expect(resolveReply(quick, { optionId: "a", text: null })).toBe("opt:a");
  });
  it("texto digitado casa com o título normalizado", () => {
    expect(resolveReply(msg, { optionId: null, text: "sim" })).toBe("opt:sim");
    expect(resolveReply(msg, { optionId: null, text: " NAO " })).toBe("opt:nao");
    expect(resolveReply(quick, { optionId: null, text: "opcao a" })).toBe("opt:a");
  });
  it("sem correspondência -> no_reply", () => {
    expect(resolveReply(msg, { optionId: null, text: "talvez" })).toBe("no_reply");
    expect(resolveReply(msg, { optionId: "zzz", text: null })).toBe("no_reply");
    expect(resolveReply(msg, { optionId: null, text: null })).toBe("no_reply");
  });
  it("botão url não é opção de caminho", () => {
    expect(resolveReply(msg, { optionId: "site", text: null })).toBe("no_reply");
    expect(resolveReply(msg, { optionId: null, text: "Site" })).toBe("no_reply");
  });
  it("nó que não é mensagem de texto -> no_reply", () => {
    expect(resolveReply(node("d", "delay", { minutes: 1 }), { optionId: "sim", text: "sim" })).toBe("no_reply");
  });
});

describe("nextNode", () => {
  const g = graphOf(
    [node("a", "trigger"), node("b", "end")],
    [{ id: "e1", source: "a", target: "b", sourceHandle: "default" }],
  );
  it("segue a aresta do handle", () => expect(nextNode(g, "a", "default")).toBe("b"));
  it("aresta ausente -> null", () => {
    expect(nextNode(g, "a", "true")).toBeNull();
    expect(nextNode(g, "b", "default")).toBeNull();
  });
});
