import { test, expect } from "@playwright/test";
import { newEmail, PASSWORD } from "./support/auth";
import { gotoReady, reloadReady, settled, waitForHydration } from "./support/nav";
import { clearRateLimits, contactIdByName, countMemberships, psql } from "./support/local-db";
import { expectAnalyticsCsv } from "./support/analytics";

test.setTimeout(120_000);
test.use({ actionTimeout: 30_000 });

test.beforeEach(() => clearRateLimits());

// UI smoke plus persisted CRM/metrics checks. Classification/RAG/replies and automation
// execution have separate behavioural cases mapped in fase-10-mvp-conclusao.md.
// Run under test:mvp:e2e: shared worker crons are paused, OpenAI is local/fake.
test("MVP smoke: 19 etapas de navegação, CRM persistido e métricas exportadas", async ({ page }) => {
  const email = newEmail();
  const orgName = "Clínica Piloto MVP";
  const contactName = "Lucas Silva";
  const contactPhone = "(11) 97777-6666";

  // =========================================================================
  // Etapa 1: Cadastro do usuário (/signup)
  // =========================================================================
  await test.step("1. Cadastro do usuário (/signup)", async () => {
    await gotoReady(page, "/signup");
    await expect(page.getByRole("button", { name: "Criar conta", exact: true })).toBeVisible();
    await page.getByLabel("Nome completo").fill("Dra. Mariana");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });
    await expect(page.getByLabel("Nome da empresa")).toBeVisible();
    await waitForHydration(page);
  });

  // =========================================================================
  // Etapa 2: Criação da organização (/onboarding)
  // =========================================================================
  await test.step("2. Criação da organização (/onboarding)", async () => {
    await page.getByLabel("Nome da empresa").fill(orgName);
    await page.getByRole("button", { name: "Criar organização" }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await waitForHydration(page);
    expect(countMemberships(email)).toBe(1);
  });

  // =========================================================================
  // Etapa 3: Acesso ao /dashboard
  // =========================================================================
  await test.step("3. Acesso ao /dashboard", async () => {
    await expect(page.getByRole("main").getByText(orgName)).toBeVisible();
    await expect(page.getByRole("group", { name: "Conversas hoje" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Taxa de resolução" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Novos contatos" })).toBeVisible();
  });

  // =========================================================================
  // Etapa 4: Configuração do agente de IA (/ia)
  // =========================================================================
  await test.step("4. Configuração do agente de IA (/ia)", async () => {
    await gotoReady(page, "/ia");
    await expect(page.getByRole("heading", { name: "IA", exact: true })).toBeVisible();
    await page.getByRole("switch", { name: "Agente ativo" }).check();
    await page.getByRole("switch", { name: "Responder automaticamente" }).check();
    await page.getByRole("switch", { name: "Transferir para humano quando necessário" }).check();
    await page.getByRole("button", { name: "Salvar", exact: true }).first().click();
    await expect(page.getByText("Agente salvo.").first()).toBeVisible();
    await reloadReady(page);
    await expect(page.getByRole("switch", { name: "Agente ativo" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Responder automaticamente" })).toBeChecked();
  });

  // =========================================================================
  // Etapa 5: Criação de documento na base de conhecimento (/conhecimento)
  // =========================================================================
  await test.step("5. Criação de documento na base de conhecimento (/conhecimento)", async () => {
    await gotoReady(page, "/conhecimento");
    await expect(page.getByRole("heading", { name: "Conhecimento", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Novo documento" }).first().click();
    await page.getByLabel("Título", { exact: true }).fill("Valores de Consulta e Retorno");
    await page
      .getByLabel("Conteúdo", { exact: true })
      .fill("A consulta médica inicial custa R$ 250 e o retorno é sem custo adicional em até 30 dias.");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByRole("row", { name: /Valores de Consulta e Retorno/ })).toBeVisible();
  });

  // =========================================================================
  // Etapa 6: Conexão do canal Simulador (/configuracoes/canais)
  // =========================================================================
  await test.step("6. Conexão do canal Simulador (/configuracoes/canais)", async () => {
    await gotoReady(page, "/configuracoes/canais");
    await expect(page.getByRole("heading", { name: "Simulador", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Criar canal Simulador" }).click();
    const block = page.getByTestId("simulator-channel");
    await expect(block.getByText("Ativo", { exact: true })).toBeVisible();
  });

  // =========================================================================
  // Etapa 7: Simulação de mensagem inbound
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
  // Etapa 8: Exibição da mensagem no /inbox
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
  // Etapa 9: Contato criado automaticamente
  // =========================================================================
  await test.step("9. Contato criado automaticamente (/contatos)", async () => {
    await gotoReady(page, "/contatos");
    await expect(page.getByRole("heading", { name: "Contatos" })).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(contactName) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Simulador");
  });

  // =========================================================================
  // Etapa 10: Smoke dos rótulos de classificação (valores em ai.spec.ts)
  // =========================================================================
  await test.step("10. Smoke: campos de classificação visíveis (/inbox)", async () => {
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
  // Etapa 11: Smoke do formulário (envio e RAG em ai.spec.ts)
  // =========================================================================
  await test.step("11. Smoke: formulário do playground (/ia)", async () => {
    await gotoReady(page, "/ia");
    const playground = page.getByRole("region", { name: "Área de teste" });
    await expect(playground).toBeVisible();
    await page.getByLabel("Mensagem do contato").fill("Qual o valor da consulta?");
    await expect(page.getByRole("button", { name: "Enviar", exact: true })).toBeEnabled();
  });

  // =========================================================================
  // Etapa 12: Smoke da cota (resposta e selo em ai.spec.ts)
  // =========================================================================
  await test.step("12. Smoke: exibição de cota da IA", async () => {
    await gotoReady(page, "/ia");
    await expect(page.getByText("de 300 respostas")).toBeVisible();
  });

  // =========================================================================
  // Etapa 13: Atualização de lead score do contato
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
    await expect(page.getByText("Lead score salvo.").first()).toBeVisible();
    const contactId = contactIdByName(email, contactName);
    expect(psql(`select lead_score from public.contacts where id='${contactId}'`)).toBe("85");
    await reloadReady(page);
    await page.getByRole("region", { name: "Lista de conversas" }).getByRole("button", { name: new RegExp(contactName) }).click();
    await expect(scoreInput).toHaveValue("85");
  });

  // =========================================================================
  // Etapa 14: Visualização do contato no /contatos e deal no /pipeline
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
  // Etapa 15: Smoke das ações (ativação e execução em automation.spec.ts)
  // =========================================================================
  await test.step("15. Smoke: ações de criação de automação (/automacoes)", async () => {
    await gotoReady(page, "/automacoes");
    await expect(page.getByRole("heading", { name: "Automações" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nova automação", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar com IA", exact: true })).toBeVisible();
  });

  // =========================================================================
  // Etapa 16: Transferência da conversa para humano (handoff)
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
  // Etapa 17: Atendente humano envia resposta no Inbox
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
  // Etapa 18: Atendente encerra a conversa
  // =========================================================================
  await test.step("18. Atendente encerra a conversa", async () => {
    const conversation = page.getByRole("region", { name: "Conversa", exact: true });
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(conversation.getByText("Fechada", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Escreva sua mensagem")).toBeDisabled();
    await expect(page.getByText("Reabra a conversa para responder.")).toBeVisible();
    const contactId = contactIdByName(email, contactName);
    expect(psql(`select status from public.conversations where contact_id='${contactId}'`)).toBe("closed");
  });

  // =========================================================================
  // Etapa 19: Métricas registradas no /dashboard e /analytics
  // =========================================================================
  await test.step("19. Métricas registradas no /dashboard e /analytics", async () => {
    // 19a. Dashboard
    await gotoReady(page, "/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Conversas hoje" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Novos contatos" })).toBeVisible();
    const dashboard = await page.request.get("/api/dashboard?periodo=7d");
    expect(dashboard.status()).toBe(200);
    expect((await dashboard.json()).kpis).toMatchObject({
      conversations_today: 1, new_contacts: 1, resolution_rate: 1, potential_value: 250,
    });

    // 19b. Analytics
    await gotoReady(page, "/analytics");
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Atendimento & Conversas" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Inteligência Artificial" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Vendas & Funil do CRM" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
    const analytics = await page.request.get("/api/analytics?periodo=30d");
    expect(analytics.status()).toBe(200);
    const metrics = await analytics.json();
    expect(metrics.summary).toMatchObject({
      total_conversations: 1, new_contacts: 1, resolution_rate: 100,
      ai_containment_rate: null, total_pipeline_value: 250, won_deals_value: 0,
    });
    expect(metrics.crm_section.avg_ticket).toBe(0);
    await expectAnalyticsCsv(page, "30d", {
      conversations: metrics.summary.total_conversations, contacts: metrics.summary.new_contacts,
      resolution: metrics.summary.resolution_rate, containment: metrics.summary.ai_containment_rate,
      pipeline: metrics.summary.total_pipeline_value, won: metrics.summary.won_deals_value,
      ticket: metrics.crm_section.avg_ticket,
    });
  });
});
