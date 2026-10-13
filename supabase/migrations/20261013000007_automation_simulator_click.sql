-- Fase 7A: clique em botões / respostas rápidas de automação no Simulador (agent+).
--
-- O ingest de 7 argumentos passa a ser um invólucro fino (canal, autorização, horário efetivo, validação)
-- sobre private.ingest_inbound_core, que faz o resto (travas, duplicata, contato, clique assinado, conversa,
-- mensagem, interação). O clique simulado chama o núcleo direto, depois da própria checagem agent+, com o
-- contato da conversa já resolvido (sem busca por telefone). Toda a validação de escopo do clique
-- (conversa → execução, nó de espera, prazo, opção) continua em private.automation_signed_reply.

-- ---------------------------------------------------------------- núcleo do ingest (sem autorização)
-- p_contact: contato já resolvido pelo chamador (pula a busca por remetente; precisa ser da organização).
create function private.ingest_inbound_core(
  p_org uuid,
  p_channel uuid,
  p_type public.channel_type,
  p_external_id text,
  p_sender_external_id text,
  p_sender_name text,
  p_text text,
  p_at timestamptz,
  p_context jsonb,
  p_contact uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg uuid;
  v_contact uuid;
  v_conv uuid;
  v_conv_status public.conversation_status;
  v_handler public.handler_type;
  v_name text := nullif(btrim(coalesce(p_sender_name, '')), '');
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
begin
  -- serializa duplicatas e primeiras mensagens simultaneas do mesmo remetente
  perform pg_advisory_xact_lock(hashtextextended('ingest:msg:' || p_channel::text || ':' || p_external_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('ingest:sender:' || p_org::text || ':' || p_type::text || ':' || p_sender_external_id, 0));

  -- duplicada: sem nenhum efeito
  select id into v_msg from public.messages
  where channel_id = p_channel and external_id = p_external_id;
  if v_msg is not null then
    return v_msg;
  end if;

  -- 4. contato
  if p_contact is not null then
    select id into v_contact from public.contacts where id = p_contact and organization_id = p_org;
    if v_contact is null then return null; end if;
  elsif p_type = 'instagram' then
    select id into v_contact from public.contacts
    where organization_id = p_org and instagram_id = p_sender_external_id;
  else
    if p_type = 'whatsapp' then
      select id into v_contact from public.contacts
      where organization_id = p_org and whatsapp_id = p_sender_external_id;
    end if;
    if v_contact is null then
      select id into v_contact from public.contacts
      where organization_id = p_org and phone = p_sender_external_id
      order by created_at limit 1;
    end if;
  end if;
  -- A signed click cannot create a contact/conversation or become ordinary text.
  -- Sender serialization was acquired above, before any conversation/run lock.
  if v_context ? 'payload' then
    if v_contact is null then return null; end if;
    select id into v_conv from public.conversations
      where organization_id=p_org and contact_id=v_contact and channel_id=p_channel
      order by created_at desc,id desc limit 1;
    if private.automation_signed_reply(p_org,v_conv,v_context->>'payload') is null then return null; end if;
  end if;
  if v_contact is null then
    insert into public.contacts (organization_id, name, phone, source, whatsapp_id, instagram_id)
    values (
      p_org,
      v_name,
      case when p_type = 'instagram' then null else p_sender_external_id end,
      p_type::text::public.contact_source,
      case when p_type = 'whatsapp' then p_sender_external_id end,
      case when p_type = 'instagram' then p_sender_external_id end
    )
    returning id into v_contact;
  end if;

  -- 5. conversa (a mais recente do contato no canal)
  select case when exists (
           select 1 from public.ai_agents
           where organization_id = p_org and is_active and auto_reply
         ) then 'ai' else 'human' end::public.handler_type
  into v_handler;

  select id, status into v_conv, v_conv_status from public.conversations
  where organization_id = p_org and contact_id = v_contact and channel_id = p_channel
  order by created_at desc, id desc limit 1
  for update;

  if v_conv is null then
    insert into public.conversations (organization_id, contact_id, channel_id, status, handled_by, last_message_at)
    values (p_org, v_contact, p_channel, 'open', v_handler, p_at)
    returning id into v_conv;
  elsif v_conv_status = 'closed' then
    update public.conversations
    set status = 'open', assigned_to = null, closed_at = null, handled_by = v_handler
    where id = v_conv;
  end if;

  -- 6. mensagem (created_at = p_at; o gatilho move last_message_at para frente). O context vai
  -- na inserção para que os gatilhos AFTER INSERT (automações) o enxerguem.
  insert into public.messages (organization_id, conversation_id, channel_id, direction,
    sender_type, content, status, external_id, created_at, context)
  values (p_org, v_conv, p_channel, 'inbound', 'contact', p_text, 'delivered', p_external_id, p_at, v_context)
  on conflict (channel_id, external_id) do nothing
  returning id into v_msg;
  if v_msg is null then
    select id into v_msg from public.messages
    where channel_id = p_channel and external_id = p_external_id;
    return v_msg;
  end if;

  -- 7. interacao do contato (apenas para frente)
  update public.contacts
  set last_interaction_at = greatest(coalesce(last_interaction_at, p_at), p_at),
      name = coalesce(name, v_name),
      whatsapp_id = case when p_type = 'whatsapp' then coalesce(whatsapp_id, p_sender_external_id) else whatsapp_id end
  where id = v_contact;

  return v_msg;
end $$;

revoke all on function private.ingest_inbound_core(uuid, uuid, public.channel_type, text, text, text, text, timestamptz, jsonb, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- ingest de 7 argumentos (invólucro)
-- Mesma autorização, horário efetivo e validação de antes; o restante é o núcleo acima.
create or replace function public.ingest_inbound_message(
  p_channel uuid,
  p_external_id text,
  p_sender_external_id text,
  p_sender_name text,
  p_text text,
  p_sent_at timestamptz,
  p_context jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_type public.channel_type;
  v_status public.channel_status;
  v_role text := auth.role();
  v_privileged boolean;
  v_at timestamptz;
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
begin
  -- 1. canal
  select organization_id, type, status into v_org, v_type, v_status
  from public.channels where id = p_channel;
  if v_org is null or v_status is distinct from 'active' then
    -- P0002 antes da autorizacao e intencional: o UUID do canal precisa ser adivinhado
    raise exception 'channel not found or inactive' using errcode = 'P0002';
  end if;

  -- 2. autorizacao. Sem role no JWT so vale para conexao direta do banco (sessao postgres/
  -- supabase_admin sem SET ROLE); qualquer outro caso sem role falha.
  v_privileged := coalesce(v_role = 'service_role', false)
    or (v_role is null
        and session_user in ('postgres', 'supabase_admin')
        and current_setting('role') in ('none', 'postgres', 'supabase_admin'));
  if not (
    v_privileged
    or coalesce(v_role = 'authenticated' and v_type = 'simulator' and public.has_role(v_org, 'admin'), false)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- instante efetivo: nunca no futuro; usuarios autenticados nao escolhem o horario
  v_at := case when v_privileged then least(p_sent_at, now()) else now() end;

  -- 3. validacao
  if p_text is null or p_text !~ '[^[:space:]]' or char_length(p_text) > 4096
     or p_external_id is null or btrim(p_external_id) = ''
     or p_sender_external_id is null or btrim(p_sender_external_id) = ''
     or p_sent_at is null or jsonb_typeof(v_context) <> 'object' then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  return private.ingest_inbound_core(v_org, p_channel, v_type, p_external_id, p_sender_external_id, p_sender_name,
    p_text, v_at, v_context);
end $$;

-- ---------------------------------------------------------------- clique simulado
-- Erros: 42501 = sem permissão (inclui mensagem inexistente ou de outra organização); 22023 com mensagem
-- fixa: 'not_simulator' | 'unknown_option' | 'not_waiting'.
create function public.click_automation_button(p_message_id uuid, p_option_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
  v_type public.channel_type;
  v_status public.channel_status;
  v_auto jsonb;
  v_title text;
  v_run uuid;
  v_node uuid;
  k public.contacts;
  v_msg uuid;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  select * into m from public.messages where id = p_message_id;
  if not found or not public.has_role(m.organization_id, 'agent') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select ch.type, ch.status into v_type, v_status from public.channels ch where ch.id = m.channel_id;
  if v_type is distinct from 'simulator' then
    raise exception 'not_simulator' using errcode = '22023';
  end if;

  -- só botões 'path' e respostas rápidas esperam clique (botões de link abrem a URL)
  v_auto := m.context -> 'automation';
  if m.sender_type <> 'automation' or jsonb_typeof(v_auto) is distinct from 'object'
     or coalesce(p_option_id, '') !~ '^[a-z0-9]{1,12}$' then
    raise exception 'unknown_option' using errcode = '22023';
  end if;
  select o ->> 'title' into v_title from (
    select x as o from jsonb_array_elements(case when jsonb_typeof(v_auto -> 'buttons') = 'array'
      then v_auto -> 'buttons' else '[]'::jsonb end) x where x ->> 'kind' = 'path'
    union all
    select x from jsonb_array_elements(case when jsonb_typeof(v_auto -> 'quickReplies') = 'array'
      then v_auto -> 'quickReplies' else '[]'::jsonb end) x
  ) opts where o ->> 'id' = p_option_id limit 1;
  if v_title is null or v_title !~ '[^[:space:]]' or char_length(v_title) > 4096 then
    raise exception 'unknown_option' using errcode = '22023';
  end if;

  -- ids malformados no context: tratados como botão expirado (nunca 22P02)
  if coalesce(v_auto ->> 'runId', '') !~ v_uuid or coalesce(v_auto ->> 'nodeId', '') !~ v_uuid then
    raise exception 'not_waiting' using errcode = '22023';
  end if;
  v_run := (v_auto ->> 'runId')::uuid;
  v_node := (v_auto ->> 'nodeId')::uuid;

  -- a execução precisa ainda aguardar resposta neste nó (verificação rápida; o núcleo confere sob as travas)
  if v_status is distinct from 'active' or not exists (select 1 from public.automation_runs r
      where r.id = v_run and r.organization_id = m.organization_id
        and r.conversation_id = m.conversation_id and r.status = 'waiting' and r.waiting_for = 'reply'
        and r.input is null and r.wait_node_id = v_node) then
    raise exception 'not_waiting' using errcode = '22023';
  end if;

  select k2.* into k from public.conversations c
    join public.contacts k2 on k2.id = c.contact_id and k2.organization_id = c.organization_id
    where c.id = m.conversation_id;
  if k.id is null then
    raise exception 'not_waiting' using errcode = '22023';
  end if;

  -- remetente: o telefone do contato (como no Simulador) ou, sem telefone, o id do contato; só serializa
  v_msg := private.ingest_inbound_core(m.organization_id, m.channel_id, v_type, 'click:' || gen_random_uuid()::text,
    coalesce(nullif(btrim(k.phone), ''), 'contact:' || k.id::text), k.name, v_title, now(),
    jsonb_build_object('origin', 'button', 'payload', private.automation_payload(v_run, v_node, p_option_id)), k.id);
  if v_msg is null then
    raise exception 'not_waiting' using errcode = '22023';
  end if;

  insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, payload)
    select c.organization_id, 'button_clicked', c.id, c.contact_id, 'contact',
      jsonb_build_object('runId', v_run, 'nodeId', v_node, 'optionId', p_option_id)
    from public.messages x join public.conversations c on c.id = x.conversation_id where x.id = v_msg;
  return v_msg;
end $$;

revoke all on function public.click_automation_button(uuid, text) from public, anon;
grant execute on function public.click_automation_button(uuid, text) to authenticated;
