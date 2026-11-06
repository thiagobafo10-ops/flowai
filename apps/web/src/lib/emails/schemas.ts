import { z } from "zod";

export const JOURNEY_KINDS = ["cart", "pending_payment", "post_purchase"] as const;
export type JourneyKind = (typeof JOURNEY_KINDS)[number];
export type EmailStepTiming = "delay" | "due_date" | "on_tracking";

// Limites iguais aos checks de email_journey_steps / email_settings / store_connections.
const DELAY = "A espera deve ser de 0 a 30 dias.";
export const stepSchema = z.object({
  delayMinutes: z.number().int(DELAY).min(0, DELAY).max(43200, DELAY),
  enabled: z.boolean(),
  subject: z.string().trim().min(1, "Informe o assunto.").max(150, "O assunto deve ter no máximo 150 caracteres."),
  heading: z.string().trim().max(150, "O título deve ter no máximo 150 caracteres."),
  body: z.string().trim().min(1, "Informe o texto.").max(3000, "O texto deve ter no máximo 3000 caracteres."),
  buttonLabel: z.string().trim().min(1, "Informe o texto do botão.").max(40, "O botão deve ter no máximo 40 caracteres."),
  coupon: z.string().trim().max(40, "O cupom deve ter no máximo 40 caracteres."),
});
export type StepInput = z.infer<typeof stepSchema>;

const email = (msg: string) => z.string().trim().toLowerCase().regex(/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/, msg);
const secret = z.string().trim().max(8192, "Valor longo demais.");
export const settingsSchema = z.object({
  fromName: z.string().trim().min(1, "Informe o nome do remetente.").max(100, "O nome deve ter no máximo 100 caracteres.")
    .regex(/^[^<>"\r\n]*$/, "O nome não pode ter < > ou aspas."),
  fromEmail: email("Informe um e-mail de remetente válido."),
  replyTo: email("Informe um e-mail de resposta válido.").or(z.literal("")),
  resendKey: secret,
  resendWebhookSecret: secret,
});
export type SettingsInput = z.infer<typeof settingsSchema>;

export const storeConnectionSchema = z.object({
  alias: z.string().trim().min(1, "Informe o alias da loja.").max(200, "O alias deve ter no máximo 200 caracteres."),
  secret: z.string().trim().min(1, "Informe o segredo do webhook da Yampi.").max(8192, "Valor longo demais."),
});

export type DelayUnit = "min" | "h" | "d";
const UNIT_MINUTES: Record<DelayUnit, number> = { min: 1, h: 60, d: 1440 };
export const toMinutes = (value: number, unit: DelayUnit) => value * UNIT_MINUTES[unit];
export function fromMinutes(minutes: number): { value: number; unit: DelayUnit } {
  if (minutes === 0) return { value: 0, unit: "min" };
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: "d" };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: "h" };
  return { value: minutes, unit: "min" };
}

export const JOURNEY_LABELS: Record<JourneyKind, string> = {
  cart: "Carrinho abandonado",
  pending_payment: "Pix ou boleto pendente",
  post_purchase: "Pós-venda",
};

const CANCEL_REASONS: Record<string, string> = {
  paid: "Pagou antes",
  converted: "Comprou",
  unsubscribed: "Descadastrado",
  suppressed: "Endereço bloqueado",
  step_disabled: "Passo desligado",
  no_email: "Sem e-mail",
  no_recovery_url: "Sem link do carrinho",
  no_link: "Sem link do pedido",
  no_settings: "Envio não configurado",
  no_coupon: "Cupom não preenchido",
  paused_by_operator: "Interrompido pelo operador",
};
export const cancelReasonLabel = (code: string) => (Object.hasOwn(CANCEL_REASONS, code) ? CANCEL_REASONS[code] : "Outro motivo");
