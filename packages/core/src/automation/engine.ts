import { nodeConfigSchemas, type AutomationGraph, type NodeType } from "./schemas.ts";
import { matchKeyword, normalizeText, renderTemplate } from "./text.ts";

export const MAX_STEPS = 50;

export type RunContext = {
  contact: { name: string | null; tagIds: string[]; stageId: string | null; leadScore: number | null };
  lastInboundText: string | null;
  lastIntent: string | null;
  now: string;
  timezone: string;
  channelType: "simulator" | "instagram";
};

export type Effect =
  | {
      type: "send_text";
      text: string;
      buttons?: { id: string; title: string; kind: "path" | "url"; url?: string }[];
      quickReplies?: { id: string; title: string }[];
    }
  | { type: "ai_message" }
  | { type: "add_tag"; tagId: string }
  | { type: "remove_tag"; tagId: string }
  | { type: "assign_user"; userId: string }
  | { type: "move_stage"; stageId: string }
  | { type: "webhook"; url: string }
  | { type: "close_conversation" }
  | { type: "handoff_ai" }
  | { type: "handoff_human" }
  | { type: "sequence_enroll"; sequenceId: string }
  | { type: "sequence_remove"; sequenceId: string };

export type NodeOutcome =
  | { effects: Effect[]; route: { handle: string } }
  | { effects: Effect[]; route: { waitReply: { until: string } } }
  | { effects: Effect[]; route: { waitDelay: { until: string } } }
  | { effects: Effect[]; route: { awaitEffect: true } }
  | { effects: []; route: { end: true } };

type GraphNode = AutomationGraph["nodes"][number];

type TextMessage = {
  mode: "text";
  text: string;
  buttons?: { id: string; title: string; kind: "path" | "url"; url?: string }[];
  quickReplies?: { id: string; title: string }[];
  replyTimeoutHours: number;
};
type Condition =
  | { kind: "keyword"; keywords: string[]; mode: "contains" | "equals" | "starts_with" }
  | { kind: "has_tag"; tagId: string }
  | { kind: "stage_is"; stageId: string }
  | { kind: "lead_score_gte"; value: number }
  | { kind: "intent_is"; intent: string }
  | { kind: "business_hours"; days: number[]; start: string; end: string };

function parseConfig<T>(type: NodeType, config: unknown): T {
  const parsed = nodeConfigSchemas[type].safeParse(config);
  if (!parsed.success) throw new Error(`invalid_node_config: ${type}`);
  return parsed.data as T;
}

const addMs = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function localWeekdayAndMinutes(nowIso: string, timezone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowIso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = WEEKDAYS[get("weekday")];
  if (!weekday) throw new Error("invalid_node_config: business_hours timezone");
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function evaluateCondition(config: unknown, ctx: RunContext): boolean {
  const c = parseConfig<Condition>("condition", config);
  switch (c.kind) {
    case "keyword":
      return ctx.lastInboundText === null ? false : matchKeyword(ctx.lastInboundText, c.keywords, c.mode);
    case "has_tag":
      return ctx.contact.tagIds.includes(c.tagId);
    case "stage_is":
      return ctx.contact.stageId === c.stageId;
    case "lead_score_gte":
      return ctx.contact.leadScore !== null && ctx.contact.leadScore >= c.value;
    case "intent_is":
      return ctx.lastIntent !== null && normalizeText(ctx.lastIntent) === normalizeText(c.intent);
    case "business_hours": {
      const { weekday, minutes } = localWeekdayAndMinutes(ctx.now, ctx.timezone);
      return c.days.includes(weekday) && minutes >= toMinutes(c.start) && minutes < toMinutes(c.end);
    }
  }
}

export function executeNode(graph: AutomationGraph, nodeId: string, ctx: RunContext): NodeOutcome {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error("node_not_found");
  const next = (effects: Effect[]): NodeOutcome => ({ effects, route: { handle: "default" } });

  switch (node.type) {
    case "trigger":
      return next([]);
    case "message": {
      const m = parseConfig<{ mode: "ai" } | TextMessage>("message", node.config);
      if (m.mode === "ai") return { effects: [{ type: "ai_message" }], route: { awaitEffect: true } };
      const send: Effect = { type: "send_text", text: renderTemplate(m.text, ctx.contact) };
      if (m.buttons?.length) send.buttons = m.buttons;
      if (m.quickReplies?.length) send.quickReplies = m.quickReplies;
      const waits = !!m.quickReplies?.length || !!m.buttons?.some((b) => b.kind === "path");
      if (!waits) return next([send]);
      return { effects: [send], route: { waitReply: { until: addMs(ctx.now, m.replyTimeoutHours * 3_600_000) } } };
    }
    case "condition":
      return { effects: [], route: { handle: evaluateCondition(node.config, ctx) ? "true" : "false" } };
    case "delay": {
      const { minutes } = parseConfig<{ minutes: number }>("delay", node.config);
      return { effects: [], route: { waitDelay: { until: addMs(ctx.now, minutes * 60_000) } } };
    }
    case "tag":
      return next([{ type: "add_tag", tagId: parseConfig<{ tagId: string }>("tag", node.config).tagId }]);
    case "remove_tag":
      return next([{ type: "remove_tag", tagId: parseConfig<{ tagId: string }>("remove_tag", node.config).tagId }]);
    case "assign_user":
      return next([{ type: "assign_user", userId: parseConfig<{ userId: string }>("assign_user", node.config).userId }]);
    case "move_stage":
      return next([{ type: "move_stage", stageId: parseConfig<{ stageId: string }>("move_stage", node.config).stageId }]);
    case "webhook": {
      const { url } = parseConfig<{ url: string }>("webhook", node.config);
      return { effects: [{ type: "webhook", url }], route: { awaitEffect: true } };
    }
    case "close_conversation":
      parseConfig("close_conversation", node.config);
      return next([{ type: "close_conversation" }]);
    case "handoff_ai":
      parseConfig("handoff_ai", node.config);
      return next([{ type: "handoff_ai" }]);
    case "handoff_human":
      parseConfig("handoff_human", node.config);
      return next([{ type: "handoff_human" }]);
    case "sequence_enroll":
    case "sequence_remove": {
      const { sequenceId } = parseConfig<{ sequenceId: string }>(node.type, node.config);
      return next([{ type: node.type, sequenceId }]);
    }
    case "end":
      return { effects: [], route: { end: true } };
  }
}

export function nextNode(graph: AutomationGraph, nodeId: string, handle: string): string | null {
  return graph.edges.find((e) => e.source === nodeId && e.sourceHandle === handle)?.target ?? null;
}

export function resolveReply(node: GraphNode, input: { optionId: string | null; text: string | null }): string {
  if (node.type !== "message") return "no_reply";
  const parsed = nodeConfigSchemas.message.safeParse(node.config);
  if (!parsed.success) return "no_reply";
  const m = parsed.data as { mode: string; buttons?: TextMessage["buttons"]; quickReplies?: TextMessage["quickReplies"] };
  if (m.mode !== "text") return "no_reply";
  const options = [...(m.buttons ?? []).filter((b) => b.kind === "path"), ...(m.quickReplies ?? [])];
  if (input.optionId !== null) {
    const hit = options.find((o) => o.id === input.optionId);
    if (hit) return `opt:${hit.id}`;
  }
  if (input.text !== null) {
    const t = normalizeText(input.text);
    if (t) {
      const hit = options.find((o) => normalizeText(o.title) === t);
      if (hit) return `opt:${hit.id}`;
    }
  }
  return "no_reply";
}
