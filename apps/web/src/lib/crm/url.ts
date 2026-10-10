import type { ContactFilters } from "@flowai/core";

/** Monta /contatos com os filtros atuais (valores padrão omitidos), com ajustes opcionais. */
export function contactsHref(f: ContactFilters, patch: Partial<ContactFilters> = {}): string {
  const x = { ...f, ...patch };
  const p = new URLSearchParams();
  if (x.q) p.set("q", x.q);
  if (x.status) p.set("status", x.status);
  if (x.tagId) p.set("tag", x.tagId);
  if (x.assignee) p.set("responsavel", x.assignee);
  if (x.source) p.set("origem", x.source);
  if (x.order !== "interacao") p.set("ordem", x.order);
  if (x.page > 1) p.set("pagina", String(x.page));
  const qs = p.toString();
  return qs ? `/contatos?${qs}` : "/contatos";
}
