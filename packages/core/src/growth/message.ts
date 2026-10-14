import { INSTAGRAM_BUTTON_TEXT_MAX } from "../automation/instagram.ts";
import { normalizeText } from "../automation/text.ts";
import type { OutreachMessage } from "./schemas.ts";

export type OutreachIssue = { code: string; message: string };

const INSTAGRAM_MAX_BYTES = 1000;
const SIMULATOR_MAX_CHARS = 4096;

export function validateOutreachMessage(msg: OutreachMessage, channelType: "simulator" | "instagram"): OutreachIssue[] {
  const issues: OutreachIssue[] = [];
  if (channelType === "instagram") {
    if (new TextEncoder().encode(msg.text).byteLength > INSTAGRAM_MAX_BYTES) {
      issues.push({
        code: "message_too_long_instagram",
        message: "A mensagem passa de 1000 bytes, o limite do Instagram. Encurte o texto.",
      });
    }
    if ((msg.buttons?.length ?? 0) > 0 && msg.text.length > INSTAGRAM_BUTTON_TEXT_MAX) {
      issues.push({
        code: "button_text_too_long_instagram",
        message: "Com botões, o texto no Instagram deve ter no máximo 640 caracteres.",
      });
    }
  } else if (msg.text.length > SIMULATOR_MAX_CHARS) {
    issues.push({ code: "message_too_long", message: "A mensagem deve ter no máximo 4096 caracteres." });
  }
  return issues;
}

const strip = (s: string) => normalizeText(s).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** A mensagem inteira, normalizada e sem pontuação nas pontas, é igual a uma palavra de saída. */
export function isExitWord(text: string, exitWords: string[]): boolean {
  const t = strip(text);
  if (!t) return false;
  return exitWords.some((w) => strip(w) === t);
}
