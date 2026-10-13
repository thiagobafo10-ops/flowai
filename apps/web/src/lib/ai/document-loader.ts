/** Fora do prefixo ["knowledge"]: invalidações da lista e do Realtime não recarregam o documento em edição. */
export const knowledgeDocumentKey = (orgId: string, id: string) => ["knowledge-doc", orgId, id] as const;

/** Dados já carregados vencem um erro posterior: o formulário nunca é desmontado com edições não salvas. */
export function editLoaderView(query: { data: unknown; isError: boolean }): "form" | "error" | "loading" {
  if (query.data !== undefined) return "form";
  return query.isError ? "error" : "loading";
}
