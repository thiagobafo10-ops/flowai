export const GROWTH_FORBIDDEN = "Você não tem permissão para esta ação.";
export const GROWTH_UNEXPECTED = "Não foi possível concluir. Tente novamente.";
export const INSTAGRAM_USERNAME_REQUIRED = "Informe o usuário do Instagram em Canais para gerar o link.";

export function growthError(error: { code?: string; message?: string }): string {
  if (error.code === "42501") return GROWTH_FORBIDDEN;
  if (error.code === "P0002") return "O link ou canal não está mais disponível.";
  if (error.code === "22023") {
    switch (error.message) {
      case "code_taken": return "Este código já está em uso neste canal.";
      case "entry_link_archived": return "Este link está arquivado.";
      case "channel_immutable": return "O canal de um link existente não pode ser alterado.";
      case "not_simulator": return "Escolha um link do canal Simulador.";
      case "invalid_username": return "Informe um usuário do Instagram válido.";
      case "invalid_name": return "O nome deve ter entre 1 e 100 caracteres.";
      case "invalid_settings": return "Revise as configurações da sequência.";
      case "invalid_step":
      case "invalid_steps": return "Revise os passos configurados.";
      case "no_steps": return "Adicione ao menos um passo antes de ativar.";
      default: return "Confira os dados informados.";
    }
  }
  return GROWTH_UNEXPECTED;
}
