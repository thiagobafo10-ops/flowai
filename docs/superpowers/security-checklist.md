# Checklist de Auditoria e Hardening de Segurança do MVP — FlowAI

- **Data da Auditoria:** 17 de Outubro de 2026
- **Escopo:** Monorepo FlowAI (`apps/web`, `packages/core`, `supabase`)
- **Status:** Aprovado para Entrada em Produção (Piloto)

---

## 1. Isolamento Multi-Tenant e Camada de Dados (PostgreSQL / Supabase)

- [x] **Row-Level Security (RLS) Mandatório:**
  - Todas as tabelas públicas do schema `public` possuem RLS habilitado explicitamente (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY; ALTER TABLE ... FORCE ROW LEVEL SECURITY;`).
  - Nenhuma política permite acesso ao role `anon` para tabelas de domínio ou dados de clientes.
  - O role `authenticated` só visualiza e altera linhas onde `organization_id` coincide com uma organização na qual o usuário possui membership ativa (`is_member(organization_id)`).
- [x] **Chave Estrangeira Composta e Integridade Referencial:**
  - Tabelas dependentes de relacionamentos secundários (ex: mensagens, conversas, tags, estágios, deals, nós de automação) utilizam foreign keys compostas incluindo `organization_id` para impedir associações cruzadas entre tenants.
- [x] **Funções `SECURITY DEFINER` Seguras:**
  - Todas as funções com privilégios de definer definem explicitamente `SET search_path = public, pg_temp` para neutralizar ataques de manipulação de search path.
  - Inserções em `audit_logs` e `events` são executadas exclusivamente por código de serviço/definer; a API e usuários autenticados não possuem permissão direta de escrita nessas tabelas.
- [x] **Privilégios por Coluna:**
  - A tabela `public.channels` protege identificadores de credenciais com restrição de privilégios de coluna; a chave anon e usuários autenticados não conseguem ler IDs de segredos.

---

## 2. Gestão de Segredos e Credenciais

- [x] **Supabase Vault:**
  - Tokens de acesso, chaves de webhook e segredos de aplicativos (Meta / Instagram) são armazenados de forma criptografada no Supabase Vault (`vault.secrets`).
  - A exclusão de uma conexão ou canal aciona trigger que remove o segredo correspondente do Vault.
- [x] **Chaves de API de Terceiros (OpenAI):**
  - A variável `OPENAI_API_KEY` reside exclusivamente nas variáveis de ambiente das Edge Functions (`ai-worker`, `ai-playground`) e proxies seguros de backend.
  - Nenhuma chave de IA é exposta em variáveis `NEXT_PUBLIC_*`, cookies de cliente ou tabelas acessíveis por frontend.
- [x] **Isolamento de Service Role:**
  - A chave de `service_role` nunca é embutida ou importada dentro do bundle client ou server de `apps/web`.

---

## 3. Segurança no Webhook e Proteção Contra SSRF

- [x] **Validação Criptográfica de Assinatura:**
  - O endpoint de webhook do Instagram/Meta (`meta-webhook`) valida o cabeçalho `X-Hub-Signature-256` utilizando HMAC-SHA256 comparado em tempo constante contra o App Secret bruto antes de processar qualquer JSON.
  - Payloads adulterados são rejeitados com `401 Unauthorized`.
- [x] **Tamanho Máximo de Requisição:**
  - Limite estrito de 1 MiB para o corpo das requisições inbound de webhook.
- [x] **Prevenção de SSRF em Webhooks de Saída (Automação):**
  - Nós de webhook de saída em automações exigem protocolo HTTPS estrito.
  - Resolução de DNS prévia e checagem de IP: faixas privadas (RFC 1918), loopback (`127.0.0.0/8`), link-local (`169.254.0.0/16`) e endereços especiais IPv6 são expressamente bloqueados.
  - Limite de resposta de 64 KB e timeout máximo de 10 segundos, sem seguir redirecionamentos cegos.

---

## 4. Proteção de Transporte, HTTP Headers e Navegador

- [x] **Content-Security-Policy (CSP):**
  - Implementado em `apps/web/src/lib/security/headers.ts` e injetado em `next.config.ts`.
  - Diretiva `default-src 'self'`.
  - Diretivas `connect-src` restritas a `'self'`, endpoints locais e remotos do Supabase, OpenAI, Graph API Meta e websocket do Vercel Live Reload em modo desenvolvimento.
- [x] **Transporte Seguro (HSTS):**
  - Cabeçalho `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` ativo para forçar conexões HTTPS.
- [x] **Prevenção de Clickjacking:**
  - Cabeçalho `X-Frame-Options: DENY` e CSP `frame-ancestors 'none'`.
- [x] **Prevenção de Sniffing de Tipo MIME:**
  - Cabeçalho `X-Content-Type-Options: nosniff`.
- [x] **Proteção de Privacidade de Referência:**
  - Cabeçalho `Referrer-Policy: strict-origin-when-cross-origin`.
- [x] **Política de Permissões (Permissions-Policy):**
  - Recursos não utilizados bloqueados (`camera=(), microphone=(), geolocation=()`).

---

## 5. Salvaguardas de IA e Prevenção de Prompt Injection

- [x] **Sanitização de Entradas de Contatos:**
  - Caracteres de controle e delimitadores artificiais XML/Markdown injetados em mensagens de contato são neutralizados antes da interpolação no prompt do agente.
- [x] **Isolamento de Contexto do RAG:**
  - Trechos de documentos indexados são passados dentro de tags estruturadas de contexto (`<context>`), com instruções de sistema protegidas por regras de desconsideração de instruções vindas do usuário.
- [x] **Handoff Automático em Baixa Confiança:**
  - Se a base de conhecimento não contiver respostas satisfatórias ou se o contato expressar descontentamento, o fluxo aciona fallback seguro transferindo a conversa para o atendente humano (`pending_human`).

---

## 6. Rate Limiting e Prevenção de Abuso

- [x] **Controle de Janela Deslizante:**
  - Tabela `public.rate_limits` rastreia tentativas com janela de tempo e expiração automática.
- [x] **Proteção em Autenticação (Signup e Login):**
  - Função segura `check_auth_rate_limit` isola os limites de tentativas por IP e ação.
- [x] **Controle de Ingestão de Webhook:**
  - Rate limit por IP antes de verificação criptográfica e taxa máxima de 3.000 requisições por minuto por canal conectado.

---

## 7. Conformidade e Conclusão

Todas as 7 seções foram auditadas e os testes de conformidade correspondentes foram aprovados sem apontamentos impeditivos. A arquitetura atende integralmente aos requisitos de segurança estipulados para a entrada em produção do MVP.
