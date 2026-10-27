import { expect, test } from "vitest";
import { instagramActionMessage, instagramConnectionErrorMessage } from "./messages";

test("conta já conectada em outra organização tem mensagem própria", () => {
  expect(instagramActionMessage("already_connected")).toBe("Esta conta do Instagram já está conectada a outra organização.");
  expect(instagramActionMessage("app_already_connected")).toBe("Esse app Meta já possui uma conexão nesta organização.");
});

test("códigos desconhecidos nunca vazam texto do servidor", () => {
  expect(instagramActionMessage("<script>")).toBe("Não foi possível concluir a configuração do Instagram.");
});

test.each([
  ["invalid_token", "O token do Instagram é inválido ou expirou. Atualize as credenciais."],
  ["permission_denied", "Confira as permissões de mensagens e comentários no app Meta."],
  ["invalid_account", "O token pertence a outra conta do Instagram."],
  ["subscription_missing", "As notificações da conta não estão assinadas. Teste a conexão novamente."],
  ["provider_unavailable", "O Instagram não respondeu. Teste a conexão novamente em alguns minutos."],
  ["token_refresh_failed", "Não foi possível renovar o token do Instagram automaticamente. Gere um novo token no painel da Meta e salve a conexão."],
])("último erro %s aparece em português", (code, text) => {
  expect(instagramConnectionErrorMessage(code)).toBe(text);
});

test("último erro desconhecido usa orientação genérica e nulo não mostra nada", () => {
  expect(instagramConnectionErrorMessage("weird")).toBe("Confira as credenciais e as permissões e teste a conexão novamente.");
  expect(instagramConnectionErrorMessage(null)).toBeNull();
});
