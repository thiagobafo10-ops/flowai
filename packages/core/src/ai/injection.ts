// Targets that mean the assistant's own prompt/instructions (not e.g. "instrucoes de montagem").
const OWN = String.raw`(?:(?:seu|sua|suas|seus|your|its)\s+(?:system\s+|initial\s+|original\s+)?(?:prompt|instrucoes|regras|instructions|rules)|(?:o\s+|the\s+)?(?:system|initial|original)\s+(?:prompt|instructions)|(?:as\s+)?instrucoes\s+(?:do\s+sistema|iniciais|internas)|(?:o\s+)?prompt(?:\s+do\s+sistema)?)\b`;
// Same idea for ignore/forget/disregard: the object must be the assistant's own rules.
const RULES_OBJ = String.raw`(?:(?:(?:as|os|all|any|the)\s+)*(?:suas|seus|sua|seu|your)\s+(?:instrucoes|regras|diretrizes|ordens|prompt|instructions|rules|guidelines)|(?:(?:as|os|all|any|the)\s+)*(?:instrucoes|regras|diretrizes|ordens)\s+(?:anteriores|acima|do\s+sistema|iniciais|internas)|(?:(?:all|any|the)\s+)*(?:previous|prior|above|earlier|system)\s+(?:instructions|rules|prompts?|guidelines)|(?:all\s+)?(?:instructions|rules)\s+(?:above|before)|(?:o\s+)?(?:system\s+prompt|prompt\s+do\s+sistema))`;
const NOT_QUESTION = String.raw`(?![^.!\n]*\?)`;

const ZERO_WIDTH = new RegExp(`[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200d)}${String.fromCharCode(0xfeff)}]`, "g");
const COMBINING = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

const PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:ignor(?:e|ar|em|a)|desconsider(?:e|ar|em|a)|disregard|ignore|esqueca|forget)\s+${RULES_OBJ}\b`),
  new RegExp(String.raw`\bvoce\s+agora\s+e\s+(?:um|uma)\s+[a-z]+${NOT_QUESTION}`),
  new RegExp(String.raw`\ba\s+partir\s+de\s+agora\s+voce\s+(?:e|sera|vai\s+ser)\s+(?:um|uma)\s+[a-z]+${NOT_QUESTION}`),
  new RegExp(String.raw`\byou\s+are\s+now\s+(?:a|an|dan)\b${NOT_QUESTION}`),
  new RegExp(String.raw`\bact\s+as\s+(?:a|an)\s+[a-z]+${NOT_QUESTION}`),
  /\bpretend\s+(?:you\s+are|to\s+be|that\s+you)\b/,
  /\bfinja\s+(?:que\s+)?(?:voce\s+)?(?:e|ser)\s+(?:um|uma)\b/,
  new RegExp(String.raw`\b(?:mostre|revele|exiba|diga|repita|imprima|show|reveal|print|repeat|display|leak)\s+(?:me\s+)?${OWN}`),
  /^\s*(?:system|sistema|assistant|assistente)\s*:/m,
  /<\/?\s*(?:conversation|system|instructions?|knowledge|context|conversa)\s*>/,
  /\b(?:developer|jailbreak|dan)\s+mode\b/,
];

export function detectInjection(text: string): boolean {
  const t = text.replace(ZERO_WIDTH, "").normalize("NFD").replace(COMBINING, "").toLowerCase();
  return PATTERNS.some((re) => re.test(t));
}
