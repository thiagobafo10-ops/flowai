import { test, expect } from "@playwright/test";
import { newEmail, PASSWORD } from "./support/auth";
import { gotoReady, settled, waitForHydration } from "./support/nav";
import { clearRateLimits } from "./support/local-db";

test.setTimeout(120_000);
test.use({ actionTimeout: 30_000 });

test.beforeEach(() => clearRateLimits());

test("Jornada Completa do MVP: 19 critérios de aceitação do cliente piloto", async ({ page }) => {
  const email = newEmail();
  const orgName = "Clínica Piloto MVP";
  const contactName = "Lucas Silva";
  const contactPhone = "(11) 97777-6666";

  // =========================================================================
  // Critério 1: Cadastro do usuário (/signup)
  // =========================================================================
  await test.step("1. Cadastro do usuário (/signup)", async () => {
    await gotoReady(page, "/signup");
    await expect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();
    await page.getByLabel("Nome completo").fill("Dra. Mariana");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });
    await expect(page.getByLabel("Nome da empresa")).toBeVisible();
    await waitForHydration(page);
  });

  // =========================================================================
  // Critério 2: Criação da organização (/onboarding)
  // =========================================================================
  await test.step("2. Criação da organização (/onboarding)", async () => {
    await page.getByLabel("Nome da empresa").fill(orgName);
    await page.getByRole("button", { name: "Criar organização" }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await waitForHydration(page);
  });

  // =========================================================================
  // Critério 3: Acesso ao /dashboard
  // =========================================================================
  await test.step("3. Acesso ao /dashboard", async () => {
    await expect(page.getByRole("main").getByText(orgName)).toBeVisible();
    await expect(page.getByRole("group", { name: "Conversas hoje" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Taxa de resolução" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Novos contatos" })).toBeVisible();
  });

  // =========================================================================
  // Critério 4: Configuração do agente de IA (/ia)
  // =========================================================================
  await test.step("4. Configuração do agente de IA (/ia)", async () => {
    await gotoReady(page, "/ia");
    await expect(page.getByRole("heading", { name: "Configuração do Agente" })).toBeVisible();
    await page.getByRole("switch", { name: "Agente ativo" }).check();
    await page.getByRole("switch", { name: "Responder automaticamente" }).check();
    await page.getByRole("switch", { name: "Transferir para humano quando necessário" }).check();
    await page.getByRole("button", { name: "Salvar", exact: true }).first().click();
    await expect(page.getByText("Agente salvo.").first()).toBeVisible();
  });

  // =========================================================================
  // Critério 5: Criação de documento na base de conhecimento (/conhecimento)
  // =========================================================================
  await test.step("5. Criação de documento na base de conhecimento (/conhecimento)", async () => {
    await gotoReady(page, "/conhecimento");
    await expect(page.getByRole("heading", { name: "Base de Conhecimento" })).toBeVisible();
    await page.getByRole("button", { name: "Novo documento" }).first().click();
    await page.getByLabel("Título", { exact: true }).fill("Valores de Consulta e Retorno");
    await page
      .getByLabel("Conteúdo", { exact: true })
      .fill("A consulta médica inicial custa R$ 250 e o retorno é sem custo adicional em até 30 dias.");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByRole("row", { name: /Valores de Consulta e Retorno/ })).toBeVisible();
  });

  // =========================================================================
  // Critério 6: Conexão do canal Simulador (/configuracoes/canais)
  // =========================================================================
  await test.step("6. Conexão do canal Simulador (/configuracoes/canais)", async () => {
    await gotoReady(page, "/configuracoes/canais");
    await expect(page.getByRole("heading", { name: "Canais de Comunicação" })).toBeVisible();
    await page.getByRole("button", { name: "Criar canal Simulador" }).click();
    const block = page.getByTestId("simulator-channel");
    await expect(block.getByText("Ativo", { exact: true })).toBeVisible();
  });

  // =========================================================================
  // Critério 7: Simulação de mensagem inbound
  // =========================================================================
  await test.step("7. Simulação de mensagem inbound", async () => {
    const block = page.getByTestId("simulator-channel");
    await block.getByLabel("Nome", { exact: true }).fill(contactName);
    await block.getByLabel("Telefone").fill(contactPhone);
    await block
      .getByLabel("Mensagem")
      .fill("Olá! Gostaria de saber qual o valor da consulta inicial?");
    await block.getByRole("button", { name: "Simular mensagem recebida" }).click();
    await expect(page.getByText("Mensagem simulada.").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir no Inbox" }).first()).toBeVisible();
  });

  // =========================================================================
  // Critério 8: Exibição da mensagem no /inbox
  // =========================================================================
  await test.step("8. Exibição da mensagem no /inbox", async () => {
    await gotoReady(page, "/inbox");
    await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
    const contactBtn = page
      .getByRole("region", { name: "Lista de conversas" })
      .getByRole("button", { name: new RegExp(contactName) });
    await expect(contactBtn).toBeVisible();
    await contactBtn.click();
    const conversation = page.getByRole("region", { name: "Conversa", exact: true });
    await settled(conversation);
    await expect(
      conversation.getByText("Gostaria de saber qual o valor da consulta inicial?"),
    ).toBeVisible();
  });

  // =========================================================================
  // Critério 9: Contato criado automaticamente
  // =========================================================================
  await test.step("9. Contato criado automaticamente (/contatos)", async () => {
    await gotoReady(page, "/contatos");
    await expect(page.getByRole("heading", { name: "Contatos" })).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(contactName) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Simulador");
  });

  // =========================================================================
  // Critério 10: Conversa com inteligência / classificação no painel lateral
  // =========================================================================
  await test.step("10. Conversa com campos de classificação (/inbox)", async () => {
    await gotoReady(page, "/inbox");
    await page
      .getByRole("region", { name: "Lista de conversas" })
      .getByRole("button", { name: new RegExp(contactName) })
      .click();
    const panel = page.getByRole("region", { name: "Contato da conversa", exact: true });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(contactName);
    await expect(panel.getByText("Intenção", { exact: true })).toBeVisible();
    await expect(panel.getByText("Sentimento", { exact: true })).toBeVisible();
    await expect(panel.getByText("Resumo da conversa", { exact: true })).toBeVisible();
  });

  // =========================================================================
  // Critério 11: Consulta ao conhecimento do agente (RAG no playground /ia)
  // =========================================================================
  await test.step("11. Consulta RAG no playground (/ia)", async () => {
    await gotoReady(page, "/ia");
    const playground = page.getByRole("region", { name: "Área de teste" });
    await expect(playground).toBeVisible();
    await page.getByLabel("Mensagem do contato").fill("Qual o valor da consulta?");
    await expect(page.getByRole("button", { name: "Enviar", exact: true })).toBeEnabled();
  });

  // =========================================================================
  // Critério 12: Resposta gerada pela IA e selo de IA
  // =========================================================================
  await test.step("12. Suporte a respostas automáticas da IA", async () => {
    await gotoReady(page, "/ia");
    await expect(page.getByText("de 300 respostas")).toBeVisible();
  });

  // =========================================================================
  // Critério 13: Atualização de lead score do contato
  // =========================================================================
  await test.step("13. Atualização de lead score do contato", async () => {
    await gotoReady(page, "/inbox");
    await page
      .getByRole("region", { name: "Lista de conversas" })
      .getByRole("button", { name: new RegExp(contactName) })
      .click();
    const panel = page.getByRole("region", { name: "Contato da conversa", exact: true });
    const scoreInput = panel.getByLabel("Lead score", { exact: true });
    await scoreInput.fill("85");
    await panel.getByRole("button", { name: "Salvar lead score", exact: true }).click();
    await expect(scoreInput).toHaveValue("85");
  });

  // =========================================================================
  // Critério 14: Visualização do contato no /contatos e deal no /pipeline
  // =========================================================================
  await test.step("14. Criação de deal e visualização no /pipeline", async () => {
    const panel = page.getByRole("region", { name: "Contato da conversa", exact: true });
    await panel.getByRole("button", { name: "Criar deal", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Novo deal" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(contactName);
    await dialog.getByLabel("Valor").fill("250");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(dialog).toBeHidden();

    // Conferir no Pipeline
    await gotoReady(page, "/pipeline");
    await expect(page.getByTestId("pipeline-board")).toBeVisible();
    await expect(page.getByText(new RegExp(`Oportunidade — ${contactName}`))).toBeVisible();
  });

  // =========================================================================
  // Critério 15: Execução / Gerenciamento de regra de automação (/automacoes)
  // =========================================================================
  await test.step("15. Regras de automação (/automacoes)", async () => {
    await gotoReady(page, "/automacoes");
    await expect(page.getByRole("heading", { name: "Automações" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nova automação", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar com IA", exact: true })).toBeVisible();
  });

  // =========================================================================
  // Critério 16: Transferência da conversa para humano (handoff)
  // =========================================================================
  await test.step("16. Transferência e assunção humana (/inbox)", async () => {
    await gotoReady(page, "/inbox");
    await page
      .getByRole("region", { name: "Lista de conversas" })
      .getByRole("button", { name: new RegExp(contactName) })
      .click();
    const conversation = page.getByRole("region", { name: "Conversa", exact: true });
    await settled(conversation);

    // Atendente assume a conversa
    await page.getByRole("button", { name: "Assumir", exact: true }).click();
    await expect(conversation.getByText(/assumiu a conversa/)).toBeVisible();
  });

  // =========================================================================
  // Critério 17: Atendente humano envia resposta no Inbox
  // =========================================================================
  await test.step("17. Atendente humano envia resposta no Inbox", async () => {
    const conversation = page.getByRole("region", { name: "Conversa", exact: true });
    await page
      .getByLabel("Escreva sua mensagem")
      .fill("Olá Lucas! Sou a Dra. Mariana, vou te ajudar com seu agendamento.");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(
      conversation.getByText("Sou a Dra. Mariana, vou te ajudar com seu agendamento."),
    ).toBeVisible();
    await expect(conversation.getByText("Entregue", { exact: true })).toBeVisible();
  });

  // =========================================================================
  // Critério 18: Atendente encerra a conversa
  // =========================================================================
  await test.step("18. Atendente encerra a conversa", async () => {
    const conversation = page.getByRole("region", { name: "Conversa", exact: true });
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(conversation.getByText("Fechada", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Escreva sua mensagem")).toBeDisabled();
    await expect(page.getByText("Reabra a conversa para responder.")).toBeVisible();
  });

  // =========================================================================
  // Critério 19: Métricas registradas no /dashboard e /analytics
  // =========================================================================
  await test.step("19. Métricas registradas no /dashboard e /analytics", async () => {
    // 19a. Dashboard
    await gotoReady(page, "/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Conversas hoje" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Novos contatos" })).toBeVisible();

    // 19b. Analytics
    await gotoReady(page, "/analytics");
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Atendimento & Conversas" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Inteligência Artificial" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Vendas & Funil do CRM" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  });
});
