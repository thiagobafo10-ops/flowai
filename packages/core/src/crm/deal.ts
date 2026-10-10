import { z } from "zod";

function parseMoney(v: unknown): unknown {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : v;
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (t === "") return 0;
  // "1.500" é milhar; "0.500" é decimal (milhar nunca começa com 0).
  const grouped = t.includes(",") || /^[1-9]\d{0,2}(\.\d{3})+$/.test(t);
  const normalized = grouped ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * 100) / 100;
}

/** Maior valor de numeric(14,2). */
export const MAX_DEAL_VALUE = 999999999999.99;

const value = z.preprocess(
  parseMoney,
  z
    .number("Informe um valor válido.")
    .min(0, "O valor não pode ser negativo.")
    .max(MAX_DEAL_VALUE, "Valor muito alto."),
);

export const dealSchema = z.object({
  contactId: z.uuid(),
  title: z.string().trim().min(1, "Informe o título.").max(120, "O título deve ter no máximo 120 caracteres."),
  value,
  ownerId: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : (v ?? null)), z.uuid().nullable()),
  stageId: z.uuid(),
});

export type DealInput = z.output<typeof dealSchema>;

export function defaultDealTitle(contactName: string): string {
  return `Oportunidade — ${contactName}`;
}

export const stageNameSchema = z
  .string()
  .trim()
  .min(1, "O nome da etapa deve ter entre 1 e 40 caracteres.")
  .max(40, "O nome da etapa deve ter entre 1 e 40 caracteres.");
