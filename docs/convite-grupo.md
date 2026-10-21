# Convite ao grupo: identificar quem não clicou

O botão "Entrar no grupo" só é rastreável quando ele é do tipo **caminho** (o botão que avança o
fluxo). Nesse caso o FlowAI assina o clique, retoma a execução e sabe exatamente quem não
respondeu dentro do prazo. Botão do tipo **URL** (link direto para o `chat.whatsapp.com`) não é
reportado pelo Instagram: o sistema só sabe que a mensagem foi enviada.

## Modelo "Convite ao grupo"

Em **Automações → Convite ao grupo**, o fluxo já vem pronto:

```
comentário no Instagram
   └─ mensagem "Quer entrar no nosso grupo?" + botão [Entrar no grupo]
        ├─ clique  → etiqueta "Entrou no grupo" → mensagem com o convite do grupo → Fim
        └─ sem resposta (24h) → etiqueta "Não clicou no grupo" → Fim
```

As duas etiquetas são criadas automaticamente na primeira instantiation do modelo. Para
personalizar, no editor:

1. troque a URL de exemplo do botão "Abrir convite" pelo link real do grupo;
2. ajuste a palavra-chave do gatilho (por padrão, comentários com "grupo");
3. ajuste o prazo de espera do bloco da mensagem (por padrão, 24 horas);
4. ative a automação.

## Aplicar na automação que você já tem

1. **Configurações → Tags**: crie as etiquetas `Entrou no grupo` e `Não clicou no grupo`.
2. No editor da automação, na saída **Sem resposta** do bloco do botão, ligue um bloco
   **Adicionar etiqueta** → `Não clicou no grupo` → **Fim**.
3. (opcional) na saída do botão, ligue **Adicionar etiqueta** → `Entrou no grupo`.

O bloco "Sem resposta" só existe quando a mensagem tem botão de caminho ou resposta rápida. Se o
seu botão é do tipo URL, troque-o por um botão de caminho e mande o link no passo seguinte.

## Reengajamento

**Automações → Campanhas → Nova campanha**:

- **Público**: etiqueta `Não clicou no grupo` (opcionalmente exclua `Entrou no grupo`);
- **Mensagem**: o texto de reengajamento;
- canal e janela de envio conforme a operação.

Quem não clicou aparece também em **Contatos**, filtrando pela etiqueta, e o relatório da campanha
mostra quantas pessoas foram abordadas.

## Como medir

```sql
-- quem clicou
select c.name, c.instagram_id, e.created_at as clique
from public.events e
join public.contacts c on c.id = e.contact_id and c.organization_id = e.organization_id
where e.type = 'button_clicked' and e.payload->>'optionId' = 'entrar';

-- quem não clicou (o passo terminou em "sem resposta")
select c.name, c.instagram_id, r.id as execucao, s.created_at
from public.automation_run_steps s
join public.automation_runs r on r.id = s.run_id and r.organization_id = s.organization_id
join public.contacts c on c.id = r.contact_id and c.organization_id = r.organization_id
where s.node_id = '<id do bloco do botão>'
  and s.handle = 'no_reply';
```

## Limitações

- A etiqueta de "não clicou" só é aplicada **depois** que o prazo do bloco expira (24 horas por
  padrão). Antes disso a pessoa ainda pode clicar.
- Quem **digita** o texto do botão em vez de clicar é contada como clique.
- Se a pessoa responder com outro texto (sem clicar), ela também entra em "não clicou".
- O fluxo para no Instagram depende da janela de 24 horas do Direct: após esse prazo, a
  plataforma não deixa mais enviar mensagem.
