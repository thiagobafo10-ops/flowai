import { z } from "zod";

function parseMoney(v: unknown): unknown {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : v;
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (t === "") return 0;
  const grouped = t.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(t);
  const normalized = grouped ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * 100) / 100;
}

const value = z.preprocess(parseMoney, z.number("Informe um valor válido.").min(0, "O valor não pode ser negativo."));

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
