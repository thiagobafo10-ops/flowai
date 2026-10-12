# FlowAI

FlowAI é uma plataforma SaaS multi-tenant de atendimento, CRM conversacional e automação com IA. Empresas conectam WhatsApp Business e Instagram, centralizam as conversas num Inbox, usam IA (com base de conhecimento/RAG) para atender, criam automações visuais, acompanham leads num pipeline e medem resultados num dashboard. Este repositório é um monorepo npm com o app web (`apps/web`, Next.js), o pacote de domínio compartilhado (`packages/core`) e o banco Supabase (`supabase/`: migrations, testes pgTAP e seed de testes).

## Pré-requisitos

- **Node.js 24** (npm workspaces; não usamos pnpm/yarn).
- **Docker Desktop** rodando — no Windows, com o backend **WSL2**. O Supabase local (Postgres, Auth, API) roda em containers.
- **Deno 2** para os testes das Edge Functions; `DENO_BIN` pode apontar para o executável.

## Configuração

```bash
npm install
npm run db:start          # sobe o Supabase local (primeira vez baixa as imagens)
npx supabase status       # mostra API URL e a chave anon/publishable
```

Crie `apps/web/.env.local` (a partir de `apps/web/.env.example`) com os valores de `npx supabase status`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<chave anon / publishable>
```

Somente essas duas variáveis vão para o frontend. **Nunca** coloque a service role key em `apps/web`.

### Confirmação de e-mail

Localmente a confirmação de e-mail está **desligada** (`[auth.email] enable_confirmations = false` em `supabase/config.toml`): o cadastro já cria a sessão e leva ao onboarding. Em produção, se a confirmação for ligada no projeto Supabase (Auth → Providers → Email → *Confirm email*), o cadastro não devolve sessão; o formulário mostra "Enviamos um e-mail de confirmação…" e o usuário entra depois de confirmar.

## Comandos

| Comando | O que faz |
|---|---|
| `npm test` | Testes unitários (Vitest) do domínio e das ações/consultas do app web |
| `npm run test:edge` | Testes das Edge Functions com contratos/transportes injetados |
| `npm run test:instagram:e2e` | Suíte completa de navegador com Graph injetada somente no proxy local de testes |
| `npm run typecheck` | Checagem de tipos em todos os workspaces |
| `npm run db:reset` | Recria o banco local aplicando migrations + `supabase/seed.sql` |
| `npm run db:test` | Testes pgTAP (`supabase/tests/database`) — rode após `db:reset` |
| `npm run db:types` | Regenera `packages/core/src/db/database.types.ts` a partir do banco local |
| `npm run dev -w apps/web` | App web em http://localhost:3000 |
| `npm run e2e -w apps/web` | Testes Playwright — exigem o Supabase local rodando (o setup limpa `rate_limits` via `docker exec`). Faz `next build` e serve o build de produção em http://localhost:3100 (veja abaixo) |

### Testes e2e

- O Playwright sobe o app com `npm run build && npx next start -p 3100` (em `apps/web`): os testes rodam contra o **build de produção**, sem compilação sob demanda do dev server. Como o e2e já faz o build, não é preciso (nem útil) rodar `npm run build` antes ou depois dele, e o `npm run dev` na porta 3000 pode continuar aberto.
- Fora do CI, um servidor já rodando na porta 3100 é reaproveitado (`reuseExistingServer`); se ele for de um build antigo, pare-o antes de rodar o e2e.
- Após `npm run db:reset`, espere os containers do Supabase ficarem saudáveis antes do e2e.
- Convenções dos testes: navegue com `gotoReady`/`reloadReady` (`e2e/support/nav.ts`), que esperam o marcador de hidratação `html[data-hydrated="1"]`; antes de recarregar ou navegar após uma ação otimista, espere o contêiner ficar com `aria-busy="false"` (`settled`). Cadastro e organização vêm de `e2e/support/auth.ts`.

## Arquitetura

- Spec do MVP (todas as fases): [`docs/superpowers/specs/2026-10-07-flowai-mvp-design.md`](docs/superpowers/specs/2026-10-07-flowai-mvp-design.md)
- Plano da Fase 1 (fundação): [`docs/superpowers/plans/2026-10-07-fase-1-fundacao.md`](docs/superpowers/plans/2026-10-07-fase-1-fundacao.md)
- Fase 2 (layout e dashboard): spec [`docs/superpowers/specs/2026-10-09-fase-2-layout-dashboard-design.md`](docs/superpowers/specs/2026-10-09-fase-2-layout-dashboard-design.md), plano [`docs/superpowers/plans/2026-10-09-fase-2-layout-dashboard.md`](docs/superpowers/plans/2026-10-09-fase-2-layout-dashboard.md)
- Fase 3 (CRM: contatos, tags, pipeline): spec [`docs/superpowers/specs/2026-10-09-fase-3-crm-design.md`](docs/superpowers/specs/2026-10-09-fase-3-crm-design.md), plano [`docs/superpowers/plans/2026-10-10-fase-3-crm.md`](docs/superpowers/plans/2026-10-10-fase-3-crm.md)
- Fase 4 (Inbox, conversas e Simulador): spec [`docs/superpowers/specs/2026-10-10-fase-4-inbox-design.md`](docs/superpowers/specs/2026-10-10-fase-4-inbox-design.md), plano [`docs/superpowers/plans/2026-10-10-fase-4-inbox.md`](docs/superpowers/plans/2026-10-10-fase-4-inbox.md)
- Fase 5 (Instagram primeiro): [design](docs/superpowers/specs/2026-10-12-fase-5-meta-design.md), [plano](docs/superpowers/plans/2026-10-12-fase-5-instagram.md), [configuração e testes](docs/superpowers/instagram-setup.md). WhatsApp adiado; validação ao vivo com Meta ainda pendente.
- Banco: `supabase/migrations` (nunca edite uma migration já aplicada; crie uma nova), testes em `supabase/tests/database`.

## Notas de segurança

- **RLS em todas as tabelas** de `public`; nenhuma policy para `anon`. Organização ativa vem sempre de uma membership validada pela RLS — o cookie `flowai_org` é só preferência.
- **`channels`: nunca `select *`.** A tabela usa privilégios por coluna (ids de segredos não são legíveis por `authenticated`); liste as colunas explicitamente.
- **Service role nunca em `apps/web`.** O frontend usa apenas URL + chave anon.
- **`events` e `audit_logs` são escritos apenas por código definer do banco** (triggers/funções `SECURITY DEFINER`). A API não insere eventos nem chama `write_audit_log`; login é auditado via `log_auth_event` (allowlist). Alterações em `memberships`, `organizations`, `channels`, `ai_agents` e `automations` são auditadas por trigger (em updates, só os nomes das colunas alteradas).
- **Rate limits do app são defesa em profundidade.** Os controles reais contra abuso de cadastro/login são os limites do Supabase Auth e captcha, configurados no projeto em produção.
- **`x-forwarded-for` precisa vir da plataforma de hospedagem** (proxy confiável que sobrescreve o cabeçalho); caso contrário o IP usado em rate limit e auditoria pode ser forjado pelo cliente.

## Convenções do app

- **`getActiveOrg()` por página e por ação.** Toda página e Server Action/Route Handler de `(app)` chama `getActiveOrg()` por conta própria; o layout (sidebar/cabeçalho) não é barreira de segurança, apenas apresentação.
- **Navegação central.** Módulos, rotas, ícones e descrições vivem em `apps/web/src/lib/navigation.ts` e são usados pela sidebar, pelo título do cabeçalho e pelas páginas "em construção".
- **Leituras dinâmicas dentro de `<Suspense>`** (`cacheComponents`): cookies, headers e `getActiveOrg` nunca ficam no corpo síncrono de um layout/página.
- **Preferências de UI em cookie:** `flowai_sidebar` (`expanded|collapsed`) é lido no servidor para evitar "pulo" visual; o tema usa `next-themes`.
