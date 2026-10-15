import type { TriggerType } from "@flowai/core";
import { numberOrNull, rec, str } from "@/lib/automation/config-utils";

/** Conversões entre a config salva de cada passo e os valores dos campos do formulário (puras). */

export function cleanKeywords(list: unknown): string[] {
  return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean) : [];
}

// ── Mensagem ───────────────────────────────────────────────────────────
export type ButtonValue = { id: string; title: string; kind: "path" | "url"; url: string };
export type QuickValue = { id: string; title: string };
export type MessageValues = {
  mode: "text" | "ai";
  text: string;
  options: "none" | "buttons" | "quickReplies";
  buttons: ButtonValue[];
  quickReplies: QuickValue[];
  replyTimeoutHours: number;
};

export function messageToValues(config: unknown): MessageValues {
  const c = rec(config);
  const buttons: ButtonValue[] = Array.isArray(c.buttons)
    ? c.buttons.map((b) => {
        const r = rec(b);
        return { id: str(r.id), title: str(r.title), kind: r.kind === "url" ? "url" : "path", url: str(r.url) };
      })
    : [];
  const quickReplies = Array.isArray(c.quickReplies) ? c.quickReplies.map((q) => ({ id: str(rec(q).id), title: str(rec(q).title) })) : [];
  return {
    mode: c.mode === "ai" ? "ai" : "text",
    text: str(c.text),
    options: buttons.length ? "buttons" : quickReplies.length ? "quickReplies" : "none",
    buttons,
    quickReplies,
    replyTimeoutHours: typeof c.replyTimeoutHours === "number" ? c.replyTimeoutHours : 24,
  };
}

export function messageToConfig(v: MessageValues): unknown {
  if (v.mode === "ai") return { mode: "ai" };
  const config: Record<string, unknown> = { mode: "text", text: v.text ?? "" };
  if (v.options === "buttons" && v.buttons?.length) {
    config.buttons = v.buttons.map((b) => {
      if (b.kind !== "url") return { id: b.id, title: b.title, kind: "path" };
      const url = b.url?.trim();
      return url ? { id: b.id, title: b.title, kind: "url", url } : { id: b.id, title: b.title, kind: "url" };
    });
  }
  if (v.options === "quickReplies" && v.quickReplies?.length) {
    config.quickReplies = v.quickReplies.map((q) => ({ id: q.id, title: q.title }));
  }
  config.replyTimeoutHours = numberOrNull(v.replyTimeoutHours);
  return config;
}

// ── Condição ───────────────────────────────────────────────────────────
export type ConditionKind = "keyword" | "has_tag" | "stage_is" | "lead_score_gte" | "intent_is" | "business_hours";
export const CONDITION_KINDS: ConditionKind[] = ["keyword", "has_tag", "stage_is", "lead_score_gte", "intent_is", "business_hours"];
export type ConditionValues = {
  kind: ConditionKind;
  keywords: string[];
  mode: string;
  tagId: string;
  stageId: string;
  value: number;
  intent: string;
  /** Checkboxes devolvem texto; a config guarda números (1 = segunda ... 7 = domingo). */
  days: string[];
  start: string;
  end: string;
};

export function conditionToValues(config: unknown): ConditionValues {
  const c = rec(config);
  return {
    kind: (CONDITION_KINDS as string[]).includes(str(c.kind)) ? (c.kind as ConditionKind) : "keyword",
    keywords: Array.isArray(c.keywords) ? (c.keywords as string[]) : [],
    mode: str(c.mode, "contains"),
    tagId: str(c.tagId),
    stageId: str(c.stageId),
    value: typeof c.value === "number" ? c.value : 50,
    intent: str(c.intent),
    days: Array.isArray(c.days) ? c.days.map(String) : ["1", "2", "3", "4", "5"],
    start: str(c.start, "09:00"),
    end: str(c.end, "18:00"),
  };
}

export function conditionToConfig(v: ConditionValues): unknown {
  switch (v.kind) {
    case "keyword":
      return { kind: v.kind, keywords: cleanKeywords(v.keywords), mode: v.mode };
    case "has_tag":
      return { kind: v.kind, tagId: v.tagId };
    case "stage_is":
      return { kind: v.kind, stageId: v.stageId };
    case "lead_score_gte":
      return { kind: v.kind, value: numberOrNull(v.value) };
    case "intent_is":
      return { kind: v.kind, intent: v.intent };
    case "business_hours":
      return { kind: v.kind, days: (v.days ?? []).map(Number).sort((a, b) => a - b), start: v.start, end: v.end };
  }
}

// ── Espera ─────────────────────────────────────────────────────────────
export type DelayUnit = "minutes" | "hours" | "days";
export type DelayValues = { amount: number; unit: DelayUnit };
const UNIT_MINUTES: Record<DelayUnit, number> = { minutes: 1, hours: 60, days: 1440 };

export function delayToValues(config: unknown): DelayValues {
  const m = numberOrNull(rec(config).minutes) ?? 60;
  if (m > 0 && m % 1440 === 0) return { amount: m / 1440, unit: "days" };
  if (m > 0 && m % 60 === 0) return { amount: m / 60, unit: "hours" };
  return { amount: m, unit: "minutes" };
}

export function delayToConfig(v: DelayValues): unknown {
  const amount = numberOrNull(v.amount);
  return { minutes: amount === null ? null : Math.round(amount * UNIT_MINUTES[v.unit]) };
}

// ── Gatilho ────────────────────────────────────────────────────────────
export type TriggerValues = {
  firstMessageOnly: boolean;
  anyKeyword: boolean;
  keywords: string[];
  mode: string;
  channelId: string;
  mediaId: string;
  tagId: string;
  stageId: string;
  linkIds: string[];
};

export function triggerToValues(config: unknown): TriggerValues {
  const c = rec(config);
  const isAny = c.anyKeyword === true || c.mode === "any";
  return {
    firstMessageOnly: c.firstMessageOnly === true,
    anyKeyword: isAny,
    keywords: Array.isArray(c.keywords) ? (c.keywords as string[]) : [],
    mode: isAny ? "any" : str(c.mode, "contains"),
    channelId: str(c.channelId),
    mediaId: str(c.mediaId),
    tagId: str(c.tagId),
    stageId: str(c.stageId),
    linkIds: Array.isArray(c.linkIds) ? c.linkIds.filter((id): id is string => typeof id === "string") : [],
  };
}

export function triggerToConfig(type: TriggerType, v: TriggerValues): unknown {
  switch (type) {
    case "message_received":
      return { firstMessageOnly: !!v.firstMessageOnly };
    case "keyword_detected":
      return {
        ...(v.anyKeyword ? { anyKeyword: true } : {}),
        keywords: v.anyKeyword ? [] : cleanKeywords(v.keywords),
        mode: v.anyKeyword ? "any" : v.mode === "any" ? "contains" : v.mode,
      };
    case "instagram_comment":
      return {
        channelId: v.channelId,
        mediaId: v.mediaId?.trim() || null,
        ...(v.anyKeyword ? { anyKeyword: true } : {}),
        keywords: v.anyKeyword ? [] : cleanKeywords(v.keywords),
        mode: v.anyKeyword ? "any" : v.mode === "any" ? "contains" : v.mode,
      };
    case "instagram_story":
      return { channelId: v.channelId };
    case "contact_created":
      return {};
    case "tag_added":
      return { tagId: v.tagId || null };
    case "stage_changed":
      return { stageId: v.stageId || null };
    case "entry_link":
      return { linkIds: v.linkIds ?? [] };
  }
}
