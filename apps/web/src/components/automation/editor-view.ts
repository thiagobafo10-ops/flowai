export type EditorView = "loading" | "error" | "editor";

/**
 * O que mostrar na tela do editor. Com dados em mãos o editor permanece montado mesmo que uma recarga em segundo
 * plano falhe (o React Query mantém `data` e marca `isError`): desmontar perderia as edições não salvas.
 */
export function editorView({ data, isError }: { data: unknown; isError: boolean }): EditorView {
  if (data !== undefined) return "editor";
  return isError ? "error" : "loading";
}
