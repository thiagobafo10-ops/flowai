# Fase 8 — Criador de Automações com IA (Plano de Implementação)

- **Data:** 2026-10-15
- **Branch:** `feat/fase-8-criador-ia`
- **Spec de referência:** [`docs/superpowers/specs/2026-10-15-fase-8-criador-ia-design.md`](../specs/2026-10-15-fase-8-criador-ia-design.md)
- **Metodologia:** TDD estrito com commits atômicos por tarefa.

---

### Task 1: Core — Schema, prompt do gerador e auto-layout de nós

**Files:**
- Create `packages/core/src/automation/ai-generator.ts`
- Create `packages/core/src/automation/ai-generator.test.ts`
- Create `packages/core/src/automation/layout.ts`
- Create `packages/core/src/automation/layout.test.ts`
- Modify `packages/core/src/automation/index.ts`
- Modify `packages/core/src/index.ts`

**Interfaces:**
- `automationAiOutputSchema`: Zod schema com `name`, `triggerType`, `triggerConfig`, `explanation`, `nodes` e `edges`.
- `buildAutomationPrompt(userPrompt: string, refs: GeneratorRefs, currentGraph?: AutomationGraph)`: monta o prompt do sistema injetando nomes e IDs de etiquetas, etapas, canais, links de entrada e sequências da organização.
- `applyAutoLayout(graph: AutomationGraph)`: calcula as coordenadas `x, y` dos nós através de busca em largura a partir do gatilho para posicionamento limpo sem sobreposição.

**Passos:**
1. Escrever testes em `ai-generator.test.ts` e `layout.test.ts` esperando falha.
2. Implementar schemas, construtor de prompt e algoritmo de layout top-down.
3. Validar com `npm test -w @flowai/core`.
4. Commit: `feat(automation): AI generator schema, prompt builder and auto-layout`.

---

### Task 2: Core — Validação e sanitização do grafo gerado

**Files:**
- Modify `packages/core/src/automation/ai-generator.ts`
- Modify `packages/core/src/automation/ai-generator.test.ts`

**Interfaces:**
- `sanitizeAndValidateGeneratedGraph(raw: unknown, refs: GraphRefs)`:
  - Corrige arestas desconexas ou apontando para nós inexistentes;
  - Valida compatibilidade de handles (ex: condição `true`/`false`, mensagens `opt:*`/`no_reply`/`default`);
  - Garante que nós sem configuração obrigatória recebam defaults válidos de `defaultNodeConfig`;
  - Roda `validateGraph` e retorna o grafo limpo acompanhado dos avisos (`issues`).

**Passos:**
1. Escrever testes em `ai-generator.test.ts` para grafos com arestas órfãs ou handles inválidos.
2. Implementar a sanitização e validação.
3. Validar com `npm test -w @flowai/core`.
4. Commit: `feat(automation): generated graph sanitizer and validator`.

---

### Task 3: Web — Server Action e chamada à OpenAI

**Files:**
- Create `apps/web/src/lib/automation/ai-actions.ts`
- Create `apps/web/src/lib/automation/ai-actions.test.ts`
- Create `apps/web/src/app/api/automacoes/gerar/route.ts`

**Interfaces:**
- `generateAutomationWithAi({ prompt, currentGraph? })`:
  - Valida autenticação e papel (`owner` ou `admin`);
  - Carrega `loadGraphRefs` da organização ativa;
  - Invoca o `AIProvider` configurado na organização (ou OpenAI padrão);
  - Sanitiza, calcula auto-layout e devolve `{ name, triggerType, triggerConfig, graph, explanation, issues }`.

**Passos:**
1. Escrever testes unitários em `ai-actions.test.ts` com mock do `AIProvider`.
2. Implementar server action e endpoint de API.
3. Validar com `npm test -w apps/web`.
4. Commit: `feat(automation): AI generation server action and API endpoint`.

---

### Task 4: Web — Componente de Diálogo e Mini-Canvas de Prévia

**Files:**
- Create `apps/web/src/components/automation/ai-dialog.tsx`
- Create `apps/web/src/components/automation/ai-preview-canvas.tsx`

**Interfaces:**
- `AutomationAiDialog`:
  - Entrada do usuário com campo de texto e tags com exemplos de prompts prontos;
  - Renderização do mini-canvas com React Flow (zoom automático, sem edição de nós na prévia);
  - Exibição da explicação gerada pela IA e avisos do validador;
  - Campo de chat de refinamento para ajustes incrementais;
  - Botão "Abrir no editor" / "Aplicar ao fluxo".

**Passos:**
1. Implementar o componente `AutomationAiDialog` e o visualizador `AutomationAiPreviewCanvas`.
2. Validar tipos e ESLint com `npm run typecheck -w apps/web` e `npm run lint -w apps/web`.
3. Commit: `feat(automation): AI generation dialog and preview canvas`.

---

### Task 5: Web — Integração na Listagem e no Editor

**Files:**
- Modify `apps/web/src/app/(app)/automacoes/page.tsx`
- Modify `apps/web/src/components/automation/editor.tsx`
- Modify `apps/web/src/components/automation/editor-header.tsx`

**Interfaces:**
- Botão "Criar com IA" na página de listagem que abre o diálogo e, após aprovação, cria o rascunho via `saveAutomation` e redireciona;
- Botão "Ajustar com IA" no cabeçalho do editor para pedir sugestões ou expansões do fluxo atual.

**Passos:**
1. Integrar o botão e modal na listagem e no editor.
2. Validar compilação do Next.js com `npm run build -w apps/web`.
3. Commit: `feat(automation): integrate AI generator into automations list and editor`.

---

### Task 6: E2E, Documentação e Verificação Final

**Files:**
- Create `apps/web/e2e/automation-ai.spec.ts`
- Create `docs/superpowers/fase-8-pendencias.md`
- Modify `apps/web/playwright.config.ts`
- Modify `README.md`

**Passos:**
1. Implementar teste E2E gerando fluxo por prompt via fake OpenAI e abrindo no editor.
2. Escrever documento de pendências e decisões da Fase 8.
3. Rodar suíte completa: `test:scripts`, `test`, `typecheck`, `lint` e `build`.
4. Commit: `test(automation): end-to-end AI generator flows, docs and verification`.
