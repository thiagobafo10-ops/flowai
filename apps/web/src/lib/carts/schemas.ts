import { z } from "zod";
import { COMMERCIAL_LABELS, STAGE_LABELS } from "./labels";

export type SearchParams = Record<string, string | string[] | undefined>;
export type CartPeriod = "all" | "today" | "7d" | "30d" | "custom";
export type CartFilters = {
  q: string;
  period: CartPeriod;
  /** yyyy-MM-dd (só no período custom) */
  from: string;
  to: string;
  commercialStatus: keyof typeof COMMERCIAL_LABELS | null;
  recoveryStage: keyof typeof STAGE_LABELS | null;
  eligible: boolean | null;
  page: number;
  pageSize: number;
  error: string | null;
};

export const CARTS_PAGE_SIZE = 25;
const MAX_RANGE_DAYS = 366;
const DAY = 86_400_000;
// São Paulo não tem horário de verão desde 2019: o deslocamento é fixo.
const SP = "-03:00";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(values: readonly T[], v: string | undefined) =>
  (values as readonly string[]).includes(v ?? "") ? (v as T) : null;
const clamp = (v: string | undefined, fallback: number, max: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : fallback;
};
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)));
const day = (s: string) => Date.parse(`${s}T00:00:00Z`);

export function parseCartFilters(sp: SearchParams): CartFilters {
  const period = pick(["all", "today", "7d", "30d", "custom"], one(sp.periodo)) ?? "all";
  const from = dateStr.safeParse(one(sp.de)).data ?? "";
  const to = dateStr.safeParse(one(sp.ate)).data ?? "";
  let error: string | null = null;
  if (period === "custom") {
    if (!from || !to) error = "Informe as datas.";
    else if (day(to) < day(from)) error = "A data final deve ser depois da inicial.";
    else if ((day(to) - day(from)) / DAY + 1 > MAX_RANGE_DAYS) error = "O período deve ter no máximo 366 dias.";
  }
  const elegivel = one(sp.elegivel);
  return {
    q: (one(sp.q) ?? "").trim().slice(0, 100),
    period,
    from,
    to,
    commercialStatus: pick(Object.keys(COMMERCIAL_LABELS) as (keyof typeof COMMERCIAL_LABELS)[], one(sp.comercial)),
    recoveryStage: pick(Object.keys(STAGE_LABELS) as (keyof typeof STAGE_LABELS)[], one(sp.estagio)),
    eligible: elegivel === "sim" ? true : elegivel === "nao" ? false : null,
    page: clamp(one(sp.pagina), 1, 100000),
    pageSize: clamp(one(sp.limite), CARTS_PAGE_SIZE, 100),
    error,
  };
}

const startOfDay = (s: string) => new Date(`${s}T00:00:00${SP}`).toISOString();
const addDays = (s: string, n: number) => new Date(day(s) + n * DAY).toISOString().slice(0, 10);

/** Filtros no formato de list_store_carts: `from` inclusivo, `to` exclusivo. */
export function toRpcFilters(f: CartFilters, now = new Date()): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (f.q) out.q = /^\+?[\d\s()-]+$/.test(f.q) ? f.q.replace(/\D/g, "") : f.q;
  const today = new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  if (f.period === "today") out.from = startOfDay(today);
  else if (f.period === "7d") out.from = startOfDay(addDays(today, -6));
  else if (f.period === "30d") out.from = startOfDay(addDays(today, -29));
  else if (f.period === "custom" && !f.error) {
    out.from = startOfDay(f.from);
    out.to = startOfDay(addDays(f.to, 1));
  }
  if (f.commercialStatus) out.commercialStatus = f.commercialStatus;
  if (f.recoveryStage) out.recoveryStage = f.recoveryStage;
  if (f.eligible !== null) out.eligible = f.eligible;
  return out;
}

/** Monta /carrinhos com os filtros atuais (padrões omitidos), com ajustes opcionais. */
export function cartsHref(f: CartFilters, patch: Partial<CartFilters> = {}): string {
  const x = { ...f, ...patch };
  const p = new URLSearchParams();
  if (x.q) p.set("q", x.q);
  if (x.period !== "all") p.set("periodo", x.period);
  if (x.period === "custom") {
    if (x.from) p.set("de", x.from);
    if (x.to) p.set("ate", x.to);
  }
  if (x.commercialStatus) p.set("comercial", x.commercialStatus);
  if (x.recoveryStage) p.set("estagio", x.recoveryStage);
  if (x.eligible !== null) p.set("elegivel", x.eligible ? "sim" : "nao");
  if (x.pageSize !== CARTS_PAGE_SIZE) p.set("limite", String(x.pageSize));
  if (x.page > 1) p.set("pagina", String(x.page));
  const qs = p.toString();
  return qs ? `/carrinhos?${qs}` : "/carrinhos";
}
