import { z } from "zod";
import type { ContactSource, ContactStatus } from "./labels.ts";

export const CONTACTS_PAGE_SIZE = 25;

export type SearchParams = Record<string, string | string[] | undefined>;

export type ContactOrder = "interacao" | "nome" | "criado" | "score";

export interface ContactFilters {
  q: string;
  status: ContactStatus | null;
  tagId: string | null;
  assignee: string | "nenhum" | null;
  source: ContactSource | null;
  order: ContactOrder;
  page: number;
}

export function firstParam(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export function uuidOrNull(v: string | undefined): string | null {
  return v !== undefined && z.uuid().safeParse(v).success ? v : null;
}

export function parseQuery(v: string | undefined): string {
  return (v ?? "").trim().slice(0, 100).trim();
}

function oneOf<T extends string>(v: string | undefined, allowed: readonly T[]): T | null {
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export function parseContactFilters(sp: SearchParams): ContactFilters {
  const assigneeRaw = firstParam(sp, "responsavel");
  const pageRaw = firstParam(sp, "pagina");
  const page = pageRaw !== undefined && /^\d+$/.test(pageRaw) ? Number(pageRaw) : 1;
  return {
    q: parseQuery(firstParam(sp, "q")),
    status: oneOf(firstParam(sp, "status"), ["lead", "customer", "inactive"] as const),
    tagId: uuidOrNull(firstParam(sp, "tag")),
    assignee: assigneeRaw === "nenhum" ? "nenhum" : uuidOrNull(assigneeRaw),
    source: oneOf(firstParam(sp, "origem"), ["whatsapp", "instagram", "manual"] as const),
    order: oneOf(firstParam(sp, "ordem"), ["interacao", "nome", "criado", "score"] as const) ?? "interacao",
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
  };
}
