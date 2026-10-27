# Conectar o Claude às automações do FlowAI (MCP)

O FlowAI expõe um servidor MCP remoto em `/mcp`. Pelo conector, o Claude cria, edita, pausa, ativa, exclui e acompanha as automações de DM do Instagram da organização — usando as mesmas funções, RLS e permissões do painel. As automações criadas por ele são automações normais do FlowAI: aparecem na lista com o selo **Criada pelo Claude**, rodam no motor existente e podem ser abertas no painel.

- **Endereço de produção:** `https://flowai-web-rust.vercel.app/mcp`
- **Autenticação:** OAuth 2.1 do Supabase Auth (JWT do próprio usuário). A chave de serviço não existe em `apps/web`.
- **Quem pode usar:** owner/admin criam, editam, pausam, ativam e excluem. Agentes e visualizadores podem listar automações, ver resultados e listar contatos; `listar_posts` exige owner/admin (a ação `list_media` da Edge verifica o papel).
- **Canal:** o primeiro canal Instagram ativo da organização. Sem canal ativo, as ferramentas de criação de comentário/story respondem "Nenhuma conta do Instagram conectada".
- **Escopo desta entrega:** Instagram, uma conta por organização. WhatsApp, mídia e App Review da Meta estão fora.

## 1. Cadastrar o conector no Claude

No Claude (web, desktop ou celular):

1. Abra **Configurações → Conectores** (em times, o administrador pode precisar habilitar conectores personalizados).
2. Escolha **Adicionar conector personalizado**.
3. Nome: `FlowAI`.
4. URL: `https://flowai-web-rust.vercel.app/mcp`.
5. Clique em **Conectar** / **Sign in now**. O Claude abre o navegador no consentimento do FlowAI.

Na tela **Autorizar acesso**, entre com a conta FlowAI (se ainda não estiver logado, o login retorna ao consentimento), confira o nome do cliente — o registro dinâmico publica a identidade do Claude — e clique em **Permitir**. Se recusar, o conector não recebe token.

O token fica no Claude e é renovado pelo fluxo OAuth. Para revogar, remova o conector no Claude; a sessão OAuth também pode ser encerrada no painel do Supabase (Authentication → Sessions/Users).

### Ferramentas disponíveis

| Ferramenta | Para quê |
|---|---|
| `listar_posts` | Ver os posts/Reels recentes da conta e obter ids para o gatilho de comentário. |
| `listar_automacoes` | Listar automações, status, gatilho, palavras, post, se foram criadas pelo Claude e disparos de 7 dias. |
| `criar_automacao` | Criar no formato simples (comentário, DM ou story) e, por padrão, já ativar. |
| `editar_automacao` | Alterar campos de uma automação criada pelo Claude; `dm`/`followUp` são substituídos inteiros. |
| `pausar_automacao` / `ativar_automacao` | Desligar ou religar sem excluir. |
| `excluir_automacao` | Excluir definitivamente (exige `confirmar: true`). |
| `ver_resultados` | Disparos, DMs enviadas, respostas públicas, cliques por botão e contatos únicos (padrão 7 dias, máx. 90). |
| `listar_contatos` | Contatos que receberam automações, com busca e filtro por automação. |

Exemplos de pedido:

- "Liste meus posts e crie uma automação para quem comentar `QUERO` no post X: responda publicamente `Te mandei no direct!` e envie uma DM com um botão para `https://minhaloja.com/promo`."
- "Na automação Promo, troque a palavra para `EU QUERO` e adicione um follow-up de 2 horas."
- "Como está a automação Promo nos últimos 30 dias? Quantos clicaram no botão?"
- "Pause a automação Promo."

## 2. Configurar o Supabase (produção)

### 2.1 Servidor OAuth e URL do site

No painel do projeto Supabase (o mesmo de `NEXT_PUBLIC_SUPABASE_URL`):

1. **Authentication → URL Configuration**: em produção, Site URL `https://flowai-web-rust.vercel.app`. O Supabase tem uma única Site URL; `http://localhost:3000` serve apenas ao ambiente local — se precisar testar o consentimento localmente, adicione `http://localhost:3000/**` às Redirect URLs permitidas e restaure a URL de produção depois.
2. **Authentication → OAuth Server** (o nome pode aparecer como *Authorization Server*):
   - habilitar o servidor OAuth;
   - **Authorization Path**: `/oauth/consent`;
   - habilitar **Dynamic Client Registration** (o Claude se registra sozinho).
3. Confirme que a API de autorização responde em `https://<ref>.supabase.co/auth/v1` — é o valor publicado em `/.well-known/oauth-protected-resource`.

Localmente, `supabase/config.toml` já traz:

```toml
[auth.oauth_server]
enabled = true
authorization_url_path = "/oauth/consent"
allow_dynamic_registration = true
```

Configuração equivalente no painel é obrigatória em produção: `config.toml` não é aplicado pelo `db push`.

### 2.2 Verificar os metadados protegidos

Com o site publicado:

```bash
curl -s https://flowai-web-rust.vercel.app/.well-known/oauth-protected-resource
curl -s https://flowai-web-rust.vercel.app/.well-known/oauth-protected-resource/mcp
```

Os dois devem devolver `resource` terminando em `/mcp`, `authorization_servers` com a URL do Auth do projeto e `bearer_methods_supported: ["header"]`.

### 2.3 Migrations e Edge Functions

As migrations desta entrega são:

- `20261027000001_mcp_automations.sql` — `mcp_spec`, `save_mcp_automation`, "uma vez por contato" em DM/story.
- `20261027000002_tracked_links_results.sql` — links `/r/<código>`, cliques, `automation_results`, `mcp_contacts`.
- `20261027000003_meta_token_refresh.sql` — colunas de expiração/renovação, RPCs de serviço, cron diário e `ops_health` com o estado do token.

**Ordem de deploy: worker → migration → push.** Funções antigas primeiro (compatíveis com o schema atual), depois o banco, depois a função nova e o site:

```bash
# 1. Workers existentes (o meta-connection passa a assinar messaging_postbacks)
npx supabase functions deploy meta-connection meta-webhook send-message instagram-worker automation-worker
# sem Docker local, acrescente --use-api ao comando acima

# 2. Banco
npx supabase db push

# 3. Função nova (depende das RPCs/colunas da migration) e site
npx supabase functions deploy meta-token-refresh
# publique o commit na master; o Vercel gera o deployment de produção
```

Por que essa ordem: `meta-token-refresh` chama `meta_token_refresh_candidates`, `record_meta_token_refresh` e lê `channels.access_token_expires_at`; se for publicada antes da migration, o cron diário falha até o banco ser atualizado. As demais funções não dependem do schema novo e podem ir antes.

### 2.4 Cron e renovação do token

A migration `20261027000003` cria o job `flowai-meta-token-refresh` (diário às 06:00 UTC) usando a mesma configuração e o mesmo segredo interno dos workers (`private.automation_worker_config` / `configure_automation_worker`). Não há secret novo.

```sql
select jobname, schedule, active from cron.job where jobname = 'flowai-meta-token-refresh';
```

O job chama `dispatch_meta_token_refresh`, que faz `net.http_post` para `https://<projeto>.supabase.co/functions/v1/meta-token-refresh` com o JWT de serviço e o header `X-FlowAI-Worker`.

A função renova apenas canais Instagram ativos com token expirando em menos de 15 dias (ou expiração desconhecida) e token com mais de 24 h — a Meta recusa renovar um token novo. O token novo é gravado no **mesmo segredo do Vault**; `credential_generation` não muda, então reservas e envios em andamento continuam válidos. Falhas viram `last_error = token_refresh_failed` (ou `invalid_token`) e aparecem como código no cartão do canal em **Configurações → Saúde**. A data de expiração ainda não é exibida na tela; consulte no SQL editor:

```sql
select name, access_token_expires_at, access_token_refreshed_at
from public.channels where type = 'instagram';
```

Nenhum log contém o token.

## 3. Checklist do painel Meta

1. App com **Instagram Login** e conta profissional (empresa ou criador).
2. Permissões: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`.
3. **Token longo** (60 dias): troque o token de curta duração antes de salvar no FlowAI:

   ```bash
   curl -s "https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=<APP_SECRET>&access_token=<TOKEN_CURTO>"
   ```

   Cole o `access_token` devolvido em **Configurações → Canais → Instagram**. A renovação automática cuida dos próximos 60 dias.
4. **Webhook**: em **Configurações → Canais**, copie a URL mostrada — ela inclui o id da conexão: `https://<ref>.supabase.co/functions/v1/meta-webhook/<id da conexão>`. Copie também o **verify token** (botão "Mostrar verify token"). No app Meta, cadastre exatamente essa URL e o mesmo verify token; sem o id no final, o webhook responde 404.
5. Assine os campos `messages`, `comments`, `messaging_seen` e `messaging_postbacks`. A assinatura HMAC (`X-Hub-Signature-256`) já cobre todos eles.
6. Use **Testar conexão Instagram** e confirme o canal como **Ativo**. A verificação GET sozinha não ativa o canal.
7. Em **Configurações → Saúde**, confirme o canal e a conexão com `last_error` vazio. Falhas de renovação aparecem como `token_refresh_failed`/`invalid_token`; para a data de expiração, use a consulta SQL da seção 2.4.

Mais detalhes de conta, credenciais e webhook: [instagram-setup.md](instagram-setup.md).

## 4. Variáveis de ambiente

Nenhuma variável nova no Vercel. O MCP usa apenas:

| Onde | Variável | Uso |
|---|---|---|
| Vercel / `apps/web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL` | Auth OAuth, RLS e RPCs; também a origem dos metadados protegidos. |
| Vercel / `apps/web/.env.local` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente do usuário no `/mcp` e no `/r/<código>` (anon). |
| Edge Functions | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Fornecidas pela plataforma; usadas só no backend. |

As Edge Functions não recebem token do Instagram por secret: ele fica no Vault, referenciado pelo canal. **Nunca** coloque a service role key em `apps/web` nem em `NEXT_PUBLIC_*`.

O endereço usado nos links rastreáveis fica em `private.tracked_link_settings.base_url` (padrão `https://flowai-web-rust.vercel.app`). Se o site mudar de domínio:

```sql
update private.tracked_link_settings set base_url = 'https://novo-dominio' where singleton;
```

A mudança vale para **novos** botões: a URL `/r/<código>` é gravada no momento do envio, então links já enviados continuam apontando para o domínio antigo (que precisa continuar servindo a rota). `null` desliga o rastreio e mantém a URL original nos botões novos.

## 5. Roteiro do teste real

Pré-requisitos: canal Instagram **ativo**, webhook verificado, conector FlowAI autorizado, um post/Reel publicado e uma conta **owner/admin** (o `listar_posts` e as ferramentas de escrita exigem esse papel).

1. No Claude, peça: *"Liste meus posts."* Confirme que `listar_posts` devolve os posts recentes com id, legenda (até 300 caracteres) e link.
2. Peça uma automação de teste no comentário de um post/Reel de teste: palavra `TESTEMCP`, resposta pública `Te mandei no direct!`, DM com texto e um botão para uma URL `https://` sua, e follow-up de `2min`.
3. Confira o resumo: nome, gatilho `comentario`, palavra, post, DM e follow-up, e o aviso se outra automação ativa usa o mesmo gatilho/palavra/post. A automação deve ficar **ativa** e aparecer no painel com o selo **Criada pelo Claude**.
4. Com **outra conta** (ou a mesma, se a Meta permitir), comente `TESTEMCP` no post escolhido.
5. Em até cerca de 1 minuto (o worker do Instagram roda a cada minuto): resposta pública no comentário + DM com o botão de abertura (quando há follow-up). Toque no botão.
6. Chega a DM com o botão de link. Toque nele: o navegador abre `https://flowai-web-rust.vercel.app/r/<12 caracteres>` e redireciona (302) para a URL de destino. Um código inexistente ou malformado mostra **Link inválido** (404).
7. Depois de `2min`, chega o follow-up.
8. No Claude, peça: *"Ver resultados da automação de teste nos últimos 7 dias."* Confira disparos, DMs enviadas, resposta pública, cliques (por botão: caminho e link) e contatos únicos. No painel, as colunas **Cliques (7 dias)** e **Contatos (7 dias)** devem bater.
9. Teste também: *"Pause a automação de teste"*, um comentário novo não deve disparar, *"Ative de novo"*, e por fim *"Exclua a automação de teste"* (o Claude deve pedir confirmação).

### Se algo falhar

| Sintoma | Causa provável | O que conferir |
|---|---|---|
| Claude não conecta / 401 | OAuth desligado, registro dinâmico desligado ou Site URL errada | Painel Supabase (OAuth Server + URL Configuration); `/.well-known/oauth-protected-resource`. |
| "Nenhuma conta do Instagram conectada" | Canal ausente ou inativo | Configurações → Canais; teste de conexão e webhook. |
| "Só administradores ou donos…" | Usuário agent/viewer | Use uma conta owner/admin. |
| "Esta automação foi alterada no painel…" | `mcp_spec_stale` ligado | Confirme com o usuário e repita com `confirmarSobrescrever: true`. |
| "O post … não está na conta" | Post saiu dos 50 mais recentes ou é de outra conta | Use `listar_posts` e um id da lista, ou `post: "qualquer"`. |
| Comentário não dispara | Automação pausada, palavra diferente, post errado, fora da janela de 7 dias ou permissão da Meta | Painel Meta (comentários/Advanced Access), status da automação e aba Execuções. |
| Link `/r/...` dá 404 | Código desconhecido/malformado, ou `base_url` aponta para um domínio sem a rota | Confira a tabela `tracked_links`, o singleton e se o domínio publicado serve `/r/[code]`. |
| Token expirou / saúde com `token_refresh_failed` | Função ou cron não publicados, `private.automation_worker_config` não configurado (o job sai sem chamar nada) ou token com menos de 24 h (não é falha, só não é candidato) | Logs de `meta-token-refresh`, `cron.job`, `net._http_response` e `select * from private.automation_worker_config;`; reconecte com um token longo se necessário. |

## 6. Limites conhecidos

- `listar_posts` enxerga somente os **50 posts mais recentes** da conta.
- `ver_resultados` aceita no máximo **90 dias**; o padrão é 7 dias.
- A edição pelo Claude só vale para automações criadas por ele; as do painel podem ser pausadas, ativadas, excluídas e consultadas.
- Se o painel salvar uma automação criada pelo Claude, a próxima edição pelo Claude exige `confirmarSobrescrever: true`.
- O link `/r/<código>` registra no máximo 30 cliques por minuto por link e redireciona mesmo acima disso, sem registrar. Não há limite por IP nesta entrega (sem helper público reutilizável; um teto por IP bloquearia NAT).
- Follow-ups longos dependem da janela de 24 h do Direct: se o contato não interagir antes de ela fechar, o passo é pulado (`window_closed`) e não é reenviado. No gatilho de comentário com follow-up, a DM com os links e o próprio follow-up só seguem depois que o contato toca no botão de abertura.
- Não há sessão MCP: `GET`/`DELETE` autenticam e respondem `405`; o conector usa `POST` com respostas JSON.

## 7. Verificação automatizada desta entrega

Execução local em 2026-10-27 (branch `feat/mcp-automacoes`, commit de documentação):

| Suíte | Comando | Resultado |
|---|---|---|
| Core | `npm test` (workspace core) | 454 testes / 37 arquivos, todos passando |
| Web | `npm test` (workspace web) | 348 testes / 50 arquivos, todos passando |
| Scripts | `npm run test:scripts` | 17 testes, todos passando |
| Edge (Deno 2) | `npm run test:edge` | 244 testes, 0 falhas |
| Tipos | `npm run typecheck` | ok |
| Lint | `npm run lint -w apps/web` | 0 erros (3 avisos pré-existentes) |
| Build | `npm run build -w apps/web` | ok (`/mcp` e `/r/[code]` dinâmicos) |

Total: **1063 testes automatizados** executados sem falha.

**Pendente por ambiente:** pgTAP (`npm run db:test`), e2e de navegador e `npm run db:types` exigem o Supabase local/Docker, que não estava rodando nesta máquina (`DbConnectError`, `ECONNREFUSED 127.0.0.1:54322`). Rode, com Docker ativo:

```bash
npm run db:start
npm run db:reset
npm run db:test
npm run db:types
FLOWAI_E2E_SLOW_HOST=1 npm run e2e -w apps/web
```

A validação ao vivo com Meta e Claude (seção 5) continua pendente de uma conta real e do conector autorizado.
