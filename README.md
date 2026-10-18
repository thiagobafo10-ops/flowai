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
| `npm run test:scripts` | Testes leves (node:test) dos runners E2E: cancelamento coordenado e recuperação de estado após interrupção; sem navegador nem banco |
| `npm run test:instagram:e2e` | Suíte completa de navegador com Graph injetada somente no proxy local de testes |
| `npm run test:ai:e2e` | Suíte de navegador da IA com OpenAI falsa; usa o harness coordenado que salva/restaura configurações e crons dos três workers, inclusive após interrupção |
| `npm run test:mvp:e2e` | Jornada smoke, contratos IA e Analytics/CSV no mesmo build, proxy local de IA e restauração coordenada; automação executável tem suíte própria |
| `npm run test:automation:e2e` | Seis fluxos de automação no navegador (3103), Supabase local e Graph/OpenAI falsos (54328); restaura os três crons/configurações de workers; após um kill forçado, a próxima execução recupera o estado salvo |
| `npm run test:growth:e2e` | Fluxos de crescimento (Fase 7B): links de entrada, sequências, campanhas e referral do Instagram no navegador (3103) e proxy local (54328) |
| `npm run typecheck` | Checagem de tipos em todos os workspaces |
| `npm run lint -w apps/web` | ESLint do app web |
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
- Em host local com pouca memória, `FLOWAI_E2E_SLOW_HOST=1` aumenta o prazo global para 60 s e o de expectativas para 15 s, mantendo as verificações. Os prazos normais (30 s / 5 s) e de CI continuam iguais. Isso não corrige timeouts SQL causados por falta de recursos; libere memória antes de repetir a suíte. Rode as suítes sequencialmente.
- A jornada MVP fica fora da configuração geral: rode `npm run test:mvp:e2e` para isolar os workers e usar a OpenAI falsa. [Mapa de contratos e estado de verificação](docs/superpowers/fase-10-mvp-conclusao.md). Teste listado/escrito não equivale a execução aprovada, nem a homologação dos fornecedores ou da produção.

## Integração contínua

`.github/workflows/ci.yml` roda em push na `main`, em pull requests e sob demanda. Três jobs independentes:

| Job | O que verifica |
|---|---|
| **Tipos, testes e lint** | `npm run typecheck`, `npm test` (Vitest web + core), `npm run test:scripts`, `npm run lint -w apps/web` e `npm run build` (com variáveis de ambiente fictícias) |
| **Edge Functions (Deno)** | `npm run test:edge` com Deno 2 |
| **Banco (pgTAP)** | sobe o Supabase local (`supabase start`), aplica migrations + seed (`supabase db reset`) e roda `npm run db:test` |

O e2e de navegador (Playwright) fica fora do CI por enquanto, por exigir build, Supabase com seed, navegadores e variáveis de integração; rode-o localmente.

## Arquitetura

- Referências selecionadas para as telas de crescimento e compatibilidade Instagram: [mapa de aproveitamento do ChatbotX](docs/superpowers/referencias-chatbotx.md).

- Spec do MVP (todas as fases): [`docs/superpowers/specs/2026-10-07-flowai-mvp-design.md`](docs/superpowers/specs/2026-10-07-flowai-mvp-design.md)
- Plano da Fase 1 (fundação): [`docs/superpowers/plans/2026-10-07-fase-1-fundacao.md`](docs/superpowers/plans/2026-10-07-fase-1-fundacao.md)
- Fase 2 (layout e dashboard): spec [`docs/superpowers/specs/2026-10-09-fase-2-layout-dashboard-design.md`](docs/superpowers/specs/2026-10-09-fase-2-layout-dashboard-design.md), plano [`docs/superpowers/plans/2026-10-09-fase-2-layout-dashboard.md`](docs/superpowers/plans/2026-10-09-fase-2-layout-dashboard.md)
- Fase 3 (CRM: contatos, tags, pipeline): spec [`docs/superpowers/specs/2026-10-09-fase-3-crm-design.md`](docs/superpowers/specs/2026-10-09-fase-3-crm-design.md), plano [`docs/superpowers/plans/2026-10-10-fase-3-crm.md`](docs/superpowers/plans/2026-10-10-fase-3-crm.md)
- Fase 4 (Inbox, conversas e Simulador): spec [`docs/superpowers/specs/2026-10-10-fase-4-inbox-design.md`](docs/superpowers/specs/2026-10-10-fase-4-inbox-design.md), plano [`docs/superpowers/plans/2026-10-10-fase-4-inbox.md`](docs/superpowers/plans/2026-10-10-fase-4-inbox.md)
- Fase 5 (Instagram primeiro): [design](docs/superpowers/specs/2026-10-12-fase-5-meta-design.md), [plano](docs/superpowers/plans/2026-10-12-fase-5-instagram.md), [configuração e testes](docs/superpowers/instagram-setup.md). WhatsApp adiado; validação ao vivo com Meta ainda pendente.
- Fase 6 (IA com base de conhecimento): [design](docs/superpowers/specs/2026-10-12-fase-6-ia-design.md), [plano](docs/superpowers/plans/2026-10-12-fase-6-ia.md), [configuração](docs/superpowers/ai-setup.md), [pendências e evidências](docs/superpowers/fase-6-pendencias.md). Validação ao vivo com OpenAI ainda pendente.
- Fase 7A (automações visuais): [design](docs/superpowers/specs/2026-10-13-fase-7a-automacoes-design.md), [plano](docs/superpowers/plans/2026-10-13-fase-7a-automacoes.md), [configuração em produção](docs/superpowers/automation-setup.md), [decisões, pendências e evidências](docs/superpowers/fase-7a-pendencias.md). Inclui modelos, botões, esperas, histórico e migração das regras de comentário. Validação ao vivo com Meta/OpenAI ainda pendente.
- Fase 7B (crescimento e campanhas): [design](docs/superpowers/specs/2026-10-14-fase-7b-crescimento-design.md), [plano](docs/superpowers/plans/2026-10-14-fase-7b-crescimento.md), [decisões, pendências e evidências](docs/superpowers/fase-7b-pendencias.md). Inclui links de entrada, sequências de nutrição e campanhas de transmissão.
- Fase 8 (criador de automações com IA): [design](docs/superpowers/specs/2026-10-15-fase-8-criador-ia-design.md), [plano](docs/superpowers/plans/2026-10-15-fase-8-criador-ia.md), [decisões, pendências e evidências](docs/superpowers/fase-8-pendencias.md). Criação e refinamento iterativo de fluxos via linguagem natural com pré-visualização em mini-canvas e auto-layout determinístico de nós.
- Fase 9 (Analytics): [design](docs/superpowers/specs/2026-10-16-fase-9-analytics-design.md), [plano](docs/superpowers/plans/2026-10-16-fase-9-analytics.md), [decisões, pendências e evidências](docs/superpowers/fase-9-pendencias.md). Painel analítico aprofundado com filtros de período (1d a 90d), comparativos de tendência, abas especializadas (Atendimento, IA e CRM/Funil) e exportação em CSV.
- Fase 10 (Verificação do MVP e controles de segurança): [design](docs/superpowers/specs/2026-10-17-fase-10-mvp-final-design.md), [plano](docs/superpowers/plans/2026-10-17-fase-10-mvp-final.md), [checklist de segurança](docs/superpowers/security-checklist.md), [estado de verificação e contratos](docs/superpowers/fase-10-mvp-conclusao.md). A jornada smoke e os casos comportamentais têm escopos explícitos. Execução dos contratos revisados no navegador, integrações reais e homologação de produção continuam pendentes.
- Painel de Saúde/Ops (Configurações → Saúde, somente admin/owner): [documentação](docs/ops-health.md). A RPC `public.ops_health` agrega filas, envios, automações, IA e a verificação da conexão Meta por organização, sem expor segredos.
- Banco: `supabase/migrations` (nunca edite uma migration já aplicada; crie uma nova), testes em `supabase/tests/database`.

## Notas de segurança

- **RLS em todas as tabelas** de `public`; nenhuma policy para `anon`. Organização ativa vem sempre de uma membership validada pela RLS — o cookie `flowai_org` é só preferência.
- **`channels`: nunca `select *`.** A tabela usa privilégios por coluna (ids de segredos não são legíveis por `authenticated`); liste as colunas explicitamente.
- **Service role nunca em `apps/web`.** O frontend usa apenas URL + chave anon.
- **`events` e `audit_logs` são escritos apenas por código definer do banco** (triggers/funções `SECURITY DEFINER`). A API não insere eventos nem chama `write_audit_log`; login é auditado via `log_auth_event` (allowlist). Alterações em `memberships`, `organizations`, `channels`, `ai_agents` e `automations` são auditadas por trigger (em updates, só os nomes das colunas alteradas).
- **Rate limits do app são defesa em profundidade.** Os controles reais contra abuso de cadastro/login são os limites do Supabase Auth e captcha, configurados no projeto em produção.
- **`x-forwarded-for` precisa vir da plataforma de hospedagem** (proxy confiável que sobrescreve o cabeçalho); caso contrário o IP usado em rate limit e auditoria pode ser forjado pelo cliente.
- **Rate limit só no servidor.** `check_rate_limit` não é executável por `anon`/`authenticated`; cadastro e login usam `check_auth_rate_limit` (tipos `signup`/`login`, chave sempre com namespace), para que a API pública não esgote buckets de outros fluxos.
- **Instagram (Fase 5):**
  - App Secret, verify token e access tokens ficam no **Supabase Vault**, referenciados por id em `meta_connections`/`channels`; só funções `SECURITY DEFINER` de serviço os leem, e removê-la apaga os segredos. `channels.app_secret_secret_id`, `verify_token_secret_id` e `waba_id` são reservadas e não usadas.
  - **Webhook** (`meta-webhook`): verifica `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto com o App Secret) antes de qualquer parse; corpo ≤ 1 MiB; GET de verificação compara o verify token em tempo constante, limita `hub.challenge` a 256 caracteres e responde `nosniff`.
  - **Rate limits do webhook:** limite grosso por IP (último hop de `X-Forwarded-For` ou `cf-connecting-ip`, nunca o primeiro hop, que o cliente controla) antes da verificação; limite por conexão (3000/min) contado só depois de assinatura válida.
  - **Worker** (`instagram-worker`): chamado pelo `pg_cron` via `pg_net` com segredo próprio (`X-FlowAI-Worker`, comparado em tempo constante) guardado no Vault; configuração em schema `private`.
  - Posse de app/conta vale só para conexões **verificadas**; claims não verificados expiram em 24h e cedem a um dono verificado. Canais Instagram só são criados/apagados por funções de serviço.

- **IA (Fase 6):** `OPENAI_API_KEY` existe **somente** nos secrets das Edge Functions (`ai-worker`, `ai-playground`); nunca em `apps/web`, em `NEXT_PUBLIC_*` ou no repositório. Limites diários, filas e configuração do worker ficam em schema `private`; veja [ai-setup.md](docs/superpowers/ai-setup.md).
- **Automações (Fase 7A):** webhook de saída só permite HTTPS, resolve/verifica todos os IPs A/AAAA, bloqueia rede interna/especial, limita resposta a 64 KB e tempo a 10 s, sem redirecionamentos. A resolução seguida de fetch pela URL original mantém uma janela residual de DNS rebinding; veja [pendências](docs/superpowers/fase-7a-pendencias.md). Payloads de clique exigem HMAC e escopo da execução/canal/contato; adulterados ou de outra organização/contato são descartados, e cliques autênticos vencidos entram como texto comum (sem retomar a espera). Worker, secrets e cron: [automation-setup.md](docs/superpowers/automation-setup.md).
- **Headers HTTP e Transporte Seguro (Fase 10):** Configurados em `apps/web/next.config.ts` através de `buildSecurityHeaders()`. Aplica Content-Security-Policy (CSP estrito com whitelist de origens Supabase, OpenAI, Meta e Vercel Live Reload em dev), Strict-Transport-Security (HSTS max-age=63072000; includeSubDomains; preload), X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy: strict-origin-when-cross-origin e Permissions-Policy (restringindo câmera, microfone e geolocalização).

## Convenções do app

- **`getActiveOrg()` por página e por ação.** Toda página e Server Action/Route Handler de `(app)` chama `getActiveOrg()` por conta própria; o layout (sidebar/cabeçalho) não é barreira de segurança, apenas apresentação.
- **Navegação central.** Módulos, rotas, ícones e descrições vivem em `apps/web/src/lib/navigation.ts` e são usados pela sidebar, pelo título do cabeçalho e pelas páginas "em construção".
- **Leituras dinâmicas dentro de `<Suspense>`** (`cacheComponents`): cookies, headers e `getActiveOrg` nunca ficam no corpo síncrono de um layout/página.
- **Preferências de UI em cookie:** `flowai_sidebar` (`expanded|collapsed`) é lido no servidor para evitar "pulo" visual; o tema usa `next-themes`.
