import { describe, expect, it } from "vitest";
import {
  automationSpecSchema,
  mergeSpec,
  parseDuration,
  specToGraph,
  specToTrigger,
  summarizeSpec,
  type AutomationSpec,
} from "./automation-spec.ts";
import { automationGraphSchema } from "../automation/schemas.ts";
import { validateGraph } from "../automation/validate.ts";

const CHANNEL = "11111111-1111-4111-8111-111111111111";
const ctx = { channelId: CHANNEL };

const base = {
  nome: "Link do guia",
  gatilho: "comentario" as const,
  palavras: ["quero"],
  dm: { texto: "Aqui está o guia!", botoes: [{ titulo: "Abrir guia", url: "https://exemplo.com.br/guia" }] },
};

const parse = (over: Record<string, unknown> = {}) => automationSpecSchema.safeParse({ ...base, ...over });
const parsed = (over: Record<string, unknown> = {}): AutomationSpec => {
  const r = parse(over);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};

describe("automationSpecSchema", () => {
  it("accepts_minimal_comment_spec", () => {
    const r = parse();
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.post).toBe("qualquer");
      expect(r.data.umaVezPorContato).toBe(true);
      expect(r.data.respostaPublica).toEqual([]);
    }
  });

  it("rejects_limits", () => {
    const bad = (over: Record<string, unknown>) => {
      const r = parse(over);
      expect(r.success).toBe(false);
      return r.success ? "" : r.error.issues.map((i) => i.message).join(" | ");
    };
    expect(bad({ palavras: Array.from({ length: 21 }, (_, i) => `p${i}`) })).toMatch(/20/);
    expect(bad({ respostaPublica: Array.from({ length: 11 }, () => "ok") })).toMatch(/10/);
    expect(bad({ respostaPublica: ["a".repeat(301)] })).toMatch(/300/);
    expect(bad({ dm: { texto: "a".repeat(1001), botoes: [] } })).toMatch(/1000/);
    const btn = { titulo: "Abrir", url: "https://exemplo.com.br" };
    expect(bad({ dm: { texto: "oi", botoes: [btn, btn, btn, btn] } })).toMatch(/3/);
    expect(bad({ dm: { texto: "oi", botoes: [{ titulo: "x".repeat(21), url: btn.url }] } })).toMatch(/20/);
    expect(bad({ dm: { texto: "oi", botoes: [{ titulo: "Abrir", url: "http://exemplo.com.br" }] } })).toMatch(/https/);
    expect(bad({ gatilho: "dm", respostaPublica: ["oi"] })).toMatch(/comentário/);
    expect(bad({ gatilho: "dm", post: "123" })).toMatch(/comentário/);
    expect(bad({ gatilho: "story", respostaPublica: ["oi"] })).toMatch(/comentário/);
    expect(bad({ nome: "" })).toBeTruthy();
    expect(bad({ followUp: { depois: "8d", texto: "oi", botoes: [] } })).toMatch(/1 minuto e 7 dias/);
    expect(bad({ followUp: { depois: "2 horas", texto: "oi", botoes: [] } })).toMatch(/1 minuto e 7 dias/);
  });

  it("rejects_texts_over_640_chars_when_buttons_are_sent", () => {
    const long = "a".repeat(700);
    const btn = [{ titulo: "Abrir", url: "https://exemplo.com.br" }];
    const msg = (r: ReturnType<typeof parse>) => (r.success ? "" : r.error.issues.map((i) => i.message).join(" | "));
    expect(msg(parse({ dm: { texto: long, botoes: btn } }))).toMatch(/640/);
    expect(msg(parse({ dm: { texto: long, botoes: [] }, followUp: { depois: "2h", texto: "oi", botoes: [] } }))).toMatch(/640/);
    expect(msg(parse({ followUp: { depois: "2h", texto: long, botoes: btn } }))).toMatch(/640/);
    // sem botão em nenhuma mensagem, 700 caracteres seguem válidos (limite de 1000 bytes)
    expect(parse({ dm: { texto: long, botoes: [] } }).success).toBe(true);
    expect(parse({ gatilho: "dm", palavras: [], dm: { texto: long, botoes: [] }, followUp: { depois: "2h", texto: long, botoes: [] } }).success).toBe(true);
    expect(parse({ dm: { texto: "a".repeat(640), botoes: btn } }).success).toBe(true);
  });

  it("counts dm.texto limit in UTF-8 bytes", () => {
    expect(parse({ dm: { texto: "ã".repeat(500), botoes: [] } }).success).toBe(true);
    expect(parse({ dm: { texto: "ã".repeat(501), botoes: [] } }).success).toBe(false);
  });

  it("accepts dm and story triggers with umaVezPorContato", () => {
    expect(parse({ gatilho: "dm", palavras: [], umaVezPorContato: false }).success).toBe(true);
    expect(parse({ gatilho: "story", palavras: [] }).success).toBe(true);
  });
});

describe("parseDuration", () => {
  it("parses_durations", () => {
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("30min")).toBe(30);
    expect(parseDuration("1d")).toBe(1440);
    expect(parseDuration("90m")).toBe(90);
    expect(parseDuration(" 7d ")).toBe(10080);
    expect(parseDuration("0h")).toBeNull();
    expect(parseDuration("8d")).toBeNull();
    expect(parseDuration("2 horas")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});

describe("specToGraph", () => {
  it("comment_without_followup_sends_links_directly", () => {
    const spec = parsed({ respostaPublica: ["Te mandei no direct!"] });
    const g = specToGraph(spec, ctx);
    expect(g.nodes.map((n) => [n.id, n.type])).toEqual([
      ["t", "trigger"],
      ["m1", "message"],
      ["e", "end"],
    ]);
    expect(g.nodes[1]!.config).toMatchObject({
      mode: "text",
      text: "Aqui está o guia!",
      buttons: [{ title: "Abrir guia", kind: "url", url: "https://exemplo.com.br/guia" }],
    });
    expect(g.edges.map((e) => [e.source, e.target, e.sourceHandle])).toEqual([
      ["t", "m1", "default"],
      ["m1", "e", "default"],
    ]);
    expect(specToTrigger(spec, ctx)).toEqual({
      type: "instagram_comment",
      config: {
        channelId: CHANNEL,
        mediaId: null,
        keywords: ["quero"],
        mode: "contains",
        oncePerUser: true,
        publicReplies: ["Te mandei no direct!"],
      },
    });
  });

  it("uses a specific post and any keyword when palavras is empty", () => {
    const spec = parsed({ palavras: [], post: "17890000000000000" });
    expect(specToTrigger(spec, ctx).config).toMatchObject({
      mediaId: "17890000000000000",
      anyKeyword: true,
      keywords: [],
      mode: "any",
    });
  });

  it("comment_with_followup_uses_opening_button", () => {
    const spec = parsed({ followUp: { depois: "2h", texto: "Conseguiu ver?", botoes: [] } });
    const g = specToGraph(spec, ctx);
    expect(g.nodes.map((n) => [n.id, n.type])).toEqual([
      ["t", "trigger"],
      ["m1", "message"],
      ["m2", "message"],
      ["d1", "delay"],
      ["m3", "message"],
      ["e", "end"],
    ]);
    const open = g.nodes[1]!.config as { buttons: { id: string; title: string; kind: string }[] };
    expect(open.buttons).toHaveLength(1);
    expect(open.buttons[0]).toMatchObject({ title: "Quero!", kind: "path" });
    expect(g.nodes[2]!.config).toMatchObject({ buttons: [{ kind: "url", url: "https://exemplo.com.br/guia" }] });
    expect(g.nodes[3]!.config).toEqual({ minutes: 120 });
    expect(g.nodes[4]!.config).toMatchObject({ text: "Conseguiu ver?" });
    const openId = open.buttons[0]!.id;
    expect(g.edges.map((e) => [e.source, e.target, e.sourceHandle])).toEqual([
      ["t", "m1", "default"],
      ["m1", "m2", `opt:${openId}`],
      ["m1", "e", "no_reply"],
      ["m2", "d1", "default"],
      ["d1", "m3", "default"],
      ["m3", "e", "default"],
    ]);
    const custom = specToGraph(parsed({ botaoDeAbertura: "Me manda", followUp: { depois: "1d", texto: "oi", botoes: [] } }), ctx);
    expect((custom.nodes[1]!.config as { buttons: { title: string }[] }).buttons[0]!.title).toBe("Me manda");
  });

  it("dm_and_story_triggers_have_no_opening_button", () => {
    const followUp = { depois: "30min", texto: "Lembrete", botoes: [] };
    const dm = parsed({ gatilho: "dm", palavras: [], followUp });
    const gDm = specToGraph(dm, ctx);
    expect(specToTrigger(dm, ctx)).toEqual({ type: "keyword_detected", config: { anyKeyword: true, keywords: [], mode: "any" } });
    expect(gDm.nodes.map((n) => n.id)).toEqual(["t", "m1", "d1", "m3", "e"]);
    expect((gDm.nodes[1]!.config as { buttons?: { kind: string }[] }).buttons?.every((b) => b.kind === "url")).toBe(true);

    const story = parsed({ gatilho: "story", palavras: [] });
    expect(specToTrigger(story, ctx)).toEqual({ type: "instagram_story", config: { channelId: CHANNEL } });
    expect(specToGraph(story, ctx).nodes.map((n) => n.id)).toEqual(["t", "m1", "e"]);

    const dmWords = parsed({ gatilho: "dm", palavras: ["preço"] });
    expect(specToTrigger(dmWords, ctx).config).toEqual({ keywords: ["preço"], mode: "contains" });
  });

  it("graph_is_valid", () => {
    const variants = [
      parsed(),
      parsed({ dm: { texto: "Só texto", botoes: [] } }),
      parsed({ followUp: { depois: "2h", texto: "Oi", botoes: [{ titulo: "Ver", url: "https://exemplo.com.br" }] } }),
      parsed({ gatilho: "dm", palavras: [], followUp: { depois: "1d", texto: "Oi", botoes: [] } }),
      parsed({ gatilho: "story", palavras: [] }),
    ];
    const refs = { tagIds: [], stageIds: [], userIds: [], channelIds: [CHANNEL], sequenceIds: [], entryLinkIds: [] };
    for (const spec of variants) {
      const g = specToGraph(spec, ctx);
      expect(automationGraphSchema.safeParse(g).success).toBe(true);
      expect(validateGraph(g, specToTrigger(spec, ctx), refs)).toEqual([]);
    }
  });

  it("throws on an unparseable follow-up delay", () => {
    const spec = { ...parsed(), followUp: { depois: "2 horas", texto: "Oi", botoes: [] } } as AutomationSpec;
    expect(() => specToGraph(spec, ctx)).toThrow(/inválida/);
  });

  it("positions nodes in a column", () => {
    const g = specToGraph(parsed({ followUp: { depois: "2h", texto: "Oi", botoes: [] } }), ctx);
    expect(g.nodes.map((n) => n.position)).toEqual([0, 160, 320, 480, 640, 800].map((y) => ({ x: 0, y })));
  });
});

describe("mergeSpec and summarizeSpec", () => {
  it("merge_and_summary", () => {
    const withFollow = parsed({ followUp: { depois: "2h", texto: "Oi", botoes: [] } });
    const merged = mergeSpec(withFollow, { followUp: null, nome: "Novo nome" });
    expect(merged.followUp).toBeUndefined();
    expect(merged.nome).toBe("Novo nome");
    expect(withFollow.followUp).toBeDefined();

    const replaced = mergeSpec(withFollow, { dm: { texto: "Outra", botoes: [] } });
    expect(replaced.dm).toEqual({ texto: "Outra", botoes: [] });
    expect(replaced.followUp).toEqual(withFollow.followUp);

    const withOpening = parsed({ botaoDeAbertura: "Me manda", followUp: { depois: "2h", texto: "Oi", botoes: [] } });
    expect(mergeSpec(withOpening, { botaoDeAbertura: null }).botaoDeAbertura).toBeUndefined();
    expect("botaoDeAbertura" in mergeSpec(withOpening, { botaoDeAbertura: null })).toBe(false);
    expect(mergeSpec(withOpening, { nome: "x" }).botaoDeAbertura).toBe("Me manda");

    const summary = summarizeSpec(withFollow);
    expect(summary).toContain("Link do guia");
    expect(summary).toMatch(/coment/i);
    expect(summary).toContain("quero");
    expect(summary.split("\n").length).toBeLessThanOrEqual(6);
  });
});
