/** Timestamp em ms (isolado para uso em Server Components sem violar react-hooks/purity). */
export function nowMs(): number {
  return Date.now();
}
