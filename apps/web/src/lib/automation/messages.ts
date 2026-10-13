export const AUTOMATION_FORBIDDEN = "Você não tem permissão para esta ação.";
export const AUTOMATION_UNEXPECTED = "Não foi possível concluir. Tente novamente.";
export const AUTOMATION_GONE = "Esta automação não existe mais.";
export const AUTOMATION_INVALID = "Automação inválida.";
export const AUTOMATION_INVALID_NAME = "Informe um nome de até 100 caracteres.";
export const AUTOMATION_INVALID_GRAPH = "Confira o fluxo da automação.";
export const AUTOMATION_ACTIVE_WITH_ISSUES = "Corrija os erros antes de salvar uma automação ativa.";
export const AUTOMATION_ACTIVATE_WITH_ISSUES = "Corrija os erros antes de ativar a automação.";
export const AUTOMATION_RERUN_BUSY = "A conversa já tem outra automação em andamento.";
export const AUTOMATION_RERUN_INVALID = "Não foi possível reexecutar a partir deste passo.";
export const AUTOMATION_RUN_GONE = "Esta execução não existe mais.";

export const AUTOMATION_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
};

export const AUTOMATION_TRIGGER_LABEL: Record<string, string> = {
  message_received: "Mensagem recebida",
  keyword_detected: "Palavra-chave detectada",
  instagram_comment: "Comentário no Instagram",
  instagram_story: "Resposta a story",
  contact_created: "Contato criado",
  tag_added: "Etiqueta adicionada",
  stage_changed: "Etapa alterada",
};

export const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  comment_link: "Quando alguém comenta uma palavra-chave, envia o link no Direct.",
  welcome_direct: "Envia uma mensagem de boas-vindas na primeira conversa.",
  qualify_buttons: "Pergunta com respostas rápidas e transfere quem tem interesse.",
};
export const AUTOMATION_CREATE_FAILED = "Não foi possível criar a automação.";
export const automationActivateBlocked = (count: number) =>
  count === 1 ? "Corrija 1 erro no editor antes de ativar a automação." : `Corrija ${count} erros no editor antes de ativar a automação.`;
export const AUTOMATION_ACTIVATED = "Automação ativada.";
export const AUTOMATION_PAUSED = "Automação pausada.";
export const AUTOMATION_DUPLICATED = "Automação duplicada.";
export const AUTOMATION_DELETED = "Automação excluída.";
export const AUTOMATION_SAVED = "Automação salva.";
export const AUTOMATION_LOAD_FAILED = "Não foi possível carregar a automação.";
