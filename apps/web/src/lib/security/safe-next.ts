/**
 * Caminho de retorno pós-login. Só aceita caminhos do próprio app (começam com
 * uma única "/"), sem barras invertidas nem caracteres de controle.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}
