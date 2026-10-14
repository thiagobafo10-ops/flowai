/** Leitura tolerante de configs ainda não validadas (o editor guarda o que o usuário digitou). */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const rec = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
export const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
/** Campo numérico do formulário: vazio (NaN) vira null para o schema acusar o erro, em vez de assumir um padrão. */
export const numberOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
