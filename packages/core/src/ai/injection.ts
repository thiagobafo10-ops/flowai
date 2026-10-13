// Targets that mean the assistant's own prompt/instructions (not e.g. "instruções de montagem").
const OWN = String.raw`(?:(?:seu|sua|suas|seus|your|its)\s+(?:system\s+|initial\s+|original\s+)?(?:prompt|instrucoes|regras|instructions|rules)|(?:o\s+|the\s+)?(?:system|initial|original)\s+(?:prompt|instructions)|(?:as\s+)?instrucoes\s+(?:do\s+sistema|iniciais|internas)|(?:o\s+)?prompt(?:\s+do\s+sistema)?)\b`;
const DET = String.raw`(?:todas?\s+)?(?:as\s+|suas\s+|seus\s+|os\s+|your\s+|the\s+|all\s+|any\s+)*(?:(?:previous|prior|above|earlier)\s+)?`;

const PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:ignor(?:e|ar|em|a)|desconsider(?:e|ar|em|a)|disregard)\s+${DET}(?:instrucoes|regras|ordens|prompts?|diretrizes|instructions|rules)\b`),
  new RegExp(String.raw`\b(?:esqueca|forget)\s+(?:tudo\b|${DET}(?:instrucoes|regras|instructions|rules|prompt))`),
  /\bvoce\s+agora\s+e\s+(?:um|uma|o|a)\b/,
  /\ba\s+partir\s+de\s+agora\s+voce\s+(?:e|sera|deve|vai\s+ser)\b/,
  /\byou\s+are\s+now\b/,
  /\bact\s+as\s+(?:a|an|if|my)\b/,
  /\bpretend\s+(?:you\s+are|to\s+be|that\s+you)\b/,
  /\baja\s+como\s+(?:um|uma)\b/,
  /\bfinja\s+(?:que\s+)?(?:voce\s+)?(?:e|ser)\s+(?:um|uma)\b/,
  new RegExp(String.raw`\b(?:mostre|revele|exiba|diga|repita|imprima|show|reveal|print|repeat|display|leak)\s+(?:me\s+)?${OWN}`),
  /^\s*(?:system|sistema|assistant|assistente)\s*:/m,
  /<\/?\s*(?:conversation|system|instructions?|knowledge|context|conversa)\s*>/,
  /\b(?:developer|jailbreak|dan)\s+mode\b/,
];

export function detectInjection(text: string): boolean {
  const t = text
    .replace(/[​-‍﻿]/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return PATTERNS.some((re) => re.test(t));
}
