import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Informe um e-mail válido." }));

export const signUpSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, { message: "Informe seu nome completo." })
    .max(100, { message: "O nome deve ter no máximo 100 caracteres." }),
  email: emailSchema,
  password: z
    .string()
    .min(8, { message: "A senha deve ter pelo menos 8 caracteres." })
    .max(72, { message: "A senha deve ter no máximo 72 caracteres." }),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: "Informe sua senha." }),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Informe o nome da empresa." })
    .max(80, { message: "O nome deve ter no máximo 80 caracteres." }),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
