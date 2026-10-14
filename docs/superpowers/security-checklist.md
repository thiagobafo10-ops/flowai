# Checklist de segurança do MVP — estado verificado localmente

- **Revisão:** 14 de outubro de 2026.
- **Escopo:** código e metadados do Supabase local após migrations adicionais de Analytics.
- **Status:** controles abaixo conferidos; configuração de produção e integrações reais pendentes. Sem aprovação de entrada em produção.

## Banco e isolamento

- [x] RLS habilitado nas 40 tabelas públicas locais. **FORCE RLS não está habilitado** nessas tabelas; proprietários e funções de serviço têm privilégios deliberadamente elevados.
- [x] Nenhuma policy de tabelas públicas concede acesso a `anon` ou `PUBLIC`. As policies de domínio validam membership e papéis; tabelas de filas/serviço têm acesso restrito próprio. RLS não implica acesso irrestrito a todo membro.
- [x] As 117 funções `SECURITY DEFINER` de `public` locais definem **`search_path = ''`**, com nomes qualificados. Não usam `public, pg_temp` como antes afirmado.
- [x] `authenticated` não pode inserir diretamente em `events`/`audit_logs` nem ler `channels.access_token_secret_id`, conforme grants locais. Triggers/funções autorizadas produzem eventos e auditoria.
- [x] Relações de domínio usam chaves compostas com organização quando aplicável; contratos pgTAP de isolamento cobrem relações cruzadas. Isso não significa que toda FK da aplicação é composta.

A consulta local foi somente de metadados (`pg_class`, `pg_proc`, `pg_policies`, `has_*_privilege`), sem ler tokens/Vault e sem reset. A suíte pgTAP da correção de Analytics aprovou 2174 verificações em 51 arquivos; essa evidência não substitui uma auditoria de produção.

## Segredos e integração Meta

- [x] Credenciais Meta e de workers são referenciadas por IDs e armazenadas no Vault; os acessos de serviço e remoção de segredos são implementados no banco. O app web recebe somente URL e chave pública do Supabase.
- [x] OpenAI usa secrets das Edge Functions; a chave não vai em `NEXT_PUBLIC_*`. O gerador de automações faz chamada pelo backend, sem expor a chave ao cliente.
- [x] Webhook Meta valida HMAC-SHA256 do corpo bruto em tempo constante antes do parse; rejeita assinatura inválida e limita corpo a 1 MiB.
- [ ] Segredos, permissões Meta, verificação de conta e entrega real conferidos no ambiente de produção.

## Webhooks de saída e navegador

- [x] Automação exige HTTPS, rejeita IPs internos/especiais após resolução A/AAAA, limita resposta a 64 KB e timeout a 10 s, sem seguir redirects. Resta uma janela de DNS rebinding entre resolução e fetch pela URL original, registrada em [pendências de automação](fase-7a-pendencias.md).
- [x] `headers.ts` produz CSP com `default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'` e `form-action 'self'`. `connect-src` permite a URL configurada do Supabase e seu WebSocket; em desenvolvimento adiciona WebSockets localhost. Não libera origens OpenAI/Graph, cujas chamadas são de servidor.
- [x] CSP ainda permite `'unsafe-inline'` em scripts e estilos; desenvolvimento também permite `'unsafe-eval'`. A política não usa nonce e não garante prevenção integral de injeção.
- [x] X-Frame-Options DENY, nosniff, Referrer-Policy e Permissions-Policy definidos. HSTS (`max-age=63072000; includeSubDomains; preload`) é emitido somente em produção; isso não comprova inscrição em lista preload nem transporte do deploy.
- [ ] Conferência de HTTPS, proxy confiável e headers efetivamente servidos no endereço publicado.

## IA e abuso

- [x] Prompt neutraliza delimitadores `<`/`>` e separa dados em blocos `<knowledge>`, `<contact>` e `<conversation>`, com regras para tratar esses dados como conteúdo. Não há sanitização universal de XML/Markdown ou garantia contra prompt injection; heurísticas e limitações estão em [pendências IA](fase-6-pendencias.md).
- [x] Ausência de conhecimento e decisões de baixa confiança podem transferir para `pending_human`, cobertas por contratos locais com OpenAI falsa. Não é avaliação da qualidade do modelo real.
- [x] Rate limiting aproxima uma janela deslizante com bucket atual + bucket anterior ponderado. Limpeza por chave ocorre a cada chamada; limpeza global de entradas antigas tem probabilidade de 1%, não expiração automática garantida.
- [x] `check_rate_limit` não é executável por `anon`/`authenticated`; `check_auth_rate_limit` expõe somente namespaces `signup`/`login`. São defesa em profundidade; limites Supabase Auth e captcha devem ser configurados na produção.
- [x] Webhook usa limite grosso por IP antes da assinatura e 3000/min **por conexão** após assinatura válida. O IP depende do proxy confiável que sobrescreve headers; configuração de hospedagem continua pendente.
- [ ] Validação ao vivo de custos, cotas e comportamento de OpenAI, medidas antiabuso e rollout.

## Evidência e limites

`npm run test:scripts` aprovou 16 testes de seleção, cancelamento e recuperação do harness; não é suíte Edge. `npm run test:edge` é um comando separado. Os resultados históricos de 199 Edge/13 scripts não são apresentados como nova execução. Build/navegador revisados permanecem pendentes por falta de memória; veja [mapa de aceitação](fase-10-mvp-conclusao.md).
