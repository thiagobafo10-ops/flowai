# Configurar a IA no FlowAI

A IA responde conversas (Simulador e Instagram) usando a base de conhecimento da organização. Ela roda só em Edge Functions (`ai-worker` e `ai-playground`). A chave da OpenAI **nunca** vai para `apps/web`, para variáveis `NEXT_PUBLIC_*` nem para o repositório.

## Chave e modelos

| Variável | Padrão | Uso |
|---|---|---|
| `OPENAI_API_KEY` | (sem padrão) | Chave da OpenAI. Obrigatória para a IA responder. |
| `AI_CHAT_MODEL` | `gpt-4.1-mini` | Modelo de classificação e resposta. O padrão ainda precisa ser validado com uma chave real. |
| `AI_EMBEDDING_MODEL` | `text-embedding-3-small` | Modelo de embeddings (1536 dimensões; a tabela da base espera esse tamanho). |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | URL base da API; útil para proxy ou para o stub local dos testes. |

### Local

Crie `supabase/functions/.env` (`.env` já está no `.gitignore`; confira antes de commitar):

```dotenv
OPENAI_API_KEY=sk-...
# opcionais
# AI_CHAT_MODEL=gpt-4.1-mini
# AI_EMBEDDING_MODEL=text-embedding-3-small
```

Depois sirva as funções:

```bash
npx supabase functions serve --env-file supabase/functions/.env
```

### Produção

```bash
npx supabase secrets set OPENAI_API_KEY=sk-...
npx supabase secrets set AI_CHAT_MODEL=gpt-4.1-mini   # opcional
npx supabase functions deploy ai-worker ai-playground
```

Nunca coloque a chave em arquivo versionado, em log ou em mensagem de commit.

## Agendamento do worker

O `pg_cron` chama `public.dispatch_ai_worker()` a cada 5 segundos (job `flowai-ai-worker`). Para ele conseguir chamar a Edge Function, o operador configura, uma vez, pelo backend privilegiado:

```sql
select public.configure_ai_worker(
  'https://<projeto>.supabase.co',   -- base_url acessível pelo banco
  '<service_role_jwt>',              -- chave legada JWT do projeto (>= 20 caracteres)
  '<segredo-aleatorio>'              -- >= 32 caracteres
);
```

Localmente a URL é `http://supabase_kong_flowai:8000`. Os dois segredos ficam no Vault; a configuração fica no schema `private`. Sem essa configuração, o cron não faz chamadas externas. Chamar a função de novo substitui os segredos e a URL.

## Limites diários

Padrão: 300 respostas e 30 testes (Playground) por organização por dia; o dia é calculado no fuso `organizations.timezone`. Para mudar (pelo SQL do backend privilegiado):

```sql
-- limite global (linha única)
update private.ai_settings set daily_replies = 500, daily_tests = 50;

-- limite de uma organização (null = usar o global)
insert into private.ai_limit_overrides (organization_id, daily_replies, daily_tests)
values ('<uuid-da-organizacao>', 1000, 100)
on conflict (organization_id) do update
  set daily_replies = excluded.daily_replies, daily_tests = excluded.daily_tests;

-- voltar ao padrão global
delete from private.ai_limit_overrides where organization_id = '<uuid-da-organizacao>';
```

Valor `0` bloqueia: a IA transfere para um atendente com o motivo "Limite diário da IA atingido". O uso do dia aparece em `public.ai_usage_daily`.

## Sem chave ou com chave inválida

- **Chave ausente** (`not_configured`): a IA não responde; a conversa é transferida para um atendente com o motivo "IA não configurada na plataforma". A página /ia mostra o mesmo aviso de status, e o Playground informa que a IA não está configurada, sem consumir testes.
- **Chave inválida ou recusada pela OpenAI** (resposta não-OK, código `rejected`): o erro não é repetível (só `rate_limited`, `unavailable` e `invalid_response` têm nova tentativa), então a tarefa desiste logo e a conversa vai para um atendente com "Falha temporária da IA". O motivo exibido é genérico; para diagnosticar, procure nos logs do `ai-worker` o evento `provider_error` com `"code":"rejected"` (os logs não trazem texto de mensagens).
- **Falhas temporárias da OpenAI** (limite de taxa, indisponibilidade, resposta inválida): até 3 tentativas (esperas de 10 s e 30 s); depois a conversa é transferida com "Falha temporária da IA".
- **Indexação de documentos sem chave:** o documento termina com status "Erro" e a mensagem "IA não configurada na plataforma". Depois de configurar a chave, use **Reprocessar** no documento. A lista de documentos também avisa que eles serão indexados quando a chave for configurada.

## Verificar sem chave real

```bash
npm run test:ai:e2e
```

Sobe um stub local da OpenAI (`OPENAI_BASE_URL` apontando para ele), pausa e restaura o cron local, e roda a suíte `ai.spec.ts` contra o Supabase local. Nenhum teste chama a OpenAI real.

## Validação ao vivo pendente

Com uma chave real ainda é preciso validar: `gpt-4.1-mini` como padrão (qualidade, custo e JSON estruturado), embeddings reais com o limiar de similaridade 0,3 e o comportamento da classificação a cada lote de mensagens. Veja [fase-6-pendencias.md](fase-6-pendencias.md).
