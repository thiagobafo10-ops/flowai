-- Fase 7B: entrada por link (referral do Instagram e simulação no Simulador).
-- * private.entry_link_open: resolve o link ativo do canal, garante contato e conversa (mesmo padrão da ingestão),
--   registra o uso de forma idempotente por (link, external_id), escreve a nota "Entrou pelo link {nome}", inicia a
--   automação entry_link (conversa livre) e aplica a tag do link. A execução é iniciada ANTES da tag para que a
--   conversa já esteja ocupada quando tag_added disparar as automações de CRM (uma execução ativa por conversa);
--   tag_added continua sendo emitido normalmente.
-- * ingest_instagram_event: novo kind 'referral'; mensagem com context.referral abre o link antes da ingestão.
-- * automation_inbound: mensagem com referral válido (link ativo do canal) nunca inicia gatilho de mensagem.
-- * public.simulate_entry_link: abertura simulada no Simulador (agent+).
-- * private.inbound_find_contact / private.inbound_conversation: resolução de contato + conversa extraída de
--   private.ingest_inbound_core (redefinido aqui sobre elas, mesmo comportamento) e reutilizada pela entrada por link.

alter table public.instagram_events drop constraint instagram_events_kind_check;
alter table public.instagram_events add constraint instagram_events_kind_check
  check(kind in ('message','button','comment','status','ignored','referral'));

-- ---------------------------------------------------------------- resolução do link
-- Link ativo do canal com o código (o código é único por canal; o canal define a organização).
create function private.entry_link_resolve(p_channel uuid, p_code text) returns public.entry_links
language sql stable security definer set search_path = '' as $$
  select l.* from public.entry_links l
    where l.channel_id = p_channel and l.status = 'active' and l.code = lower(btrim(coalesce(p_code, '')))
$$;

-- context.referral.ref resolve um link ativo do canal?
create function private.entry_link_referral_valid(p_channel uuid, p_context jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_typeof(p_context -> 'referral') = 'object'
    and jsonb_typeof(p_context #> '{referral,ref}') = 'string'
    and (private.entry_link_resolve(p_channel, p_context #>> '{referral,ref}')).id is not null, false)
$$;


-- ---------------------------------------------------------------- contato + conversa (núcleo compartilhado)
-- Extraído de private.ingest_inbound_core (000009) sem mudança de comportamento; usado pela ingestão de mensagens
-- e pela entrada por link. O chamador já serializou o remetente (trava 'ingest:sender:').
-- Busca do contato pelo remetente: Instagram → instagram_id; WhatsApp → whatsapp_id e, sem ele, telefone;
-- demais canais (Simulador) → telefone.
create function private.inbound_find_contact(p_org uuid, p_type public.channel_type, p_sender text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_contact uuid;
begin
  if p_type = 'instagram' then
    select id into v_contact from public.contacts where organization_id = p_org and instagram_id = p_sender;
    return v_contact;
  end if;
  if p_type = 'whatsapp' then
    select id into v_contact from public.contacts where organization_id = p_org and whatsapp_id = p_sender;
  end if;
  if v_contact is null then
    select id into v_contact from public.contacts where organization_id = p_org and phone = p_sender
      order by created_at limit 1;
  end if;
  return v_contact;
end $$;

-- Contato (p_contact já resolvido pelo chamador; nulo = busca pelo remetente e cria se não existir) e a conversa
-- mais recente do contato no canal (travada; criada com last_message_at = p_at, ou reaberta se fechada).
create function private.inbound_conversation(p_org uuid, p_channel uuid, p_type public.channel_type, p_sender text,
  p_name text, p_at timestamptz, p_contact uuid) returns public.conversations
language plpgsql security definer set search_path = '' as $$
declare
  v_contact uuid := p_contact;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_handler public.handler_type;
  conv public.conversations;
begin
  if v_contact is null then
    v_contact := private.inbound_find_contact(p_org, p_type, p_sender);
  end if;
  if v_contact is null then
    insert into public.contacts (organization_id, name, phone, source, whatsapp_id, instagram_id)
      values (p_org, v_name,
        case when p_type = 'instagram' then null else p_sender end,
        p_type::text::public.contact_source,
        case when p_type = 'whatsapp' then p_sender end,
        case when p_type = 'instagram' then p_sender end)
      returning id into v_contact;
  end if;

  select case when exists (select 1 from public.ai_agents
      where organization_id = p_org and is_active and auto_reply) then 'ai' else 'human' end::public.handler_type
    into v_handler;
  select * into conv from public.conversations
    where organization_id = p_org and contact_id = v_contact and channel_id = p_channel
    order by created_at desc, id desc limit 1
    for update;
  if conv.id is null then
    insert into public.conversations (organization_id, contact_id, channel_id, status, handled_by, last_message_at)
      values (p_org, v_contact, p_channel, 'open', v_handler, p_at)
      returning * into conv;
  elsif conv.status = 'closed' then
    update public.conversations set status = 'open', assigned_to = null, closed_at = null, handled_by = v_handler
      where id = conv.id
      returning * into conv;
  end if;
  return conv;
end $$;

-- ---------------------------------------------------------------- núcleo do ingest (000009 sobre o helper)
-- Mesma ordem de 000009: travas → duplicata → busca do contato → portão do clique assinado (antes de criar
-- contato/conversa) → contato + conversa (helper) → mensagem → interação.
create or replace function private.ingest_inbound_core(
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
  conv public.conversations;
  v_name text := nullif(btrim(coalesce(p_sender_name, '')), '');
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
  v_click text;
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

  -- 4. contato (busca)
  if p_contact is not null then
    select id into v_contact from public.contacts where id = p_contact and organization_id = p_org;
    if v_contact is null then return null; end if;
  else
    v_contact := private.inbound_find_contact(p_org, p_type, p_sender_external_id);
  end if;
  -- Clique assinado: adulterado / de outra organização ou contato é descartado (nunca cria contato nem conversa).
  -- Autêntico mas vencido entra como texto comum, sem payload e marcado (não retoma a espera atual).
  -- A serialização do remetente foi feita acima, antes das travas de conversa → execução.
  if v_context ? 'payload' then
    if v_contact is not null then
      select id into v_conv from public.conversations
        where organization_id = p_org and contact_id = v_contact and channel_id = p_channel
        order by created_at desc, id desc limit 1;
    end if;
    v_click := private.automation_click_kind(p_org, v_contact, v_conv, v_context ->> 'payload');
    if v_click = 'forged' then return null; end if;
    if v_click = 'stale' then v_context := (v_context - 'payload') || '{"staleClick":true}'::jsonb; end if;
  end if;

  -- 4–5. contato (criação) e conversa (a mais recente do contato no canal)
  conv := private.inbound_conversation(p_org, p_channel, p_type, p_sender_external_id, v_name, p_at, v_contact);
  v_contact := conv.contact_id;
  v_conv := conv.id;

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

-- ---------------------------------------------------------------- abertura
-- p_at: instante do evento (nunca no futuro); a conversa nova usa-o em last_message_at e a nota fica 1 ms antes
-- dele, para ser ordenada antes da mensagem que veio junto (gravada em p_at).
-- Retorna {ignored:true} (link desconhecido/arquivado/de outro canal) ou
-- {ignored:false, duplicate, linkId, hitId, contactId, conversationId, runId}.
create function private.entry_link_open(p_channel uuid, p_sender text, p_code text, p_external_id text,
  p_contact uuid default null, p_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.entry_links;
  v_type public.channel_type;
  v_sender text := btrim(coalesce(p_sender, ''));
  v_external text := coalesce(p_external_id, '');
  v_at timestamptz := least(coalesce(p_at, now()), now());
  conv public.conversations;
  h public.entry_link_hits;
  v_hit uuid;
  auto public.automations;
  v_event uuid;
  v_run uuid;
begin
  l := private.entry_link_resolve(p_channel, p_code);
  if l.id is null then return jsonb_build_object('ignored', true); end if;
  if v_sender = '' or v_external = '' then raise exception 'invalid input' using errcode = '22023'; end if;
  -- external_id do provedor maior que a coluna: hash determinístico (mantém a idempotência)
  if char_length(v_external) > 200 then
    v_external := 'sha256:' || encode(extensions.digest(convert_to(v_external, 'UTF8'), 'sha256'), 'hex');
  end if;
  select type into v_type from public.channels where id = p_channel;

  -- mesma serialização por remetente da ingestão (antes das travas de conversa → execução)
  perform pg_advisory_xact_lock(hashtextextended('ingest:sender:' || l.organization_id::text || ':' || v_type::text
    || ':' || v_sender, 0));

  -- RF1: uso já registrado → devolve o registro existente, sem novo uso, contato, conversa, nota, tag ou execução
  select * into h from public.entry_link_hits where link_id = l.id and external_id = v_external;
  if found then
    return jsonb_build_object('ignored', false, 'duplicate', true, 'linkId', l.id, 'hitId', h.id,
      'contactId', h.contact_id, 'conversationId', h.conversation_id, 'runId', null);
  end if;

  if p_contact is not null and not exists (select 1 from public.contacts
      where id = p_contact and organization_id = l.organization_id) then
    return jsonb_build_object('ignored', true);
  end if;
  conv := private.inbound_conversation(l.organization_id, p_channel, v_type, v_sender, null, v_at, p_contact);
  update public.contacts set last_interaction_at = greatest(coalesce(last_interaction_at, v_at), v_at)
    where id = conv.contact_id;

  -- uso (on conflict: corrida com outro remetente no mesmo external_id — trata como o RF1 acima)
  insert into public.entry_link_hits (organization_id, link_id, contact_id, conversation_id, external_id)
    values (l.organization_id, l.id, conv.contact_id, conv.id, v_external)
    on conflict (link_id, external_id) do nothing
    returning id into v_hit;
  if v_hit is null then
    select * into h from public.entry_link_hits where link_id = l.id and external_id = v_external;
    return jsonb_build_object('ignored', false, 'duplicate', true, 'linkId', l.id, 'hitId', h.id,
      'contactId', h.contact_id, 'conversationId', h.conversation_id, 'runId', null);
  end if;

  -- nota de sistema (uma por uso)
  insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status,
      created_at)
    values (l.organization_id, conv.id, p_channel, 'outbound', 'system', 'Entrou pelo link ' || l.name, 'delivered',
      v_at - interval '1 millisecond');

  -- gatilho entry_link: só com a conversa livre (sem execução ativa e sem humano, regras da 7A); ocupada = só o uso
  if not private.automation_conversation_busy(l.organization_id, conv.id, null)
     and not private.automation_human_handled(conv) then
    select a.* into auto
      from public.automations a
      join public.automation_versions v on v.automation_id = a.id and v.version = a.current_version
      where a.organization_id = l.organization_id and a.status = 'active' and v.trigger_type = 'entry_link'
        and jsonb_typeof(v.trigger_config -> 'linkIds') = 'array' and v.trigger_config -> 'linkIds' ? l.id::text
      order by a.activated_at nulls last, a.id
      limit 1;
    if found then
      insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, actor_id, payload)
        values (l.organization_id, 'automation_trigger', conv.id, conv.contact_id, 'system', null,
          jsonb_build_object('automation_id', auto.id, 'entry_link_id', l.id, 'hit_id', v_hit))
        returning id into v_event;
      v_run := private.automation_start_run(auto, v_event, conv.id, conv.contact_id);
      if v_run is not null then
        perform private.automation_link_run(conv.id, v_run);
      end if;
    end if;
  end if;

  -- tag do link (depois da execução: tag_added encontra a conversa ocupada)
  if l.tag_id is not null then
    insert into public.contact_tags (organization_id, contact_id, tag_id)
      values (l.organization_id, conv.contact_id, l.tag_id)
      on conflict do nothing;
  end if;

  return jsonb_build_object('ignored', false, 'duplicate', false, 'linkId', l.id, 'hitId', v_hit,
    'contactId', conv.contact_id, 'conversationId', conv.id, 'runId', v_run);
end $$;

revoke all on function private.entry_link_resolve(uuid, text), private.entry_link_referral_valid(uuid, jsonb),
  private.inbound_find_contact(uuid, public.channel_type, text),
  private.inbound_conversation(uuid, uuid, public.channel_type, text, text, timestamptz, uuid),
  private.entry_link_open(uuid, text, text, text, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- Simulador
-- Erros: 42501 = sem permissão (inclui link inexistente ou de outra organização); 22023 'not_simulator' |
-- 'entry_link_archived' | 'invalid_phone' | 'invalid_name'; P0002 = canal inativo.
create function public.simulate_entry_link(p_link uuid, p_contact_phone text, p_contact_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l public.entry_links;
  ch public.channels;
  v_phone text := btrim(coalesce(p_contact_phone, ''));
  v_name text := nullif(btrim(coalesce(p_contact_name, '')), '');
  conv public.conversations;
  r jsonb;
begin
  select * into l from public.entry_links where id = p_link;
  if not found or not public.has_role(l.organization_id, 'agent') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into ch from public.channels where id = l.channel_id;
  if ch.type is distinct from 'simulator' then raise exception 'not_simulator' using errcode = '22023'; end if;
  if ch.status is distinct from 'active' then
    raise exception 'channel not found or inactive' using errcode = 'P0002';
  end if;
  if l.status <> 'active' then raise exception 'entry_link_archived' using errcode = '22023'; end if;
  if v_phone = '' or char_length(v_phone) > 100 then raise exception 'invalid_phone' using errcode = '22023'; end if;
  if char_length(v_name) > 120 then raise exception 'invalid_name' using errcode = '22023'; end if;

  -- contato com o nome informado (o Simulador não tem busca de perfil); a abertura reaproveita a conversa
  perform pg_advisory_xact_lock(hashtextextended('ingest:sender:' || l.organization_id::text || ':simulator:'
    || v_phone, 0));
  conv := private.inbound_conversation(l.organization_id, l.channel_id, 'simulator', v_phone, v_name, now(), null);
  update public.contacts set name = v_name where id = conv.contact_id and name is null and v_name is not null;

  r := private.entry_link_open(l.channel_id, v_phone, l.code, 'sim:' || gen_random_uuid()::text, conv.contact_id,
    now());
  if coalesce((r ->> 'ignored')::boolean, true) then
    raise exception 'entry_link_archived' using errcode = '22023';
  end if;
  return (r ->> 'conversationId')::uuid;
end $$;

revoke all on function public.simulate_entry_link(uuid, text, text) from public, anon;
grant execute on function public.simulate_entry_link(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- ingest do Instagram
-- Sobre 000009: kind 'referral' (abre o link; sem mensagem) e mensagem com context.referral (abre o link antes da
-- ingestão, para que a mensagem encontre a conversa já em automação e não dispare outro gatilho).
create or replace function public.ingest_instagram_event(p_connection_id uuid,p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ch public.channels; ev public.instagram_events; a public.automations;
  v_kind text:=p_event->>'kind'; v_external text:=p_event->>'externalId'; v_at timestamptz;
  v_message uuid; v_state text:='done'; v_context jsonb; signed jsonb; v_click text; v_open jsonb;
begin
  select channels.* into ch from public.channels join public.meta_connections mc on mc.id=channels.meta_connection_id
    where mc.id=p_connection_id and mc.disconnected_at is null and channels.external_account_id=p_event->>'accountId'
      and channels.type='instagram' for share of channels,mc;
  if not found or ch.status<>'active' then return jsonb_build_object('state','ignored'); end if;
  if v_kind is null or v_kind not in ('message','button','comment','status','ignored','referral') or coalesce(v_external,'')=''
    or length(v_external)>2048 then raise exception 'invalid event' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('instagram-event:'||ch.id||':'||v_kind||':'||v_external,0));
  select * into ev from public.instagram_events where channel_id=ch.id and kind=v_kind and external_id=v_external;
  if found then return jsonb_build_object('eventId',ev.id,'messageId',ev.message_id,'state',ev.state); end if;
  v_at:=least((p_event->>'occurredAt')::timestamptz,now());
  if v_at is null then raise exception 'missing timestamp' using errcode='22023'; end if;
  if v_kind in ('message','button') then
    v_context:=case when v_kind='button' then jsonb_build_object('origin','button','payload',p_event->>'payload')
      else coalesce(p_event->'context','{}'::jsonb) end;
    -- Match the seven-argument ingester's message -> sender -> conversation -> run order.
    perform pg_advisory_xact_lock(hashtextextended('ingest:msg:'||ch.id||':'||v_external,0));
    if v_kind='button' or v_context ? 'payload' then
      v_click:=private.instagram_automation_click_kind(ch.id,p_event->>'senderExternalId',v_context->>'payload');
    end if;
    if v_click='forged' then v_state:='ignored';
    else
      -- Authentic but stale: ordinary text without the payload (never resumes the current wait).
      if v_click='stale' then v_context:=(v_context-'payload')||'{"staleClick":true}'::jsonb; end if;
      -- 7B: the entry link opens first (unknown/archived codes are ignored; the message always enters).
      -- Same echo guard as the referral kind: the account itself never opens a link.
      if v_kind='message' and jsonb_typeof(v_context->'referral')='object'
         and coalesce(p_event->>'senderExternalId','')<>'' and p_event->>'senderExternalId'<>ch.external_account_id then
        perform private.entry_link_open(ch.id,p_event->>'senderExternalId',v_context#>>'{referral,ref}',v_external,
          null,v_at);
      end if;
      v_message:=public.ingest_inbound_message(ch.id,v_external,p_event->>'senderExternalId',p_event->>'senderName',
        case when v_kind='button' then p_event->>'title' else p_event->>'text' end,v_at,v_context);
      if exists(select 1 from public.messages m where m.id=v_message and m.context ? 'payload') then
        signed:=private.automation_verify_payload(v_context->>'payload');
        insert into public.events(organization_id,type,conversation_id,contact_id,actor_type,payload)
          select m.organization_id,'button_clicked',m.conversation_id,c.contact_id,'contact',signed
          from public.messages m join public.conversations c on c.id=m.conversation_id where m.id=v_message;
      end if;
    end if;
  elsif v_kind='referral' then
    if coalesce(p_event->>'senderExternalId','')='' or p_event->>'senderExternalId'=ch.external_account_id then
      v_state:='ignored';
    else
      v_open:=private.entry_link_open(ch.id,p_event->>'senderExternalId',p_event->>'ref',v_external,null,v_at);
      if coalesce((v_open->>'ignored')::boolean,true) then v_state:='ignored'; end if;
    end if;
  elsif v_kind='comment' then
    if p_event->>'senderExternalId' is distinct from ch.external_account_id and coalesce(p_event->>'senderExternalId','')<>'' then
      select x.* into a from public.automations x join public.automation_versions v
        on v.automation_id=x.id and v.version=x.current_version
        where x.organization_id=ch.organization_id and x.status='active' and x.activated_at<=now()
          and v.trigger_type='instagram_comment' and v.trigger_config->>'channelId'=ch.id::text
          and (v.trigger_config->>'mediaId' is null or v.trigger_config->>'mediaId'=p_event->>'mediaId')
          and private.automation_keyword_matches(p_event->>'text',v.trigger_config)
          and private.instagram_comment_first_node(v.graph) is not null
        order by x.activated_at,x.id limit 1;
    end if;
    v_state:=case when a.id is null then 'ignored' else 'pending' end;
  elsif v_kind='status' then
    if p_event->>'state'<>'read' or coalesce(p_event->>'messageExternalId','')='' then raise exception 'invalid receipt' using errcode='22023'; end if;
    update public.messages set status='read' where channel_id=ch.id and external_id=p_event->>'messageExternalId'
      and direction='outbound' and not is_internal_note returning id into v_message;
  else v_state:='ignored'; end if;
  insert into public.instagram_events(organization_id,channel_id,kind,external_id,payload,occurred_at,
    automation_id,automation_version,automation_activated_at,message_id,state)
    values(ch.organization_id,ch.id,v_kind,v_external,p_event,v_at,a.id,a.current_version,a.activated_at,v_message,v_state)
    returning * into ev;
  if v_state='pending' then perform pgmq.send('instagram_work',jsonb_build_object('eventId',ev.id)); end if;
  return jsonb_build_object('eventId',ev.id,'messageId',ev.message_id,'state',ev.state);
end $$;

-- Exclusão do contato também apaga o payload dos referrals dele.
create or replace function public.purge_instagram_contact_data() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.instagram_events set payload=jsonb_build_object('purged',true),
      state=case when state='pending' then 'ignored' else state end,
      last_error=case when state='pending' then 'contact_deleted' else last_error end
    where organization_id=old.organization_id and kind in ('message','button','comment','referral')
      and payload->>'senderExternalId'=old.instagram_id;
  update public.instagram_send_intents set state='failed',error_code='contact_deleted'
    where organization_id=old.organization_id and kind='private_reply' and state='pending'
      and recipient_external_id=old.instagram_id;
  return old;
end $$;
drop index public.instagram_events_sender_idx;
create index instagram_events_sender_idx on public.instagram_events(organization_id,(payload->>'senderExternalId'))
  where kind in ('message','button','comment','referral');

-- ---------------------------------------------------------------- mensagem recebida
-- Sobre 000009: uma mensagem com referral válido (link ativo do canal) nunca inicia um gatilho de mensagem — a
-- entrada pelo link tem prioridade (e já iniciou a automação entry_link, quando havia uma).
create or replace function private.automation_inbound() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  conv public.conversations;
  run public.automation_runs;
  auto public.automations;
  v_verified jsonb;
  v_option text;
  v_first boolean;
  v_event uuid;
  v_run uuid;
begin
  select * into conv from public.conversations
    where id = new.conversation_id and organization_id = new.organization_id for update;
  if not found then return null; end if;

  -- Never fall back to title matching or another trigger for supplied invalid context.
  if new.context ? 'payload' then
    v_verified:=private.automation_signed_reply(conv.organization_id,conv.id,new.context->>'payload');
    if v_verified is null then return null; end if;
  end if;

  -- 1. retomada: só a primeira resposta (input ainda nulo); as seguintes não sobrescrevem. Um clique autêntico
  -- vencido (staleClick) é texto comum mas nunca retoma a espera atual pelo título.
  if coalesce(new.context ->> 'staleClick', '') <> 'true' then
    select r.* into run from public.automation_runs r
      where r.organization_id = conv.organization_id and r.conversation_id = conv.id
        and r.status = 'waiting' and r.waiting_for = 'reply' and r.input is null
      order by (r.id = conv.automation_run_id) desc nulls last, r.created_at desc, r.id
      limit 1
      for update;
    if found then
      if new.context ? 'payload' and (v_verified->>'runId' is distinct from run.id::text
        or v_verified->>'nodeId' is distinct from run.wait_node_id::text) then return null; end if;
      if v_verified ->> 'runId' = run.id::text and v_verified ->> 'nodeId' = run.wait_node_id::text then
        v_option := v_verified ->> 'optionId';
      end if;
      update public.automation_runs
        set input = jsonb_build_object('optionId', v_option, 'text', new.content), resume_at = now()
        where id = run.id;
      perform private.automation_link_run(conv.id, run.id);
      return null;
    end if;
  end if;

  -- 2. conversa já em automação: nada a fazer (e a IA não é enfileirada)
  if exists (select 1 from public.automation_runs r
      where r.organization_id = conv.organization_id
        and (r.conversation_id = conv.id or r.id = conv.automation_run_id)
        and r.status in ('pending', 'running', 'waiting')) then
    return null;
  end if;

  -- conversa com humano: nenhuma execução nova
  if private.automation_human_handled(conv) then return null; end if;

  -- 7B: entrada por link tem prioridade sobre os gatilhos de mensagem
  if private.entry_link_referral_valid(new.channel_id, new.context) then return null; end if;

  v_first := not exists (select 1 from public.messages m
    where m.conversation_id = conv.id and m.id <> new.id and m.direction = 'inbound'
      and m.sender_type = 'contact' and not m.is_internal_note);

  select a.* into auto
    from public.automations a
    join public.automation_versions v on v.automation_id = a.id and v.version = a.current_version
    where a.organization_id = conv.organization_id and a.status = 'active'
      and (
        (v.trigger_type = 'keyword_detected' and private.automation_keyword_matches(new.content, v.trigger_config))
        or (v.trigger_type = 'message_received'
            and (v.trigger_config -> 'firstMessageOnly' is distinct from 'true'::jsonb or v_first))
        or (v.trigger_type = 'instagram_story'
            and new.context ->> 'origin' in ('story_reply', 'story_mention')
            and v.trigger_config ->> 'channelId' = new.channel_id::text)
      )
    order by a.activated_at nulls last, a.id
    limit 1;
  if not found then return null; end if;

  insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, actor_id, payload)
    values (conv.organization_id, 'automation_trigger', conv.id, conv.contact_id, 'system', null,
      jsonb_build_object('automation_id', auto.id, 'message_id', new.id))
    returning id into v_event;
  v_run := private.automation_start_run(auto, v_event, conv.id, conv.contact_id);
  if v_run is not null then
    perform private.automation_link_run(conv.id, v_run);
  end if;
  return null;
end $$;
