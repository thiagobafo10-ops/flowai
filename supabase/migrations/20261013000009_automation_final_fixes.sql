-- Fase 7A: onda final de correções (revisão do branch).
-- * contains por palavra/frase inteira (mesma regra de instagram_keyword_matches da Fase 5);
-- * a IA nunca responde (nem transfere) por cima de uma execução ativa;
-- * mensagem final do cliente sem resposta: handoff_ai e execuções retomadas por texto que terminam em silêncio
--   enfileiram a IA (mesma regra de enfileiramento da Fase 6, run_after = now() + 4 s);
-- * encerrar a conversa é terminal; handoff_human grava handoff_reason = 'automation';
-- * cliques autênticos vencidos (HMAC válido, execução da mesma organização e do mesmo contato) entram como texto
--   comum, sem payload e sem retomar a espera atual; adulterados / de outra organização ou contato seguem descartados;
-- * conversas com humano não iniciam novas execuções (retomadas continuam);
-- * Parar automação fecha o passo em espera; automação pausada/excluída não envia resposta privada da fila.

-- ---------------------------------------------------------------- motivo de transferência da automação
alter table public.conversations drop constraint conversations_handoff_reason_check;
alter table public.conversations add constraint conversations_handoff_reason_check
  check (handoff_reason in ('needs_human', 'no_knowledge', 'unverified_fact', 'injection', 'quota_exceeded',
    'not_configured', 'ai_failure', 'window_closed', 'reply_too_long', 'automation'));

-- ---------------------------------------------------------------- palavras-chave
-- contains: a palavra-chave (ou frase) precisa aparecer inteira, entre limites de palavra ([[:alnum:]_]).
create or replace function private.automation_keyword_matches(p_text text, p_config jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare v_text text := private.automation_normalize(p_text); v_mode text := p_config ->> 'mode'; k text; v_kw text;
  n int; v_from int;
begin
  if v_text = '' or jsonb_typeof(p_config -> 'keywords') is distinct from 'array' then return false; end if;
  for k in select jsonb_array_elements_text(p_config -> 'keywords') loop
    v_kw := private.automation_normalize(k);
    continue when v_kw = '';
    if (v_mode = 'equals' and v_text = v_kw)
       or (v_mode = 'starts_with' and left(v_text, char_length(v_kw)) = v_kw) then
      return true;
    end if;
    if v_mode = 'contains' then
      v_from := 1;
      loop
        n := strpos(substr(v_text, v_from), v_kw);
        exit when n = 0;
        n := n + v_from - 1;
        if (n = 1 or substr(v_text, n - 1, 1) !~ '[[:alnum:]_]')
           and (n + char_length(v_kw) > char_length(v_text) or substr(v_text, n + char_length(v_kw), 1) !~ '[[:alnum:]_]') then
          return true;
        end if;
        v_from := n + 1;
      end loop;
    end if;
  end loop;
  return false;
end $$;

-- ---------------------------------------------------------------- IA × automação
-- Elegibilidade da Fase 6 + a conversa não está em automação (execução pending/running/waiting vinculada).
-- prepare/complete_ai_reply e handoff_ai_job passam a pular (e cancelar) a tarefa quando uma execução assume.
create or replace function private.ai_reply_eligible(p_conv public.conversations) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_conv.id is not null and p_conv.handled_by = 'ai' and p_conv.status = 'open'
    and exists (select 1 from public.channels ch
                where ch.id = p_conv.channel_id and ch.type in ('simulator', 'instagram'))
    and exists (select 1 from public.ai_agents a
                where a.organization_id = p_conv.organization_id and a.is_active and a.auto_reply)
    and not exists (select 1 from public.automation_runs r
                    where r.id = p_conv.automation_run_id and r.status in ('pending', 'running', 'waiting')), false);
$$;

-- Enfileira a IA para a última mensagem do cliente quando ela ficou sem resposta: a conversa é elegível e a
-- mensagem mais recente do contato é mais nova que qualquer resposta enviada (mensagens de sistema não contam).
create function private.automation_enqueue_ai(p_conv uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.conversations; v_in timestamptz;
begin
  select * into c from public.conversations where id = p_conv;
  if not found or not private.ai_reply_eligible(c) then return; end if;
  select m.created_at into v_in from public.messages m
    where m.conversation_id = c.id and m.direction = 'inbound' and m.sender_type = 'contact' and not m.is_internal_note
    order by m.created_at desc, m.id desc limit 1;
  if v_in is null or exists (select 1 from public.messages m
      where m.conversation_id = c.id and m.direction = 'outbound' and not m.is_internal_note
        and m.sender_type <> 'system' and m.created_at >= v_in) then
    return;
  end if;
  insert into public.ai_jobs (organization_id, kind, conversation_id, run_after)
    values (c.organization_id, 'reply', c.id, now() + interval '4 seconds')
    on conflict (conversation_id) where kind = 'reply' and state = 'pending'
    do update set run_after = now() + interval '4 seconds';
end $$;

-- Conversa com humano: aguardando humano, ou assumida por humano numa organização com a IA ligada. Sem IA ativa,
-- handled_by = 'human' é apenas o padrão de toda conversa e não impede automações.
create function private.automation_human_handled(p_conv public.conversations) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_conv.status = 'pending_human'
    or (p_conv.handled_by = 'human' and exists (select 1 from public.ai_agents a
        where a.organization_id = p_conv.organization_id and a.is_active and a.auto_reply)), false);
$$;

-- ---------------------------------------------------------------- cliques assinados
-- valid = retoma a espera; stale = assinatura válida de uma execução desta organização e deste contato que não
-- aguarda mais este clique (entra como texto comum); forged = adulterado, de outra organização ou de outro contato.
create function private.automation_click_kind(p_org uuid, p_contact uuid, p_conv uuid, p_payload text) returns text
language plpgsql security definer set search_path = '' as $$
declare signed jsonb := private.automation_verify_payload(p_payload);
begin
  if signed is null or p_contact is null then return 'forged'; end if;
  if not exists (select 1 from public.automation_runs r where r.id = (signed ->> 'runId')::uuid
      and r.organization_id = p_org and r.contact_id = p_contact) then
    return 'forged';
  end if;
  if private.automation_signed_reply(p_org, p_conv, p_payload) is not null then return 'valid'; end if;
  return 'stale';
end $$;

create function private.instagram_automation_click_kind(p_channel uuid, p_sender text, p_payload text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_contact uuid; v_conv uuid;
begin
  select organization_id into v_org from public.channels where id = p_channel and type = 'instagram';
  if not found then return 'forged'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ingest:sender:' || v_org || ':instagram:' || p_sender, 0));
  select ct.id, c.id into v_contact, v_conv from public.contacts ct
    left join public.conversations c on c.contact_id = ct.id and c.organization_id = ct.organization_id and c.channel_id = p_channel
    where ct.organization_id = v_org and ct.instagram_id = p_sender
    order by c.created_at desc nulls last, c.id desc limit 1;
  return private.automation_click_kind(v_org, v_contact, v_conv, p_payload);
end $$;

-- substituída por instagram_automation_click_kind (o único chamador, ingest_instagram_event, é recriado abaixo)
drop function private.instagram_automation_click_valid(uuid, text, text);

-- ---------------------------------------------------------------- núcleo do ingest
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
  v_conv_status public.conversation_status;
  v_handler public.handler_type;
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

-- ---------------------------------------------------------------- clique simulado
-- O núcleo agora grava cliques vencidos como texto; o Simulador mantém o erro 'not_waiting' (a transação inteira
-- é desfeita, sem mensagem).
create or replace function public.click_automation_button(p_message_id uuid, p_option_id text) returns uuid
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
  -- descartado, ou vencido sob as travas (o núcleo o gravou como texto): desfaz tudo
  if v_msg is null or not exists (select 1 from public.messages x where x.id = v_msg and x.context ? 'payload') then
    raise exception 'not_waiting' using errcode = '22023';
  end if;

  insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, payload)
    select c.organization_id, 'button_clicked', c.id, c.contact_id, 'contact',
      jsonb_build_object('runId', v_run, 'nodeId', v_node, 'optionId', p_option_id)
    from public.messages x join public.conversations c on c.id = x.conversation_id where x.id = v_msg;
  return v_msg;
end $$;

-- ---------------------------------------------------------------- ingest do Instagram
create or replace function public.ingest_instagram_event(p_connection_id uuid,p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ch public.channels; ev public.instagram_events; a public.automations;
  v_kind text:=p_event->>'kind'; v_external text:=p_event->>'externalId'; v_at timestamptz;
  v_message uuid; v_state text:='done'; v_context jsonb; signed jsonb; v_click text;
begin
  select channels.* into ch from public.channels join public.meta_connections mc on mc.id=channels.meta_connection_id
    where mc.id=p_connection_id and mc.disconnected_at is null and channels.external_account_id=p_event->>'accountId'
      and channels.type='instagram' for share of channels,mc;
  if not found or ch.status<>'active' then return jsonb_build_object('state','ignored'); end if;
  if v_kind is null or v_kind not in ('message','button','comment','status','ignored') or coalesce(v_external,'')=''
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
      v_message:=public.ingest_inbound_message(ch.id,v_external,p_event->>'senderExternalId',p_event->>'senderName',
        case when v_kind='button' then p_event->>'title' else p_event->>'text' end,v_at,v_context);
      if exists(select 1 from public.messages m where m.id=v_message and m.context ? 'payload') then
        signed:=private.automation_verify_payload(v_context->>'payload');
        insert into public.events(organization_id,type,conversation_id,contact_id,actor_type,payload)
          select m.organization_id,'button_clicked',m.conversation_id,c.contact_id,'contact',signed
          from public.messages m join public.conversations c on c.id=m.conversation_id where m.id=v_message;
      end if;
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

-- ---------------------------------------------------------------- mensagem recebida
-- Ordem: (1) execução aguardando resposta/clique -> retoma (cliques vencidos nunca retomam); (2) conversa em
-- automação ou com humano -> nada; (3) automação casada -> nova execução; senão a IA segue como antes.
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

-- ---------------------------------------------------------------- eventos de CRM
create or replace function private.automation_crm_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.automation_trigger_type;
  v_key text;
  v_value text;
  v_conv uuid;
  v_locked public.conversations;
  v_run uuid;
  auto public.automations;
begin
  if new.contact_id is null then return null; end if;
  case new.type
    when 'contact_created' then v_type := 'contact_created';
    when 'tag_added' then v_type := 'tag_added'; v_key := 'tagId'; v_value := new.payload ->> 'tag_id';
    when 'deal_created' then v_type := 'stage_changed'; v_key := 'stageId'; v_value := new.payload ->> 'stage_id';
    when 'deal_stage_changed' then v_type := 'stage_changed'; v_key := 'stageId'; v_value := new.payload ->> 'to_stage_id';
    else return null;
  end case;
  if not exists (select 1 from public.automations a
      where a.organization_id = new.organization_id and a.status = 'active' and a.trigger_type = v_type) then
    return null;
  end if;

  select c.id into v_conv from public.conversations c
    where c.organization_id = new.organization_id and c.contact_id = new.contact_id and c.status <> 'closed'
    order by c.last_message_at desc nulls last, c.created_at desc, c.id desc
    limit 1;

  -- Serializa o disparo na conversa (ver 000003: SKIP LOCKED evita inverter a ordem de travas da ingestão;
  -- conversa travada por outra transação = ocupada, nada é registrado).
  if v_conv is not null then
    select c.* into v_locked from public.conversations c where c.id = v_conv for update skip locked;
    if v_locked.id is null then return null; end if;
    -- conversa com humano: nenhuma execução nova
    if private.automation_human_handled(v_locked) then return null; end if;
  end if;

  for auto in
    select a.* from public.automations a
      join public.automation_versions v on v.automation_id = a.id and v.version = a.current_version
      where a.organization_id = new.organization_id and a.status = 'active' and v.trigger_type = v_type
        and (v_key is null or coalesce(v.trigger_config -> v_key, 'null'::jsonb) = 'null'::jsonb
             or v.trigger_config ->> v_key = v_value)
      order by a.activated_at nulls last, a.id
  loop
    -- uma execução ativa por conversa: com a conversa ocupada, nada é registrado
    if v_conv is not null and exists (select 1 from public.automation_runs r
        join public.conversations c on c.id = v_conv
        where r.organization_id = new.organization_id
          and (r.conversation_id = v_conv or r.id = c.automation_run_id)
          and r.status in ('pending', 'running', 'waiting')) then
      continue;
    end if;
    v_run := private.automation_start_run(auto, new.id, v_conv, new.contact_id);
    if v_run is not null and v_conv is not null then
      perform private.automation_link_run(v_conv, v_run);
    end if;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------- aplicação do passo
-- Mudanças sobre 000004: close_conversation é terminal; handoff_human grava handoff_reason 'automation';
-- handoff_ai enfileira a IA para a mensagem pendente do cliente; a retomada por texto digitado (sem optionId)
-- marca o passo (output.typedReply) e, se a execução concluir sem responder depois disso, a IA é enfileirada.
create or replace function private.automation_apply_step(p_run uuid, p_token uuid, p_step jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  run public.automation_runs;
  conv public.conversations;
  v_node_id uuid := (p_step ->> 'nodeId')::uuid;
  v_iteration int := (p_step ->> 'iteration')::int;
  v_handle text := p_step ->> 'handle';
  v_ai jsonb := nullif(p_step -> 'aiReply', 'null'::jsonb);
  v_route jsonb := p_step -> 'route';
  v_graph jsonb; v_node jsonb; v_out jsonb; v_resume boolean := false; v_has_step boolean;
  v_next uuid; v_until timestamptz; v_kind text;
  e jsonb; v_text text; v_block text; v_send record; v_cand uuid; v_send_block text; v_conv_checked boolean := false;
  v_terminal boolean := false; v_reroute boolean := false;
  v_result text; v_intents uuid[] := '{}'; v_payloads jsonb := '{}'::jsonb; v_status public.run_status; v_error text;
  v_typed boolean;
begin
  run := private.automation_lock_run(p_run);
  if run.id is null then raise exception 'invalid claim' using errcode = '42501'; end if;

  select s.output into v_out from public.automation_run_steps s
    where s.run_id = run.id and s.node_id = v_node_id and s.iteration = v_iteration;
  v_has_step := found;
  v_resume := v_has_step and run.status = 'running' and p_token is not null and run.claim_token = p_token
    and run.waiting_for is not null and run.current_node_id = v_node_id and run.iteration = v_iteration;
  -- replay: o passo já foi aplicado, devolve o resultado gravado sem efeito algum
  if v_has_step and not v_resume then return v_out; end if;

  if run.status <> 'running' or p_token is null or run.claim_token is distinct from p_token then
    raise exception 'invalid claim' using errcode = '42501';
  end if;
  if v_iteration <> run.iteration or v_node_id is distinct from run.current_node_id then
    raise exception 'invalid step node' using errcode = '22023';
  end if;
  if run.waiting_for is not null and not v_resume then
    raise exception 'wait not resolved' using errcode = '22023';
  end if;
  v_graph := private.automation_run_graph(run);
  v_node := private.automation_graph_node(v_graph, v_node_id);
  if v_node is null then raise exception 'invalid step node' using errcode = '22023'; end if;

  select k into v_kind from jsonb_object_keys(v_route) k;
  if v_kind = 'next' then
    v_next := (v_route ->> 'next')::uuid;
    if private.automation_graph_node(v_graph, v_next) is null then raise exception 'invalid next' using errcode = '22023'; end if;
  elsif v_kind in ('waitReply', 'waitDelay') then
    begin
      v_until := (v_route -> v_kind ->> 'until')::timestamptz;
    exception when others then
      raise exception 'invalid until' using errcode = '22023';
    end;
    if v_until is null or v_until > now() + interval '7 days 1 hour' then
      raise exception 'invalid until' using errcode = '22023';
    end if;
  end if;

  -- conversa da execução fechada desde o último passo: cancela (result conversation_closed) e libera o
  -- vínculo; a execução nunca é estacionada em espera numa conversa fechada.
  if run.conversation_id is not null then
    select * into conv from public.conversations where id = run.conversation_id;
    if conv.id is null or conv.status = 'closed' then
      v_out := jsonb_build_object('state', 'cancelled', 'intentIds', '[]'::jsonb, 'payloads', '{}'::jsonb,
        'result', 'conversation_closed', 'currentNodeId', v_node_id);
      perform private.automation_cancel_run(run.id);
      if v_resume then
        update public.automation_run_steps set status = 'cancelled', output = v_out
          where run_id = run.id and node_id = v_node_id and iteration = v_iteration;
      else
        insert into public.automation_run_steps (organization_id, run_id, node_id, iteration, status, output, handle)
          values (run.organization_id, run.id, v_node_id, v_iteration, 'cancelled', v_out, v_handle);
      end if;
      return v_out;
    end if;
  end if;

  -- retomada da espera: conclui o passo do nó de espera com o handle resolvido. O worker é um serviço
  -- confiável: o handle não é conferido contra input aqui (o worker o calcula com resolveReply sobre o
  -- input devolvido por prepare); só se exige que a execução esteja de fato aguardando neste nó.
  if v_resume then
    if jsonb_array_length(p_step -> 'effects') > 0 or v_kind not in ('next', 'end') or v_handle is null then
      raise exception 'invalid resume' using errcode = '22023';
    end if;
    -- texto digitado pelo cliente (não um clique assinado nem o fim do prazo)
    v_typed := run.waiting_for = 'reply' and run.input is not null and run.input ->> 'optionId' is null
      and run.input ->> 'text' is not null;
    if v_kind = 'next' then
      update public.automation_runs set current_node_id = v_next, waiting_for = null, wait_node_id = null, input = null,
        resume_at = null where id = run.id;
      v_status := 'running';
    else
      update public.automation_runs set status = 'completed', waiting_for = null, wait_node_id = null, input = null,
        resume_at = null, claim_token = null, claimed_until = null where id = run.id;
      perform private.automation_release(run.id);
      v_status := 'completed';
    end if;
    v_out := jsonb_build_object('state', v_status, 'intentIds', '[]'::jsonb, 'payloads', '{}'::jsonb, 'result', null,
      'currentNodeId', case when v_kind = 'next' then v_next else v_node_id end)
      || case when v_typed then '{"typedReply":true}'::jsonb else '{}'::jsonb end;
    update public.automation_run_steps set status = 'completed', handle = v_handle, output = v_out
      where run_id = run.id and node_id = v_node_id and iteration = v_iteration;
    if v_status = 'completed' and v_typed and conv.id is not null then
      perform private.automation_enqueue_ai(conv.id);
    end if;
    return v_out;
  end if;

  -- limite de passos e erro informado pelo worker: falha sem efeitos
  if run.step_count >= 50 or p_step ->> 'error' is not null then
    v_error := case when run.step_count >= 50 then 'max_steps'
                    when p_step ->> 'error' ~ '^[a-z0-9_]{1,64}$' then p_step ->> 'error' else 'invalid_code' end;
    v_out := jsonb_build_object('state', 'failed', 'intentIds', '[]'::jsonb, 'payloads', '{}'::jsonb, 'result', v_error,
      'currentNodeId', v_node_id);
    insert into public.automation_run_steps (organization_id, run_id, node_id, iteration, status, output, error, handle)
      values (run.organization_id, run.id, v_node_id, v_iteration, 'failed', v_out, v_error, v_handle);
    update public.automation_runs set status = 'failed', error = v_error, claim_token = null, claimed_until = null,
      resume_at = null, step_count = step_count + 1 where id = run.id;
    perform private.automation_release(run.id);
    return v_out;
  end if;

  -- efeitos
  for e in select * from jsonb_array_elements(p_step -> 'effects') loop
    case e ->> 'type'
    when 'add_tag' then
      if run.contact_id is not null and exists (select 1 from public.tags t
          where t.id = (e ->> 'tagId')::uuid and t.organization_id = run.organization_id) then
        insert into public.contact_tags (organization_id, contact_id, tag_id)
          values (run.organization_id, run.contact_id, (e ->> 'tagId')::uuid)
          on conflict (contact_id, tag_id) do nothing;
      end if;
    when 'remove_tag' then
      delete from public.contact_tags
        where organization_id = run.organization_id and contact_id = run.contact_id and tag_id = (e ->> 'tagId')::uuid;
    when 'assign_user' then
      -- só membros da organização; conversa quando houver, senão o responsável do contato
      if exists (select 1 from public.memberships m
          where m.organization_id = run.organization_id and m.user_id = (e ->> 'userId')::uuid) then
        if conv.id is not null then
          update public.conversations set assigned_to = (e ->> 'userId')::uuid where id = conv.id;
        elsif run.contact_id is not null then
          update public.contacts set assigned_to = (e ->> 'userId')::uuid
            where id = run.contact_id and organization_id = run.organization_id;
        end if;
      end if;
    when 'move_stage' then
      perform private.automation_move_stage(run.organization_id, run.contact_id, (e ->> 'stageId')::uuid);
    -- encerrar a conversa é terminal: nada roda depois (a saída do bloco é ignorada)
    when 'close_conversation' then
      v_terminal := true;
      if conv.id is not null then
        update public.conversations set status = 'closed' where id = conv.id and status <> 'closed';
        select * into conv from public.conversations where id = conv.id;
      end if;
    -- transferências são terminais: a execução termina 'completed' (a saída do bloco é ignorada)
    when 'handoff_ai' then
      v_terminal := true;
      if conv.id is not null then
        update public.conversations set handled_by = 'ai', status = 'open', handoff_reason = null, automation_run_id = null
          where id = conv.id;
        -- a última mensagem do cliente ficou sem resposta: a IA responde (regras da Fase 6)
        perform private.automation_enqueue_ai(conv.id);
      end if;
    when 'handoff_human' then
      v_terminal := true;
      if conv.id is not null then
        update public.conversations set status = 'pending_human', handled_by = 'human', handoff_reason = 'automation'
          where id = conv.id;
        insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status)
          values (conv.organization_id, conv.id, conv.channel_id, 'outbound', 'system',
            'Automação transferiu para atendimento humano', 'delivered');
      end if;
    when 'send_text', 'ai_message' then
      if e ->> 'type' = 'ai_message' and v_ai is null then continue; end if;
      -- conversa de destino (execução de contato: liga a conversa aberta e livre; ocupada → pula)
      if not v_conv_checked then
        v_conv_checked := true;
        if conv.id is null and run.conversation_id is null and run.contact_id is not null then
          v_cand := private.automation_contact_conversation(run.organization_id, run.contact_id);
          if v_cand is not null then
            select * into conv from public.conversations where id = v_cand for update skip locked;
            if not found then
              v_send_block := 'conversation_busy';
            elsif private.automation_conversation_busy(run.organization_id, conv.id, run.id) then
              v_send_block := 'conversation_busy';
              conv := null;
            else
              update public.automation_runs set conversation_id = conv.id where id = run.id;
              run.conversation_id := conv.id;
              perform private.automation_link_run(conv.id, run.id);
              select * into conv from public.conversations where id = conv.id;
            end if;
          end if;
        end if;
        if v_send_block is null and conv.id is null then v_send_block := 'no_conversation'; end if;
      end if;
      if v_send_block is not null then
        v_result := v_send_block;
        continue;
      end if;
      v_text := case when e ->> 'type' = 'ai_message' then v_ai ->> 'text' else e ->> 'text' end;
      -- bloqueios do canal antes de qualquer escrita e antes de consumir a cota da IA
      v_block := private.automation_send_blocker(conv, v_text);
      if v_block is not null then
        v_result := v_block;
        -- texto longo da IA segue pela saída handoff; o de send_text conclui a execução
        if v_block = 'reply_too_long' and e ->> 'type' = 'ai_message' then v_reroute := true; end if;
        continue;
      end if;
      if e ->> 'type' = 'ai_message' then
        if not public.consume_ai_quota(run.organization_id, 'reply') then
          v_result := 'quota_exceeded';
          v_reroute := true;
          continue;
        end if;
        select * into v_send from private.automation_deliver(run.id, conv, v_node_id, v_text, null, null,
          jsonb_build_object('text', v_text), jsonb_build_object('usedChunkIds', v_ai -> 'usedChunkIds'));
      else
        select * into v_send from private.automation_deliver(run.id, conv, v_node_id, e ->> 'text',
          e -> 'buttons', e -> 'quickReplies', nullif(e -> 'instagram', 'null'::jsonb), null);
      end if;
      v_result := v_send.result;
      if v_send.intent_id is not null then v_intents := v_intents || v_send.intent_id; end if;
      if v_send.result in ('sent', 'queued') then
        v_payloads := v_payloads || private.automation_node_payloads(run.id, v_node);
      end if;
    else
      null; -- webhook: executado pelo worker antes do apply
    end case;
  end loop;

  -- rota final (resultados que mudam a rota têm prioridade sobre a do worker)
  if v_result = 'conversation_closed' then
    v_status := 'cancelled';
  elsif v_result = 'channel_unavailable' then
    v_status := 'failed'; v_error := 'channel_unavailable';
  elsif v_result = 'window_closed' then
    v_status := 'completed';
  elsif v_reroute then
    v_handle := 'handoff';
    v_next := private.automation_graph_target(v_graph, v_node_id, 'handoff');
    v_status := case when v_next is null then 'completed' else 'running' end;
  elsif v_result = 'reply_too_long' or v_terminal then
    v_status := 'completed';
  elsif v_kind = 'next' then
    v_status := 'running';
  elsif v_kind in ('waitReply', 'waitDelay') then
    v_status := 'waiting';
  else
    v_status := 'completed';
  end if;

  if v_status = 'running' then
    update public.automation_runs set current_node_id = v_next, step_count = step_count + 1, waiting_for = null,
      wait_node_id = null, input = null where id = run.id;
  elsif v_status = 'waiting' then
    update public.automation_runs set status = 'waiting', current_node_id = v_node_id, step_count = step_count + 1,
      waiting_for = case when v_kind = 'waitReply' then 'reply' else 'delay' end, wait_node_id = v_node_id, input = null,
      resume_at = v_until, attempts = 0, claim_token = null, claimed_until = null where id = run.id;
  else
    update public.automation_runs set status = v_status, error = v_error, step_count = step_count + 1, waiting_for = null,
      wait_node_id = null, input = null, resume_at = null, claim_token = null, claimed_until = null where id = run.id;
    perform private.automation_release(run.id);
  end if;

  v_out := jsonb_build_object('state', v_status, 'intentIds', to_jsonb(v_intents), 'payloads', v_payloads,
    'result', v_result, 'currentNodeId', case when v_status = 'running' then v_next else v_node_id end);
  insert into public.automation_run_steps (organization_id, run_id, node_id, iteration, status, output, error, handle)
    values (run.organization_id, run.id, v_node_id, v_iteration,
      case v_status when 'running' then 'completed' else v_status end, v_out, v_error, v_handle);

  -- execução retomada por texto digitado que termina sem responder depois dele: a IA atende a mensagem
  if v_status = 'completed' and conv.id is not null and exists (select 1 from public.automation_run_steps s
      where s.run_id = run.id and s.iteration = run.iteration and s.output ->> 'typedReply' = 'true') then
    perform private.automation_enqueue_ai(conv.id);
  end if;
  return v_out;
end $$;

-- ---------------------------------------------------------------- Parar automação (agent+)
-- Igual a 000003, mas cada execução cancelada também fecha o passo que aguardava (automation_release).
create or replace function public.stop_automation(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare conv public.conversations; v_org uuid; v_rows int := 0; v_id uuid;
begin
  -- papel conferido antes de travar: quem não pode parar não segura a linha da conversa
  select organization_id into v_org from public.conversations where id = p_conversation;
  if v_org is null or not public.has_role(v_org, 'agent') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into conv from public.conversations where id = p_conversation and organization_id = v_org for update;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  for v_id in
    update public.automation_runs set status = 'cancelled', claim_token = null, claimed_until = null, resume_at = null
      where organization_id = conv.organization_id and conversation_id = conv.id
        and (status in ('pending', 'waiting') or (id = conv.automation_run_id and status = 'running'))
      returning id
  loop
    perform private.automation_release(v_id);
    v_rows := v_rows + 1;
  end loop;
  update public.conversations set automation_run_id = null where id = conv.id and automation_run_id is not null;
  if v_rows = 0 then return; end if;

  insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id,
      content, status)
    values (conv.organization_id, conv.id, conv.channel_id, 'outbound', 'system', auth.uid(),
      'Automação interrompida por ' || private.automation_actor_name(), 'delivered');
end $$;

-- ---------------------------------------------------------------- respostas privadas da fila
-- Automação pausada ou excluída: a resposta privada ainda não enviada não é preparada nem reservada
-- (paridade com a Fase 5, em que desativar a regra descartava a resposta da fila).
create function private.instagram_comment_automation_active(p_event public.instagram_events) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.automations a
    where a.id = p_event.automation_id and a.organization_id = p_event.organization_id and a.status = 'active');
$$;

create or replace function public.prepare_instagram_comment_send(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ev public.instagram_events; ch public.channels; item public.instagram_send_intents; n jsonb; body jsonb; txt text;
begin
  select * into ev from public.instagram_events where id=p_event_id and kind='comment' for update;
  if not found or ev.state not in ('pending','uncertain') or ev.automation_id is null then return 'null'::jsonb; end if;
  if not private.instagram_comment_automation_active(ev) then return 'null'::jsonb; end if;
  select * into ch from public.channels where id=ev.channel_id;
  if ch.status<>'active' or ev.payload->>'senderExternalId'=ch.external_account_id then return 'null'::jsonb; end if;
  n:=private.instagram_comment_node(ev);
  if n is null then return 'null'::jsonb; end if;
  if ev.automation_run_id is null then
    update public.instagram_events set automation_run_id=gen_random_uuid() where id=ev.id returning * into ev;
  end if;
  body:=private.instagram_comment_body(ev.automation_run_id,n);
  txt:=coalesce(body->>'text',body#>>'{attachment,payload,text}');
  if txt is null or txt !~ '[^[:space:]]' or octet_length(txt)>1000 then return 'null'::jsonb; end if;
  insert into public.instagram_send_intents(organization_id,channel_id,event_id,kind,recipient_external_id,comment_id,text,message_payload)
    values(ev.organization_id,ch.id,ev.id,'private_reply',ev.payload->>'senderExternalId',ev.payload->>'commentId',txt,body)
    on conflict(event_id) do nothing;
  select * into item from public.instagram_send_intents where event_id=ev.id for update;
  if item.state='pending' and item.automation_run_id is null then
    update public.instagram_send_intents set text=txt,message_payload=body where id=item.id returning * into item;
  end if;
  if item.state='failed' and item.error_code='rate_limited' then
    update public.instagram_send_intents set state='pending',claim_token=null,claimed_at=null,error_code=null where id=item.id returning * into item;
  end if;
  if item.state='sending' and item.claimed_at<now()-interval '1 minute' then
    update public.instagram_send_intents set state='uncertain',error_code='expired_send_lease' where id=item.id returning * into item;
  end if;
  return jsonb_build_object('eventId',ev.id,'organizationId',ev.organization_id,'channelId',ch.id,'connectionId',ch.meta_connection_id,
    'intentId',item.id,'commentId',item.comment_id,'mediaId',ev.payload->>'mediaId','senderExternalId',ev.payload->>'senderExternalId',
    'ruleEffectiveAt',ev.automation_activated_at,'state',item.state);
end $$;

create or replace function public.claim_instagram_send(p_intent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.instagram_send_intents; ch public.channels; ev public.instagram_events; n jsonb; eid uuid;
begin
  select * into item from public.instagram_send_intents where id=p_intent_id for update;
  if not found then return 'null'::jsonb; end if;
  if item.state='sending' and item.claimed_at<now()-interval '1 minute' then
    update public.instagram_send_intents set state='uncertain',error_code='expired_send_lease' where id=item.id;
    update public.messages set error='Envio sem confirmação. Verifique o Instagram antes de tentar novamente.' where id=item.message_id;
    return 'null'::jsonb;
  end if;
  if item.state<>'pending' then return 'null'::jsonb; end if;
  select * into ch from public.channels where id=item.channel_id;
  if ch.status<>'active' then raise exception 'channel inactive' using errcode='22023'; end if;
  if item.kind='direct' and not exists(select 1 from public.messages where conversation_id=item.conversation_id
    and direction='inbound' and created_at>now()-interval '24 hours') then raise exception 'messaging window closed' using errcode='22023'; end if;
  if item.kind='private_reply' then
    select * into ev from public.instagram_events where id=item.event_id;
    if ev.state is distinct from 'pending' or ev.automation_id is null then return 'null'::jsonb; end if;
    -- pausada/excluída depois de enfileirar: nada é enviado
    if not private.instagram_comment_automation_active(ev) then return 'null'::jsonb; end if;
    n:=private.instagram_comment_node(ev);
    if n is null then return 'null'::jsonb; end if;
    if item.automation_run_id is null then
      insert into public.events(organization_id,type,actor_type,payload) values(ev.organization_id,'automation_trigger','system',
        jsonb_build_object('automation_id',ev.automation_id,'instagram_event_id',ev.id)) returning id into eid;
      -- Non-runnable until HTTP confirms the reply. No contact/conversation exists yet.
      insert into public.automation_runs(id,organization_id,automation_id,trigger_event_id,status,current_node_id,version,step_count)
        values(ev.automation_run_id,ev.organization_id,ev.automation_id,eid,'waiting',(n->>'id')::uuid,ev.automation_version,1);
      insert into public.automation_run_steps(organization_id,run_id,node_id,status,output)
        values(ev.organization_id,ev.automation_run_id,(n->>'id')::uuid,'pending',jsonb_build_object('result','private_reply_pending'));
      update public.instagram_send_intents set automation_run_id=ev.automation_run_id where id=item.id;
    end if;
  end if;
  update public.instagram_send_intents set state='sending',claim_token=gen_random_uuid(),claimed_at=now() where id=item.id returning * into item;
  return jsonb_build_object('intentId',item.id,'channelId',ch.id,'connectionId',ch.meta_connection_id,'actorId',item.actor_id,
    'recipientExternalId',item.recipient_external_id,'commentId',item.comment_id,'kind',item.kind,'text',item.text,
    'messagePayload',item.message_payload,'claimToken',item.claim_token);
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function
  private.automation_enqueue_ai(uuid),
  private.automation_human_handled(public.conversations),
  private.automation_click_kind(uuid, uuid, uuid, text),
  private.instagram_automation_click_kind(uuid, text, text),
  private.instagram_comment_automation_active(public.instagram_events)
  from public, anon, authenticated;
