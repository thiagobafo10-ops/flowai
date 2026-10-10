import { z } from "zod";

export const TAG_COLORS = ["slate", "red", "amber", "green", "teal", "blue", "indigo", "pink"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const tagSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da tag.").max(40, "O nome da tag deve ter no máximo 40 caracteres."),
  color: z.enum(TAG_COLORS).default("slate"),
});

export type TagInput = z.output<typeof tagSchema>;
