export type KeywordMode = "contains" | "equals" | "starts_with";

/** NFD + remoção de marcas + minúsculas + espaços colapsados. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function matchKeyword(text: string, keywords: string[], mode: KeywordMode): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  for (const raw of keywords) {
    const k = normalizeText(raw);
    if (!k) continue;
    if (mode === "equals" ? t === k : mode === "starts_with" ? t.startsWith(k) : t.includes(k)) return true;
  }
  return false;
}

/** Substitui {primeiro_nome} e {nome}; variáveis vazias somem junto com o espaço excedente. */
export function renderTemplate(text: string, contact: { name: string | null }): string {
  const full = (contact.name ?? "").trim().replace(/\s+/g, " ");
  const values: Record<string, string> = { primeiro_nome: full.split(" ")[0] ?? "", nome: full };
  return text
    .replace(/(^|\s*)\{(primeiro_nome|nome)\}(\s*)/g, (_m, before: string, key: string, after: string) => {
      const v = values[key];
      if (v) return `${before}${v}${after}`;
      if (before === "") return ""; // início do texto: descarta também o espaço seguinte
      return after && !/^[,.;:!?]/.test(after) ? " " : "";
    })
    .trim();
}
