import { z } from "zod";
export const instagramIdSchema = z.string().regex(/^\d+$/).max(100);
export const instagramVersionSchema = z.string().regex(/^v\d+\.0$/);
export const instagramTextSchema = z.string().refine((text) => text.trim().length > 0 && new TextEncoder().encode(text).byteLength <= 1000, "Texto deve conter de 1 a 1.000 bytes UTF-8.");
export const instagramEnvelopeSchema = z.object({
  object: z.literal("instagram"),
  entry: z.array(z.object({ id: z.string().min(1).max(100), time: z.number().optional(), messaging: z.array(z.unknown()).optional(), changes: z.array(z.unknown()).optional(), field: z.string().optional(), value: z.unknown().optional() })).max(1000),
});
