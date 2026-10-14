# Configurar as automações no FlowAI (produção)

As automações rodam no banco (disparo, fila, versões) e na Edge Function `automation-worker`, que executa os passos (mensagens, IA, webhooks, esperas). O `pg_cron` chama o worker a cada 5 segundos, **só quando há execuções vencidas**. Sem a configuração abaixo nenhuma automação avança: as execuções ficam `pending` para sempre.

## 1. Publicar a função

```bash
npx supabase functions deploy automation-worker
```

O `supabase/config.toml` já declara `verify_jwt = true` para ela: o gateway exige o JWT de serviço que o cron envia.

## 2. Secrets da função

O worker lê do ambiente da Edge Function:

| Variável | Obrigatória | Uso |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | sim (já fornecidas pela plataforma) | RPCs do worker no banco. |
| `OPENAI_API_KEY` | só para blocos "Mensagem com IA" | Mesma chave da Fase 6 ([ai-setup.md](ai-setup.md)). Sem ela, o bloco de IA segue a saída "Transferiu" sem chamar a OpenAI. |
| `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`, `OPENAI_BASE_URL` | não | Mesmos padrões da Fase 6. |

```bash
npx supabase secrets set OPENAI_API_KEY=sk-...   # se ainda não existir para ai-worker
```

O envio pelo Instagram usa as credenciais das conexões Meta já guardadas no Vault (Fase 5); não há secret extra.

## 3. Configurar o despacho (uma vez)

Pelo backend privilegiado (SQL editor do projeto ou `psql` com `postgres`):

```sql
select public.configure_automation_worker(
  'https://<projeto>.supabase.co',   -- base_url acessível pelo banco (sem barra no fim)
  '<service_role_jwt>',              -- chave legada JWT do projeto (>= 20 caracteres)
  '<segredo-aleatorio>'              -- >= 32 caracteres; o worker o confere em tempo constante
);
```

- Os dois segredos ficam no Vault (`flowai-automation-worker-service`, `flowai-automation-worker-secret`); a configuração fica em `private.automation_worker_config`.
- Use a chave legada JWT (`service_role`), não uma publishable key nem uma `sb_secret_...`: o gateway verifica JWT.
- Localmente a URL é `http://supabase_kong_flowai:8000`.
- Chamar a função de novo substitui os segredos e a URL.

## 4. Conferir o cron

```sql
select jobname, schedule, active from cron.job order by jobname;
```

Devem aparecer ativos os quatro jobs do produto: `flowai-ai-worker` (5 seconds), `flowai-automation-worker` (5 seconds), `flowai-instagram-cleanup` (diário) e `flowai-instagram-worker` (a cada minuto). Se `flowai-automation-worker` estiver inativo (por exemplo, depois de um teste local interrompido):

```sql
select cron.alter_job((select jobid from cron.job where jobname = 'flowai-automation-worker'), active => true);
```

## 5. Verificar o disparo

1. Crie e ative uma automação de teste (por exemplo, o modelo "Boas-vindas no Direct") e simule uma mensagem pelo Simulador em **Configurações → Canais**.
2. Em até alguns segundos a mensagem da automação aparece no Inbox, e a aba **Execuções** da automação mostra a execução como concluída.
3. Se a execução ficar `pending`:
   - confira a configuração: `select base_url from private.automation_worker_config;` (deve existir uma linha);
   - confira as chamadas do cron: `select status_code, error_msg, created from net._http_response order by created desc limit 5;` (401 = segredo do worker diferente do configurado; 404 = função não publicada ou URL errada);
   - confira os logs da função `automation-worker` no painel (eventos `run_failed`, `claim_lost`, `budget_reached`; os logs nunca trazem texto de mensagens).
4. Execuções que falham ficam `failed` com o código do erro (por exemplo `webhook_blocked_address`, `webhook_http_error`, `max_steps`) visível no histórico; falhas temporárias (`webhook_http_error` 5xx/429, `webhook_timeout`, `db_conflict`) são tentadas de novo até 3 vezes.

## Testes locais sem Meta/OpenAI reais

```bash
npm run test:automation:e2e
```

Sobe Graph e OpenAI falsos, pausa e restaura os crons e a configuração dos workers, e roda os fluxos de automação no navegador contra o Supabase local.
