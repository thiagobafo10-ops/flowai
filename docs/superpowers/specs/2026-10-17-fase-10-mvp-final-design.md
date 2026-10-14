# Fase 10 — Verificação Final do MVP, Testes Consolidados e Hardening de Segurança

- **Data:** 2026-10-17
- **Status:** aguardando aprovação
- **Branch:** `feat/fase-10-mvp-final`
- **Spec de referência:** [MVP Design](2026-10-07-flowai-mvp-design.md) (Seções 1, 10, 11 e 13)

---

## 1. Visão Geral e Objetivos

A **Fase 10** é a fase de consolidação e encerramento do MVP do FlowAI. Seu propósito é garantir que a plataforma esteja pronta, segura, testada e homologada para operação com as primeiras organizações-piloto.

Ela se concentra em três frentes essenciais:

1. **Jornada de Ponta a Ponta dos 19 Critérios de Aceitação:**
   - Implementação de um teste E2E unificado (`mvp-journey.spec.ts`) que percorre rigorosamente a jornada completa: do cadastro de uma nova organização, criação de agente, RAG, simulador de canal, atendimento por IA, geração de lead no pipeline, handoff, encerramento de conversa até o registro métrico no Dashboard e Analytics.
2. **Revisão e Hardening de Segurança:**
   - Auditoria final das políticas de RLS de todas as tabelas em `public`.
   - Garantia de isolamento multi-tenant estrito: nenhuma consulta pode vazar dados de outra organização.
   - Verificação de headers HTTP seguros (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Frame-Options).
   - Validação de defesas de Rate Limit e sanitização contra Prompt Injection.
3. **Refinamento e Polimento Geral de UI/UX:**
   - Verificação de que todos os 9 módulos da sidebar possuem telas funcionais e de alto padrão estético (sem placeholders residuais).
   - Tratamento uniforme de estados de erro ("Tentar novamente"), estados vazios explicativos e loaders suaves.

---

## 2. A Jornada dos 19 Critérios de Aceitação

```
1. CADASTRO → 2. ORGANIZAÇÃO → 3. DASHBOARD → 4. AGENTE IA → 5. CONHECIMENTO (RAG) →
6. CANAL CONECTADO → 7. MENSAGEM RECEBIDA → 8. INBOX REALTIME → 9. CONTATO CRIADO →
10. CLASSIFICAÇÃO IA → 11. CONSULTA RAG → 12. RESPOSTA IA → 13. LEAD SCORE →
14. CRM & PIPELINE → 15. AUTOMAÇÃO EXECUTADA → 16. HANDOFF IA → 17. HUMANO ASSUME →
18. CONVERSA ENCERRADA → 19. DASHBOARD & ANALYTICS CONSOLIDADOS
```

Cada um dos 19 passos é validado de forma sequencial com persistência real no PostgreSQL e verificação dos seletores de interface no Playwright.

---

## 3. Matriz de Segurança e Conformidade

| Requisito | Solução Implementada | Verificação |
| :--- | :--- | :--- |
| **Multi-Tenancy** | `organization_id` obrigatório + FKs compostas + RLS com `is_member(org_id)` | Testes pgTAP e E2E |
| **Credenciais Sensíveis** | Tokens Meta e chaves guardados no Supabase Vault | Somente Edge Functions com service_role acessam |
| **Segurança no Webhook** | Validação de assinatura HMAC-SHA256 em tempo constante | Teste unitário de payload alterado |
| **Proteção contra Injeção** | Normalização de delimitadores XML e sanitização de caracteres de controle | Suíte de guardrails do `@flowai/core` |
| **Rate Limiting** | Janela deslizante por IP e por organização ativa | Tabela `public.rate_limits` |
| **Headers HTTP** | Security headers configurados no Next.js (`next.config.ts`) | Checagem de headers de resposta |
