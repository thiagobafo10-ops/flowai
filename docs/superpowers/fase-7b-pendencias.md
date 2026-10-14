# Fase 7B — Decisões, pendências e evidências

Referências: [design](specs/2026-10-14-fase-7b-crescimento-design.md) e [plano](plans/2026-10-14-fase-7b-crescimento.md). Validação local com Deno/Playwright e PostgreSQL não substitui a validação ao vivo com uma app Meta real ou contas ativas no Instagram.

---

## Decisões de implementação e arquitetura

1. **Links de entrada e Códigos:**
   - O código do link é único por canal (regex `^[a-z0-9_-]{3,40}$`).
   - Geração automática de shortlink amigável: `ig.me/m/<username>?ref=<code_or_id>`. Caso a conta não possua username configurado, exibe aviso orientativo para cadastro em Canais.
   - O Simulador aceita simulação direta de abertura por link gerando uma nota interna rastreada (`Entrou pelo link de entrada: <nome>`), aplicando a tag vinculada (se houver) e disparando automações com gatilho `entry_link`.

2. **Gatilho de Automação `entry_link`:**
   - O gatilho `entry_link` aceita múltiplos links (`linkIds: uuid[]`).
   - Suporta idempotência estrita via hash do evento de entrada, evitando execuções duplicadas de webhooks repetidos da Meta.

3. **Nós de Automação de Sequência:**
   - Adicionados os nós `sequence_enroll` (inscrever em sequência) e `sequence_remove` (remover de sequência) na paleta visual e painel do editor de automações.
   - O executor de automação e as server actions gerenciam inscrições ativas e garantem remoção atômica do contato.

4. **Sequências de Follow-up (Nutrição):**
   - Suporte a múltiplos passos com intervalo/espera flexível (minutos, horas, dias) convertidos de forma determinística para minutos.
   - Janela de horário opcional por passo (dias da semana e intervalo inicial/final).
   - Saída inteligente por resposta (`exitOnReply`) e por palavras-chave de saída configuráveis (`exitWords`, padrão: "sair", "parar", "cancelar").
   - Mensagens com suporte a texto, botões de ação (URL ou disparo de automação) e respostas rápidas compartilhadas via `OutreachMessageForm`.
   - Gerenciamento direto na ficha do contato no Inbox para operadores e agentes.

5. **Campanhas de Transmissão (Outreach):**
   - Assistente em 3 passos com filtros de público: canais, etiquetas (inclusão de todas `tagsAll`, inclusão de qualquer `tagsAny`, exclusão `tagsNone`), etapas de funil, links de entrada, score de lead e última interação.
   - Prévia de público ao vivo em tempo real via RPC `preview_campaign_audience`, computando: total no público, contatos dentro da janela de 24h e contatos que ficarão de fora.
   - Proteção da Janela de 24h da Meta: apenas contatos que interagiram nas últimas 24 horas são transmitidos de forma gratuita. Contatos fora da janela são marcados como `skipped` com motivo `window_closed`.
   - Pacing de canal (`campaign_rate_per_minute`, padrão 30/minuto): evita bloqueios por taxa de envio na Meta.
   - Envio imediato ou agendado no fuso horário local.
   - Cancelamento seguro e atômico para campanhas em `scheduled` ou `sending`.
   - Relatório detalhado com taxa de entrega, motivos de descarte/falha, contadores de cliques e lista paginada de destinatários.

6. **Worker de Entregas (Edge Functions / Deno):**
   - O worker drena tanto automações convencionais quanto entregas de growth (`outreach_deliveries`) dentro do mesmo ciclo de execução.
   - Tratamento de idempotência e ordenação global de locks em transações do banco de dados (evitando deadlocks `40P01`).

---

## Validação ao vivo pendente

- **Meta Graph API em Produção:**
  - Validação do link real `ig.me/m/<username>?ref=...` abrindo a thread direta no aplicativo móvel do Instagram.
  - Teste de webhooks `messaging_referral` e postbacks de `referral` reais disparados via campanhas de anúncios e shortlinks externos.
  - Validação de aprovação em App Review da Meta para os escopos `instagram_manage_messages` e envio de templates de botões em Direct.
- **WhatsApp Cloud API:**
  - Envio de campanhas e sequências para WhatsApp exigirá aprovação prévia de Message Templates (HSM) para contatos fora da janela de 24 horas.
- **Ritmo de Envio em Escala:**
  - Avaliação de limites de throughput da Meta (Tier 1, Tier 2 e Tier 3) para campanhas acima de 10.000 destinatários.

---

## Tabela de Evidências dos Testes

| Suíte / Comando | Escopo | Resultado |
| :--- | :--- | :--- |
| `npm test -w apps/web` | Vitest: links, sequências, campanhas, QR code, queries e actions | **30 passed (155 testes)** |
| `npm run typecheck -w apps/web` | TypeScript: verificação estrita de rotas e tipos Next.js 16 | **Passou (código 0)** |
| `npm run lint -w apps/web` | ESLint: conformidade React 19 e boas práticas | **Passou (0 erros, 0 avisos)** |
| `npm run build -w apps/web` | Next.js: build de produção Turbopack com 36 rotas | **Passou (código 0)** |
| `scripts/test-growth-e2e.mjs` | Playwright: 5 cenários isolados (Simulador, Sequência, Campanha, Cancelamento, Referral) | **Pronto para execução** |
