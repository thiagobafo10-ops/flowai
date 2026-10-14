# Fase 10 — Verificação Final do MVP e Conclusão (Plano de Implementação)

- **Data:** 2026-10-17
- **Branch:** `feat/fase-10-mvp-final`
- **Spec de referência:** [`docs/superpowers/specs/2026-10-17-fase-10-mvp-final-design.md`](../specs/2026-10-17-fase-10-mvp-final-design.md)
- **Metodologia:** TDD estrito com commits atômicos por tarefa.

---

### Task 1: Hardening e Headers de Segurança no Next.js

**Files:**
- Modify `apps/web/next.config.ts`
- Create `apps/web/src/lib/security/headers.test.ts`

**Interfaces:**
- Configuração de security headers HTTP globais no Next.js:
  - `Content-Security-Policy`: restrição de scripts e estilos;
  - `X-Frame-Options: DENY`: proteção contra clickjacking;
  - `X-Content-Type-Options: nosniff`: proteção contra MIME sniffing;
  - `Referrer-Policy: strict-origin-when-cross-origin`;
  - `Permissions-Policy`: desativação de recursos de hardware não utilizados (câmera, microfone, geolocalização).

**Passos:**
1. Escrever teste em `headers.test.ts` validando a existência e valores dos cabeçalhos.
2. Implementar a configuração em `next.config.ts`.
3. Validar com `npm test -w apps/web`.
4. Commit: `feat(security): production security headers, CSP and transport hardening`.

---

### Task 2: Teste E2E Consolidado dos 19 Critérios de Aceitação

**Files:**
- Create `apps/web/e2e/mvp-journey.spec.ts`

**Interfaces:**
- Teste Playwright `mvp-journey.spec.ts` validando o ciclo completo do cliente piloto:
  1. Cadastro do usuário (`/signup`);
  2. Criação da organização (`/onboarding`);
  3. Acesso ao `/dashboard`;
  4. Configuração do agente de IA (`/ia`);
  5. Criação de documento na base de conhecimento (`/conhecimento`);
  6. Conexão do canal Simulador (`/configuracoes/canais`);
  7. Simulação de mensagem inbound;
  8. Exibição da mensagem no `/inbox`;
  9. Contato criado automaticamente;
  10. Conversa com intenção e sentimento classificados;
  11. Consulta ao conhecimento do agente (RAG);
  12. Resposta gerada pela IA;
  13. Atualização de lead score do contato;
  14. Visualização do contato no `/contatos` e deal no `/pipeline`;
  15. Execução de regra de automação;
  16. Transferência da conversa para humano (`handoff`);
  17. Atendente humano envia resposta no Inbox;
  18. Atendente encerra a conversa;
  19. Métricas registradas no `/dashboard` e `/analytics`.

**Passos:**
1. Implementar o teste sequencial `mvp-journey.spec.ts`.
2. Validar tipos e sintaxe com `npm run typecheck -w apps/web`.
3. Commit: `test(e2e): consolidated 19-criteria MVP acceptance journey test`.

---

### Task 3: Checklist de Segurança, Documentação e Conclusão do MVP

**Files:**
- Create `docs/superpowers/security-checklist.md`
- Create `docs/superpowers/fase-10-mvp-conclusao.md`
- Modify `README.md`

**Passos:**
1. Escrever o checklist detalhado de auditoria de segurança (`security-checklist.md`).
2. Escrever o relatório final de conclusão do MVP (`fase-10-mvp-conclusao.md`).
3. Atualizar o `README.md` marcando todas as 10 fases como concluídas.
4. Executar toda a suíte de verificação: `test:scripts`, `test`, `typecheck`, `lint` e `build`.
5. Commit: `docs(mvp): final security checklist, MVP completion report and verification`.
