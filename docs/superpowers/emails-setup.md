# E-mails da loja: guia de configuração

Recuperação de carrinho abandonado da Holy Spirit, enviada pelo FlowAI via Resend. Siga na ordem.

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

3. Aplique as migrações `20261104000001` a `20261104000004`. As duas últimas restringem eventos à organização autorizada e fazem a fila avançar por envios cancelados. Publique as versões correspondentes de `resend-webhook` e `email-worker` antes de ativar a jornada:

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

## 5. Jornada de carrinho

1. Na mesma tela, abra **Carrinho abandonado**. Os e-mails saem em **60 min**, **24 h** e **48 h** após o abandono.
2. Revise assunto, título e texto do botão de cada e-mail.
3. O e-mail 3 usa `{cupom}`. Preencha o cupom (ex.: `CUPOM20`, criado na Yampi). Sem cupom preenchido ele **não é enviado** e o histórico mostra "Cupom não preenchido".
4. Toque em **Enviar teste para mim** em cada e-mail e confira no seu celular.
5. Ligue a jornada.

Descadastro: todo e-mail tem link no rodapé e o botão de descadastro do Gmail. Quem sai não recebe mais. E-mails transacionais (pedido, pagamento) ainda não existem nesta etapa.

## 6. Teste real

1. Na loja, coloque um produto no carrinho, informe **seu e-mail** no checkout e abandone.
2. No FlowAI, confira o evento no **Histórico**.
3. Após 60 min chega o 1º e-mail. Confirme o assunto e o texto.
4. Toque no botão do e-mail. **Confirme que o carrinho reabre** (link `simulate_url` da Yampi; é uma incógnita até testar).
5. Finalize o pagamento. Os e-mails seguintes devem aparecer no histórico como "Pagou antes" (não enviados).
6. Em um e-mail, use o link de descadastro no rodapé e confira no FlowAI que o contato ficou descadastrado.

O que o teste precisa confirmar:

- O link `simulate_url` reabre o carrinho.
- A assinatura da Yampi é aceita. Se **todos** os eventos da Yampi forem rejeitados com 401, avise: a validação sobre o corpo bruto precisa de ajuste.
- Nesta etapa os e-mails não mostram foto do produto.

## Validação local de 03/11/2026

A etapa de carrinho foi conferida sem chamadas reais à Yampi ou ao Resend. Passaram os testes da aplicação, do serviço e do banco, a verificação de tipos, o build de produção e a conferência da página pública de descadastro no navegador. A revisão final corrigiu o isolamento dos webhooks por organização e a reserva de um e-mail por vez, para revalidar compra, descadastro e bloqueios antes de cada tentativa. Envios cancelados não bloqueiam os próximos válidos.

Publicação, DNS, permissões das credenciais, assinatura real da Yampi, entrega na caixa de entrada e reabertura do carrinho ainda precisam do roteiro acima; os testes locais não comprovam essas integrações reais.
