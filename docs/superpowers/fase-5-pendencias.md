# Fase 5 — Instagram: execução e limites

Branch `codex/fase-5-instagram`; base `aacfe07`. Escopo aprovado em 2026-10-12: somente Instagram; WhatsApp adiado.

## Estado

Implementação concluída nas tarefas 1–9, revisão independente da branch inteira feita e onda final de correções aplicada (itens 0–15 abaixo). Configuração manual, Direct, contextos de stories, regras de comentário, worker e Vault estão implementados. [Guia de configuração](instagram-setup.md).

## Limites

- Validação ao vivo depende de app Meta e conta profissional; nenhum envio real foi realizado nesta execução.
- Confirmação remota de leitura pendente por inconsistência da documentação oficial; não há endpoint presumido. Leitura local e `messaging_seen` recebidos funcionam.
- Cada conexão manual usa uma conta/app próprio. OAuth, app compartilhado, WhatsApp, mídia enviada, anexos, IA e automações genéricas permanecem fora desta etapa.
- Texto: 1.000 bytes UTF-8; janela comum de 24h; private reply único em até sete dias. Restrições e permissões da Meta prevalecem.

## Decisões de execução

- Execução na checkout existente em nova branch, seguindo a escolha de implementação nesta sessão. Não há segunda checkout isolada.
- Bookkeeping em PowerShell no Windows, mantendo brief, base, ledger e logs equivalentes aos scripts Bash. O custo é reprodução manual dessas operações.
- Nenhuma chamada remota de `mark_seen` presumida; custo: confirmação remota de leitura temporariamente indisponível.
- Verificações remotas levam a geração das credenciais ao SQL, impedindo reativação por resultado antigo; handlers precisam informar essa geração.
- Status do simulador conserva seus callers; um trigger impede mudanças diretas de estado do Instagram. Novos providers deverão ter controle equivalente.
- Completion exige claim token; tentativas antigas não completam uma tentativa nova. Todos os handlers carregam o token.
- Desconexão e retry receberam migrations próprias antes do worker; sua migration passou de 003 para 004 e depois 005. O custo é divergência dos nomes originais do plano, preservando a ordem e a imutabilidade.
- O compositor mantém request ID estável e limpa rascunhos já representados no histórico, inclusive falha/resultado incerto. Retry explícito usa a mensagem existente; o texto rejeitado permanece no histórico.
- O worker consulta a criação real do comentário e a propriedade da mídia, não a hora de entrega do webhook. Custo: consultas adicionais antes de enviar.
- Configuração global do worker fica em schema privado, mantendo o requisito de organization_id nas tabelas públicas; os helpers de serviço preservam sua interface.
- Captura de regras usa o estado no recebimento, porque webhooks podem ter precisão de segundos; a elegibilidade temporal real é conferida no worker. Desativar post inalterado não depende de token/prova novos; ativação e troca continuam verificadas.

## Revisão final e correções

A revisão independente (1 crítico, 5 importantes, 9 menores) foi tratada na onda final:

- Regressão do e2e padrão: o helper de prontidão esperava só a hidratação; com streaming do React 19 o conteúdo resolvido existe duas vezes no DOM (uma cópia em `<div hidden id="S:n">`) até o reveal, gerando violações de strict mode. Os timeouts 57014 vinham de falta de recursos da VM Docker (host com 8 GB e pouca memória livre; coletor `vector` do analytics em loop de reinício no Docker Desktop/Windows). O helper agora espera os segmentos e o analytics local foi desligado.
- Rate limit: `check_rate_limit` só para servidor; `check_auth_rate_limit` (signup/login) para a API pública. Webhook usa o hop anexado pela plataforma e conta o limite por conexão só após assinatura válida (3000/min).
- Posse de app/conta só para conexões verificadas; claims não verificados expiram em 24h e cedem ao dono verificado; mensagem dedicada de conta já conectada.
- Varredura por minuto de envios do Direct presos (lease vencido → sem confirmação; pendente > 10 min → falha com nova tentativa).
- Worker esvazia a fila em lotes de 3 simultâneos por até ~100 s; cron não chama o worker com fila vazia.
- Janela de 24h visível no Inbox (composer só com nota interna fora da janela).
- Canais Instagram só criados/removidos por serviço; remoção apaga segredos do Vault.
- Menores: nome do perfil best-effort, seleção de regra por vigência com fallback no worker, remoção do matcher TS morto, expurgo de payloads ao excluir contato, último resultado por regra, texto do último erro, `readLimitedBody` no meta-connection, `hub.challenge` ≤ 256 + `nosniff`, colunas reservadas documentadas.

## Evidências finais (onda de correções, HEAD f88fda5 + docs)

- `npm test`: 127 passando (core 100, web 27). `npm run typecheck` e lint do web sem erros.
- `db:reset` + `db:test`: 35 arquivos, 740 testes passando.
- Edge (Deno 2 local): 53 passando.
- Navegador padrão (`npm run e2e -w apps/web`, build de produção): 64/64 em 6,6 min.
- `npm run test:instagram:e2e` (proxy Graph local, cron pausado e restaurado): 70/70 em 7,5 min; `flowai-instagram-worker` e `flowai-instagram-cleanup` ativos ao final.
- Ambiente: Studio, pg-meta e analytics/vector parados durante a verificação para aliviar a VM Docker.

## Evidências parciais (até a tarefa 8)

- Unitários: 123 passando; Edge: 37 passando; TypeScript e lint passando.
- SQL: 653 passando antes do último caso de desativação; caso focado de mídia 6/6 após a correção. Reset/suíte completos finais pendentes.
- Instagram no navegador: cinco cenários passando, incluindo resposta privada única e token expirado.
- Callback HTTP local: challenge 200, payload assinado 200, duplicado 200 e uma mensagem gravada.
- pg_net: worker autenticado respondeu 200 com fila vazia; cron por minuto e limpeza diária verificados.
- Desktop/celular inspecionados, sem cortes ou sobreposições. Screenshots preservadas no diretório de visualizações desta conversa.

## Pendências após a revisão das correções (2026-10-12)

Revisão independente das correções: todos os itens resolvidos. Ficam como pendências:

- **Segurança (antes de produção):** `check_auth_rate_limit` aceita o limite escolhido por quem chama; fixar limite e janela por tipo no servidor. O app web ainda usa o **primeiro** hop do `X-Forwarded-For` para o IP do login/cadastro (o webhook já usa o hop da plataforma); trocar pelo IP fornecido pela hospedagem. E-mails muito longos (≈135+ caracteres) não entram no rate limit de login (falha aberta); limitar o tamanho do e-mail no schema.
- **Texto:** a mensagem "Esse app Meta já possui uma conexão nesta organização." também aparece quando o conflito é a conta (mesma org, outro app); uma corrida que atinge o índice direto mostra o texto de "outra organização".
- **Limpeza:** claims não verificados que já têm histórico nunca são removidos (não bloqueiam ninguém); eventos de comentário em estado "incerto" mantêm o estado após a exclusão do contato (sem envio).
- **Ambiente local:** o analytics/vector local foi desligado em `supabase/config.toml` para caber em máquinas de 8 GB; a fragilidade de memória do host não é resolvida pelo repositório.
- **Validação ao vivo com a Meta** continua pendente (app e conta profissional reais), incluindo contrato de `subscribed_apps`, `messaging_seen`, `media_product_type` e o bundle de `packages/core` no deploy das Edge Functions.
- **Comentários em anúncios (2026-10-17):** comentários em post impulsionado/anúncio chegam com `media_product_type='AD'` e `media.original_media_id` (a publicação orgânica). O worker de comentários e o VIP agora aceitam `AD` e casam a regra/checam a posse pela mídia original; o parser passou a expor `originalMediaId`/`adId`. A entrega e os campos `ad_id`/`original_media_id` reais ainda dependem de validação ao vivo com a Meta.
