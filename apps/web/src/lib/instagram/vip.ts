import { z } from "zod";
export const VIP_PUBLIC_DEFAULT = "Quer entrar no nosso grupo VIP do WhatsApp? Comente VIP para receber o link no Direct.";
export const VIP_GROUP_DEFAULT = "https://chat.whatsapp.com/FFHuLdtAehRCoIDP67bX5r";
export const vipSettingsSchema = z.object({ channelId: z.uuid(), enabled: z.boolean(), publicReplyText: z.string().trim().min(1).refine(value => new TextEncoder().encode(value).length <= 1000), groupUrl: z.string().trim().refine(value => /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/.test(value)) });
export type InstagramVipView = { enabled: boolean; publicReplyText: string; groupUrl: string; activatedAt: string | null; lastError: string | null; commentsVerifiedAt: string | null; commentsError: string | null };
export function vipPrivatePreview(groupUrl: string) { return `Aqui está o convite para o nosso grupo VIP do WhatsApp: ${groupUrl}`; }
const uncertain = "Não foi possível confirmar o envio. Confira no Instagram; o envio incerto não será repetido automaticamente.";
const errors: Record<string, string> = {
 network_error: uncertain, invalid_response: uncertain, operation_failed: uncertain, expired_send_lease: uncertain,
 provider_unavailable: "O Instagram não respondeu. Tente novamente em alguns minutos.",
 connection_disconnected: "A conexão está desconectada. Reconecte o Instagram.",
 credentials_changed: "As credenciais mudaram. Verifique a permissão novamente.",
 comments_permission_required: "Reconecte o Instagram com as permissões de comentários e mensagens e verifique novamente.",
 permission_denied: "Reconecte o Instagram com as permissões de comentários e mensagens e verifique novamente.",
 invalid_token: "O token é inválido ou expirou. Atualize as credenciais.",
 rate_limited: "O Instagram limitou os envios. Aguarde antes de verificar novamente.",
 uncertain: "O resultado do envio é incerto e não será repetido automaticamente.",
};
export function vipErrorMessage(code: unknown): string { return typeof code === "string" && Object.hasOwn(errors, code) ? errors[code] : "Não foi possível concluir a configuração VIP."; }


type VipDraft = { publicReplyText: string; groupUrl: string };
export function vipSaveInput(channelId: string, enabled: boolean, draft: VipDraft, saved: VipDraft, pause = false) {
 return { channelId, enabled: pause ? false : enabled, ...(pause ? saved : draft) };
}

export function vipCardIdentity(connection: { channelId: string; disconnected: boolean; vip?: { enabled: boolean } }) {
 return `${connection.channelId}-${connection.vip?.enabled ?? false}-${connection.disconnected}`;
}
