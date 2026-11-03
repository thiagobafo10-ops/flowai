# Automação para comentários em live do Instagram

- Data: 2026-11-03.
- Status: desenho aprovado pelo usuário em chat (opção A: ampliar o gatilho "Comentário"); aguardando revisão desta spec.
- Base: `master` (MCP de automações + resposta pública já no ar).
- Uso: loja Holy Spirit, API oficial da Meta (Instagram Login, `graph.instagram.com`), sem cookies nem automação de navegador.

## Resultado esperado

Durante uma live, quem comentar qualquer coisa (ou a palavra configurada) recebe **uma DM por live**. Em uma live futura, a mesma pessoa recebe de novo. As automações de post existentes continuam exatamente como estão.

## Fora do escopo

Resposta pública em live (a Meta não permite); "Ambos" no MCP (só no painel); DM diferente por palavra (resolve-se com várias automações, o gatilho já aceita palavras); lembretes após a live; detecção de início/fim de live.

## Regras da Meta assumidas

- Comentários de live chegam no campo de webhook `live_comments`, com o mesmo formato do campo `comments` (`id`, `from {id, username}`, `text`, `media {id, media_product_type: "LIVE"}`) e somente enquanto a live está no ar.
- A resposta privada (`recipient: {comment_id}`) a um comentário de live só é aceita enquanto a live está no ar.
- **Verificação obrigatória (Tarefa 1 do plano):** confirmar na documentação atual da Meta e numa live curta de teste o payload real. Se divergir, o leitor da seção 1 é ajustado antes de qualquer outra tarefa.

## 1. Entrada (Meta → FlowAI)

- `meta-connection` (ação `test`): `subscribed_fields` passa a incluir `live_comments`.
- `packages/core/src/channels/instagram/parse.ts`: `change.field === "live_comments"` é lido com o mesmo `commentSchema` e vira `kind: "comment"` com `mediaProductType: "LIVE"` (forçado, mesmo que o payload não traga `media_product_type`).
- Nada muda na verificação GET/HMAC nem nos limites de taxa do webhook.
- Checklist manual (guia): marcar `live_comments` nos campos do webhook do app no painel da Meta e rodar "Testar conexão" no FlowAI.

## 2. Regra (banco)

- `trigger_config.source` do gatilho `instagram_comment`: `"posts" | "lives" | "both"`; ausente = `"posts"`.
- Esquema (`packages/core/src/automation/schemas.ts`): campo opcional `source`. Com `source = "lives"`, `mediaId` deve ser `null` e `publicReplies` vazio (erro de validação em português caso contrário).
- Nova migração redefine `public.ingest_instagram_event` e `public.reselect_instagram_comment_rule` a partir das versões vigentes (20261017000001 e 20261022000001), mudando somente:
  - **Filtro de origem:** evento com `payload->>'mediaProductType' = 'LIVE'` só casa com `source in ('lives','both')`; os demais só com `source` nulo, `'posts'` ou `'both'`.
  - **Uma vez por live:** na checagem de `oncePerUser`, quando o evento atual é de live, os eventos anteriores só contam se tiverem o mesmo `payload->>'mediaId'`.
- **Sem resposta pública em live:** a função que cria a resposta pública (`private.bind_instagram_comment_public_reply` / gatilho de enfileiramento) ignora eventos `LIVE`.
- Envio da DM: mesmo caminho do comentário de post. Recusa da Meta depois do fim da live → evento termina como falha permanente com o código de erro existente; sem retentativa extra.
- `save_automation` e `save_mcp_automation` aceitam o novo campo sem outras mudanças (validação no esquema Zod).

## 3. Painel e Claude

- `trigger-form.tsx` (gatilho Comentário): seletor "Onde: Posts / Lives / Ambos" (padrão Posts). Com "Lives": esconde o seletor de post e o campo de respostas públicas e mostra o aviso "Só envia enquanto a live estiver no ar." Com "Ambos": respostas públicas valem só para posts (texto de ajuda).
- `mappings.ts`, `node-summary.ts`, `node-labels.ts`: rótulo "Comentário na live" (lives) e "Comentário em post ou live" (ambos).
- MCP (`automation-spec.ts`): `gatilho: "live"` → `instagram_comment` com `source: "lives"`, `mediaId: null`, sem `publicReplies` (erro se `post` ou `respostaPublica` forem informados). Descrição da ferramenta `criar_automacao` atualizada. `listar_automacoes` mostra `gatilho: "live"`. A regra do botão de abertura vale igual (é resposta privada).

## 4. Testes e definição de concluído

Nenhum teste chama a Meta.
- core: `parse` com payload `live_comments` (vira comentário LIVE); esquema (`source`, regras de lives); `automation-spec` (`gatilho: "live"`).
- pgTAP: automação de posts não dispara em comentário LIVE e vice-versa; "ambos" dispara nos dois; uma vez por live (mesma live bloqueia, outra live libera); comentário LIVE não gera resposta pública; automações sem `source` continuam iguais.
- Edge: `meta-connection` assina `live_comments`.
- web: formulário (seletor, campos escondidos, aviso); MCP cria automação de live.
- Concluído quando todas as suítes passam, o guia `docs/superpowers/mcp-setup.md` tem o passo do painel da Meta e o roteiro do teste real (live curta → comentar → DM recebida → comentar de novo → nenhuma DM nova).
