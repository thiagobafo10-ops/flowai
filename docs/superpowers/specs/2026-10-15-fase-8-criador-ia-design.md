# Fase 8 — Criador de Automações com IA (Design Spec)

- **Data:** 2026-10-15
- **Status:** Em elaboração
- **Escopo:** Geração de fluxos de automação a partir de prompts em linguagem natural, validação com o validador da 7A, auto-layout de nós e prévia interativa com aprovação antes de persistência.

---

## 1. Visão Geral e Objetivos

O FlowAI conta com um editor visual completo de automações (Fase 7A e 7B) que suporta mensagens, condições, esperas, tags, etapas de CRM, sequências e transferências. No entanto, para novos usuários ou operadores sem experiência técnica, desenhar um fluxo complexo do zero pode ser demorado.

A **Fase 8** adiciona o **Criador de Automações com IA**:
1. O usuário descreve o que deseja em português (ex: *"Quando o cliente mandar 'orçamento', envie o link da nossa tabela, aguarde 2 horas e se ele não responder transfira para um atendente"*).
2. A IA gera um rascunho completo: nome, tipo de gatilho, configuração do gatilho e o grafo de nós e arestas.
3. O sistema calcula o layout espacial (posicionamento `x, y`) automaticamente e valida com o `validateGraph` do `@flowai/core`.
4. Uma **prévia visual interativa** é exibida ao usuário, acompanhada de um resumo explicativo do fluxo gerado.
5. O usuário pode refinar com instruções adicionais ou clicar em **"Usar este fluxo"**, abrindo o editor para ajustes finais ou ativação imediata.

---

## 2. Arquitetura e Contrato de Domínio

### 2.1 Schema de Saída Estruturada (`@flowai/core`)

A IA deve responder estritamente dentro de uma estrutura tipada:

```ts
export const automationGenerationSchema = z.object({
  name: z.string().min(1).max(100),
  triggerType: triggerTypeSchema,
  triggerConfig: z.record(z.unknown()),
  explanation: z.string().max(500),
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      type: nodeTypeSchema,
      config: z.record(z.unknown()),
    }),
  ),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      sourceHandle: z.string().nullable().default(null),
    }),
  ),
});
```

### 2.2 Injeção de Contexto Real da Organização

Para que a IA não invente IDs inexistentes, o prompt de sistema recebe o catálogo de opções reais disponíveis na organização:
- Etiquetas existentes (`tags: { id, name }[]`)
- Etapas do pipeline padrão (`stages: { id, name }[]`)
- Canais ativos (`channels: { id, name, type }[]`)
- Links de entrada ativos (`entryLinks: { id, name }[]`)
- Sequências de follow-up (`sequences: { id, name }[]`)

Caso o usuário peça uma ação que referencia um item inexistente (ex: *"coloque na etapa Negociação"* quando só existem *"Novo"* e *"Fechado"*), a IA é instruída a escolher a etapa mais próxima ou deixar em branco para preenchimento.

### 2.3 Auto-layout Determinístico dos Nós

A IA apenas define a topologia (`nodes` e `edges`). As coordenadas visuais `position: { x, y }` são calculadas no código do FlowAI por um algoritmo de layout baseado em níveis topológicos (BFS a partir do gatilho):
- Cada nível vertical avança em `y += 140px`.
- Ramificações horizontais de condições e opções de botões são centralizadas e espaçadas em `x += 240px`.
- Isso garante que a prévia nunca gere blocos sobrepostos.

---

## 3. Interface com o Usuário

1. **Botão de Acesso:**
   - Botão **"Criar com IA"** com ícone `SparklesIcon` na página `/automacoes` (ao lado de "Nova automação").
   - Botão **"Pedir ajuda à IA"** dentro da barra superior do editor `/automacoes/[id]`.

2. **Diálogo de Geração e Prévia (`AutomationAiDialog`):**
   - **Estado Inicial (Prompt):**
     - Campo de texto expandido para digitação.
     - Exemplos rápidos em pílulas clicáveis (ex: *"Qualificação de Leads"*, *"Pós-venda com Espera"*, *"Captura de Comentário"*).
   - **Estado de Prévia (Resultado):**
     - Explicação da IA em destaque (ex: *"Criei um fluxo que aguarda 1 hora e verifica se o lead tem a tag Interessado..."*).
     - Visualizador do canvas com nós e arestas renderizados via React Flow em modo leitura / zoom fit.
     - Indicador de conformidade: lista de avisos do validador (se houver campos a preencher).
     - Campo de refinamento: *"Não gostou? Diga o que alterar..."*.
     - Ações: *"Cancelar"*, *"Tentar novamente"* e *"Abrir no editor"*.

---

## 4. Testes e Validação

1. **Testes Unitários (`@flowai/core` e `apps/web`):**
   - Montagem do prompt do gerador com injeção de referências.
   - Algoritmo de auto-layout calculando coordenadas válidas sem sobreposição.
   - Validação de saída: grafos gerados com tipos de nós desconhecidos ou ciclos ilegais são interceptados e corrigidos.
2. **Testes de Integração / E2E:**
   - Criação de fluxo por prompt simulado através do `FakeAIProvider`.
   - Verificação de persistência e abertura imediata no editor com os nós conectados.
