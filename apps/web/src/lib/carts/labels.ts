export const COMMERCIAL_LABELS = {
  abandoned: "Abandonado",
  order_created: "Pedido criado",
  payment_pending: "Aguardando pagamento",
  paid: "Pago",
  cancelled: "Cancelado",
} as const;

export const STAGE_LABELS = {
  new: "Novo",
  contacted: "Contato realizado",
  waiting_reply: "Aguardando resposta",
  closed: "Encerrado",
} as const;

export const ACTION_LABELS = {
  opened_whatsapp: "WhatsApp aberto (não conta como envio)",
  marked_sent: "Envio confirmado pelo operador",
  reply_received: "Resposta recebida",
  paused: "Atendimento pausado",
  resumed: "Atendimento retomado",
  closed: "Atendimento encerrado",
  reopened: "Atendimento reaberto",
  emails_stopped: "E-mails interrompidos",
  note: "Observação",
} as const;

export const EMAIL_STATE_LABELS: Record<string, string> = {
  scheduled: "Agendado",
  sending: "Enviando",
  sent: "Enviado",
  cancelled: "Cancelado",
  failed: "Falhou",
};

export const PERMISSION_LABELS: Record<string, string> = { granted: "Autorizado", revoked: "Revogado" };

export const label = (map: Record<string, string>, key: string) => (Object.hasOwn(map, key) ? map[key] : key);
