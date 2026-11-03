# E-mails da loja (estilo Reportana): jornadas de e-mail com Yampi + Resend

- Data: 2026-11-03.
- Status: desenho aprovado pelo usuário em chat (jornadas prontas — opção A; Resend; modelo fixo com a marca); aguardando revisão desta spec.
- Base: `master` (automação de live no ar).
- Uso: loja Holy Spirit (catálogo Shopify, **checkout Yampi**). O FlowAI continua multi-tenant por baixo: tudo é por organização.

## Resultado esperado

O FlowAI recebe os eventos do checkout Yampi e envia, pelo Resend, e-mails com a marca da loja em três jornadas pré-montadas — carrinho abandonado, Pix/boleto pendente e pós-venda — que param sozinhas quando o pedido é pago ou a pessoa se descadastra, com um painel de enviados, aberturas, cliques e vendas recuperadas.

## Fora do escopo

WhatsApp e SMS; editor visual de arrastar blocos; teste A/B; desvios condicionais nas jornadas ("se clicou, faça X"); uso do editor de fluxos (opção B); importação de pedidos antigos; e-mails para lista inteira (campanhas).

## Etapas de entrega

Cada etapa tem seu próprio plano e é utilizável sozinha.
1. **Base + Carrinho abandonado:** seções 1–6 completas para a jornada `cart`.
2. **Pix/boleto pendente:** jornada `pending_payment`.
3. **Pós-venda + resultados completos:** jornada `post_purchase` e a seção 7 inteira (a etapa 1 já entrega enviados/aberturas/cliques/vendas recuperadas da jornada de carrinho).

## 1. Entrada (Yampi → FlowAI)

- **Edge Function `yampi-webhook`**, URL `/functions/v1/yampi-webhook/<connectionId>` (id aleatório por loja). Aceita só `POST`, corpo ≤ 1 MB, limite por IP e por conexão (padrão do `meta-webhook`).
- **Autenticação:** se a Yampi assinar o corpo (cabeçalho com HMAC), validar com o segredo da conexão em tempo constante; caso contrário, a segurança é o `connectionId` secreto + validação do formato. **Verificação obrigatória na Tarefa 1 do plano** (documentação atual da Yampi: cabeçalho de assinatura e formato de `cart.reminder` e `order.*`).
- Eventos tratados: `cart.reminder`, `order.created`, `order.paid`, `order.status.updated`. Outros → 200 e ignorados.
- **Idempotência:** tabela `store_events` com `(connection_id, event, resource_id, hash do corpo)` único; reentrega devolve 200 sem efeito.
- Cada evento:
  - **contato por e-mail** (minúsculo, aparado): encontra o contato da organização com o mesmo e-mail ou cria um (nome e telefone se vierem). O e-mail nunca é sobrescrito por outro.
  - grava/atualiza **`store_carts`** (`cart.reminder`: id do carrinho, contato, valor, link de recuperação do checkout, itens) ou **`store_orders`** (número, status, forma de pagamento, valor, link do pedido/pagamento, vencimento Pix/boleto, código e link de rastreio, itens).
  - itens: nome, variante, quantidade, preço, URL da imagem (guardados no próprio registro, em `jsonb`).
- **Conexão Yampi** (`store_connections`): organização, alias da loja, segredo (Vault), estado. Tela de Configurações → "Loja (Yampi)" mostra a URL do webhook e o checklist de eventos a marcar no painel da Yampi.

## 2. Jornadas e agendamento

- **`email_journeys`** (uma por tipo e organização): `kind` = `cart` | `pending_payment` | `post_purchase`, `enabled`.
- **`email_journey_steps`**: `journey_id`, `position`, `delay_minutes`, `enabled`, `subject`, `heading`, `body`, `button_label`, `coupon` (opcional), `category` = `marketing` | `transactional`.
- **Padrões criados na ativação** (textos sugeridos em português, editáveis):
  - `cart`: 60 min, 1440 min, 2880 min (o 3º com o campo de cupom preenchido em branco, para o usuário colocar o dele); categoria `marketing`.
  - `pending_payment` (etapa 2): 120 min após `order.created` não pago; e "dia do vencimento" (09:00 no fuso da loja, se houver vencimento); `marketing`.
  - `post_purchase` (etapa 3): confirmação em `order.paid` (0 min, `transactional`); envio quando chega código de rastreio (`transactional`); 15 dias após o pagamento, avaliação/recompra (`marketing`).
- **Agendamento:** o evento de entrada cria linhas em **`email_sends`** (`organization_id`, `contact_id`, `journey_step_id`, `cart_id`/`order_id`, `send_at`, `state` = `scheduled|sending|sent|cancelled|failed`, `cancel_reason`, `provider_id`, `attempts`), com **chave única `(step_id, cart_id|order_id)`** — o mesmo e-mail nunca é agendado duas vezes.
- **Cancelamento:** antes de cada envio, a função de reserva revalida e cancela com motivo: jornada/passo desligado (`step_disabled`), carrinho virou pedido do mesmo contato (`converted`), pedido pago (`paid`), contato descadastrado de marketing (`unsubscribed`), endereço bloqueado (`suppressed`), sem e-mail válido (`no_email`). `order.paid` também cancela de imediato todos os envios `scheduled` de carrinho/pendente daquele contato.
- **Cron `flowai-email-worker`** (pg_cron + `net.http_post` com segredo interno, padrão dos crons existentes), a cada minuto, chama a Edge Function `email-worker` com o lote de envios vencidos (`send_at <= now()`), reservados com `for update skip locked` (estado `sending` + `claimed_at`; reserva expira em 5 min).

## 3. Envio (Resend)

- **`email-worker`**: para cada envio reservado, monta o e-mail e chama `POST https://api.resend.com/emails` com `Idempotency-Key = <email_send.id>`.
- **Configuração por organização** (`email_settings`): chave da API Resend (Vault), remetente (`nome <endereço>`), responder-para, estado do domínio (consultado na API do Resend ao salvar e por botão "verificar").
- **Modelo fixo** (`packages/core/src/email/template.ts`, função pura testada): HTML compatível com e-mail (tabelas, estilos inline, largura 600, legível no celular e no Gmail) + versão texto. Contém logo/nome da loja, título, corpo, bloco de produtos (até 4 itens: foto, nome, variante, preço; "+N itens"), cupom em destaque quando houver, botão, rodapé com endereço da loja e — em `marketing` — link de descadastro e cabeçalhos `List-Unsubscribe` / `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- **Variáveis:** `{primeiro_nome}`, `{nome}`, `{cupom}`, `{numero_pedido}`, `{valor}`, `{loja}`, `{rastreio}`; variável sem valor vira vazio (nunca `{...}` cru no e-mail).
- **Links rastreados:** o botão e os produtos usam `tracked_links` (`/r/<código>`, já existente), ganhando `email_send_id` opcional.
- **Falhas:** erro 429/5xx/rede → `failed` temporário com nova tentativa (até 3, espera 5/15/60 min); 4xx de validação/endereço → `failed` definitivo. Nunca registrar a chave nem o corpo do e-mail em log.
- **Webhook do Resend** (`resend-webhook`, verificação de assinatura Svix com o segredo do webhook da organização): `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained` atualizam `email_sends` e, em `bounced`/`complained`, inserem o endereço em **`email_suppressions`** (organização + e-mail).
- **Descadastro:** rota pública `/e/sair/<token>` (token aleatório por contato, `email_unsubscribe_tokens`) — GET mostra confirmação com um botão; POST (inclusive o one-click do Gmail) marca `contacts.email_marketing_opt_out_at`. Transacionais continuam.

## 4. Painel ("E-mails da loja")

- Item novo no menu do app.
- **Jornadas:** cartões por jornada (liga/desliga geral) com passos em linha do tempo; cada passo: espera (min/h/dias), liga/desliga, assunto, título, texto, botão, cupom; **prévia ao vivo** com pedido de exemplo e **"Enviar teste para mim"** (para o e-mail do usuário logado; não cria `email_sends`).
- **Configuração:** chave Resend (campo de escrita, nunca reexibida), remetente, responder-para, estado do domínio, URL do webhook Yampi e do webhook Resend.
- **Histórico:** últimos 100 envios com destinatário, jornada, passo, estado (enviado/aberto/clicado/cancelado + motivo/devolvido/falhou) e data; filtro por jornada e estado.
- Escrita exige admin/owner (mesma regra do resto do app); leitura para membros.

## 5. Resultados

- `public.email_journey_results(p_org, p_from, p_to)`: por jornada e passo — agendados, enviados, entregues, abertos, cliques (únicos e totais), cancelados por motivo, **vendas recuperadas** (quantidade e R$).
- **Venda recuperada:** pedido com `order.paid` do mesmo contato em até **7 dias** após um envio `sent` das jornadas `cart` ou `pending_payment`; atribuída ao **último** envio dessas jornadas antes do pagamento. Pós-venda não gera venda recuperada.

## 6. Segurança e privacidade

- Chaves (Resend, segredo Yampi, segredo do webhook Resend) só no Vault; nunca no frontend; chave de serviço fora de `apps/web`.
- RLS em todas as tabelas novas por organização; Edge Functions usam funções `security definer` específicas, como no Instagram.
- Rotas públicas (`yampi-webhook`, `resend-webhook`, `/e/sair`, `/r`) não revelam dados pessoais nem existência de contatos.
- Remoção de contato apaga/anonimiza seus `store_carts`, `store_orders` e `email_sends` (seguir a rotina de expurgo existente).

## 7. Testes e definição de concluído

Nenhum teste chama Yampi ou Resend de verdade.
- **core:** `template` (variáveis, item faltando, até 4 produtos + "+N", cupom, rodapé de descadastro só em marketing, escape de HTML em todo texto vindo do usuário ou da Yampi); parser dos eventos Yampi (formatos de exemplo da documentação).
- **pgTAP:** criação/atualização de contato por e-mail (sem duplicar, sem sobrescrever); idempotência de eventos; agendamento dos passos com chave única; cancelamento por `paid`/`converted`/`unsubscribed`/`suppressed`/`step_disabled`; reserva com `skip locked` e expiração; supressão por bounce; venda recuperada (janela de 7 dias, último envio); RLS entre organizações.
- **Edge (Deno):** `yampi-webhook` (assinatura válida/inválida, evento desconhecido, reentrega); `email-worker` com fetch simulado (sucesso, 429 com nova tentativa, 422 definitivo, chave nunca em log, cabeçalhos List-Unsubscribe); `resend-webhook` (assinatura Svix, bounce → supressão).
- **web:** tela de jornadas (salvar passo, validação), prévia, envio de teste (Resend simulado), página de descadastro.
- Concluído quando as suítes passam e há um guia `docs/superpowers/emails-setup.md`: criar conta e domínio no Resend (registros DNS), chave da API, webhook do Resend, webhook da Yampi (eventos a marcar), desligar a recuperação nativa da Yampi se existir, e o roteiro do teste real (abandonar um carrinho com o próprio e-mail → receber o 1º e-mail → pagar → e-mails seguintes cancelados).
