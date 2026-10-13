export const AI_FORBIDDEN = "Você não tem permissão para esta ação.";
export const AI_UNEXPECTED = "Não foi possível concluir. Tente novamente.";
export const AI_DOCUMENT_GONE = "Este documento não existe mais.";
export const AI_DOCUMENT_INVALID = "Documento inválido.";
export const AI_STATUS_FAILED = "Não foi possível verificar o status da IA.";

export const KNOWLEDGE_STATUS_LABEL: Record<string, string> = {
  processing: "Processando",
  ready: "Pronto",
  error: "Erro",
};

export const AI_PLAYGROUND_ERRORS: Record<string, string> = {
  not_configured: "IA não configurada na plataforma.",
  quota_exceeded: "Limite diário de testes atingido.",
  ai_failure: "A IA não respondeu. Tente novamente.",
  agent_not_configured: "Agente de IA não encontrado para esta organização.",
  invalid_input: "Mensagens inválidas para o teste.",
  forbidden: AI_FORBIDDEN,
};
