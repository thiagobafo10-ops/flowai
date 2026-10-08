# FlowAI — Fase 1: Fundação (Projeto + Auth + Multi-tenancy + Banco + RLS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo funcional com Supabase local, schema completo do MVP com RLS multi-tenant testada por pgTAP, e fluxo cadastro → organização criada → dashboard (critérios de aceitação 1–3).

**Architecture:** npm workspaces com `apps/web` (Next.js) e `packages/core` (TS puro, compatível Deno/Node). Banco versionado em `supabase/migrations`, uma migration por domínio. Autorização via funções `is_member`/`has_role` + RLS em toda tabela; referências entre tabelas tenant usam FK composta `(organization_id, …)`. Operação de criação de organização é uma função SQL transacional.

**Tech Stack:** Node 24, npm workspaces, TypeScript strict, Next.js (`create-next-app@latest`, ≥15), Tailwind, shadcn/ui, React Hook Form, Zod 4, `@supabase/ssr`, Supabase CLI 2.x (Postgres 17), pgTAP, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-flowai-mvp-design.md` (seções 3, 5, 6, 11, 12, 13)

## Global Constraints

- Pré-requisito: Docker Desktop (WSL2) rodando. Sem ele, Tasks 2+ não executam — parar e avisar.
- Toda tabela de negócio: `id uuid default gen_random_uuid()`, `organization_id uuid not null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` (trigger `set_updated_at`). Exceções: `organizations` (é o tenant), `profiles` (1:1 com `auth.users`), `rate_limits` (infra).
- RLS habilitada em **todas** as tabelas de `public`. Nenhuma policy para `anon`.
- Referências tenant → tenant usam FK composta `(organization_id, x_id) → parent(organization_id, id)`; todo parent declara `unique (organization_id, id)`.
- Referências a usuários dentro de uma org (`assigned_to`, `owner_id`, `sender_user_id`, `created_by`) usam FK composta `(organization_id, col) → memberships(organization_id, user_id) on delete set null (col)`.
- Hierarquia de papéis: `owner > admin > agent > viewer` (enum `org_role`).
- Funções `SECURITY DEFINER` sempre com `set search_path = ''` e nomes qualificados.
- Service role **nunca** em `apps/web`. Somente `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` no frontend.
- `packages/core`: só Web APIs padrão; imports relativos com extensão `.ts` explícita.
- Textos de interface e mensagens de erro em português do Brasil.
- Nenhum dado fictício na UI; estados vazios são explícitos.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Escalada de papel** — um `agent` (ou `admin`) tenta se promover a `owner`/alterar a própria membership → deve falhar. Teste na Task 3.
2. **Referência cruzada entre orgs** — inserir um deal da org B apontando para contato da org A, mesmo como `postgres` → deve falhar pela FK composta. Teste na Task 5.
3. **Cookie de org ativa adulterado/obsoleto** — cookie com id de org da qual o usuário não é (mais) membro → deve cair para a primeira membership válida, nunca usar o id do cookie. Teste na Task 10.
4. **E-mail já cadastrado no signup** → mensagem "Este e-mail já está cadastrado." e nenhuma organização criada. Teste na Task 11.
5. **Nome de empresa com acentos/espaços/símbolos** (`"  Açaí & Cia!!  "`) → org criada com nome aparado e slug `acai-cia-<6 hex>`; nome vazio após trim é rejeitado. Teste na Task 9 (SQL) e Task 1 (Zod).

---

## Estrutura de arquivos

```
flowai/
├─ package.json                      workspaces, scripts raiz
├─ tsconfig.base.json
├─ .gitignore  .editorconfig  .nvmrc
├─ packages/core/
│   ├─ package.json  tsconfig.json  vitest.config.ts
│   └─ src/
│       ├─ index.ts
│       ├─ schemas/auth.ts            signUp, signIn, createOrganization (Zod)
│       ├─ schemas/auth.test.ts
│       ├─ tenancy/resolve-active-org.ts
│       ├─ tenancy/resolve-active-org.test.ts
│       └─ db/database.types.ts       gerado (supabase gen types)
├─ supabase/
│   ├─ config.toml
│   ├─ seed.sql                       helpers de teste no schema `tests` (sem dados)
│   ├─ migrations/
│   │   ├─ 20261007000001_foundation.sql
│   │   ├─ 20261007000002_tenancy.sql
│   │   ├─ 20261007000003_audit_rate_limit.sql
│   │   ├─ 20261007000004_crm.sql
│   │   ├─ 20261007000005_messaging.sql
│   │   ├─ 20261007000006_ai_knowledge.sql
│   │   ├─ 20261007000007_automation_events.sql
│   │   └─ 20261007000008_create_organization.sql
│   └─ tests/database/
│       ├─ 001_foundation.test.sql … 008_create_organization.test.sql
│       └─ 009_global_rls.test.sql
└─ apps/web/
    ├─ .env.example
    ├─ playwright.config.ts
    ├─ e2e/onboarding.spec.ts
    └─ src/
        ├─ middleware.ts | proxy.ts     (conforme versão do Next)
        ├─ lib/supabase/{server,client,session}.ts
        ├─ lib/action-result.ts
        ├─ lib/org/active-org.ts
        └─ app/
            ├─ (auth)/login/page.tsx  (auth)/signup/page.tsx  (auth)/actions.ts
            ├─ onboarding/page.tsx  onboarding/actions.ts
            └─ (app)/dashboard/page.tsx
```

---

### Task 1: Monorepo + `packages/core` com schemas Zod de auth

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`, `.nvmrc`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`, `packages/core/src/schemas/auth.ts`
- Test: `packages/core/src/schemas/auth.test.ts`

**Interfaces:**
- Produces: pacote `@flowai/core` com exports
  - `signUpSchema: z.ZodObject<{ fullName; email; password }>`, `type SignUpInput`
  - `signInSchema: z.ZodObject<{ email; password }>`, `type SignInInput`
  - `createOrganizationSchema: z.ZodObject<{ name }>`, `type CreateOrganizationInput`
- Root scripts: `test` (vitest em core), `typecheck`, `db:start`, `db:reset`, `db:test`, `db:types`.

- [ ] **Step 1: Scaffold raiz**

`package.json` raiz: `"private": true`, `"workspaces": ["apps/*", "packages/*"]`, scripts:
- `"test": "npm run test -w @flowai/core"`
- `"typecheck": "npm run typecheck --workspaces --if-present"`
- `"db:start": "supabase start"`, `"db:reset": "supabase db reset"`, `"db:test": "supabase test db"`
- `"db:types": "supabase gen types typescript --local > packages/core/src/db/database.types.ts"`
- devDependency `supabase` (CLI) fixada na versão instalada (2.120.0).

`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `module: "esnext"`, `moduleResolution: "bundler"`, `allowImportingTsExtensions: true`, `noEmit: true`, `target: "es2022"`, `skipLibCheck`.
`.nvmrc`: `24`. `.gitignore`: node_modules, .next, .env*.local, supabase/.temp, playwright-report, test-results.

`packages/core/package.json`: name `@flowai/core`, `"type": "module"`, `"exports": { ".": "./src/index.ts" }`, deps `zod@^4`, devDeps `vitest`, `typescript`; scripts `test: vitest run`, `typecheck: tsc --noEmit`.

- [ ] **Step 2: Escrever o teste que falha**

```ts
// packages/core/src/schemas/auth.test.ts
import { describe, it, expect } from "vitest";
import { signUpSchema, signInSchema, createOrganizationSchema } from "./auth.ts";

describe("signUpSchema", () => {
  it("aceita dados válidos e normaliza e-mail", () => {
    const r = signUpSchema.parse({ fullName: "  Ana Souza ", email: " ANA@Exemplo.com ", password: "12345678" });
    expect(r).toEqual({ fullName: "Ana Souza", email: "ana@exemplo.com", password: "12345678" });
  });
  it("rejeita senha com menos de 8 caracteres com mensagem em pt-BR", () => {
    const r = signUpSchema.safeParse({ fullName: "Ana", email: "a@b.com", password: "1234567" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("A senha deve ter pelo menos 8 caracteres.");
  });
  it("rejeita nome com menos de 2 caracteres", () => {
    expect(signUpSchema.safeParse({ fullName: " a ", email: "a@b.com", password: "12345678" }).success).toBe(false);
  });
  it("rejeita e-mail inválido", () => {
    const r = signUpSchema.safeParse({ fullName: "Ana", email: "ana", password: "12345678" });
    expect(r.error?.issues[0]?.message).toBe("Informe um e-mail válido.");
  });
});

describe("signInSchema", () => {
  it("exige senha não vazia", () => {
    expect(signInSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("createOrganizationSchema", () => {
  it("apara o nome e preserva acentos e símbolos", () => {
    expect(createOrganizationSchema.parse({ name: "  Açaí & Cia!!  " })).toEqual({ name: "Açaí & Cia!!" });
  });
  it("rejeita nome vazio após trim", () => {
    const r = createOrganizationSchema.safeParse({ name: "    " });
    expect(r.error?.issues[0]?.message).toBe("Informe o nome da empresa.");
  });
  it("rejeita nome com mais de 80 caracteres", () => {
    expect(createOrganizationSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm install` e depois `npm test`
Expected: FAIL — `Cannot find module './auth.ts'`.

- [ ] **Step 4: Implementar `packages/core/src/schemas/auth.ts`**

Regras: `fullName` trim, 2–100 chars; `email` trim + lowercase, `z.email()` com mensagem "Informe um e-mail válido."; `password` (signUp) 8–72 chars, mensagem mínima "A senha deve ter pelo menos 8 caracteres."; `password` (signIn) min 1, "Informe sua senha."; `name` trim, min 1 "Informe o nome da empresa.", max 80 "O nome deve ter no máximo 80 caracteres.". Re-exportar tudo em `src/index.ts`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test` → PASS (8 testes). Run: `npm run typecheck` → sem erros.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo and core auth schemas"
```

---

### Task 2: Supabase local + migration de fundação + helpers de teste

**Files:**
- Create: `supabase/config.toml` (via `npx supabase init`), `supabase/seed.sql`
- Create: `supabase/migrations/20261007000001_foundation.sql`
- Test: `supabase/tests/database/001_foundation.test.sql`

**Interfaces:**
- Produces (SQL):
  - extensões em schema `extensions`: `pgcrypto`, `unaccent`, `vector`, `pg_net`; `pgmq`; `pg_cron`
  - `create type public.org_role as enum ('owner','admin','agent','viewer')`
  - `public.set_updated_at() returns trigger`
  - `public.role_rank(r public.org_role) returns int` (owner 4, admin 3, agent 2, viewer 1), `immutable`
- Produces (helpers de teste em `seed.sql`, schema `tests`, plpgsql):
  - `tests.create_user(p_email text, p_full_name text default 'Test User') returns uuid` — insere em `auth.users` (`raw_user_meta_data = {"full_name": …}`)
  - `tests.authenticate_as(p_user uuid) returns void` — `set_config('role','authenticated',true)` e `set_config('request.jwt.claims', json_build_object('sub',p_user,'role','authenticated')::text, true)`
  - `tests.clear_authentication() returns void` — volta `role` para `postgres` e limpa claims
  - `tests.create_org(p_owner uuid, p_name text) returns uuid` — insere org (slug `p_name` + sufixo aleatório) e membership `owner` diretamente (sem RPC)
  - `tests.add_member(p_org uuid, p_user uuid, p_role public.org_role) returns void`

  (Os helpers que referenciam tabelas ainda inexistentes são plpgsql — resolvidos em tempo de execução.)

- [ ] **Step 1: Inicializar Supabase**

Run: `npx supabase init` (aceitar defaults). Em `config.toml`: `[auth] site_url = "http://localhost:3000"`, `[auth.email] enable_confirmations = false`, `[db] major_version = 17`.
Run: `npm run db:start` → Expected: imprime API URL, anon key.

- [ ] **Step 2: Escrever o teste que falha**

```sql
-- supabase/tests/database/001_foundation.test.sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
select has_extension('vector');
select has_extension('pgmq');
select has_extension('pg_cron');
select has_extension('unaccent');
select has_type('public', 'org_role', 'enum org_role existe');
select is(public.role_rank('owner'), 4);
select ok(public.role_rank('admin') > public.role_rank('agent') and public.role_rank('agent') > public.role_rank('viewer'), 'hierarquia de papéis');
select * from finish();
rollback;
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run db:test` → Expected: FAIL (extensões/tipos ausentes).

- [ ] **Step 4: Implementar a migration de fundação e `seed.sql`**

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run db:reset` e `npm run db:test` → Expected: `001_foundation ... ok`.

- [ ] **Step 6: Commit**

```bash
git add supabase package.json
git commit -m "feat(db): supabase local, foundation migration and pgTAP helpers"
```

---

### Task 3: Tenancy — organizations, profiles, memberships, `is_member`, `has_role`

**Files:**
- Create: `supabase/migrations/20261007000002_tenancy.sql`
- Test: `supabase/tests/database/002_tenancy.test.sql`

**Interfaces:**
- Consumes: `org_role`, `role_rank`, `set_updated_at`, helpers `tests.*` (Task 2)
- Produces:
  - `public.organizations(id, name, slug unique, company_info jsonb default '{}', timezone text default 'America/Sao_Paulo', created_at, updated_at)`
  - `public.profiles(id uuid pk references auth.users on delete cascade, full_name, avatar_url, created_at, updated_at)` + trigger `on_auth_user_created` (SECURITY DEFINER) que cria o profile a partir de `raw_user_meta_data->>'full_name'`
  - `public.memberships(id, organization_id, user_id → profiles, role org_role, created_at, updated_at, unique(organization_id, user_id))`
  - `public.is_member(p_org uuid) returns boolean` — SECURITY DEFINER, `stable`
  - `public.has_role(p_org uuid, p_min public.org_role) returns boolean` — SECURITY DEFINER, `stable`, compara via `role_rank`
  - `public.shares_org_with(p_user uuid) returns boolean` — SECURITY DEFINER, `stable`; usado pela policy de `profiles` para evitar recursão de RLS em `memberships`

**Policies:**
| Tabela | select | insert | update | delete |
|---|---|---|---|---|
| organizations | `is_member(id)` | — (só via RPC) | `has_role(id,'admin')` | `has_role(id,'owner')` |
| profiles | própria **ou** compartilha alguma org | — (trigger) | própria | — |
| memberships | `is_member(organization_id)` | admin+, `role <> 'owner'` | admin+, `user_id <> auth.uid()`, e (`role <> 'owner'` ou `has_role(org,'owner')`) em USING e WITH CHECK | mesmo critério do update |

- [ ] **Step 1: Escrever o teste que falha**

```sql
-- supabase/tests/database/002_tenancy.test.sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select tests.create_user('a@t.test') as ua \gset
select tests.create_user('b@t.test') as ub \gset
select tests.create_user('agent@t.test') as uagent \gset
select tests.create_org(:'ua', 'Org A') as org_a \gset
select tests.create_org(:'ub', 'Org B') as org_b \gset
select tests.add_member(:'org_a', :'uagent', 'agent');

select is((select full_name from public.profiles where id = :'ua'), 'Test User', 'profile criado pelo trigger');

select tests.authenticate_as(:'ua');
select is((select count(*)::int from public.organizations), 1, 'A vê só a própria org');
select is((select count(*)::int from public.organizations where id = :'org_b'), 0, 'A não vê org B');
select is((select count(*)::int from public.memberships where organization_id = :'org_b'), 0, 'A não vê memberships de B');
select ok(public.has_role(:'org_a', 'owner'), 'A é owner de A');
select ok(not public.is_member(:'org_b'), 'A não é membro de B');
select is((select count(*)::int from public.profiles where id = :'ub'), 0, 'A não vê profile de B');

-- Review Focus #1: escalada de papel
select tests.authenticate_as(:'uagent');
update public.memberships set role = 'owner' where user_id = :'uagent';
select tests.clear_authentication();
select is((select role::text from public.memberships where user_id = :'uagent'), 'agent', 'agent não se promove');

select tests.authenticate_as(:'uagent');
select throws_ok(
  format($$insert into public.memberships(organization_id, user_id, role) values (%L, %L, 'owner')$$, :'org_a', :'ub'),
  '42501', null, 'agent não adiciona membros');
select lives_ok(format($$update public.organizations set name = 'X' where id = %L$$, :'org_a'), 'update sem permissão não erra…');
select tests.clear_authentication();
select is((select name from public.organizations where id = :'org_a'), 'Org A', '…mas não altera (agent não é admin)');

select * from finish();
rollback;
```

> Nota: `supabase test db` executa via `pg_prove`; se `\gset` não for suportado no runner, substituir por um bloco que guarda os ids em uma temp table `ids(k text, v uuid)` e lê com subselects. Decidir no Step 2 ao rodar.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run db:test` → FAIL (`relation public.profiles does not exist`).

- [ ] **Step 3: Implementar a migration de tenancy** (tabelas, trigger, funções, policies da tabela acima, `unique (organization_id, user_id)` em memberships, triggers `set_updated_at`)

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run db:reset; npm run db:test` → `002_tenancy ... ok`.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat(db): organizations, profiles, memberships with RLS"
```

---

### Task 4: Audit logs (append-only) + rate limiting

**Files:**
- Create: `supabase/migrations/20261007000003_audit_rate_limit.sql`
- Test: `supabase/tests/database/003_audit_rate_limit.test.sql`

**Interfaces:**
- Produces:
  - `public.audit_logs(id, organization_id uuid null → organizations, actor_id uuid → profiles, action text, entity_type text, entity_id uuid, metadata jsonb default '{}', ip inet, created_at)` — sem `updated_at`
  - trigger `audit_logs_append_only` que lança exceção `'audit_logs is append-only'` em UPDATE/DELETE (vale também para postgres/service_role)
  - `public.write_audit_log(p_org uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb default '{}', p_ip inet default null) returns void` — SECURITY DEFINER; exige `auth.uid()`; se `p_org` não nulo, exige `is_member(p_org)`; `actor_id := auth.uid()` (não aceita actor externo)
  - policies `audit_logs`: select = (`organization_id` não nulo e `has_role(organization_id,'admin')`) ou (`organization_id` nulo e `actor_id = auth.uid()`); sem insert/update/delete diretos
  - `public.rate_limits(key text, window_start timestamptz, count int, primary key(key, window_start))` — RLS habilitada, **nenhuma** policy
  - `public.check_rate_limit(p_key text, p_limit int, p_window_seconds int) returns boolean` — SECURITY DEFINER; `grant execute to anon, authenticated`; retorna `true` se permitido

**Algoritmo (janela deslizante aproximada):** janela atual `w = to_timestamp(floor(epoch(now())/p_window_seconds)*p_window_seconds)`; upsert `count = count + 1` em `(p_key, w)`; `prev` = count da janela anterior; `elapsed = (now() - w)/p_window_seconds`; estimado = `prev * (1 - elapsed) + atual`; retorna `estimado <= p_limit`. Apaga linhas com `window_start < now() - 2 * janela` para a mesma chave.

- [ ] **Step 1: Escrever o teste que falha**

```sql
-- casos (plan 8):
-- 1. user A chama write_audit_log(org_a, 'test.action', 'organization', org_a) → lives_ok
-- 2. actor_id gravado = A
-- 3. user B chama write_audit_log(org_a, …) → throws_ok (não é membro)
-- 4. como postgres: update public.audit_logs set action='x' → throws_ok '…append-only'
-- 5. como postgres: delete from public.audit_logs → throws_ok '…append-only'
-- 6. agent da org A: select count(*) from audit_logs → 0 (só admin+ lê)
-- 7. check_rate_limit('k', 3, 60) chamado 3x → todas true
-- 8. 4ª chamada → false
```

(Escrever com `throws_ok`/`is`/`ok` no mesmo formato da Task 3.)

- [ ] **Step 2: Rodar e ver falhar** — `npm run db:test` → FAIL.
- [ ] **Step 3: Implementar a migration.**
- [ ] **Step 4: Rodar e ver passar** — `npm run db:reset; npm run db:test` → ok.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): append-only audit logs and rate limiting"`

---

### Task 5: CRM — contacts, custom fields, tags, pipelines, stages, deals

**Files:**
- Create: `supabase/migrations/20261007000004_crm.sql`
- Test: `supabase/tests/database/004_crm.test.sql`

**Interfaces:**
- Consumes: tenancy (Task 3)
- Produces tabelas com colunas **exatamente** como spec §6: `contacts`, `contact_custom_fields`, `tags`, `contact_tags` (PK `(contact_id, tag_id)` + `organization_id`), `pipelines`, `pipeline_stages`, `deals`.
  - enums: `contact_source ('whatsapp','instagram','manual')`, `contact_status ('lead','customer','inactive')`, `deal_status ('open','won','lost')`
  - `contacts.lead_score int not null default 0 check (between 0 and 100)`
  - unique parciais: `contacts(organization_id, whatsapp_id) where whatsapp_id is not null`, idem `instagram_id`; `tags(organization_id, lower(name))`; `pipeline_stages(pipeline_id, position)`; `deals(contact_id, pipeline_id) where status = 'open'`; `pipelines(organization_id) where is_default`
  - `deals.value numeric(14,2) not null default 0`, `currency text not null default 'BRL'`
  - FKs compostas (Global Constraints) para todas as referências tenant e de usuário

**Policies:** select `is_member`. `contacts`, `contact_custom_fields`, `tags`, `contact_tags`, `deals`: insert/update agent+; delete admin+ (exceto `contact_tags` e `contact_custom_fields`: delete agent+). `pipelines`, `pipeline_stages`: insert/update/delete admin+.

- [ ] **Step 1: Escrever o teste que falha** — casos (plan 9):

```sql
-- setup: orgs A e B (owners ua, ub), viewer de A (uview), agent de A (uagent);
--        como postgres: contact ca em A, pipeline pa + stage sa em A, contact cb em B, pipeline pb + stage sb em B
-- 1. ua: count contacts = 1 (só A)
-- 2. ub: select contacts where id = ca → 0
-- 3. uagent: insert contact em A → lives_ok
-- 4. uview: insert contact em A → throws_ok 42501
-- 5. uagent: insert pipeline em A → throws_ok 42501 (só admin+)
-- 6. ub: insert contact com organization_id = A → throws_ok 42501
-- 7. Review Focus #2 — como postgres: insert deal (organization_id=B, contact_id=ca, pipeline_id=pb, stage_id=sb) → throws_ok '23503'
-- 8. como postgres: segundo deal 'open' para (ca, pa) → throws_ok '23505'
-- 9. update contacts set lead_score = 101 → throws_ok '23514'
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar a migration.**
- [ ] **Step 4: Rodar e ver passar** — `npm run db:reset; npm run db:test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): CRM tables with composite tenant FKs and RLS"`

---

### Task 6: Messaging — channels, conversations, messages, Realtime

**Files:**
- Create: `supabase/migrations/20261007000005_messaging.sql`
- Test: `supabase/tests/database/005_messaging.test.sql`

**Interfaces:**
- Consumes: CRM (Task 5)
- Produces tabelas conforme spec §6: `channels`, `conversations`, `messages`.
  - enums: `channel_type ('whatsapp','instagram')`, `channel_status ('needs_setup','active','error')`, `conversation_status ('open','pending_human','closed')`, `handler_type ('ai','human')`, `message_direction ('inbound','outbound')`, `sender_type ('contact','ai','human','system','automation')`, `message_status ('pending','sent','delivered','read','failed')`
  - `channels`: `access_token_secret_id`, `app_secret_secret_id`, `verify_token_secret_id` são `uuid` (ids de `vault.secrets`), nulos até a Fase 5; unique `(type, external_account_id) where external_account_id is not null`
  - `messages`: `unique (channel_id, external_id)`; `content_type text not null default 'text'`; `is_internal_note boolean not null default false`
  - índices: `conversations(organization_id, status, last_message_at desc)`, `messages(conversation_id, created_at)`
  - publicação `supabase_realtime` inclui `messages`, `conversations`, `deals`

**Privilégios de coluna (tokens nunca no frontend):** `revoke select, insert, update on public.channels from authenticated`; `grant select (id, organization_id, type, name, status, external_account_id, waba_id, last_error, created_at, updated_at)`, `grant insert (organization_id, type, name)`, `grant update (name, status)` para `authenticated`.

**Policies:** select `is_member`. `channels`: insert/update/delete admin+. `conversations`: insert/update agent+; sem delete. `messages`: insert agent+ **com** `sender_type = 'human' and sender_user_id = auth.uid() and direction = 'outbound'`; update agent+; sem delete.

- [ ] **Step 1: Escrever o teste que falha** — casos (plan 8):

```sql
-- 1. ua (owner A): select access_token_secret_id from channels → throws_ok '42501'
-- 2. ua: select id, name, status from channels → lives_ok
-- 3. uagent (A): insert channel → throws_ok 42501
-- 4. uagent: insert message humana outbound com sender_user_id = uagent → lives_ok
-- 5. uagent: insert message com sender_type='ai' → throws_ok 42501
-- 6. uagent: insert message com sender_user_id = ua (outro usuário) → throws_ok 42501
-- 7. como postgres: duas mensagens com mesmo (channel_id, external_id) → throws_ok '23505'
-- 8. ok(exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='messages'))
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar a migration.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `git commit -m "feat(db): channels, conversations, messages with column-level secret protection"`

---

### Task 7: IA e conhecimento — ai_agents, knowledge_documents, knowledge_chunks, ai_classifications

**Files:**
- Create: `supabase/migrations/20261007000006_ai_knowledge.sql`
- Test: `supabase/tests/database/006_ai_knowledge.test.sql`

**Interfaces:**
- Consumes: messaging (Task 6)
- Produces tabelas conforme spec §6:
  - `ai_agents`: `auto_reply boolean not null default false`, `human_handoff boolean not null default true`, `is_active boolean not null default false`, `tone text not null default 'profissional e cordial'`
  - `knowledge_documents`: enum `knowledge_status ('processing','ready','error')`, default `processing`
  - `knowledge_chunks`: `embedding extensions.vector(1536)`, índice `using hnsw (embedding extensions.vector_cosine_ops)`, `unique(document_id, chunk_index)`
  - `ai_classifications`: enum `sentiment ('positive','neutral','negative')`; `lead_score int check 0..100`; `needs_human boolean not null`; `suggested_stage text null`; `model text not null`

**Policies:** select `is_member` em todas. `ai_agents`, `knowledge_documents`: insert/update/delete admin+. `knowledge_chunks`, `ai_classifications`: **sem** escrita para `authenticated` (somente service role, Fase 6).

- [ ] **Step 1: Escrever o teste que falha** — casos (plan 6): agent de A não insere `ai_agents` (42501); admin de A insere; B não vê agente de A; agent de A não insere `knowledge_chunks` (42501); owner de A não insere `ai_classifications` (42501); `has_index('public','knowledge_chunks', <nome do índice hnsw>)`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar a migration.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `git commit -m "feat(db): AI agents, knowledge base and classifications tables"`

---

### Task 8: Automações + eventos

**Files:**
- Create: `supabase/migrations/20261007000007_automation_events.sql`
- Test: `supabase/tests/database/007_automation_events.test.sql`

**Interfaces:**
- Consumes: tabelas anteriores
- Produces tabelas conforme spec §6 e §8: `automations`, `automation_nodes`, `automation_edges`, `automation_runs`, `automation_run_steps`, `events`.
  - enums: `automation_status ('draft','active','paused')`, `automation_node_type` (12 valores da spec §8.1: `trigger, condition, message, delay, tag, remove_tag, assign_user, move_stage, ai, webhook, close_conversation, end`), `automation_trigger_type ('message_received','keyword_detected','conversation_created','tag_added','stage_changed','contact_created')`, `run_status ('pending','running','waiting','completed','failed','cancelled')`
  - `automation_edges.source_handle text not null default 'default' check (in ('default','true','false'))`
  - `automation_runs`: `unique (automation_id, trigger_event_id)`; `step_count int not null default 0`; índice `(status, resume_at) where status = 'waiting'`
  - `automation_run_steps`: `iteration int not null default 0`, `unique (run_id, node_id, iteration)`
  - `events`: `type text not null`, `actor_type text not null check (in ('user','ai','system','automation','contact'))`, `actor_id uuid null`, `payload jsonb not null default '{}'`; índice `(organization_id, type, created_at)`

**Policies:** select `is_member` em todas. `automations`, `automation_nodes`, `automation_edges`: escrita admin+. `automation_runs`, `automation_run_steps`: sem escrita para `authenticated`. `events`: insert agent+ com `actor_type = 'user' and actor_id = auth.uid()`; sem update/delete.

- [ ] **Step 1: Escrever o teste que falha** — casos (plan 6): agent não cria automação (42501); admin cria; owner não insere `automation_runs` (42501); como postgres, segundo run com mesmo `(automation_id, trigger_event_id)` → 23505; agent insere event com `actor_id = auth.uid()` → ok; agent insere event com `actor_type='ai'` → 42501.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar a migration.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `git commit -m "feat(db): automation graph, runs and domain events tables"`

---

### Task 9: `create_organization_with_owner` + suíte global de RLS + tipos gerados

**Files:**
- Create: `supabase/migrations/20261007000008_create_organization.sql`
- Test: `supabase/tests/database/008_create_organization.test.sql`, `supabase/tests/database/009_global_rls.test.sql`
- Create (gerado): `packages/core/src/db/database.types.ts`; Modify: `packages/core/src/index.ts` (exporta `type Database`)

**Interfaces:**
- Produces:
  - `public.slugify(p text) returns text` — `immutable`; `lower(unaccent(p))`, não-alfanuméricos → `-`, colapsa e apara hífens, máx. 40 chars
  - `public.create_organization_with_owner(p_name text) returns uuid` — SECURITY DEFINER; `grant execute to authenticated`; em uma transação:
    1. exige `auth.uid()`; `name := btrim(p_name)`; se vazio ou > 80 → `raise exception 'invalid_organization_name' using errcode = '22023'`
    2. insere org com `slug = slugify(name) || '-' || substr(encode(gen_random_bytes(3),'hex'),1,6)`
    3. membership `owner` para `auth.uid()`
    4. pipeline `'Pipeline padrão'` (`is_default = true`) com etapas em ordem, `position` 0–6: **Novo, Interessado, Qualificado, Orçamento, Negociação, Ganho (`is_won`), Perdido (`is_lost`)**
    5. `ai_agents`: `name 'Assistente'`, `is_active false`, `auto_reply false`, `human_handoff true`, demais textos vazios
    6. `write_audit_log(org, 'organization.created', 'organization', org)`
    7. retorna o id da org
  - `type Database` exportado de `@flowai/core`

- [ ] **Step 1: Escrever os testes que falham**

```sql
-- 008_create_organization.test.sql (plan 9)
-- como user U autenticado: select public.create_organization_with_owner('  Açaí & Cia!!  ') → org
-- 1. is(name, 'Açaí & Cia!!')
-- 2. matches(slug, '^acai-cia-[0-9a-f]{6}$')                       -- Review Focus #5
-- 3. is(role de U na org, 'owner')
-- 4. is(array_agg(name order by position) das etapas,
--       array['Novo','Interessado','Qualificado','Orçamento','Negociação','Ganho','Perdido'])
-- 5. ok(etapa 'Ganho' is_won and 'Perdido' is_lost)
-- 6. is(count(ai_agents) da org, 1) e is_active = false
-- 7. is(count(audit_logs where action='organization.created'), 1)
-- 8. throws_ok(create_organization_with_owner('   '), '22023')
-- 9. sem autenticação: throws_ok(create_organization_with_owner('X'))
```

```sql
-- 009_global_rls.test.sql (plan 3)
-- 1. Toda tabela de public tem RLS:
select is(
  (select array_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  null, 'todas as tabelas de public têm RLS');
-- 2. Toda tabela de public (exceto organizations, profiles, rate_limits) tem organization_id NOT NULL
--    (exceção: audit_logs, nullable por design) → array de violações é null
-- 3. Nenhuma policy concede acesso a anon:
select is((select count(*)::int from pg_policies where schemaname='public' and 'anon' = any(roles)), 0);
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar a migration.**
- [ ] **Step 4: Rodar e ver passar** — `npm run db:reset; npm run db:test` → todos os 9 arquivos ok.
- [ ] **Step 5: Gerar tipos** — `npm run db:types`; `npm run typecheck` → sem erros.
- [ ] **Step 6: Commit** — `git commit -m "feat(db): transactional organization creation, global RLS checks, generated types"`

---

### Task 10: App Next.js + clientes Supabase + proteção de rotas + org ativa

**Files:**
- Create: `apps/web/*` (via `npx create-next-app@latest apps/web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm`), `apps/web/.env.example`
- Create: `apps/web/src/lib/supabase/server.ts`, `client.ts`, `session.ts`
- Create: `apps/web/src/middleware.ts` (Next 15) **ou** `apps/web/src/proxy.ts` (Next ≥16) — usar a convenção da versão instalada
- Create: `packages/core/src/tenancy/resolve-active-org.ts`, `apps/web/src/lib/org/active-org.ts`, `apps/web/src/lib/action-result.ts`
- Test: `packages/core/src/tenancy/resolve-active-org.test.ts`

**Interfaces:**
- Consumes: `Database` (Task 9)
- Produces:
  - `resolveActiveOrg(cookieOrgId: string | null, memberships: { organizationId: string; createdAt: string }[]): string | null` — exportado de `@flowai/core`
  - `createServerClient(): Promise<SupabaseClient<Database>>` (`server.ts`, usa `cookies()`); `createBrowserClient(): SupabaseClient<Database>` (`client.ts`)
  - `updateSession(request: NextRequest): Promise<NextResponse>` (`session.ts`) — renova sessão; sem usuário em rota protegida → redirect `/login`; com usuário em `/login` ou `/signup` → redirect `/dashboard`
  - Rotas públicas: `/login`, `/signup`. Protegidas: todo o resto (exceto assets e `/_next`).
  - `ACTIVE_ORG_COOKIE = "flowai_org"`; `getActiveOrg(): Promise<{ id: string; name: string; role: OrgRole } | null>` (`active-org.ts`) — lê memberships do usuário via RLS, aplica `resolveActiveOrg`, e é a única fonte de org ativa no servidor
  - `type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> }`
  - `next.config`: `transpilePackages: ["@flowai/core"]` + headers de segurança (CSP básica `default-src 'self'` com `connect-src` incluindo `NEXT_PUBLIC_SUPABASE_URL` e `ws:` do Supabase, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`)

- [ ] **Step 1: Escrever o teste que falha**

```ts
// packages/core/src/tenancy/resolve-active-org.test.ts
import { describe, it, expect } from "vitest";
import { resolveActiveOrg } from "./resolve-active-org.ts";

const m = (id: string, createdAt: string) => ({ organizationId: id, createdAt });

describe("resolveActiveOrg", () => {
  it("usa o cookie quando o usuário é membro da org", () => {
    expect(resolveActiveOrg("b", [m("a", "2026-01-01"), m("b", "2026-02-01")])).toBe("b");
  });
  it("ignora cookie de org da qual o usuário não é membro e cai na mais antiga", () => { // Review Focus #3
    expect(resolveActiveOrg("x", [m("b", "2026-02-01"), m("a", "2026-01-01")])).toBe("a");
  });
  it("sem cookie, usa a membership mais antiga", () => {
    expect(resolveActiveOrg(null, [m("b", "2026-02-01"), m("a", "2026-01-01")])).toBe("a");
  });
  it("sem memberships retorna null", () => {
    expect(resolveActiveOrg("a", [])).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm test` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar `resolveActiveOrg`** e exportar em `index.ts`.
- [ ] **Step 4: Rodar e ver passar** — `npm test` → PASS.
- [ ] **Step 5: Scaffold do app** — create-next-app; `npx shadcn@latest init` (base neutra); `npx shadcn@latest add button input label card form sonner`; deps `@supabase/ssr @supabase/supabase-js @tanstack/react-query react-hook-form @hookform/resolvers zod@^4`; dependência workspace `"@flowai/core": "*"`. `.env.example` com `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` e `NEXT_PUBLIC_SUPABASE_ANON_KEY=` (copiar de `npx supabase status` para `.env.local`).
- [ ] **Step 6: Implementar clientes, `updateSession`, middleware/proxy, `getActiveOrg`, `ActionResult` e headers.**
- [ ] **Step 7: Verificar** — `npm run typecheck` e `npm run build -w apps/web` → sucesso. `npm run dev -w apps/web` e abrir `http://localhost:3000/dashboard` → redireciona para `/login` (404 aceitável na página de login até a Task 11).
- [ ] **Step 8: Commit** — `git commit -m "feat(web): Next.js app, Supabase SSR clients, route protection, active org resolution"`

---

### Task 11: Cadastro e login

**Files:**
- Create: `apps/web/src/app/(auth)/layout.tsx`, `(auth)/signup/page.tsx`, `(auth)/login/page.tsx`, `(auth)/actions.ts`, `apps/web/src/components/auth/signup-form.tsx`, `login-form.tsx`
- Create: `apps/web/src/lib/request-ip.ts`
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `signUpSchema`, `signInSchema` (Task 1); `createServerClient`, `ActionResult` (Task 10); `check_rate_limit`, `write_audit_log` (Task 4)
- Produces:
  - `signUp(input: SignUpInput): Promise<ActionResult>` — valida com Zod; `check_rate_limit('signup:' + ip, 5, 3600)`; `supabase.auth.signUp` com `options.data.full_name`; sucesso → `redirect('/onboarding')`
  - `signIn(input: SignInInput): Promise<ActionResult>` — `check_rate_limit('login:' + ip + ':' + email, 10, 900)`; `signInWithPassword`; sucesso → `write_audit_log(null, 'auth.login', 'user', userId)` e `redirect('/dashboard')`
  - `signOut(): Promise<void>` → `redirect('/login')`
  - `getRequestIp(): Promise<string>` — primeiro IP de `x-forwarded-for`, senão `x-real-ip`, senão `'unknown'`
  - Mensagens fixas: e-mail duplicado → **"Este e-mail já está cadastrado."**; credenciais inválidas → **"E-mail ou senha inválidos."**; rate limit → **"Muitas tentativas. Aguarde alguns minutos e tente novamente."**; erro inesperado → **"Não foi possível concluir. Tente novamente."**
  - Formulários com RHF + `zodResolver`; botão desabilitado e com spinner enquanto pendente; erro exibido inline e no toast (sonner); links cruzados "Já tem conta? Entrar" / "Criar conta".

> Detecção de e-mail duplicado: com confirmação desligada, o Supabase retorna erro `user_already_exists` (`error.code`). Mapear por `code`, não por texto.

- [ ] **Step 1: Escrever o teste e2e que falha**

```ts
// apps/web/e2e/auth.spec.ts
import { test, expect } from "@playwright/test";
const email = () => `e2e+${Date.now()}${Math.random().toString(16).slice(2, 6)}@flowai.test`;

test("cadastro leva ao onboarding", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("Ana Souza");
  await page.getByLabel("E-mail").fill(email());
  await page.getByLabel("Senha").fill("senha-segura-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("e-mail já cadastrado mostra erro e não avança", async ({ page, context }) => { // Review Focus #4
  const e = email();
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("Ana");
  await page.getByLabel("E-mail").fill(e);
  await page.getByLabel("Senha").fill("senha-segura-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await context.clearCookies();
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("Ana");
  await page.getByLabel("E-mail").fill(e);
  await page.getByLabel("Senha").fill("senha-segura-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Este e-mail já está cadastrado.")).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);
});

test("senha errada mostra erro genérico", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("ninguem@flowai.test");
  await page.getByLabel("Senha").fill("errada-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();
});

test("rota protegida sem sessão redireciona para login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
```

`playwright.config.ts`: `baseURL: "http://localhost:3000"`, `webServer: { command: "npm run dev", port: 3000, reuseExistingServer: true }`, projeto chromium. Script `"e2e": "playwright test"` em `apps/web`. Rodar `npx playwright install chromium` uma vez.

- [ ] **Step 2: Rodar e ver falhar** — `npm run e2e -w apps/web` → FAIL (páginas inexistentes).
- [ ] **Step 3: Implementar actions, formulários e páginas.**
- [ ] **Step 4: Rodar e ver passar** — `npm run e2e -w apps/web -- auth.spec.ts` → 4 passed. (O primeiro teste só passa por completo após a Task 12 criar `/onboarding`; até lá, aceitar que a URL mude para `/onboarding` mesmo com 404.)
- [ ] **Step 5: Commit** — `git commit -m "feat(web): sign up and sign in with validation, rate limiting and audit"`

---

### Task 12: Onboarding + dashboard inicial (critérios 1–3)

**Files:**
- Create: `apps/web/src/app/onboarding/page.tsx`, `onboarding/actions.ts`, `apps/web/src/components/onboarding/create-organization-form.tsx`
- Create: `apps/web/src/app/(app)/layout.tsx`, `(app)/dashboard/page.tsx`
- Create: `apps/web/e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: `createOrganizationSchema`, `getActiveOrg`, `ACTIVE_ORG_COOKIE`, `createServerClient`, `ActionResult`, RPC `create_organization_with_owner`
- Produces:
  - `createOrganization(input: CreateOrganizationInput): Promise<ActionResult>` — valida; chama RPC; grava cookie `flowai_org` (`httpOnly`, `sameSite: 'lax'`, `secure` em produção, `path: '/'`); `redirect('/dashboard')`. Erro `22023` → "Informe o nome da empresa."; outros → mensagem genérica da Task 11.
  - `/onboarding`: se `getActiveOrg()` já retorna org → `redirect('/dashboard')` (evita criar org duplicada ao voltar/recarregar). Formulário "Nome da empresa" + botão "Criar organização" (desabilitado enquanto pendente).
  - `(app)/layout.tsx`: se `getActiveOrg()` é `null` → `redirect('/onboarding')`. Cabeçalho mínimo com nome da org e botão "Sair" (`signOut`). A sidebar completa é Fase 2.
  - `/dashboard`: título "Dashboard", nome da org, e estado vazio explícito: **"Ainda não há dados. Conecte um canal para começar a receber conversas."** Sem métricas (Fase 2).

- [ ] **Step 1: Escrever o teste e2e que falha**

```ts
// apps/web/e2e/onboarding.spec.ts
import { test, expect } from "@playwright/test";

test("critérios 1–3: cadastro → organização → dashboard", async ({ page }) => {
  const email = `e2e+${Date.now()}@flowai.test`;
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("Ana Souza");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("senha-segura-123");
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Nome da empresa").fill("  Açaí & Cia!!  ");
  await page.getByRole("button", { name: "Criar organização" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Açaí & Cia!!")).toBeVisible();
  await expect(page.getByText("Ainda não há dados. Conecte um canal para começar a receber conversas.")).toBeVisible();

  // voltar ao onboarding não cria outra org
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/dashboard$/);

  // sair e entrar de novo mantém a org
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("senha-segura-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Açaí & Cia!!")).toBeVisible();
});

test("nome vazio mostra erro de validação", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("Ana");
  await page.getByLabel("E-mail").fill(`e2e+${Date.now()}x@flowai.test`);
  await page.getByLabel("Senha").fill("senha-segura-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByLabel("Nome da empresa").fill("   ");
  await page.getByRole("button", { name: "Criar organização" }).click();
  await expect(page.getByText("Informe o nome da empresa.")).toBeVisible();
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run e2e -w apps/web -- onboarding.spec.ts` → FAIL.
- [ ] **Step 3: Implementar onboarding, layout e dashboard.**
- [ ] **Step 4: Rodar a verificação completa da fase**

Run (em sequência):
- `npm test` → PASS
- `npm run typecheck` → sem erros
- `npm run db:reset; npm run db:test` → todos os arquivos pgTAP ok
- `npm run e2e -w apps/web` → todos passed (auth + onboarding)

- [ ] **Step 5: Commit** — `git commit -m "feat(web): onboarding creates organization and lands on dashboard"`
