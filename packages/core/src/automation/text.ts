import type { KeywordMode } from "./schemas.ts";

/** NFD + remoção de marcas + minúsculas + espaços colapsados. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** `k` aparece em `t` como palavra/frase inteira (mesma regra de instagram_keyword_matches da Fase 5). */
function containsWhole(t: string, k: string): boolean {
  for (let at = t.indexOf(k); at !== -1; at = t.indexOf(k, at + 1)) {
    const before = at === 0 ? "" : t[at - 1]!;
    const after = t[at + k.length] ?? "";
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true;
  }
  return false;
}

/** contains = palavra ou frase inteira; equals = texto inteiro; starts_with = prefixo. Sem maiúsculas/acentos. */
export function matchKeyword(text: string, keywords: string[], mode: KeywordMode): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  for (const raw of keywords) {
    const k = normalizeText(raw);
    if (!k) continue;
    if (mode === "equals" ? t === k : mode === "starts_with" ? t.startsWith(k) : containsWhole(t, k)) return true;
  }
  return false;
}

/**
 * Substitui {primeiro_nome} e {nome}.
 * Variável preenchida: substituição simples. Variável vazia: some junto com o espaço/tabulação
 * excedente ao redor (nunca quebras de linha) e, antes de pontuação, também a vírgula anterior
 * ("Oi, {nome}!" -> "Oi!"). No início de linha remove o espaço seguinte. O espaçamento do
 * restante do texto (inclusive nas pontas) é preservado.
 */
export function renderTemplate(text: string, contact: { name: string | null }): string {
  const full = (contact.name ?? "").trim().replace(/\s+/g, " ");
  const values: Record<string, string> = { primeiro_nome: full.split(" ")[0] ?? "", nome: full };
  const re = /\{(primeiro_nome|nome)\}/;
  let out = "";
  let rest = text;
  for (;;) {
    const m = re.exec(rest);
    if (!m) return out + rest;
    out += rest.slice(0, m.index);
    let after = rest.slice(m.index + m[0].length);
    const value = values[m[1]!];
    if (value) {
      out += value;
    } else {
      const afterWs = /^[ \t]*/.exec(after)![0];
      const next = after.slice(afterWs.length);
      if (out === "" || out.endsWith("\n")) {
        after = next;
      } else if (/^[,.;:!?]/.test(next)) {
        out = out.replace(/[ \t]+$/, "").replace(/,$/, "");
        after = next;
      } else if (afterWs === "" && next !== "" && !next.startsWith("\n") && /[ \t]$/.test(out)) {
        // "Oi {nome}tudo": mantém um espaço
      } else {
        out = out.replace(/[ \t]+$/, "");
      }
    }
    rest = after;
  }
}
