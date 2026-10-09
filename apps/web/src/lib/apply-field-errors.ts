import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

/**
 * Aplica erros de campo retornados pelo servidor ao formulário (exibidos só
 * inline, ligados ao input). Retorna true se algum erro de campo foi aplicado.
 */
export function applyFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  fieldErrors: Record<string, string[]> | undefined,
): boolean {
  let applied = false;
  for (const [field, messages] of Object.entries(fieldErrors ?? {})) {
    const message = messages?.[0];
    if (!message) continue;
    setError(field as Path<T>, { type: "server", message }, { shouldFocus: !applied });
    applied = true;
  }
  return applied;
}
