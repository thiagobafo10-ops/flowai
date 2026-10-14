# Fase 7B — Links e QR de entrada, sequências e mensagens em massa

- Data: 2026-10-14.
- Status: design aprovado pelo usuário em seções (2026-10-14); aguardando revisão da spec escrita.
- Base: Fase 7A no `master` (`076a0ad`), roadmap (paridade com ManyChat), spec da 7A.

## Resultado esperado

A empresa cria links e QR codes que abrem o Direct e disparam automações; inscreve contatos em sequências de mensagens espalhadas por dias; e envia campanhas segmentadas com botões que levam a automações, com relatório. Tudo respeita a janela de 24h do Instagram e não trava a conversa.

## Decisões do usuário (2026-10-14)

1. **Os três recursos, respeitando a janela:** sequências e campanhas no Instagram só enviam para quem está na janela de 24h; a tela mostra quantos serão alcançados e quantos ficam de fora. Ficam prontas para o WhatsApp no futuro.
2. **Sequência como recurso próprio em segundo plano:** não segura a conversa; IA e automações continuam funcionando entre os passos.
3. **Campanhas completas:** segmentação combinada, envio imediato ou agendado, botões que iniciam automações, ritmo controlado, cancelamento e relatório.
4. **Arquitetura A:** uma fila única de entregas (`outreach_deliveries`) processada pelo `automation-worker` existente, reaproveitando envios, janela, variáveis e botões assinados da 7A.

## Escopo

**Dentro:** links de entrada (cadastro, link, QR PNG/SVG, contagem, gatilho, tag automática, simulação no Simulador); sequências (editor de passos, janela de horário, inscrição por bloco e pela ficha, saída por palavra/resposta, pausa); campanhas (público, prévia, mensagem com botões, agendamento, ritmo, cancelamento, relatório); fila de entregas e worker.

**Fora:** WhatsApp e modelos aprovados; testes A/B; mídia; segmentos salvos; QR personalizado.

## 1. Links e QR de entrada

- **Cadastro** em `/automacoes/links`: nome (1–100), canal (Instagram ou Simulador), código (gerado com 8 caracteres `[a-z0-9]`, ou definido pelo admin: 3–40 caracteres `[a-z0-9_-]`, único por canal), tag opcional, status `active` | `archived`.
- **Lista:** nome, código, link pronto, usos (total e 7 dias), automação ligada, status; ações "Copiar link", "Baixar QR (PNG)", "Baixar QR (SVG)", "Arquivar". QR gerado no navegador por biblioteca (sem serviço externo).
- **Link do Instagram:** `https://ig.me/m/<usuário da conta>?ref=<código>`. Simulador não tem link público: no Inbox, "Simular abertura por link" escolhe link e contato.
- **Entrada:** o webhook do Instagram passa a reconhecer o evento de referral (sozinho ou junto da primeira mensagem); o código, canal e remetente viram uma entrada: cria a conversa se não existir, nota de sistema "Entrou pelo link {nome}", registro em `entry_link_hits`, tag automática aplicada. Código desconhecido ou arquivado é ignorado; a mensagem que veio junto entra normalmente. Formato exato do referral validado com app real da Meta (pendência).
- **Gatilho de automação `entry_link`** (um ou mais links). Prioridade mais alta entre os gatilhos de entrada. Se a conversa já está num fluxo ativo, não interrompe (o uso é contado).

## 2. Sequências

- **Tela** `/automacoes/sequencias`: lista (nome, status `draft` | `active` | `paused`, passos, inscritos ativos, envios 7 dias) e editor de passos ordenados.
- **Passo:** espera de 1 minuto a 30 dias após o passo anterior (o primeiro conta da inscrição); janela de horário opcional (dias da semana + faixa de horas no fuso da organização; fora dela vai para o próximo horário permitido); mensagem (texto com `{primeiro_nome}`/`{nome}`, até 3 botões — link HTTPS ou "iniciar automação X" — ou até 13 respostas rápidas que iniciam automações; limites do Instagram da 7A: 1000 bytes, título ≤ 20, texto com botões ≤ 640).
- **Configurações:** canais; "sair se o contato responder qualquer mensagem" (padrão desligado); palavras de saída (padrão "sair", "parar", "cancelar", palavra inteira, sem acento/maiúsculas) que removem o contato e registram nota no Inbox.
- **Inscrição:** blocos de automação `sequence_enroll` e `sequence_remove` (ações que não seguram a conversa); ficha do contato com seção "Sequências" ("Inscrever", "Remover", próximo envio previsto). Inscrição duplicada na mesma sequência é ignorada e registrada. Excluir o contato remove de todas. Pausar congela inscritos; reativar recalcula a partir de agora.
- **Execução de cada passo:** fora da janela de 24h no Instagram → passo `skipped` (`window_closed`) e segue para o próximo calculado a partir de agora; conversa num fluxo ativo → adia 10 min, até 6 vezes, depois `skipped` (`conversation_busy`); sem conversa no canal → `skipped` (`no_conversation`). Fim dos passos → inscrição `completed`.
- **Edição de sequência ativa:** vale para passos ainda não enviados; inscritos seguem pela posição (passo removido → seguem para o seguinte).

## 3. Campanhas (mensagens em massa)

- **Tela** `/automacoes/campanhas`: lista (nome, status `draft` | `scheduled` | `sending` | `completed` | `cancelled`, público, data, enviados/pulados/falhas/cliques).
- **Criação em três passos:** (1) público com filtros combinados por "e": canal; tem todas/alguma destas tags; não tem estas tags; etapa; lead score mínimo; última interação nos últimos N dias; veio pelo link de entrada X. (2) mensagem igual à do passo de sequência, com prévia do balão. (3) envio "agora" ou data/hora no fuso da organização; prévia "N no público · M dentro da janela de 24h · K ficarão de fora"; confirmação "Enviar campanha para M contatos?". Só admin/owner enviam.
- **Execução:** na hora marcada o banco tira a foto do público: quem está na janela vira entrega `pending` com horário escalonado; quem está fora fica `skipped` (`window_closed`). Ritmo padrão 30 envios por minuto por canal (configurável na plataforma). No envio a janela é conferida de novo; conversa ocupada adia como nas sequências; contato excluído → entrega `cancelled`. "Cancelar campanha" cancela entregas pendentes. No máximo uma entrega por contato por campanha.
- **Relatório:** enviados, pulados por motivo, falhas por motivo, cliques por botão/resposta rápida, lista de destinatários com estado e motivo.

## 4. Botões e cliques (sequências e campanhas)

Botões e respostas rápidas levam payload assinado (mesmo esquema da 7A, apontando para a entrega). Clique em "iniciar a automação X" cria uma execução normal da 7A naquela conversa se ela estiver livre (regras da 7A: uma execução ativa por conversa, prioridade sobre a IA) e conta clique. Botões de link não são rastreáveis no Instagram. Clique forjado ou de outra organização é descartado; clique antigo autêntico entra como texto (regra da 7A).

## 5. Fila de entregas e worker

- `outreach_deliveries`: origem (passo de sequência + inscrição, ou campanha), organização, contato, canal, conversa, `run_after`, estado (`pending` | `sending` | `sent` | `skipped` | `failed` | `cancelled`), motivo, adiamentos, tentativas, reserva com token e expiração, ids de mensagem/intent.
- O cron de 5 s (`dispatch_automation_worker`) também chama o worker quando há entregas vencidas. O `automation-worker` reserva lotes, monta a mensagem (variáveis, botões, corpo do Instagram) e chama uma função transacional que confere janela, conversa ocupada, inscrição/campanha ativas e contato existente, envia (Simulador direto; Instagram pela fila de envio da Fase 5), grava o resultado e agenda o próximo passo da sequência. A mesma entrega nunca é enviada duas vezes (idempotência por entrega).
- Ritmo por canal aplicado ao escalonar `run_after`.

## 6. Dados e segurança

- Tabelas novas: `entry_links`, `entry_link_hits`, `sequences`, `sequence_steps`, `sequence_enrollments`, `campaigns`, `outreach_deliveries`. Enums/valores novos: gatilho `entry_link`; blocos `sequence_enroll`, `sequence_remove`.
- Todas com `organization_id`, FKs compostas, RLS, sem políticas para `anon`, grants por coluna; escrita por funções SECURITY DEFINER com `search_path=''` e checagem de papel; fila e worker só pelo serviço.
- Permissões: admin/owner criam e editam links, sequências e campanhas e enviam campanhas; agent inscreve/remove contatos em sequências pela ficha; viewer só lê.
- Logs e códigos de erro sem texto de mensagem.

## 7. Testes e definição de concluído

Nenhum teste chama Meta, OpenAI ou hosts externos reais.
- **core (Vitest):** filtros de público, próximo horário com janela e fuso, validação de mensagens, parser de referral, geração de link e código.
- **pgTAP:** links e usos; entrada por link disparando automação; inscrição sem duplicar; saída por palavra e por resposta; passos pulados (janela, ocupada, sem conversa) e adiamento; foto do público, prévia, ritmo e cancelamento; idempotência de entrega; clique iniciando automação; RLS e grants.
- **Edge (Deno):** worker enviando entregas de sequência e campanha com botões (Instagram e IA falsos).
- **Playwright:** criar link, baixar QR, simular abertura disparando automação; criar sequência, inscrever pela ficha e ver passos; criar campanha com filtro de tag, prévia, envio, clique no botão no Simulador iniciando automação e relatório.

Concluído quando todas as suítes passam (unitários, typecheck, lint, pgTAP, edge, scripts, e2e padrão, IA, Instagram, automações e o novo e2e de crescimento), README atualizado e `fase-7b-pendencias.md` registra decisões e pendências (incluindo a validação ao vivo do referral com app Meta real).
