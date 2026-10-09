# FlowAI

FlowAI é uma plataforma SaaS multi-tenant de atendimento, CRM conversacional e automação com IA. Empresas conectam WhatsApp Business e Instagram, centralizam as conversas num Inbox, usam IA (com base de conhecimento/RAG) para atender, criam automações visuais, acompanham leads num pipeline e medem resultados num dashboard. Este repositório é um monorepo npm com o app web (`apps/web`, Next.js), o pacote de domínio compartilhado (`packages/core`) e o banco Supabase (`supabase/`: migrations, testes pgTAP e seed de testes).

## Pré-requisitos

- **Node.js 24** (npm workspaces; não usamos pnpm/yarn).
- **Docker Desktop** rodando — no Windows, com o backend **WSL2**. O Supabase local (Postgres, Auth, API) roda em containers.

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
| `npm test` | Testes unitários (Vitest) de `packages/core` |
| `npm run typecheck` | Checagem de tipos em todos os workspaces |
| `npm run db:reset` | Recria o banco local aplicando migrations + `supabase/seed.sql` |
| `npm run db:test` | Testes pgTAP (`supabase/tests/database`) — rode após `db:reset` |
| `npm run db:types` | Regenera `packages/core/src/db/database.types.ts` a partir do banco local |
| `npm run dev -w apps/web` | App web em http://localhost:3000 |
| `npm run e2e -w apps/web` | Testes Playwright — exigem o Supabase local rodando (o setup limpa `rate_limits` via `docker exec`) |

## Arquitetura

- Spec do MVP (todas as fases): [`docs/superpowers/specs/2026-10-07-flowai-mvp-design.md`](docs/superpowers/specs/2026-10-07-flowai-mvp-design.md)
- Plano da Fase 1 (fundação): [`docs/superpowers/plans/2026-10-07-fase-1-fundacao.md`](docs/superpowers/plans/2026-10-07-fase-1-fundacao.md)
- Banco: `supabase/migrations` (nunca edite uma migration já aplicada; crie uma nova), testes em `supabase/tests/database`.

## Notas de segurança

- **RLS em todas as tabelas** de `public`; nenhuma policy para `anon`. Organização ativa vem sempre de uma membership validada pela RLS — o cookie `flowai_org` é só preferência.
- **`channels`: nunca `select *`.** A tabela usa privilégios por coluna (ids de segredos não são legíveis por `authenticated`); liste as colunas explicitamente.
- **Service role nunca em `apps/web`.** O frontend usa apenas URL + chave anon.
- **`events` e `audit_logs` são escritos apenas por código definer do banco** (triggers/funções `SECURITY DEFINER`). A API não insere eventos nem chama `write_audit_log`; login é auditado via `log_auth_event` (allowlist). Alterações em `memberships`, `organizations`, `channels`, `ai_agents` e `automations` são auditadas por trigger (em updates, só os nomes das colunas alteradas).
- **Rate limits do app são defesa em profundidade.** Os controles reais contra abuso de cadastro/login são os limites do Supabase Auth e captcha, configurados no projeto em produção.
- **`x-forwarded-for` precisa vir da plataforma de hospedagem** (proxy confiável que sobrescreve o cabeçalho); caso contrário o IP usado em rate limit e auditoria pode ser forjado pelo cliente.
