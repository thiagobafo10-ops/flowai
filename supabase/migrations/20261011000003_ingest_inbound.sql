-- Ponto unico e transacional de entrada de mensagens recebidas (Simulador agora, Meta depois).
create function public.ingest_inbound_message(
  p_channel uuid,
  p_external_id text,
  p_sender_external_id text,
  p_sender_name text,
  p_text text,
  p_sent_at timestamptz
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
  v_msg uuid;
  v_contact uuid;
  v_conv uuid;
  v_conv_status public.conversation_status;
  v_handler public.handler_type;
  v_name text := nullif(btrim(coalesce(p_sender_name, '')), '');
  v_privileged boolean;
  v_at timestamptz;
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
     or p_sent_at is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  -- serializa duplicatas e primeiras mensagens simultaneas do mesmo remetente
  perform pg_advisory_xact_lock(hashtextextended('ingest:msg:' || p_channel::text || ':' || p_external_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('ingest:sender:' || v_org::text || ':' || v_type::text || ':' || p_sender_external_id, 0));

  -- duplicada: sem nenhum efeito
  select id into v_msg from public.messages
  where channel_id = p_channel and external_id = p_external_id;
  if v_msg is not null then
    return v_msg;
  end if;

  -- 4. contato
  if v_type = 'instagram' then
    select id into v_contact from public.contacts
    where organization_id = v_org and instagram_id = p_sender_external_id;
  else
    if v_type = 'whatsapp' then
      select id into v_contact from public.contacts
      where organization_id = v_org and whatsapp_id = p_sender_external_id;
    end if;
    if v_contact is null then
      select id into v_contact from public.contacts
      where organization_id = v_org and phone = p_sender_external_id
      order by created_at limit 1;
    end if;
  end if;
  if v_contact is null then
    insert into public.contacts (organization_id, name, phone, source, whatsapp_id, instagram_id)
    values (
      v_org,
      v_name,
      case when v_type = 'instagram' then null else p_sender_external_id end,
      v_type::text::public.contact_source,
      case when v_type = 'whatsapp' then p_sender_external_id end,
      case when v_type = 'instagram' then p_sender_external_id end
    )
    returning id into v_contact;
  end if;

  -- 5. conversa (a mais recente do contato no canal)
  select case when exists (
           select 1 from public.ai_agents
           where organization_id = v_org and is_active and auto_reply
         ) then 'ai' else 'human' end::public.handler_type
  into v_handler;

  select id, status into v_conv, v_conv_status from public.conversations
  where organization_id = v_org and contact_id = v_contact and channel_id = p_channel
  order by created_at desc, id desc limit 1
  for update;

  if v_conv is null then
    insert into public.conversations (organization_id, contact_id, channel_id, status, handled_by, last_message_at)
    values (v_org, v_contact, p_channel, 'open', v_handler, v_at)
    returning id into v_conv;
  elsif v_conv_status = 'closed' then
    update public.conversations
    set status = 'open', assigned_to = null, closed_at = null, handled_by = v_handler
    where id = v_conv;
  end if;

  -- 6. mensagem (created_at = p_sent_at; o gatilho move last_message_at para frente)
  insert into public.messages (organization_id, conversation_id, channel_id, direction,
    sender_type, content, status, external_id, created_at)
  values (v_org, v_conv, p_channel, 'inbound', 'contact', p_text, 'delivered', p_external_id, v_at)
  on conflict (channel_id, external_id) do nothing
  returning id into v_msg;
  if v_msg is null then
    select id into v_msg from public.messages
    where channel_id = p_channel and external_id = p_external_id;
    return v_msg;
  end if;

  -- 7. interacao do contato (apenas para frente)
  update public.contacts
  set last_interaction_at = greatest(coalesce(last_interaction_at, v_at), v_at),
      name = coalesce(name, v_name),
      whatsapp_id = case when v_type = 'whatsapp' then coalesce(whatsapp_id, p_sender_external_id) else whatsapp_id end
  where id = v_contact;

  return v_msg;
end $$;

revoke all on function public.ingest_inbound_message(uuid, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.ingest_inbound_message(uuid, text, text, text, text, timestamptz) to authenticated, service_role;
