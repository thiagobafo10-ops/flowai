# Automações do Instagram operadas pelo Claude via MCP (estilo ChatFyre)

- Data: 2026-10-27.
- Status: design aprovado pelo usuário em chat (auditoria, plano em fases, OAuth opção 1, desenho em 5 partes); aguardando revisão desta spec.
- Base: `master` em `12d88d1` (Fases 1–10 + resposta pública ao comentário). Branch `feat/mcp-automacoes`.
- Uso: só a loja do usuário (Holy Spirit), conta própria com acesso padrão da Meta, sem App Review. O FlowAI continua multi-tenant por baixo; nada é removido.

## Resultado esperado

O usuário cria, edita, pausa e acompanha automações de DM do Instagram conversando com o Claude (web, desktop ou celular), que acessa o FlowAI por um conector MCP remoto. As automações criadas pelo Claude são automações normais do FlowAI: aparecem no painel e rodam no motor existente.

## Fora do escopo

Curtir comentário (exige Facebook Login); "siga para receber"; WhatsApp; mídia; multi-conta no MCP; remover o multi-tenant; App Review.

## 1. Arquitetura e autenticação

- **Rota `/mcp`** em `apps/web` (Next 16, route handler `POST`/`GET`/`DELETE`), SDK oficial `@modelcontextprotocol/sdk` (versão exata publicada há ≥ 2 semanas), transporte Streamable HTTP em modo **sem sessão** (um `McpServer` + transporte por requisição, respostas JSON).
- **OAuth 2.1 pelo Supabase Auth** (servidor OAuth do Supabase com registro dinâmico de clientes ligado):
  - `/.well-known/oauth-protected-resource` (e a variante com o caminho `/mcp`) no domínio do app apontando para o servidor de autorização do Supabase (`https://<ref>.supabase.co/auth/v1`).
  - Sem token válido → `401` com `WWW-Authenticate: Bearer resource_metadata="…"`.
  - Tela de consentimento `/oauth/consent` no app: exige login FlowAI, mostra o nome do cliente e "Permitir que o Claude gerencie suas automações do Instagram?", botões "Permitir"/"Recusar". Usa a API de autorização do Supabase (aprovar/negar), sem chave privilegiada.
  - O token recebido é um JWT do usuário no Supabase; o servidor valida (assinatura/expiração via Supabase) e cria o cliente Supabase **com esse token**. Toda ferramenta passa pelas mesmas funções e RLS do painel. A chave de serviço continua fora de `apps/web`.
- **Organização:** a do usuário (se tiver mais de uma, a ativa/primeira em que é admin ou owner; ferramentas de escrita exigem admin/owner, verificado pelo banco). Nenhuma ferramenta recebe `organizationId`.
- **Canal:** o canal Instagram ativo da organização. Sem canal ativo → erro claro "Nenhuma conta do Instagram conectada".
- Limites: corpo ≤ 1 MB; erros sem segredos nem texto de mensagens nos logs.

## 2. Formato simples de automação

Contrato (Zod em `packages/core/src/mcp/automation-spec.ts`):

```
nome: 1–100
gatilho: "comentario" | "dm" | "story"
palavras: 0–20 (palavra inteira, sem acento/maiúsculas); vazio = qualquer mensagem/comentário
post: id do post | "qualquer"            (só comentario; padrão "qualquer")
respostaPublica: 0–10 textos ≤ 300       (só comentario)
dm: { texto ≤ 1000 bytes, botoes: 0–3 [{ titulo ≤ 20, url https }] }
botaoDeAbertura: título ≤ 20             (opcional; ver regra abaixo)
followUp: { depois: 1 min–7 dias (ex.: "2h", "30min", "1d"), texto, botoes } (opcional)
umaVezPorContato: boolean (padrão true)
```

**Conversão** (`specToGraph`, pura e testada) para o grafo normal da 7A:
- `trigger` (instagram_comment | keyword_detected | instagram_story) com palavras, post, `oncePerUser` e `publicReplies`.
- **Regra da Meta:** depois de uma Private Reply só cabe uma mensagem até a pessoa interagir. Quando o gatilho é `comentario` e há `followUp`, a DM inicial é enviada com um botão de caminho (`botaoDeAbertura`, padrão "Quero!") e texto; o toque abre a janela de 24h e então seguem a mensagem com os links (`dm.botoes`) e, após `depois`, o follow-up. Sem `followUp`, os links vão direto na DM. Gatilhos `dm`/`story` já têm janela aberta e não precisam do botão.
- Validação final pelo esquema de grafo existente; erros devolvidos em português para a IA corrigir.

**Persistência:** a automação guarda o formato simples (`automations.mcp_spec jsonb`, nulo para as criadas no painel) e a versão do grafo gerado. Se o grafo for salvo pelo painel depois, `mcp_spec_stale = true`; `editar_automacao` então devolve aviso e só sobrescreve com `confirmarSobrescrever: true`. Automações criadas no painel podem ser pausadas, ativadas, excluídas e consultadas pelo MCP, mas não editadas por ele.

## 3. Ferramentas MCP

Descrições em português, escritas para a IA saber quando usar. Toda ferramenta que altera dados devolve um resumo legível (o que mudou, nome, status, gatilho, palavras, post) e os dados estruturados.

| Ferramenta | Entrada | Saída |
|---|---|---|
| `listar_posts` | `limite` 1–50 (padrão 12) | id, legenda (até 300 car.), tipo, data, link (via ação `list_media` existente) |
| `criar_automacao` | formato simples + `ativar` (padrão true) | resumo + id; ativa se pedido |
| `listar_automacoes` | `status` opcional | nome, status, gatilho, palavras, post, criada pelo Claude?, disparos 7 dias |
| `editar_automacao` | id + campos parciais + `confirmarSobrescrever` | resumo do antes/depois |
| `pausar_automacao` / `ativar_automacao` | id | resumo |
| `excluir_automacao` | id + `confirmar: true` | resumo |
| `ver_resultados` | id opcional, `de`/`ate` (padrão 7 dias, máx. 90) | por automação: disparos, DMs enviadas, respostas públicas, cliques (por botão), contatos únicos |
| `listar_contatos` | `busca`, `automacaoId`, `limite` ≤ 100 | nome, @usuário, última interação, automações que recebeu |

Erros como resultado de ferramenta (`isError`) com mensagem curta e acionável; nunca stack trace.

## 4. Meta

- **Token:** colunas `access_token_expires_at` e `access_token_refreshed_at` no canal. Edge Function `meta-token-refresh` (cron diário via pg_cron + `net.http_post` com segredo interno, padrão dos crons existentes): para cada canal Instagram ativo com expiração desconhecida ou < 15 dias e token com mais de 24 h, chama `GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`, grava o novo token no Vault (mesmo `secret_id`), a nova expiração e incrementa `credential_generation` só se o contrato atual exigir (reservas em andamento continuam válidas). Falha → `last_error = token_refresh_failed` e alerta no painel de saúde; nunca registra o token.
- **Webhook:** o teste de conexão passa a assinar `messages`, `comments`, `messaging_seen` e `messaging_postbacks`.
- Nada muda na verificação GET/HMAC já existente.

## 5. Motor

- **Uma vez por contato** em `keyword_detected` e `instagram_story` (campo `oncePerUser`, mesma semântica do comentário: não dispara de novo para o mesmo contato naquela automação; execuções anteriores de qualquer estado contam, exceto falhas antes do envio).
- **Link rastreável:** ao enviar uma mensagem com botão de link, o worker gera `https://<app>/r/<código>` (código aleatório de 12 caracteres, tabela `tracked_links` com organização, automação, execução, contato, botão, URL de destino). A rota `/r/[code]` chama `public.open_tracked_link(code)` (SECURITY DEFINER, executável por `anon`, só devolve a URL e registra o clique, limite por IP) e redireciona com `302`. Código desconhecido → página "Link inválido". Cliques duplicados contam como cliques; contatos únicos são calculados. **Nota de implementação (Task 8):** o limite por IP não foi adicionado — não há helper público reutilizável (`check_auth_rate_limit` só aceita `signup`/`login` e `check_rate_limit` é exclusivo de `service_role`), e um teto por IP bloquearia audiências atrás de NAT. O SQL já limita o registro a 30 cliques/min por link (`open_tracked_link`), o que limita a inflação de cada link.
- **Resultados:** `public.automation_results(p_from, p_to, p_automation uuid default null)` (membro da organização) agrega execuções, envios, respostas públicas, cliques de botão (caminho e link) e contatos únicos.

## 6. Painel

A lista de automações mostra status, gatilho, "criada pelo Claude" e disparos/cliques/contatos de 7 dias (via `automation_results`). Nenhuma outra tela nova além do consentimento OAuth.

## 7. Testes e definição de concluído

Nenhum teste chama Meta, OpenAI ou hosts reais.
- core: `automation-spec` (limites, durações "2h"/"30min"/"1d", regra do botão de abertura, conversão para grafo válido).
- pgTAP: `oncePerUser` em DM/story; `tracked_links` e `open_tracked_link` (anon só abre, RLS, clique registrado); `automation_results`; `mcp_spec`/`mcp_spec_stale`; colunas de token e função de gravação da renovação (service-only).
- Edge (Deno): `meta-token-refresh` com fetch simulado (renova, ignora token novo, falha → alerta, nunca loga o token).
- web: cada ferramenta MCP chamada por um cliente MCP real do SDK contra a rota (Supabase simulado); 401 com `WWW-Authenticate`; metadados protegidos; consentimento; `/r/[code]`.
- Concluído quando todas as suítes existentes e novas passam, README atualizado e `docs/superpowers/mcp-setup.md` contém: cadastro do conector no Claude, configuração do Supabase (servidor OAuth, registro dinâmico, URL do consentimento), checklist do painel Meta (permissões, webhook, campos assinados, token longo), variáveis de ambiente e o roteiro do teste real (comentar a palavra → resposta pública + DM → tocar o botão → link → follow-up → `ver_resultados`).
