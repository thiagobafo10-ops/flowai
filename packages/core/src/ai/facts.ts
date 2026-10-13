export type FactKind = "money" | "percent" | "duration" | "date" | "quantity";
export type Fact = { kind: FactKind; raw: string; value: string; unit?: string };

const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?`;

function canon(n: string): string {
  const s = n.replace(/\.(?=\d{3}(?!\d))/g, "").replace(",", ".");
  return String(Number(s));
}

const DURATION_UNITS: Record<string, string> = {
  dia: "dia", dias: "dia",
  h: "hora", hora: "hora", horas: "hora",
  semana: "semana", semanas: "semana",
  mes: "mes", meses: "mes", "mês": "mes",
  min: "minuto", minuto: "minuto", minutos: "minuto",
};

const QUANTITY_RE = new RegExp(String.raw`(?<![\d.,/])(${NUM})\s*(unidades?|pe[çc]as?|itens?|pcs)(?![\p{L}\d])`, "giu");
const MONEY_RE = new RegExp(String.raw`(?:R\$\s*(${NUM}))|(?:(?<![\d.,/])(${NUM})\s*reais\b)`, "gi");
const PERCENT_RE = new RegExp(String.raw`(?<![\d.,/])(${NUM})\s*%`, "g");
const DURATION_RE = new RegExp(String.raw`(?<![\d.,/])(${NUM})\s*(dias?|horas?|h|semanas?|meses|mes|mês|minutos?|min)(?![\p{L}\d])`, "giu");
const DATE_RE = /(?<![\d./])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/g;

export function extractFacts(text: string): Fact[] {
  const out: Fact[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    out.push({ kind: "money", raw: m[0].trim(), value: canon((m[1] ?? m[2])!) });
  }
  for (const m of text.matchAll(PERCENT_RE)) {
    out.push({ kind: "percent", raw: m[0].trim(), value: canon(m[1]!) });
  }
  for (const m of text.matchAll(DURATION_RE)) {
    out.push({ kind: "duration", raw: m[0].trim(), value: canon(m[1]!), unit: DURATION_UNITS[m[2]!.toLowerCase()] });
  }
  for (const m of text.matchAll(DATE_RE)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    out.push({ kind: "date", raw: m[0].trim(), value: `${d}/${mo}` });
  }
  for (const m of text.matchAll(QUANTITY_RE)) {
    out.push({ kind: "quantity", raw: m[0].trim(), value: canon(m[1]!), unit: "unidade" });
  }
  return out;
}

const key = (f: Fact) => `${f.kind}|${f.value}|${f.unit ?? ""}`;

export function verifyFacts(reply: string, sources: string[]): { ok: boolean; unverified: string[] } {
  const known = new Set(sources.flatMap((s) => extractFacts(s)).map(key));
  const unverified: string[] = [];
  for (const f of extractFacts(reply)) {
    if (!known.has(key(f)) && !unverified.includes(f.raw)) unverified.push(f.raw);
  }
  return { ok: unverified.length === 0, unverified };
}
