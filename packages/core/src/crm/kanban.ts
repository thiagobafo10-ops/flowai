import { firstParam, parseQuery, uuidOrNull, type SearchParams } from "./filters.ts";

export interface KanbanFilters {
  q: string;
  ownerId: string | null;
  closed: "30d" | "todos";
}

export function parseKanbanFilters(sp: SearchParams): KanbanFilters {
  return {
    q: parseQuery(firstParam(sp, "q")),
    ownerId: uuidOrNull(firstParam(sp, "responsavel")),
    closed: firstParam(sp, "fechados") === "todos" ? "todos" : "30d",
  };
}

export function columnTotals(
  deals: { stageId: string; value: number }[],
): Record<string, { count: number; value: number }> {
  const out: Record<string, { count: number; value: number }> = {};
  for (const d of deals) {
    const col = (out[d.stageId] ??= { count: 0, value: 0 });
    col.count += 1;
    col.value += d.value;
  }
  for (const col of Object.values(out)) col.value = Math.round(col.value * 100) / 100;
  return out;
}
