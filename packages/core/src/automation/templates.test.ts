import { describe, expect, it } from "vitest";
import { automationTemplates, TEMPLATE_PLACEHOLDER } from "./templates.ts";
import { automationGraphSchema } from "./schemas.ts";
import { validateGraph } from "./validate.ts";

const refs = {
  tagIds: [TEMPLATE_PLACEHOLDER.tagId],
  stageIds: [TEMPLATE_PLACEHOLDER.stageId],
  userIds: [],
  channelIds: [TEMPLATE_PLACEHOLDER.channelId],
};

describe("automationTemplates", () => {
  it("exposes the three named templates", () => {
    expect(automationTemplates.map((t) => [t.key, t.name])).toEqual([
      ["comment_link", "Responder comentário com link"],
      ["welcome_direct", "Boas-vindas no Direct"],
      ["qualify_buttons", "Qualificar lead com botões"],
    ]);
  });

  it.each(automationTemplates.map((t) => [t.key, t] as const))("%s is a valid graph with placeholder refs", (_key, t) => {
    expect(automationGraphSchema.safeParse(t.graph).success).toBe(true);
    expect(validateGraph(t.graph, { type: t.triggerType, config: t.triggerConfig }, refs)).toEqual([]);
  });

  it("reports unknown refs when the placeholders are not provided", () => {
    const t = automationTemplates.find((x) => x.key === "qualify_buttons")!;
    const codes = validateGraph(t.graph, { type: t.triggerType, config: t.triggerConfig }, { tagIds: [], stageIds: [], userIds: [], channelIds: [] }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["unknown_tag", "unknown_stage"]));
  });

  it("comment_link starts with the Quero path button and its no_reply reaches no message", () => {
    const t = automationTemplates.find((x) => x.key === "comment_link")!;
    const ask = t.graph.nodes.find((n) => n.id === "ask")!.config as { buttons: { title: string; kind: string }[] };
    expect(ask.buttons).toEqual([expect.objectContaining({ title: "Quero", kind: "path" })]);
    const silent = t.graph.edges.find((e) => e.source === "ask" && e.sourceHandle === "no_reply")!;
    expect(t.graph.nodes.find((n) => n.id === silent.target)!.type).toBe("end");
  });

  it("qualify_buttons ends at the human handoff (terminal block without outputs)", () => {
    const t = automationTemplates.find((x) => x.key === "qualify_buttons")!;
    const handoff = t.graph.nodes.find((n) => n.type === "handoff_human")!;
    expect(t.graph.edges.filter((e) => e.source === handoff.id)).toEqual([]);
    expect(t.graph.edges.some((e) => e.target === handoff.id)).toBe(true);
  });

  it("uses fixed v4-shaped placeholder UUIDs", () => {
    for (const id of Object.values(TEMPLATE_PLACEHOLDER)) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
