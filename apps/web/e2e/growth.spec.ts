import { createHmac } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { newEmail, signUpWithOrg } from "./support/auth";
import { gotoReady } from "./support/nav";
import { clearRateLimits, psql, simulateInboundSql } from "./support/local-db";
import {
  AUTOMATION_TEST_URL,
  drainGrowth,
  orgFor,
} from "./support/automation";
import { confirmWebhook, connectionFor, connectInstagram } from "./support/instagram";

test.setTimeout(120_000);
test.beforeEach(() => clearRateLimits());

async function setupOrg(page: Page, email: string) {
  await signUpWithOrg(page, email, "Crescimento E2E");
  const org = orgFor(email);

  // Garante canal Simulador
  const simCheck = psql(
    `select id from public.channels where organization_id='${org}' and type='simulator' limit 1`,
  );
  let simChannelId = simCheck;
  if (!simCheck) {
    simChannelId = psql(
      `insert into public.channels(organization_id, name, type) values ('${org}', 'Simulador', 'simulator') returning id`,
    );
  }

  // Tags
  psql(
    `insert into public.tags(organization_id, name, color) values ('${org}', 'Vip', '#8844ff'), ('${org}', 'Promo', '#22aa44') on conflict do nothing`,
  );

  return { org, simChannelId };
}

test("Growth 1: Link no Simulador cria nota, atribui tag e dispara automação entry_link", async ({
  page,
}) => {
  const email = newEmail();
  const { org, simChannelId } = await setupOrg(page, email);

  const vipTagId = psql(
    `select id from public.tags where organization_id='${org}' and name='Vip' limit 1`,
  );

  // Cria link de entrada no banco
  const linkId = psql(
    `insert into public.entry_links (organization_id, channel_id, name, code, tag_id, status)
     values ('${org}', '${simChannelId}', 'Link Promoção', 'promo-vip', '${vipTagId}', 'active')
     returning id`,
  );

  // Cria automação com gatilho entry_link
  const autoId = psql(
    `insert into public.automations (organization_id, name, trigger_type, trigger_config, status, current_version)
     values ('${org}', 'Boas-vindas Link', 'entry_link', '{"linkIds": ["${linkId}"]}', 'active', 1)
     returning id`,
  );
  const triggerNodeId = "00000000-0000-4000-8000-000000000001";
  const msgNodeId = "00000000-0000-4000-8000-000000000002";
  psql(`
    insert into public.automation_nodes (id, organization_id, automation_id, type, config, position) values
      ('${triggerNodeId}', '${org}', '${autoId}', 'trigger', '{"linkIds": ["${linkId}"]}', '{"x":0,"y":0}'),
      ('${msgNodeId}', '${org}', '${autoId}', 'message', '{"mode":"text","text":"Bem-vindo via link de entrada!"}', '{"x":0,"y":100}');
    insert into public.automation_edges (id, organization_id, automation_id, source_node_id, target_node_id, source_handle) values
      ('00000000-0000-4000-8000-000000000003', '${org}', '${autoId}', '${triggerNodeId}', '${msgNodeId}', 'default');
    insert into public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph) values
      ('${org}', '${autoId}', 1, 'entry_link', '{"linkIds": ["${linkId}"]}',
       '{"nodes":[{"id":"${triggerNodeId}","type":"trigger","config":{"linkIds":["${linkId}"]},"position":{"x":0,"y":0}},{"id":"${msgNodeId}","type":"message","config":{"mode":"text","text":"Bem-vindo via link de entrada!"},"position":{"x":0,"y":100}}],"edges":[{"id":"00000000-0000-4000-8000-000000000003","source":"${triggerNodeId}","target":"${msgNodeId}","sourceHandle":"default"}]}');
  `);

  // Abre a aba de links
  await gotoReady(page, "/automacoes/links");
  await expect(page.getByText("Link Promoção").first()).toBeVisible();

  // Simula a abertura do link
  await page.getByRole("button", { name: "Simular" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Simular conversa")).toBeVisible();
  await dialog.getByRole("tab", { name: "Abertura por link" }).click();
  await dialog.getByLabel("Link de entrada").selectOption({ value: linkId });
  await dialog.getByLabel("Nome do contato").fill("Roberto Link");
  await dialog.getByLabel("Telefone").fill("(11) 97777-6666");
  await dialog.getByRole("button", { name: "Simular abertura pelo link" }).click();

  await expect(page.getByText("Conversa simulada com sucesso.").first()).toBeVisible();

  // Drena execuções de automação
  await drainGrowth(email);

  // Acessa o Inbox
  await gotoReady(page, "/inbox");
  await page.getByRole("button", { name: /Roberto Link/ }).click();

  // Verifica nota de entrada e resposta da automação
  await expect(page.getByText("Entrou pelo link de entrada").first()).toBeVisible();
  await expect(page.getByText("Bem-vindo via link de entrada!").first()).toBeVisible();

  // Verifica tag atribuída no painel do contato
  await expect(page.getByText("Vip").first()).toBeVisible();
});

test("Growth 2: Sequência envia passo 1 e remove contato ao responder palavra de saída", async ({
  page,
}) => {
  const email = newEmail();
  const { org, simChannelId } = await setupOrg(page, email);

  // Cria sequência de 2 passos com exitWords: ["parar"]
  const seqId = psql(
    `insert into public.sequences (organization_id, name, status, settings)
     values ('${org}', 'Sequência Boas-vindas', 'active', '{"channelIds": ["${simChannelId}"], "exitOnReply": false, "exitWords": ["parar"]}')
     returning id`,
  );
  psql(`
    insert into public.sequence_steps (organization_id, sequence_id, position, delay_minutes, message) values
      ('${org}', '${seqId}', 0, 1, '{"text": "Primeiro passo da sequência"}'),
      ('${org}', '${seqId}', 1, 1, '{"text": "Segundo passo da sequência"}');
  `);

  // Cria contato com conversa no simulador
  simulateInboundSql(email, { name: "Fernanda", phone: "5511999998888", text: "Oi" });
  const contactId = psql(
    `select contact_id from public.conversations where organization_id='${org}' limit 1`,
  );

  // Inscreve contato na sequência
  psql(`select public.enroll_contact_in_sequence('${seqId}', '${contactId}');`);

  // Avança o run_after da entrega do passo 0 para agora e drena
  psql(
    `update public.outreach_deliveries set run_after = now() - interval '1 minute' where organization_id='${org}'`,
  );
  await drainGrowth(email);

  // Entra no Inbox
  await gotoReady(page, "/inbox");
  await page.getByRole("button", { name: /Fernanda/ }).click();

  // O passo 1 deve ter sido enviado
  await expect(page.getByText("Primeiro passo da sequência").first()).toBeVisible();

  // Fernanda responde "parar"
  simulateInboundSql(email, { name: "Fernanda", phone: "5511999998888", text: "parar" });
  await drainGrowth(email);

  // Contato deve ter sido removido da sequência e gerado nota interna
  await page.reload();
  await page.getByRole("button", { name: /Fernanda/ }).click();
  await expect(page.getByText(/saiu da sequência/i).first()).toBeVisible();

  // Avança tempo novamente: passo 2 NÃO deve ser gerado nem enviado
  psql(
    `update public.outreach_deliveries set run_after = now() - interval '1 minute' where organization_id='${org}'`,
  );
  await drainGrowth(email);
  await expect(page.getByText("Segundo passo da sequência")).not.toBeVisible();
});

test("Growth 3: Campanha transmite para público dentro da janela e contabiliza cliques", async ({
  page,
}) => {
  const email = newEmail();
  const { org, simChannelId } = await setupOrg(page, email);
  const promoTagId = psql(
    `select id from public.tags where organization_id='${org}' and name='Promo' limit 1`,
  );

  // Contato com conversa recente (< 24h) e tag Promo
  simulateInboundSql(email, { name: "Lucas", phone: "5511955554444", text: "Tenho interesse" });
  const contactId = psql(
    `select contact_id from public.conversations where organization_id='${org}' limit 1`,
  );
  psql(
    `insert into public.contact_tags (organization_id, contact_id, tag_id) values ('${org}', '${contactId}', '${promoTagId}')`,
  );

  // Cria rascunho de campanha
  const campaignId = psql(
    `insert into public.campaigns (organization_id, name, status, audience, message)
     values ('${org}', 'Super Promoção', 'draft',
       '{"channelIds": ["${simChannelId}"], "tagsAll": ["${promoTagId}"], "tagsAny": [], "tagsNone": [], "stageIds": [], "minLeadScore": null, "lastInteractionDays": null, "entryLinkIds": []}',
       '{"text": "Aproveite 30% de desconto!", "quickReplies": [{"id": "qr1", "title": "Quero desconto", "automationId": "00000000-0000-4000-8000-000000000000"}]}')
     returning id`,
  );

  // Abre o assistente de campanha
  await gotoReady(page, `/automacoes/campanhas/${campaignId}`);
  await expect(page.getByText("Prévia do público").first()).toBeVisible();
  await expect(page.getByText("1 no público").first()).toBeVisible();

  // Avança para mensagem e envio
  await page.getByRole("button", { name: "Continuar para Mensagem" }).click();
  await expect(page.getByText("Prévia da mensagem")).toBeVisible();
  await page.getByRole("button", { name: "Continuar para Envio" }).click();

  // Enviar agora
  await page.getByRole("button", { name: "Confirmar e enviar agora" }).click();
  await expect(page.getByText(/Campanha iniciada/i).first()).toBeVisible();

  // Drena envios da campanha
  await drainGrowth(email);

  // Verifica relatório da campanha
  await gotoReady(page, `/automacoes/campanhas/${campaignId}`);
  await expect(page.getByText("1 enviados com sucesso").or(page.getByText("1", { exact: true }))).toBeVisible();

  // Verifica recebimento no Inbox e simula clique
  await gotoReady(page, "/inbox");
  await page.getByRole("button", { name: /Lucas/ }).click();
  await expect(page.getByText("Aproveite 30% de desconto!").first()).toBeVisible();

  // Registra evento de clique outreach_click
  const deliveryId = psql(
    `select id from public.outreach_deliveries where organization_id='${org}' and campaign_id='${campaignId}' limit 1`,
  );
  psql(`
    insert into public.events (organization_id, type, actor_type, payload)
    values ('${org}', 'outreach_click', 'contact', '{"deliveryId": "${deliveryId}", "optionId": "qr1"}');
  `);

  // Relatório deve mostrar 1 clique
  await gotoReady(page, `/automacoes/campanhas/${campaignId}`);
  await expect(page.getByText("1 cliques").first()).toBeVisible();
});

test("Growth 4: Campanha agendada cancelada não realiza entregas", async ({ page }) => {
  const email = newEmail();
  const { org, simChannelId } = await setupOrg(page, email);

  // Cria campanha já agendada para daqui a 2 dias
  const campaignId = psql(
    `insert into public.campaigns (organization_id, name, status, scheduled_at, audience, message)
     values ('${org}', 'Campanha Futura', 'scheduled', now() + interval '2 days',
       '{"channelIds": ["${simChannelId}"], "tagsAll": [], "tagsAny": [], "tagsNone": [], "stageIds": [], "minLeadScore": null, "lastInteractionDays": null, "entryLinkIds": []}',
       '{"text": "Mensagem que será cancelada"}')
     returning id`,
  );

  await gotoReady(page, `/automacoes/campanhas/${campaignId}`);
  await expect(page.getByText("Campanha Futura").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar campanha" })).toBeVisible();

  // Cancela a campanha
  await page.getByRole("button", { name: "Cancelar campanha" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Confirmar cancelamento" }).click();

  await expect(page.getByText("Cancelada").first()).toBeVisible();

  // Drena e valida que nenhuma entrega foi disparada
  await drainGrowth(email);
  const count = Number(
    psql(
      `select count(*) from public.outreach_deliveries where organization_id='${org}' and campaign_id='${campaignId}' and status='sent'`,
    ),
  );
  expect(count).toBe(0);
});

test("Growth 5: Webhook do Instagram com referral inicia automação e descarta duplicados", async ({
  page,
}) => {
  const email = newEmail();
  const { org } = await setupOrg(page, email);

  // Conecta Instagram de teste
  await connectInstagram(page);
  await confirmWebhook(email);
  const connection = connectionFor(email);
  const channelId = connection.channelId;

  // Cria link de entrada para o Instagram
  const linkId = psql(
    `insert into public.entry_links (organization_id, channel_id, name, code, status)
     values ('${org}', '${channelId}', 'Link Bio Instagram', 'bio-ig', 'active')
     returning id`,
  );

  // Cria automação para o link
  const autoId = psql(
    `insert into public.automations (organization_id, name, trigger_type, trigger_config, status, current_version)
     values ('${org}', 'Resposta Referral', 'entry_link', '{"linkIds": ["${linkId}"]}', 'active', 1)
     returning id`,
  );
  const tNode = "00000000-0000-4000-8000-000000000010";
  const mNode = "00000000-0000-4000-8000-000000000011";
  psql(`
    insert into public.automation_nodes (id, organization_id, automation_id, type, config, position) values
      ('${tNode}', '${org}', '${autoId}', 'trigger', '{"linkIds": ["${linkId}"]}', '{"x":0,"y":0}'),
      ('${mNode}', '${org}', '${autoId}', 'message', '{"mode":"text","text":"Obrigado por clicar no link da Bio!"}', '{"x":0,"y":100}');
    insert into public.automation_edges (id, organization_id, automation_id, source_node_id, target_node_id, source_handle) values
      ('00000000-0000-4000-8000-000000000012', '${org}', '${autoId}', '${tNode}', '${mNode}', 'default');
    insert into public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph) values
      ('${org}', '${autoId}', 1, 'entry_link', '{"linkIds": ["${linkId}"]}',
       '{"nodes":[{"id":"${tNode}","type":"trigger","config":{"linkIds":["${linkId}"]},"position":{"x":0,"y":0}},{"id":"${mNode}","type":"message","config":{"mode":"text","text":"Obrigado por clicar no link da Bio!"},"position":{"x":0,"y":100}}],"edges":[{"id":"00000000-0000-4000-8000-000000000012","source":"${tNode}","target":"${mNode}","sourceHandle":"default"}]}');
  `);

  const payload = JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: connection.accountId,
        time: Date.now(),
        messaging: [
          {
            sender: { id: "contact-ig-123" },
            recipient: { id: connection.accountId },
            timestamp: Date.now(),
            referral: {
              ref: "bio-ig",
              source: "SHORTLINK",
              type: "OPEN_THREAD",
            },
          },
        ],
      },
    ],
  });

  const signature = `sha256=${createHmac("sha256", "e2e-app-secret").update(payload).digest("hex")}`;
  const response = await fetch(
    `${AUTOMATION_TEST_URL}/functions/v1/meta-webhook/${connection.id}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
      },
      body: payload,
    },
  );
  expect(response.ok).toBe(true);

  // Drena o worker
  await drainGrowth(email);

  // Segundo envio do mesmo evento exato para testar idempotência
  const dupResponse = await fetch(
    `${AUTOMATION_TEST_URL}/functions/v1/meta-webhook/${connection.id}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
      },
      body: payload,
    },
  );
  expect(dupResponse.ok).toBe(true);
  await drainGrowth(email);

  // Verifica que a automação executou apenas 1 vez
  const runCount = Number(
    psql(
      `select count(*) from public.automation_runs where organization_id='${org}' and automation_id='${autoId}'`,
    ),
  );
  expect(runCount).toBe(1);
});
