import { z } from "zod";
import { formatBrazilianPhone, normalizeBrazilianPhone } from "./phone.ts";

function trimmedOrNull(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? null : t;
}

const nullableText = (max: number, message: string) =>
  z.preprocess(trimmedOrNull, z.string().max(max, message).nullable()).default(null);

const email = z
  .preprocess(trimmedOrNull, z.email("Informe um e-mail válido.").max(254, "Informe um e-mail válido.").nullable())
  .default(null)
  .transform((v) => (v === null ? null : v.toLowerCase()));

const phone = z
  .preprocess(trimmedOrNull, z.string().nullable())
  .default(null)
  .transform((v, ctx) => {
    if (v === null) return null;
    const n = normalizeBrazilianPhone(v);
    if (n === null) {
      ctx.issues.push({ code: "custom", message: "Informe um telefone brasileiro válido.", input: v });
      return z.NEVER;
    }
    return n;
  });

const leadScore = z
  .preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number())
  .refine((n) => Number.isInteger(n) && n >= 0 && n <= 100, "O lead score deve estar entre 0 e 100.")
  .default(0);

const customField = z.object({
  key: z.string().trim().min(1, "Informe o nome do campo.").max(60, "O nome do campo deve ter no máximo 60 caracteres."),
  value: z.string().trim().max(500, "O valor deve ter no máximo 500 caracteres."),
});

export const contactSchema = z
  .object({
    name: nullableText(120, "O nome deve ter no máximo 120 caracteres."),
    phone,
    email,
    status: z.enum(["lead", "customer", "inactive"]).default("lead"),
    assignedTo: z.preprocess(trimmedOrNull, z.uuid().nullable()).default(null),
    tagIds: z.array(z.uuid()).default([]),
    leadScore,
    customFields: z
      .array(customField)
      .default([])
      .refine((fs) => new Set(fs.map((f) => f.key.toLowerCase())).size === fs.length, "Nomes de campos repetidos."),
  })
  .superRefine((c, ctx) => {
    if (c.name === null && c.phone === null && c.email === null) {
      ctx.addIssue({ code: "custom", message: "Informe ao menos nome, telefone ou e-mail.", path: [] });
    }
  });

export type ContactInput = z.output<typeof contactSchema>;

export function contactDisplayName(c: { name: string | null; phone: string | null; email: string | null }): string {
  if (c.name) return c.name;
  if (c.phone) return formatBrazilianPhone(c.phone);
  if (c.email) return c.email;
  return "Sem nome";
}
