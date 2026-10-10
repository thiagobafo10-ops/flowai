import { z } from "zod";
import { normalizeBrazilianPhone } from "../crm/phone.ts";

export const MAX_MESSAGE_LENGTH = 4096;

const messageText = z
  .string()
  .trim()
  .min(1, "Escreva uma mensagem.")
  .max(MAX_MESSAGE_LENGTH, `A mensagem deve ter no máximo ${MAX_MESSAGE_LENGTH} caracteres.`);

export const replySchema = z.object({ text: messageText });
export type ReplyInput = z.infer<typeof replySchema>;

const simulatorName = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") return v;
    const t = v.trim();
    return t === "" ? null : t;
  },
  z.string().max(120, "O nome deve ter no máximo 120 caracteres.").nullable(),
);

const simulatorPhone = z.string().transform((v, ctx) => {
  const n = normalizeBrazilianPhone(v);
  if (n === null) {
    ctx.issues.push({ code: "custom", message: "Informe um telefone brasileiro válido.", input: v });
    return z.NEVER;
  }
  return n;
});

export const simulatorInboundSchema = z.object({
  name: simulatorName,
  phone: simulatorPhone,
  text: messageText,
});
export type SimulatorInboundInput = z.infer<typeof simulatorInboundSchema>;
