export function normalizeCommentKeyword(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function matchesCommentKeyword(text: string, keyword: string): boolean {
  const haystack = normalizeCommentKeyword(text);
  const needle = normalizeCommentKeyword(keyword);
  if (!needle || !haystack) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "u").test(haystack);
}
