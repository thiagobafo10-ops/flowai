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
    closed: firstParam(sp, "encerrados") === "todos" ? "todos" : "30d",
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

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Busca do quadro: contato, telefone, e-mail ou título (sem acento, sem caixa).
 * Com 3 ou mais dígitos na busca, compara também só os dígitos do telefone.
 */
export function matchesDealQuery(
  query: string,
  deal: { contactName: string; phone: string | null; email: string | null; title: string },
): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const text = fold(`${deal.contactName} ${deal.phone ?? ""} ${deal.email ?? ""} ${deal.title}`);
  if (text.includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  return digits.length >= 3 && !!deal.phone && deal.phone.replace(/\D/g, "").includes(digits);
}
