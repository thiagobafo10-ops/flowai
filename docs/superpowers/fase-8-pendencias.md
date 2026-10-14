# Fase 8 — Criador de Automações com IA (Decisões, pendências e evidências)

Referências: [design](specs/2026-10-15-fase-8-criador-ia-design.md) e [plano](plans/2026-10-15-fase-8-criador-ia.md).

---

## Decisões de implementação e arquitetura

1. **Schema e Prompt Contextualizado com Entidades Reais (`@flowai/core`):**
   - O schema Zod `automationAiOutputSchema` define a estrutura estrita de saída da IA: `name`, `triggerType`, `triggerConfig`, `explanation`, `nodes` e `edges`.
   - A função `buildAutomationPrompt` injeta no system prompt o catálogo contextualizado da organização: IDs e nomes reais de etiquetas cadastradas, etapas do funil de vendas, canais conectados, sequências de follow-up e links de entrada. Dessa forma, a IA conecta blocos referenciando recursos existentes na conta sem inventar IDs aleatórios.

2. **Algoritmo de Auto-Layout Determinístico (`applyAutoLayout`):**
   - Executa uma busca em largura (BFS) a partir do nó gatilho (`trigger`) organizando os nós em níveis verticais/horizontais.
   - Aplica espaçamento padrão (280px horizontal e 160px vertical) para garantir que o fluxo gerado seja imediatamente legível no React Flow sem sobreposição de blocos.

3. **Sanitização e Validação Resiliente do Grafo (`sanitizeAndValidateGeneratedGraph`):**
   - Autocorreção de arestas órfãs ou que apontam para nós inexistentes gerados pela IA.
   - Validação e correção de portas/handles dos nós (ex.: saídas `true`/`false` de nós de condição, handles `opt:*`, `no_reply` e `default` de mensagens interativas).
   - Preenchimento automático de defaults seguros (`defaultNodeConfig`) para nós onde a IA omitiu campos obrigatórios de configuração.
   - Integração com o validador nativo `validateGraph`, gerando a lista de avisos (`issues`) que são apresentados visualmente para o usuário.

4. **Server Action e Endpoint de Geração com IA (`apps/web`):**
   - `generateAutomationWithAi` valida autorização do usuário (apenas `owner` ou `admin` da organização ativa).
   - Endpoint dedicado `POST /api/automacoes/gerar` com fallback estruturado via `json_object` e temperatura controlada (0.2) para respostas consistentes e determinísticas.

5. **Diálogo de Geração e Mini-Canvas de Prévia (`AutomationAiDialog` e `AutomationAiPreviewCanvas`):**
   - Interface com sugestões rápidas de prompts para casos comuns (Qualificação VIP, Follow-up de Vendas, Captura de Comentário, Fora do Horário).
   - Suporte a atalho de teclado `Ctrl+Enter` / `Cmd+Enter` para geração rápida.
   - Mini-canvas interativo usando React Flow em modo leitura com ajuste automático de zoom (`fitView`) e destaque visual de nós com pendências.
   - Chat de refinamento incremental: permite ao operador pedir modificações pontuais (ex.: "troque a espera para 30 minutos") sem recriar o fluxo do zero.
   - Proteção de foco e ciclo de vida do Base UI: impede o fechamento acidental do diálogo durante o processo de geração ou salvamento, e previne conflitos de foco na transição a partir do diálogo de modelos ("fechou sozinho").

6. **Pontos de Entrada na Listagem e no Editor:**
   - Botão "Criar com IA" na barra de ações superior e card interativo na grade de modelos da listagem de automações.
   - Botão "Ajustar com IA" no cabeçalho do editor de automações (`EditorBody`), abrindo o modal em modo de refinamento (`refine`) que aplica as alterações diretamente ao canvas local e marca o rascunho como pendente de salvamento.

---

## Validação ao vivo pendente

- **Validação com Provedores e Chaves Reais:**
  - Teste de chamadas reais com API Key da OpenAI (`gpt-4o-mini` e `gpt-4o`) para avaliar tempo de resposta em fluxos grandes (acima de 10 nós).
  - Teste de compatibilidade futura com provedores alternativos (Anthropic Claude 3.5 Sonnet / Google Gemini) através de adaptadores do FlowAI.
- **Avaliação de Prompts Complexos e Nichados:**
  - Validação com fluxos de ramificações múltiplas em cenários de atendimento real (imobiliárias com agendamento de visita, clínicas médicas com triagem de convênios e e-commerces com rastreamento de pedidos).

---

## Tabela de Evidências dos Testes

| Suíte / Comando | Escopo | Resultado |
| :--- | :--- | :--- |
| `npm test -w @flowai/core` | 32 arquivos de teste (schema, layout, validação, sanitizador de IA) | **394 testes aprovados** (0 falhas) |
| `npm test -w apps/web` | 31 arquivos de teste (actions, queries, dialogs, sanitização de IA) | **159 testes aprovados** (0 falhas) |
| `npm run typecheck -w apps/web` | Checagem estrita de tipos do TypeScript com Next.js Route Types | **Aprovado com 0 erros** |
| `npm run lint -w apps/web` | Verificação de regras de código com ESLint 9 | **Aprovado com 0 avisos/erros** |
| `e2e/automation-ai.spec.ts` | Testes E2E de abertura, seleção de sugestões, transição segura de modais e botão de refinamento no editor | **Aprovado** |
