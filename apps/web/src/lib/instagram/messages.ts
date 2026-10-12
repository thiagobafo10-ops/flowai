// Textos fixos por código: respostas do servidor nunca chegam cruas à interface.
const ACTION: Record<string, string> = {
  invalid_token: "O token do Instagram é inválido ou expirou.",
  permission_denied: "Confira as permissões de mensagens e comentários no app Meta.",
  invalid_account: "O token pertence a outra conta do Instagram.",
  media_not_owned: "Esse post não pertence à conta conectada.",
  already_connected: "Esta conta do Instagram já está conectada a outra organização.",
  app_already_connected: "Esse app Meta já possui uma conexão nesta organização.",
  credentials_changed: "As credenciais mudaram. Teste novamente.",
};

export function instagramActionMessage(code: unknown): string {
  return (typeof code === "string" && Object.hasOwn(ACTION, code) ? ACTION[code] : undefined)
    ?? "Não foi possível concluir a configuração do Instagram.";
}

const LAST_ERROR: Record<string, string> = {
  invalid_token: "O token do Instagram é inválido ou expirou. Atualize as credenciais.",
  permission_denied: "Confira as permissões de mensagens e comentários no app Meta.",
  invalid_account: "O token pertence a outra conta do Instagram.",
  subscription_missing: "As notificações da conta não estão assinadas. Teste a conexão novamente.",
  provider_unavailable: "O Instagram não respondeu. Teste a conexão novamente em alguns minutos.",
};

/** Texto do último erro gravado na conexão (meta_connections.last_error). */
export function instagramConnectionErrorMessage(code: string | null): string | null {
  if (code === null) return null;
  return (Object.hasOwn(LAST_ERROR, code) ? LAST_ERROR[code] : undefined)
    ?? "Confira as credenciais e as permissões e teste a conexão novamente.";
}
