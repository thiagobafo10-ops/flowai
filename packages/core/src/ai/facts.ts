export type FactKind = "money" | "percent" | "duration" | "date" | "quantity";
export type Fact = { kind: FactKind; raw: string; value: string; unit?: string };

const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?`;
const NB = String.raw`(?<![\d.,/])`; // not glued to a previous number
const END = String.raw`(?![\p{L}\d])`;
const MIL = String.raw`(mil|milh(?:ão|ões|ao|oes))`;

function canon(n: string): string {
  const s = n.replace(/\.(?=\d{3}(?!\d))/g, "").replace(",", ".");
  return String(Number(s));
}
function scaled(n: string, mult?: string): string {
  const base = Number(canon(n));
  if (!mult) return String(base);
  const f = mult.toLowerCase().startsWith("milh") ? 1_000_000 : 1000;
  return String(Math.round(base * f * 1e6) / 1e6);
}

const DURATION_UNITS: Record<string, string> = {
  dia: "dia", dias: "dia",
  h: "hora", hr: "hora", hrs: "hora", hs: "hora", hora: "hora", horas: "hora",
  semana: "semana", semanas: "semana",
  mes: "mes", meses: "mes", "mês": "mes",
  ano: "ano", anos: "ano",
  min: "minuto", mins: "minuto", minuto: "minuto", minutos: "minuto",
};
const DUR_UNIT_RE = String.raw`dias?|horas?|hrs?|hs|h|semanas?|meses|mes|mês|anos?|minutos?|mins?`;
const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};
const MONTH_RE = Object.keys(MONTHS).join("|");

const MONEY_SYM_RE = new RegExp(String.raw`(R\$|US\$|\$)\s*(${NUM})(?:\s*${MIL}${END})?`, "giu");
const MONEY_WORD_RE = new RegExp(String.raw`${NB}(${NUM})(?:\s*${MIL})?\s*(reais|real|d[óo]lares|d[óo]lar)${END}`, "giu");
const PERCENT_RE = new RegExp(String.raw`${NB}(${NUM})\s*(?:%|por\s*cento${END})`, "giu");
const RANGE = String.raw`(?:\s*(?:a|à|-|–|—|até|ou)\s*(${NUM}))?`;
const DURATION_RE = new RegExp(String.raw`${NB}(${NUM})${RANGE}\s*(${DUR_UNIT_RE})${END}`, "giu");
const QUANTITY_RE = new RegExp(String.raw`${NB}(${NUM})${RANGE}\s*(unidades?|pe[çc]as?|itens?|pcs|parcelas?|vezes)${END}`, "giu");
const INSTALLMENT_RE = new RegExp(String.raw`${NB}(\d+)\s*x${END}`, "giu");
const DATE_RE = /(?<![\d./])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/g;
const DATE_NAMED_RE = new RegExp(String.raw`(?<![\d./])(\d{1,2})\s*º?\s+de\s+(${MONTH_RE})(?:\s+de\s+\d{4})?${END}`, "giu");
const DAY_ONLY_RE = new RegExp(
  String.raw`(?<![\p{L}])dia\s+(\d{1,2})(?![\d/])(?!\s*º?\s+de\s+(?:${MONTH_RE}))(?!\s*(?:dias?|horas?))`,
  "giu",
);

const W =
  "zero|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|duzentas|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|mil|meio|meia";
const WORD_UNITS: Record<string, { kind: FactKind; unit: string }> = {
  reais: { kind: "money", unit: "brl" }, real: { kind: "money", unit: "brl" },
  "dólares": { kind: "money", unit: "usd" }, dolares: { kind: "money", unit: "usd" },
  "dólar": { kind: "money", unit: "usd" }, dolar: { kind: "money", unit: "usd" },
  "por cento": { kind: "percent", unit: "" },
  parcela: { kind: "quantity", unit: "parcela" }, parcelas: { kind: "quantity", unit: "parcela" },
  unidade: { kind: "quantity", unit: "unidade" }, unidades: { kind: "quantity", unit: "unidade" },
  vezes: { kind: "quantity", unit: "parcela" },
};
const WORD_RE = new RegExp(
  String.raw`(?<![\p{L}\d])(?<![\d.,]\s*)((?:${W})(?:\s+(?:e\s+)?(?:${W}))*)\s+(reais|real|d[óo]lares|d[óo]lar|por\s+cento|parcelas?|unidades?|vezes|${DUR_UNIT_RE})${END}`,
  "giu",
);

function durUnit(u: string) {
  return DURATION_UNITS[u.toLowerCase()];
}

export function extractFacts(text: string): Fact[] {
  const out: Fact[] = [];
  const add = (f: Fact) => out.push(f);

  for (const m of text.matchAll(MONEY_SYM_RE)) {
    add({ kind: "money", raw: m[0].trim(), value: scaled(m[2]!, m[3]), unit: m[1]!.toUpperCase() === "R$" ? "brl" : "usd" });
  }
  for (const m of text.matchAll(MONEY_WORD_RE)) {
    add({ kind: "money", raw: m[0].trim(), value: scaled(m[1]!, m[2]), unit: /^r/i.test(m[3]!) ? "brl" : "usd" });
  }
  for (const m of text.matchAll(PERCENT_RE)) {
    add({ kind: "percent", raw: m[0].trim(), value: canon(m[1]!) });
  }
  for (const m of text.matchAll(DURATION_RE)) {
    const unit = durUnit(m[3]!);
    add({ kind: "duration", raw: m[0].trim(), value: canon(m[1]!), unit });
    if (m[2]) add({ kind: "duration", raw: m[0].trim(), value: canon(m[2]), unit });
  }
  for (const m of text.matchAll(QUANTITY_RE)) {
    const unit = /^(parcela|vezes)/i.test(m[3]!) ? "parcela" : "unidade";
    add({ kind: "quantity", raw: m[0].trim(), value: canon(m[1]!), unit });
    if (m[2]) add({ kind: "quantity", raw: m[0].trim(), value: canon(m[2]), unit });
  }
  for (const m of text.matchAll(INSTALLMENT_RE)) {
    add({ kind: "quantity", raw: m[0].trim(), value: canon(m[1]!), unit: "parcela" });
  }
  for (const m of text.matchAll(DATE_RE)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    add({ kind: "date", raw: m[0].trim(), value: `${d}/${mo}` });
  }
  for (const m of text.matchAll(DATE_NAMED_RE)) {
    add({ kind: "date", raw: m[0].trim(), value: `${Number(m[1])}/${MONTHS[m[2]!.toLowerCase()]}` });
  }
  for (const m of text.matchAll(DAY_ONLY_RE)) {
    add({ kind: "date", raw: m[0].trim(), value: `dia ${Number(m[1])}` });
  }
  // Number words next to a unit cannot be compared numerically, so they only
  // verify when the same words appear in a source (fail closed).
  for (const m of text.matchAll(WORD_RE)) {
    const unitRaw = m[2]!.toLowerCase().replace(/\s+/g, " ");
    const words = `w:${m[1]!.toLowerCase().replace(/\s+/g, " ")}`;
    const wu = WORD_UNITS[unitRaw];
    if (wu) add({ kind: wu.kind, raw: m[0].trim(), value: words, unit: wu.unit || undefined });
    else add({ kind: "duration", raw: m[0].trim(), value: words, unit: durUnit(unitRaw) });
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
