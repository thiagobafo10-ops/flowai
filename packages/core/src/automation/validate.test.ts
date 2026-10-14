import { describe, expect, it } from "vitest";
import type { AutomationGraph, TriggerType } from "./schemas.ts";
import { requiredHandles, validateGraph, type GraphRefs } from "./validate.ts";

const TAG = "3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f";
const STAGE = "4a3c9d2f-6e5b-4f7c-8d8e-2b3c4d5e6f70";
const USER = "5b4d0e3a-7f6c-4a8d-9e9f-3c4d5e6f7081";
const CHANNEL = "6c5e1f4b-8a7d-4b9e-8fa0-4d5e6f708192";
const OTHER = "7d6f2a5c-9b8e-4cae-9ab1-5e6f708192a3";

const refs: GraphRefs = { tagIds: [TAG], stageIds: [STAGE], userIds: [USER], channelIds: [CHANNEL] };

type N = AutomationGraph["nodes"][number];
const node = (id: string, type: N["type"], config: unknown = {}): N => ({ id, type, config, position: { x: 0, y: 0 } });
const edge = (source: string, target: string, sourceHandle = "default") => ({
  id: `${source}-${sourceHandle}-${target}`,
  source,
  target,
  sourceHandle,
});
const text = (extra: Record<string, unknown> = {}) => ({ mode: "text", text: "Olá", replyTimeoutHours: 24, ...extra });

const generic = { type: "message_received" as TriggerType, config: { firstMessageOnly: true } };
const comment = {
  type: "instagram_comment" as TriggerType,
  config: { channelId: CHANNEL, mediaId: null, keywords: ["quero"], mode: "contains" },
};
const story = { type: "instagram_story" as TriggerType, config: { channelId: CHANNEL } };

const codes = (g: AutomationGraph, t: { type: TriggerType; config: unknown } = generic, r = refs) => validateGraph(g, t, r).map((i) => i.code);

const valid: AutomationGraph = {
  nodes: [node("t", "trigger"), node("m", "message", text()), node("e", "end")],
  edges: [edge("t", "m"), edge("m", "e")],
};

describe("validateGraph", () => {
  it("grafo válido retorna []", () => {
    expect(validateGraph(valid, generic, refs)).toEqual([]);
  });

  it("grafo com condição, botões, ia, tags e etapas válido retorna []", () => {
    const g: AutomationGraph = {
      nodes: [
        node("t", "trigger"),
        node("c", "condition", { kind: "has_tag", tagId: TAG }),
        node("m", "message", text({ buttons: [{ id: "a", title: "Sim", kind: "path" }, { id: "b", title: "Site", kind: "url", url: "https://x.com" }] })),
        node("ai", "message", { mode: "ai" }),
        node("tag", "tag", { tagId: TAG }),
        node("rt", "remove_tag", { tagId: TAG }),
        node("au", "assign_user", { userId: USER }),
        node("ms", "move_stage", { stageId: STAGE }),
        node("d", "delay", { minutes: 5 }),
        node("w", "webhook", { url: "https://x.com/h" }),
        node("cc", "close_conversation"),
        node("hh", "handoff_human"),
        node("ha", "handoff_ai"),
        node("e", "end"),
      ],
      edges: [
        edge("t", "c"),
        edge("c", "m", "true"),
        edge("c", "ai", "false"),
        edge("m", "tag", "opt:a"),
        edge("m", "e", "no_reply"),
        edge("ai", "rt", "sent"),
        edge("ai", "hh", "handoff"),
        edge("tag", "au"),
        edge("rt", "ms"),
        edge("au", "d"),
        edge("ms", "ha"),
        edge("d", "w"),
        edge("w", "cc"),
        edge("cc", "e"),
      ],
    };
    expect(validateGraph(g, generic, refs)).toEqual([]);
  });

  describe("blocos terminais", () => {
    it("transferências não têm saída: conexão a partir delas é extra_handle", () => {
      for (const type of ["handoff_ai", "handoff_human"] as const) {
        const g: AutomationGraph = { nodes: [node("t", "trigger"), node("h", type), node("e", "end")], edges: [edge("t", "h"), edge("h", "e")] };
        expect(validateGraph(g, generic, refs)).toEqual([expect.objectContaining({ code: "extra_handle", nodeId: "h" })]);
        const ok: AutomationGraph = { nodes: [node("t", "trigger"), node("h", type)], edges: [edge("t", "h")] };
        expect(validateGraph(ok, generic, refs)).toEqual([]);
      }
    });

    it("after_close: nada além do Fim depois de encerrar a conversa", () => {
      const g: AutomationGraph = {
        nodes: [node("t", "trigger"), node("cc", "close_conversation"), node("tag", "tag", { tagId: TAG }), node("e", "end")],
        edges: [edge("t", "cc"), edge("cc", "tag"), edge("tag", "e")],
      };
      expect(validateGraph(g, generic, refs)).toEqual([
        { nodeId: "cc", code: "after_close", message: "Nada é executado depois de fechar a conversa." },
      ]);
      const ok: AutomationGraph = { nodes: [node("t", "trigger"), node("cc", "close_conversation"), node("e", "end")], edges: [edge("t", "cc"), edge("cc", "e")] };
      expect(validateGraph(ok, generic, refs)).toEqual([]);
    });
  });

  describe("button_text_too_long_instagram", () => {
    const buttons = (s: string, kind: "path" | "url" = "path"): AutomationGraph => ({
      nodes: [
        node("t", "trigger"),
        node("m", "message", text({ text: s, buttons: [kind === "path" ? { id: "a", title: "Sim", kind } : { id: "a", title: "Site", kind, url: "https://x.com" }] })),
        node("e", "end"),
      ],
      edges: kind === "path" ? [edge("t", "m"), edge("m", "e", "opt:a"), edge("m", "e", "no_reply")] : [edge("t", "m"), edge("m", "e")],
    });
    it("mensagem com botões no Instagram aceita até 640 caracteres", () => {
      expect(codes(buttons("a".repeat(640)), story)).toEqual([]);
      expect(validateGraph(buttons("a".repeat(641)), story, refs)).toEqual([
        { nodeId: "m", code: "button_text_too_long_instagram", message: "Mensagens com botões no Instagram aceitam até 640 caracteres. Encurte o texto." },
      ]);
      expect(codes(buttons("é".repeat(641), "url"), story)).toContain("button_text_too_long_instagram");
    });
    it("não se aplica sem botões nem fora do Instagram", () => {
      expect(codes(buttons("a".repeat(700)))).toEqual([]);
      const plain: AutomationGraph = { nodes: [node("t", "trigger"), node("m", "message", text({ text: "a".repeat(700) })), node("e", "end")], edges: [edge("t", "m"), edge("m", "e")] };
      expect(codes(plain, story)).toEqual([]);
    });
  });

  it("no_trigger", () => {
    const g = { nodes: [node("m", "message", text())], edges: [] };
    expect(codes(g)).toContain("no_trigger");
  });

  it("multiple_triggers", () => {
    const g = { ...valid, nodes: [...valid.nodes, node("t2", "trigger")], edges: [...valid.edges, edge("t2", "m")] };
    const issues = validateGraph(g, generic, refs).filter((i) => i.code === "multiple_triggers");
    expect(issues).toEqual([expect.objectContaining({ nodeId: "t2" })]);
  });

  it("unreachable (nó órfão)", () => {
    const g = { ...valid, nodes: [...valid.nodes, node("x", "end")] };
    const issues = validateGraph(g, generic, refs);
    expect(issues).toEqual([expect.objectContaining({ code: "unreachable", nodeId: "x" })]);
  });

  it("cycle", () => {
    const g: AutomationGraph = {
      nodes: [node("t", "trigger"), node("a", "tag", { tagId: TAG }), node("b", "remove_tag", { tagId: TAG })],
      edges: [edge("t", "a"), edge("a", "b"), edge("b", "a")],
    };
    expect(validateGraph(g, generic, refs)).toEqual([expect.objectContaining({ code: "cycle", nodeId: "a" })]);
  });

  it("cycle: laço em si mesmo", () => {
    const g: AutomationGraph = {
      nodes: [node("t", "trigger"), node("a", "tag", { tagId: TAG })],
      edges: [edge("t", "a"), edge("a", "a")],
    };
    expect(validateGraph(g, generic, refs)).toEqual([expect.objectContaining({ code: "cycle", nodeId: "a" })]);
  });

  it("missing_handle: condição sem false", () => {
    const g: AutomationGraph = {
      nodes: [node("t", "trigger"), node("c", "condition", { kind: "has_tag", tagId: TAG }), node("e", "end")],
      edges: [edge("t", "c"), edge("c", "e", "true")],
    };
    const issues = validateGraph(g, generic, refs);
    expect(issues).toEqual([expect.objectContaining({ code: "missing_handle", nodeId: "c" })]);
  });

  it("missing_handle: botão sem aresta e no_reply desconectado", () => {
    const m = node("m", "message", text({ buttons: [{ id: "a", title: "Sim", kind: "path" }, { id: "b", title: "Não", kind: "path" }] }));
    const g: AutomationGraph = {
      nodes: [node("t", "trigger"), m, node("e", "end")],
      edges: [edge("t", "m"), edge("m", "e", "opt:a")],
    };
    const issues = validateGraph(g, generic, refs).filter((i) => i.code === "missing_handle");
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.message).join(" ")).toContain("opt:b");
    expect(issues.map((i) => i.message).join(" ")).toContain("no_reply");
  });

  it("botões url não exigem aresta", () => {
    const m = node("m", "message", text({ buttons: [{ id: "a", title: "Site", kind: "url", url: "https://x.com" }] }));
    const g: AutomationGraph = { nodes: [node("t", "trigger"), m, node("e", "end")], edges: [edge("t", "m"), edge("m", "e")] };
    expect(codes(g)).toEqual([]);
  });

  it("extra_handle", () => {
    const g: AutomationGraph = {
      nodes: [node("t", "trigger"), node("m", "message", text()), node("e", "end")],
      edges: [edge("t", "m"), edge("m", "e"), edge("m", "e", "true")],
    };
    expect(codes(g)).toEqual(["extra_handle"]);
  });

  it("extra_handle: saída de end", () => {
    const g: AutomationGraph = {
      nodes: [node("t", "trigger"), node("e", "end"), node("m", "message", text())],
      edges: [edge("t", "e"), edge("e", "m")],
    };
    expect(codes(g)).toContain("extra_handle");
  });

  it("dangling_edge: destino inexistente", () => {
    const g: AutomationGraph = {
      nodes: [node("t", "trigger"), node("m", "message", text())],
      edges: [edge("t", "m"), edge("m", "ghost")],
    };
    const d = validateGraph(g, generic, refs).filter((i) => i.code === "dangling_edge");
    expect(d).toEqual([expect.objectContaining({ nodeId: "m" })]);
  });

  it("dangling_edge: origem inexistente", () => {
    const g = { ...valid, edges: [...valid.edges, edge("ghost", "e")] };
    const d = validateGraph(g, generic, refs).filter((i) => i.code === "dangling_edge");
    expect(d).toEqual([expect.objectContaining({ nodeId: null })]);
  });

  it("duplicate_handle", () => {
    const g: AutomationGraph = {
      nodes: [node("t", "trigger"), node("m", "message", text()), node("e", "end"), node("e2", "end")],
      edges: [edge("t", "m"), edge("m", "e"), edge("m", "e2")],
    };
    const issues = validateGraph(g, generic, refs);
    expect(issues).toEqual([expect.objectContaining({ code: "duplicate_handle", nodeId: "m" })]);
  });

  it("invalid_config traz a mensagem do Zod", () => {
    const g: AutomationGraph = {
      nodes: [node("t", "trigger"), node("d", "delay", { minutes: 0 }), node("e", "end")],
      edges: [edge("t", "d"), edge("d", "e")],
    };
    const issues = validateGraph(g, generic, refs);
    expect(issues).toEqual([
      expect.objectContaining({ code: "invalid_config", nodeId: "d", message: expect.stringContaining("A espera mínima é 1 minuto.") }),
    ]);
  });

  it("invalid_config do gatilho", () => {
    const issues = validateGraph(valid, { type: "keyword_detected", config: { keywords: [], mode: "contains" } }, refs);
    expect(issues.map((i) => i.code)).toEqual(["invalid_config"]);
  });

  it("requiredHandles não quebra com config inválida", () => {
    expect(requiredHandles(node("m", "message", null))).toEqual(["default"]);
  });

  it("unknown_tag (nó, condição e gatilho)", () => {
    const g: AutomationGraph = {
      nodes: [
        node("t", "trigger"),
        node("a", "tag", { tagId: OTHER }),
        node("c", "condition", { kind: "has_tag", tagId: OTHER }),
        node("e", "end"),
      ],
      edges: [edge("t", "a"), edge("a", "c"), edge("c", "e", "true"), edge("c", "e", "false")],
    };
    expect(codes(g).filter((c) => c === "unknown_tag")).toHaveLength(2);
    expect(codes(valid, { type: "tag_added", config: { tagId: OTHER } })).toEqual(["unknown_tag"]);
    expect(codes(valid, { type: "tag_added", config: { tagId: null } })).toEqual([]);
  });

  it("unknown_stage (nó, condição e gatilho)", () => {
    const g: AutomationGraph = {
      nodes: [
        node("t", "trigger"),
        node("a", "move_stage", { stageId: OTHER }),
        node("c", "condition", { kind: "stage_is", stageId: OTHER }),
        node("e", "end"),
      ],
      edges: [edge("t", "a"), edge("a", "c"), edge("c", "e", "true"), edge("c", "e", "false")],
    };
    expect(codes(g).filter((c) => c === "unknown_stage")).toHaveLength(2);
    expect(codes(valid, { type: "stage_changed", config: { stageId: OTHER } })).toEqual(["unknown_stage"]);
  });

  it("unknown_user", () => {
    const g: AutomationGraph = {
      nodes: [node("t", "trigger"), node("a", "assign_user", { userId: OTHER }), node("e", "end")],
      edges: [edge("t", "a"), edge("a", "e")],
    };
    expect(codes(g)).toEqual(["unknown_user"]);
  });

  it("unknown_channel", () => {
    const g: AutomationGraph = {
      nodes: [node("t", "trigger"), node("m", "message", text({ buttons: [{ id: "a", title: "Ok", kind: "path" }] })), node("e", "end")],
      edges: [edge("t", "m"), edge("m", "e", "opt:a"), edge("m", "e", "no_reply")],
    };
    const bad = { ...story, config: { channelId: OTHER } };
    expect(codes(g, bad)).toEqual(["unknown_channel"]);
    expect(codes(g, story)).toEqual([]);
  });

  describe("comment_needs_reply", () => {
    const tagNode = (id: string) => node(id, "tag", { tagId: TAG });
    const btn = text({ buttons: [{ id: "a", title: "Sim", kind: "path" }] });

    it("sem opções: default alcança outra mensagem", () => {
      const g: AutomationGraph = {
        nodes: [node("t", "trigger"), node("m", "message", text()), tagNode("a"), node("m2", "message", text()), node("e", "end")],
        edges: [edge("t", "m"), edge("m", "a"), edge("a", "m2"), edge("m2", "e")],
      };
      expect(codes(g, comment)).toEqual(["comment_needs_reply"]);
    });

    it("sem opções: default só com ações e fim é aceito", () => {
      const g: AutomationGraph = {
        nodes: [node("t", "trigger"), node("m", "message", text()), tagNode("a"), node("e", "end")],
        edges: [edge("t", "m"), edge("m", "a"), edge("a", "e")],
      };
      expect(codes(g, comment)).toEqual([]);
    });

    it("no_reply alcança mensagem", () => {
      const g: AutomationGraph = {
        nodes: [node("t", "trigger"), node("m", "message", btn), node("m2", "message", text()), node("e", "end")],
        edges: [edge("t", "m"), edge("m", "e", "opt:a"), edge("m", "m2", "no_reply"), edge("m2", "e")],
      };
      expect(codes(g, comment)).toEqual(["comment_needs_reply"]);
    });

    it("no_reply com ação e fim é aceito (opt pode seguir com mensagem)", () => {
      const g: AutomationGraph = {
        nodes: [node("t", "trigger"), node("m", "message", btn), node("m2", "message", text()), tagNode("a"), node("e", "end")],
        edges: [edge("t", "m"), edge("m", "m2", "opt:a"), edge("m2", "e"), edge("m", "a", "no_reply"), edge("a", "e")],
      };
      expect(codes(g, comment)).toEqual([]);
    });

    it("atrás de condição, um ramo alcança mensagem", () => {
      const g: AutomationGraph = {
        nodes: [
          node("t", "trigger"),
          node("m", "message", btn),
          node("c", "condition", { kind: "has_tag", tagId: TAG }),
          node("m2", "message", text()),
          node("e", "end"),
        ],
        edges: [edge("t", "m"), edge("m", "e", "opt:a"), edge("m", "c", "no_reply"), edge("c", "m2", "true"), edge("c", "e", "false"), edge("m2", "e")],
      };
      expect(codes(g, comment)).toEqual(["comment_needs_reply"]);
    });

    it("bypass: default para end e default para mensagem", () => {
      const g: AutomationGraph = {
        nodes: [node("t", "trigger"), node("m", "message", text()), node("m2", "message", text()), node("e", "end")],
        edges: [edge("t", "m"), edge("m", "e"), edge("m", "m2"), edge("m2", "e")],
      };
      const c = codes(g, comment);
      expect(c).toContain("duplicate_handle");
      expect(c).toContain("comment_needs_reply");
    });

    it("mensagem de ia como primeira", () => {
      const g: AutomationGraph = {
        nodes: [node("t", "trigger"), node("m", "message", { mode: "ai" }), node("e", "end")],
        edges: [edge("t", "m"), edge("m", "e", "sent"), edge("m", "e", "handoff")],
      };
      expect(codes(g, comment)).toEqual(["comment_first_message", "comment_needs_reply"]);
    });

    it("texto com botões ou default para end são aceitos", () => {
      expect(codes(valid, comment)).toEqual([]);
      const g: AutomationGraph = {
        nodes: [node("t", "trigger"), node("m", "message", text({ quickReplies: [{ id: "a", title: "Ok" }] })), node("e", "end")],
        edges: [edge("t", "m"), edge("m", "e", "opt:a"), edge("m", "e", "no_reply")],
      };
      expect(codes(g, comment)).toEqual([]);
    });

    it("considera a primeira mensagem após outros nós", () => {
      const g: AutomationGraph = {
        nodes: [node("t", "trigger"), node("a", "tag", { tagId: TAG }), node("m", "message", text()), node("m2", "message", text()), node("e", "end")],
        edges: [edge("t", "a"), edge("a", "m"), edge("m", "m2"), edge("m2", "e")],
      };
      expect(codes(g, comment)).toEqual(["comment_first_message", "comment_needs_reply"]);
    });

    it("condition before first private reply must be rejected", () => {
      const g: AutomationGraph = {
        nodes: [node("t", "trigger"), node("c", "condition", { kind: "has_tag", tagId: TAG }), node("m", "message", text()), node("e", "end")],
        edges: [edge("t", "c"), edge("c", "m", "true"), edge("c", "e", "false"), edge("m", "e")],
      };
      expect(codes(g, comment)).toEqual(["comment_first_message"]);
    });

    it("CRM before first private reply must be rejected", () => {
      const g: AutomationGraph = {
        nodes: [node("t", "trigger"), tagNode("a"), node("m", "message", text()), node("e", "end")],
        edges: [edge("t", "a"), edge("a", "m"), edge("m", "e")],
      };
      expect(codes(g, comment)).toEqual(["comment_first_message"]);
    });

    it("não se aplica a outros gatilhos", () => {
      const g: AutomationGraph = {
        nodes: [node("t", "trigger"), node("m", "message", text()), node("m2", "message", text()), node("e", "end")],
        edges: [edge("t", "m"), edge("m", "m2"), edge("m2", "e")],
      };
      expect(codes(g)).toEqual([]);
    });
  });

  describe("message_too_long_instagram", () => {
    const long = (s: string): AutomationGraph => ({
      nodes: [node("t", "trigger"), node("m", "message", text({ text: s })), node("e", "end")],
      edges: [edge("t", "m"), edge("m", "e")],
    });

    it("conta bytes UTF-8, não caracteres", () => {
      // 600 caracteres, 1200 bytes
      expect(codes(long("é".repeat(600)), comment)).toContain("message_too_long_instagram");
      expect(codes(long("é".repeat(600)), story)).toContain("message_too_long_instagram");
    });

    it("1000 bytes exatos passa", () => {
      expect(codes(long("a".repeat(1000)), story)).toEqual([]);
      expect(codes(long("a".repeat(1001)), story)).toEqual(["message_too_long_instagram"]);
    });

    it("não se aplica a gatilhos fora do Instagram", () => {
      expect(codes(long("a".repeat(2000)))).toEqual([]);
    });
  });
});

describe("requiredHandles", () => {
  it("por tipo", () => {
    expect(requiredHandles(node("c", "condition", { kind: "has_tag", tagId: TAG }))).toEqual(["true", "false"]);
    expect(
      requiredHandles(node("m", "message", text({ buttons: [{ id: "a", title: "A", kind: "path" }, { id: "u", title: "U", kind: "url", url: "https://x.com" }] }))),
    ).toEqual(["opt:a", "no_reply"]);
    expect(requiredHandles(node("m", "message", text({ quickReplies: [{ id: "q", title: "Q" }] })))).toEqual(["opt:q", "no_reply"]);
    expect(requiredHandles(node("m", "message", text()))).toEqual(["default"]);
    expect(requiredHandles(node("m", "message", { mode: "ai" }))).toEqual(["sent", "handoff"]);
    expect(requiredHandles(node("e", "end"))).toEqual([]);
    expect(requiredHandles(node("t", "trigger"))).toEqual(["default"]);
    expect(requiredHandles(node("d", "delay", { minutes: 1 }))).toEqual(["default"]);
    expect(requiredHandles(node("ha", "handoff_ai"))).toEqual([]);
    expect(requiredHandles(node("hh", "handoff_human"))).toEqual([]);
    expect(requiredHandles(node("cc", "close_conversation"))).toEqual(["default"]);
  });
});
