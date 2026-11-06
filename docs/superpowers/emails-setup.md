# E-mails da loja: guia de configuração

Jornadas de e-mail da loja (carrinho abandonado, Pix/boleto pendente e pós-venda), enviadas pelo FlowAI via Resend. Siga na ordem.

## 1. Resend (envio e domínio)

1. Crie a conta em resend.com.
2. Em **Domains**, adicione `useholyspirit.store`.
3. O Resend mostra os registros DNS (SPF, DKIM e, se oferecido, DMARC). Crie cada um no painel onde o domínio é gerenciado, copiando tipo, nome e valor exatamente. Aguarde o status **Verified**.
4. Em **Domains**, ligue o rastreio de abertura (**Open tracking**) e de clique (**Click tracking**).
5. Em **API Keys**, crie uma chave **Full access**: esta integração também consulta o domínio pelo botão **Verificar**. Uma chave **Sending access** permite enviar, mas não consultar os domínios ([permissões oficiais do Resend](https://resend.com/changelog/new-api-key-permissions)). Copie na hora: ela só aparece uma vez e ficará guardada no Vault.
6. Em **Webhooks**, crie um webhook:
   - URL: `https://<ref>.supabase.co/functions/v1/resend-webhook` (`<ref>` é o ID do projeto Supabase).
   - Eventos: `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`.
7. Abra o webhook criado e copie o **Signing secret**. Ele começa com `whsec_`: cole inteiro, com o prefixo.

## 2. Supabase (deploy)

No terminal, dentro do projeto, nesta ordem.

1. Defina a URL do app (antes de publicar o `email-worker`):

```bash
npx supabase secrets set FLOWAI_APP_URL=https://flowai-web-rust.vercel.app
```

2. Publique as funções, uma por vez:

```bash
npx supabase functions deploy yampi-webhook
```

```bash
npx supabase functions deploy email-worker
```

```bash
npx supabase functions deploy email-admin
```

```bash
npx supabase functions deploy resend-webhook
```

3. Aplique as migrações pendentes. A `20261106000001` adiciona as jornadas de Pix/boleto pendente e pós-venda, o tipo de agendamento dos passos e os campos de vencimento/link dos pedidos. Publique primeiro as novas versões de `yampi-webhook`, `email-worker`, `email-admin` e `resend-webhook`, depois aplique o banco e só então publique o app: o worker novo é quem preenche número do pedido e rastreio nos e-mails.

```bash
npx supabase db push
```

4. Publique o app (Vercel):

```bash
git push
```

## 3. FlowAI (configuração)

1. Abra **Configurações → aba "E-mails da loja"**.
2. Em **Remetente (Resend)** preencha nome, e-mail do remetente (do domínio verificado) e, se quiser, **Responder para**.
3. Cole a **Chave da API do Resend** e o **Segredo do webhook do Resend** (`whsec_...`). No primeiro salvamento os dois são obrigatórios. Toque em **Salvar remetente**.
4. Toque em **Verificar** para consultar o domínio. Deve aparecer "Verificado".
5. Em **Alias da loja**, informe o alias da loja na Yampi. Em **Segredo do webhook Yampi**, cole o segredo (passo 4 abaixo, `secret_key`). Toque em **Salvar loja**.
6. Depois de salvar, a tela mostra a **URL do webhook Yampi**: `https://<ref>.supabase.co/functions/v1/yampi-webhook/<id mostrado na tela>`. Use o botão **Copiar**.

## 4. Yampi (webhook)

1. No painel da Yampi, vá em Webhooks e crie um novo, com a URL copiada do FlowAI (passo 3.6).
2. Marque os eventos: `cart.reminder`, `order.created`, `order.paid`, `order.status.updated`.
3. Copie o segredo do webhook (`secret_key`) e cole no FlowAI (passo 3.5). Se a Yampi só mostrar o segredo depois de criar o webhook, crie, copie e volte ao FlowAI para salvar.
4. **Desligue a recuperação de carrinho nativa da Yampi** (e-mails de carrinho abandonado dela). Senão o cliente recebe e-mail duplicado.

Atenção: a Yampi exige resposta 2xx em até 5 segundos e desativa o webhook após 30 falhas seguidas. Se parar de chegar evento, confira se ele continua ativo.

## 5. Jornadas

Na publicação controlada de 03/11/2026, o cron `flowai-email-worker` foi pausado. Somente depois de configurar e conferir as integrações, reative esse cron no Supabase antes do teste controlado. Ligar apenas o botão da jornada não reativa um cron pausado.

As três jornadas nascem **desligadas** na primeira vez. Ao ligar, o FlowAI cria os e-mails padrão; desligar não apaga os textos já editados.

### Carrinho abandonado

1. Os e-mails saem em **60 min**, **24 h** e **48 h** após o abandono.
2. Revise assunto, título e texto do botão de cada e-mail.
3. O e-mail 3 usa `{cupom}`. Preencha o cupom (ex.: `CUPOM20`, criado na Yampi). Sem cupom preenchido ele **não é enviado** e o histórico mostra "Cupom não preenchido".
4. Toque em **Enviar teste para mim** em cada e-mail e confira no seu celular.
5. Ligue a jornada.

### Pix ou boleto pendente

1. O primeiro lembrete sai **2 h** depois do `order.created` ainda não pago.
2. Se o pedido tiver boleto com vencimento, o segundo e-mail sai **no dia do vencimento, às 09:00 no fuso da loja**. Sem vencimento, esse passo não é enviado.
3. O botão usa o link de pagamento do pedido (ou a página pública do pedido). Pedido sem nenhum link é cancelado no histórico como "Sem link do pedido".
4. Quando o pagamento é confirmado, os lembretes pendentes são cancelados na hora.

### Pós-venda

1. **Pedido confirmado** sai assim que o pagamento é confirmado (transacional).
2. **Pedido enviado** sai quando o código de rastreio chega no evento da Yampi (transacional).
3. **Avaliação/recompra** sai 15 dias após o pagamento (marketing).
4. Confirmação e rastreio são transacionais: continuam mesmo para quem se descadastrou dos e-mails de marketing.

Há dois e-mails transacionais por pedido e um de marketing; o histórico mostra a jornada e o passo de cada envio.

Descadastro: todo e-mail de marketing tem link no rodapé e o botão de descadastro do Gmail. Quem sai não recebe mais marketing; os transacionais de pedido continuam.

## 6. Teste real

1. Na loja, coloque um produto no carrinho, informe **seu e-mail** no checkout e abandone.
2. No FlowAI, confira o evento no **Histórico**.
3. Após 60 min chega o 1º e-mail de carrinho. Confirme o assunto e o texto.
4. Toque no botão do e-mail. **Confirme que o carrinho reabre** (link `simulate_url` da Yampi; é uma incógnita até testar).
5. Agora faça um pedido com **Pix ou boleto** usando o mesmo e-mail e não pague. Após 2 h chega o lembrete de pagamento, com o número do pedido no texto.
6. Se o boleto tiver vencimento, confirme o e-mail das 09:00 do dia do vencimento (ou ajuste o passo para testar antes).
7. Pague o pedido. Os lembretes de carrinho/pendente devem aparecer no histórico como cancelados ("Pagou antes"/"Comprou") e a confirmação de compra chega logo em seguida.
8. Quando a Yampi enviar o código de rastreio, chega o e-mail de rastreio com o código no texto e no botão.
9. Em um e-mail de marketing, use o link de descadastro no rodapé e confira no FlowAI que o contato ficou descadastrado. Confirme que os transacionais de um novo pedido continuam chegando.

O que o teste precisa confirmar:

- O link `simulate_url` reabre o carrinho.
- O link de pagamento do Pix/boleto e a página do pedido existem no evento da Yampi e abrem o checkout certo.
- O código de rastreio chega em `order.status.updated` (evento que a Yampi dispara quando o pedido muda de status).
- O boleto traz o vencimento (`billet_date`) e o link (`billet_url`).
- A assinatura da Yampi é aceita. Se **todos** os eventos da Yampi forem rejeitados com 401, avise: a validação sobre o corpo bruto precisa de ajuste.
- Nesta etapa os e-mails não mostram foto do produto.

## Validação local de 03/11/2026

A etapa de carrinho foi conferida sem chamadas reais à Yampi ou ao Resend. Passaram os testes da aplicação, do serviço e do banco, a verificação de tipos, o build de produção e a conferência da página pública de descadastro no navegador. A revisão final corrigiu o isolamento dos webhooks por organização e a reserva de um e-mail por vez, para revalidar compra, descadastro e bloqueios antes de cada tentativa. Envios cancelados não bloqueiam os próximos válidos.

As etapas 2 e 3 (Pix/boleto pendente e pós-venda) foram validadas localmente com testes do parser da Yampi, do modelo de e-mail, do worker e do banco: passos padrão das três jornadas, agendamento pelo vencimento no fuso da organização, cancelamento ao pagar, confirmação imediata, rastreio só quando o código chega, recompra em 15 dias e contexto do pedido na reserva. Nenhum teste chama Yampi ou Resend de verdade.

Publicação, DNS, permissões das credenciais, assinatura real da Yampi, entrega na caixa de entrada, reabertura do carrinho, links reais de Pix/boleto e o código de rastreio ainda precisam do roteiro acima; os testes locais não comprovam essas integrações reais.
