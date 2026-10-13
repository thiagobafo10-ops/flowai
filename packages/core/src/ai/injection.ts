const PATTERNS: RegExp[] = [
  /\bignor(?:e|ar|em|a)\s+(?:todas?\s+)?(?:as\s+|suas\s+|seus\s+|os\s+)?(?:instrucoes|regras|ordens|prompts?|diretrizes)\b/,
  /\bignore\s+(?:all\s+|any\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier)?\s*(?:instructions|rules|prompts?)\b/,
  /\besqueca\s+(?:todas?\s+)?(?:as\s+|suas\s+)?(?:instrucoes|regras)\b/,
  /\bvoce\s+agora\s+e\s+(?:um|uma|o|a)\b/,
  /\bfinja\s+(?:que\s+)?(?:voce\s+)?(?:e|ser)\s+(?:um|uma)\b/,
  /\b(?:mostre|revele|exiba|diga|repita|imprima|show|reveal|print|repeat)\s+(?:me\s+)?(?:o\s+|seu\s+|sua\s+|as\s+|suas\s+|your\s+|the\s+)?(?:system\s+|initial\s+)?(?:prompt|instrucoes)\b/,
  /^\s*(?:system|sistema|assistant|assistente)\s*:/m,
  /<\/?\s*(?:conversation|system|instructions?|knowledge|context|conversa)\s*>/,
  /\b(?:developer|jailbreak|dan)\s+mode\b/,
];

export function detectInjection(text: string): boolean {
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return PATTERNS.some((re) => re.test(t));
}
