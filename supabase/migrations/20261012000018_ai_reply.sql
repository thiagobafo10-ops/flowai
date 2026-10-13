-- Fase 6 (IA): fila de respostas, transferência para humano e devolução para a IA.

-- ---------------------------------------------------------------- colunas
alter table public.conversations add column handoff_reason text
  check (handoff_reason in ('needs_human', 'no_knowledge', 'unverified_fact', 'injection', 'quota_exceeded',
    'not_configured', 'ai_failure', 'window_closed', 'reply_too_long'));
-- Leitura pela tabela (select já é de tabela); insert/update de authenticated são por coluna e não a incluem.
grant select (handoff_reason) on public.conversations to authenticated;

-- Escrita só pelo serviço: insert/update de authenticated em messages são por coluna.
alter table public.messages add column ai_metadata jsonb;

-- A classificação aponta uma mensagem da mesma conversa.
alter table public.messages add constraint messages_org_conversation_id_key unique (organization_id, conversation_id, id);
alter table public.ai_classifications add constraint ai_classifications_message_conversation_fk
  foreign key (organization_id, conversation_id, message_id)
  references public.messages (organization_id, conversation_id, id) on delete cascade;

-- ---------------------------------------------------------------- evento ai_replied com ator IA
create or replace function public.trg_messages_emit_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
begin
  if (new.direction = 'inbound' and not new.is_internal_note) or new.sender_type = 'ai' then
    select c.contact_id into v_contact
      from public.conversations c
      where c.organization_id = new.organization_id and c.id = new.conversation_id;
  end if;

  if new.direction = 'inbound' and not new.is_internal_note then
    perform public.emit_event(new.organization_id, 'message_received', new.conversation_id, v_contact, null,
      jsonb_build_object('message_id', new.id));
  end if;
  if new.sender_type = 'ai' then
    insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, actor_id, payload)
      values (new.organization_id, 'ai_replied', new.conversation_id, v_contact, 'ai', null,
        jsonb_build_object('message_id', new.id));
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------- auxiliares
create function private.ai_handoff_label(p_reason text) returns text
language sql immutable set search_path = '' as $$
  select case p_reason
    when 'needs_human' then 'Cliente precisa de atendimento humano'
    when 'no_knowledge' then 'IA sem informação na base de conhecimento'
    when 'unverified_fact' then 'IA citou um valor que não está na base'
    when 'injection' then 'Possível tentativa de manipulação da IA'
    when 'quota_exceeded' then 'Limite diário da IA atingido'
    when 'not_configured' then 'IA não configurada na plataforma'
    when 'ai_failure' then 'Falha temporária da IA'
    when 'window_closed' then 'Fora da janela de 24h do Instagram'
    when 'reply_too_long' then 'Resposta da IA longa demais para o canal'
  end;
$$;

-- §1 da spec, na parte que depende do banco: conversa aberta com a IA, canal elegível, agente ligado.
create function private.ai_reply_eligible(p_conv public.conversations) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_conv.id is not null and p_conv.handled_by = 'ai' and p_conv.status = 'open'
    and exists (select 1 from public.channels ch
                where ch.id = p_conv.channel_id and ch.type in ('simulator', 'instagram'))
    and exists (select 1 from public.ai_agents a
                where a.organization_id = p_conv.organization_id and a.is_active and a.auto_reply), false);
$$;

-- Dia (fuso da organização) e limite diário de respostas, com o mesmo cálculo de consume_ai_quota/ai_quota.
create function private.ai_reply_limit(p_org uuid, out day date, out daily_limit int)
language sql stable security definer set search_path = '' as $$
  select (select (now() at time zone o.timezone)::date from public.organizations o where o.id = p_org),
    (select coalesce(ov.daily_replies, s.daily_replies)
       from private.ai_settings s left join private.ai_limit_overrides ov on ov.organization_id = p_org);
$$;

-- Ainda há resposta disponível hoje (sem consumir). Mesmas regras de consume_ai_quota(p_org, 'reply').
create function private.ai_reply_quota_left(p_org uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_limit record; v_used int;
begin
  select * into v_limit from private.ai_reply_limit(p_org);
  if v_limit.day is null or coalesce(v_limit.daily_limit, 0) <= 0 then return false; end if;
  select u.replies into v_used from public.ai_usage_daily u where u.organization_id = p_org and u.day = v_limit.day;
  return coalesce(v_used, 0) < v_limit.daily_limit;
end $$;

create function private.ai_default_pipeline(p_org uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.pipelines p where p.organization_id = p_org and p.is_default;
$$;

-- Nomes das etapas abertas (sem ganho/perdido) do pipeline padrão, por posição.
create function private.ai_open_stages(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(s.name order by s.position), '[]'::jsonb)
  from public.pipeline_stages s
  where s.organization_id = p_org and s.pipeline_id = private.ai_default_pipeline(p_org)
    and not s.is_won and not s.is_lost;
$$;

create function private.ai_agent_json(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', a.name, 'personality', a.personality, 'objective', a.objective,
    'tone', a.tone, 'systemPrompt', a.system_prompt, 'humanHandoff', a.human_handoff)
  from public.ai_agents a where a.organization_id = p_org;
$$;

-- Motivo que impede enviar pelo Instagram agora (null = pode enviar). Janela igual a create_instagram_send_intent.
create function private.ai_instagram_blocker(p_conv public.conversations) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.channels ch where ch.id = p_conv.channel_id and ch.status = 'active') then
    return 'ai_failure';
  end if;
  if not exists (select 1 from public.messages m where m.conversation_id = p_conv.id and m.direction = 'inbound'
      and m.sender_type = 'contact' and m.created_at > now() - interval '24 hours') then
    return 'window_closed';
  end if;
  if not exists (select 1 from public.contacts k where k.id = p_conv.contact_id
      and k.organization_id = p_conv.organization_id and coalesce(k.instagram_id, '') <> '') then
    return 'ai_failure';
  end if;
  return null;
end $$;

-- Grava a mensagem da IA. Simulador: delivered. Instagram: pending + intent direto (sem ator); devolve o intent.
-- Para o Instagram, o chamador já conferiu private.ai_instagram_blocker.
create function private.ai_deliver(p_conv public.conversations, p_text text, p_metadata jsonb, p_request uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_type public.channel_type; v_message uuid; v_intent uuid; v_recipient text;
begin
  select ch.type into v_type from public.channels ch where ch.id = p_conv.channel_id;
  if v_type = 'instagram' then
    select k.instagram_id into v_recipient from public.contacts k
      where k.id = p_conv.contact_id and k.organization_id = p_conv.organization_id;
    insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status, ai_metadata)
      values (p_conv.organization_id, p_conv.id, p_conv.channel_id, 'outbound', 'ai', p_text, 'pending', p_metadata)
      returning id into v_message;
    insert into public.instagram_send_intents (organization_id, channel_id, conversation_id, message_id, actor_id,
        request_id, recipient_external_id, text)
      values (p_conv.organization_id, p_conv.channel_id, p_conv.id, v_message, null, p_request, v_recipient, p_text)
      returning id into v_intent;
    return v_intent;
  end if;
  insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status, ai_metadata)
    values (p_conv.organization_id, p_conv.id, p_conv.channel_id, 'outbound', 'ai', p_text, 'delivered', p_metadata);
  return null;
end $$;

-- ---------------------------------------------------------------- transferência
-- p_notify = false (desistência do worker): só transfere, sem aviso de transição ao cliente.
create function private.ai_handoff(p_conversation uuid, p_reason text, p_detail text, p_notify boolean default true) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare conv public.conversations; v_label text := private.ai_handoff_label(p_reason); v_notice boolean;
  v_type public.channel_type; v_intent uuid; v_intents uuid[] := '{}';
begin
  if v_label is null then raise exception 'invalid handoff reason' using errcode = '22023'; end if;
  select * into conv from public.conversations where id = p_conversation for update;
  if not found then return v_intents; end if;
  -- assigned_to fica como está; o gatilho ai_cancel_on_human cancela a tarefa pendente.
  update public.conversations set status = 'pending_human', handled_by = 'human', handoff_reason = p_reason
    where id = conv.id;
  insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status)
    values (conv.organization_id, conv.id, conv.channel_id, 'outbound', 'system',
      'IA transferiu para atendimento humano: ' || v_label
        || coalesce(' — ' || left(nullif(btrim(p_detail), ''), 200), ''), 'delivered');
  select a.human_handoff into v_notice from public.ai_agents a where a.organization_id = conv.organization_id;
  if p_notify and coalesce(v_notice, false) then
    select ch.type into v_type from public.channels ch where ch.id = conv.channel_id;
    if v_type = 'simulator' or (v_type = 'instagram' and private.ai_instagram_blocker(conv) is null) then
      v_intent := private.ai_deliver(conv, 'Vou te encaminhar para um atendente, só um instante.', null, null);
      if v_intent is not null then v_intents := v_intents || v_intent; end if;
    end if;
  end if;
  return v_intents;
end $$;

-- ---------------------------------------------------------------- gatilhos
create function public.ai_enqueue_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare conv public.conversations;
begin
  select * into conv from public.conversations where id = new.conversation_id and organization_id = new.organization_id;
  if private.ai_reply_eligible(conv) then
    insert into public.ai_jobs (organization_id, kind, conversation_id, run_after)
      values (conv.organization_id, 'reply', conv.id, now() + interval '4 seconds')
      on conflict (conversation_id) where kind = 'reply' and state = 'pending'
      do update set run_after = now() + interval '4 seconds';
  end if;
  return null;
end $$;

create trigger ai_enqueue_reply after insert on public.messages
  for each row when (new.direction = 'inbound' and new.sender_type = 'contact' and not new.is_internal_note)
  execute function public.ai_enqueue_reply();

create function public.ai_human_takes_over() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations set handled_by = 'human'
    where id = new.conversation_id and organization_id = new.organization_id and handled_by = 'ai';
  return null;
end $$;

create trigger ai_human_takes_over after insert on public.messages
  for each row when (new.direction = 'outbound' and new.sender_type = 'human' and not new.is_internal_note)
  execute function public.ai_human_takes_over();

create function public.ai_cancel_on_human() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.ai_jobs set state = 'cancelled', claim_token = null, claimed_until = null
    where conversation_id = new.id and kind = 'reply' and state = 'pending';
  return null;
end $$;

create trigger ai_cancel_on_human after update of handled_by on public.conversations
  for each row when (new.handled_by = 'human' and old.handled_by is distinct from 'human')
  execute function public.ai_cancel_on_human();

-- Conversa fechada que reabre (por qualquer caminho) não carrega o motivo de transferência antigo.
create function public.ai_clear_handoff_on_reopen() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.handoff_reason := null;
  return new;
end $$;

create trigger ai_clear_handoff_on_reopen before update of status on public.conversations
  for each row when (old.status = 'closed' and new.status <> 'closed')
  execute function public.ai_clear_handoff_on_reopen();

-- ---------------------------------------------------------------- worker: preparar
create function public.prepare_ai_reply(p_job uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.ai_jobs; conv public.conversations; v_type public.channel_type; v_last uuid;
  v_intents uuid[]; v_contact jsonb; v_history jsonb; v_pipeline uuid;
begin
  if p_token is null then return '{"action":"skip"}'::jsonb; end if;
  select * into job from public.ai_jobs
    where id = p_job and kind = 'reply' and state = 'running' and claim_token = p_token for update;
  if not found then return '{"action":"skip"}'::jsonb; end if;
  select * into conv from public.conversations
    where id = job.conversation_id and organization_id = job.organization_id for update;
  if found and private.ai_reply_eligible(conv) then
    select m.id into v_last from public.messages m
      where m.conversation_id = conv.id and m.direction = 'inbound' and m.sender_type = 'contact' and not m.is_internal_note
      order by m.created_at desc, m.id desc limit 1;
  end if;
  if v_last is null then
    update public.ai_jobs set state = 'cancelled', claim_token = null, claimed_until = null where id = job.id;
    return '{"action":"skip"}'::jsonb;
  end if;

  if not private.ai_reply_quota_left(conv.organization_id) then
    v_intents := private.ai_handoff(conv.id, 'quota_exceeded', null);
    update public.ai_jobs set state = 'done', claim_token = null, claimed_until = null, last_error = null where id = job.id;
    return jsonb_build_object('action', 'handoff', 'reason', 'quota_exceeded', 'intentIds', to_jsonb(v_intents));
  end if;

  select ch.type into v_type from public.channels ch where ch.id = conv.channel_id;
  v_pipeline := private.ai_default_pipeline(conv.organization_id);
  select jsonb_build_object(
      'name', k.name,
      'tags', coalesce((select jsonb_agg(t.name order by lower(t.name), t.id)
                        from public.contact_tags ct join public.tags t on t.id = ct.tag_id
                        where ct.contact_id = k.id), '[]'::jsonb),
      'stage', (select s.name from public.deals d join public.pipeline_stages s on s.id = d.stage_id
                where d.contact_id = k.id and d.pipeline_id = v_pipeline and d.status = 'open' limit 1),
      'leadScore', k.lead_score)
    into v_contact
    from public.contacts k where k.id = conv.contact_id and k.organization_id = conv.organization_id;
  select coalesce(jsonb_agg(jsonb_build_object('role', h.role, 'text', h.content) order by h.created_at, h.id), '[]'::jsonb)
    into v_history
    from (select m.id, m.created_at, m.content,
            case m.sender_type when 'contact' then 'contact' when 'human' then 'human' else 'ai' end as role
          from public.messages m
          where m.conversation_id = conv.id and not m.is_internal_note and m.sender_type <> 'system'
          order by m.created_at desc, m.id desc limit 20) h;

  return jsonb_build_object(
    'action', 'run',
    'organizationId', conv.organization_id,
    'conversationId', conv.id,
    'channelType', v_type,
    'lastMessageId', v_last,
    'agent', private.ai_agent_json(conv.organization_id),
    'company', (select o.company_info::text from public.organizations o where o.id = conv.organization_id),
    'contact', v_contact,
    'stages', private.ai_open_stages(conv.organization_id),
    'conversation', v_history);
end $$;

-- ---------------------------------------------------------------- worker: concluir
-- Valida o resultado do worker antes de qualquer escrita.
create function private.ai_validate_reply_result(p_result jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare c jsonb; r jsonb; h jsonb;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'invalid result' using errcode = '22023';
  end if;
  c := nullif(p_result->'classification', 'null'::jsonb);
  r := nullif(p_result->'reply', 'null'::jsonb);
  h := nullif(p_result->'handoff', 'null'::jsonb);
  if c is not null and (jsonb_typeof(c) <> 'object'
      or c->>'sentiment' is null or c->>'sentiment' not in ('positive', 'neutral', 'negative')
      or jsonb_typeof(c->'lead_score') is distinct from 'number' or (c->>'lead_score') !~ '^[0-9]{1,3}$'
      or (c->>'lead_score')::int > 100
      or jsonb_typeof(c->'needs_human') is distinct from 'boolean'
      or coalesce(jsonb_typeof(c->'intent'), 'null') not in ('string', 'null') or char_length(c->>'intent') > 200
      or coalesce(jsonb_typeof(c->'summary'), 'null') not in ('string', 'null') or char_length(c->>'summary') > 1000
      or coalesce(jsonb_typeof(c->'suggested_stage'), 'null') not in ('string', 'null') or char_length(c->>'suggested_stage') > 200
      or jsonb_typeof(c->'model') is distinct from 'string' or char_length(c->>'model') not between 1 and 100) then
    raise exception 'invalid classification' using errcode = '22023';
  end if;
  if r is not null and (jsonb_typeof(r) <> 'object'
      or jsonb_typeof(r->'text') is distinct from 'string' or (r->>'text') !~ '[^[:space:]]'
      or jsonb_typeof(r->'usedChunkIds') is distinct from 'array' or jsonb_array_length(r->'usedChunkIds') > 50
      or exists (select 1 from jsonb_array_elements(r->'usedChunkIds') x
                 where jsonb_typeof(x) <> 'string'
                   or (x #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or coalesce(jsonb_typeof(r->'factCheck'), 'null') not in ('object', 'null')) then
    raise exception 'invalid reply' using errcode = '22023';
  end if;
  if h is not null and (jsonb_typeof(h) <> 'object' or private.ai_handoff_label(h->>'reason') is null
      or coalesce(jsonb_typeof(h->'detail'), 'null') not in ('string', 'null')) then
    raise exception 'invalid handoff' using errcode = '22023';
  end if;
  if r is null and h is null then raise exception 'empty result' using errcode = '22023'; end if;
  if coalesce(jsonb_typeof(p_result->'lastMessageId'), 'null') not in ('string', 'null')
      or (p_result->>'lastMessageId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid last message' using errcode = '22023';
  end if;
end $$;

-- Grava a classificação, atualiza conversa/contato e garante o deal no pipeline padrão.
create function private.ai_apply_classification(p_conv public.conversations, p_message uuid, p_cls jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_pipeline uuid; v_first uuid; v_deal uuid; v_pos int; v_target uuid; v_target_pos int; v_title text;
begin
  insert into public.ai_classifications (organization_id, message_id, conversation_id, intent, sentiment, lead_score,
      needs_human, summary, suggested_stage, model)
    values (p_conv.organization_id, p_message, p_conv.id, p_cls->>'intent', (p_cls->>'sentiment')::public.sentiment,
      (p_cls->>'lead_score')::int, (p_cls->>'needs_human')::boolean, p_cls->>'summary', p_cls->>'suggested_stage',
      p_cls->>'model');
  update public.conversations set intent = p_cls->>'intent', sentiment = p_cls->>'sentiment', summary = p_cls->>'summary'
    where id = p_conv.id;
  update public.contacts set lead_score = (p_cls->>'lead_score')::int
    where id = p_conv.contact_id and organization_id = p_conv.organization_id;

  v_pipeline := private.ai_default_pipeline(p_conv.organization_id);
  if v_pipeline is null then return; end if;
  select s.id into v_first from public.pipeline_stages s
    where s.pipeline_id = v_pipeline and not s.is_won and not s.is_lost order by s.position limit 1;
  if v_first is null then return; end if;

  select d.id into v_deal from public.deals d
    where d.contact_id = p_conv.contact_id and d.pipeline_id = v_pipeline and d.status = 'open' for update;
  if v_deal is null then
    select coalesce(nullif(btrim(k.name), ''), 'Novo contato') into v_title from public.contacts k where k.id = p_conv.contact_id;
    insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title)
      values (p_conv.organization_id, v_pipeline, v_first, p_conv.contact_id, v_title)
      on conflict (contact_id, pipeline_id) where status = 'open' do nothing
      returning id into v_deal;
    if v_deal is null then
      select d.id into v_deal from public.deals d
        where d.contact_id = p_conv.contact_id and d.pipeline_id = v_pipeline and d.status = 'open' for update;
    end if;
  end if;
  if v_deal is null or nullif(btrim(p_cls->>'suggested_stage'), '') is null then return; end if;

  -- Só avança, e só para etapa aberta (nunca ganho/perdido).
  select s.position into v_pos from public.deals d join public.pipeline_stages s on s.id = d.stage_id where d.id = v_deal;
  select s.id, s.position into v_target, v_target_pos from public.pipeline_stages s
    where s.pipeline_id = v_pipeline and not s.is_won and not s.is_lost
      and lower(btrim(s.name)) = lower(btrim(p_cls->>'suggested_stage'))
    order by s.position limit 1;
  if v_target is not null and v_target_pos > v_pos then
    update public.deals set stage_id = v_target where id = v_deal;
  end if;
end $$;

create function public.complete_ai_reply(p_job uuid, p_token uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.ai_jobs; conv public.conversations; v_cls jsonb; v_reply jsonb; v_handoff jsonb;
  v_last uuid; v_type public.channel_type; v_text text; v_block text; v_intent uuid; v_intents uuid[] := '{}';
  v_state text;
begin
  perform private.ai_validate_reply_result(p_result);
  v_cls := nullif(p_result->'classification', 'null'::jsonb);
  v_reply := nullif(p_result->'reply', 'null'::jsonb);
  v_handoff := nullif(p_result->'handoff', 'null'::jsonb);

  select * into job from public.ai_jobs where id = p_job for update;
  -- Conversa apagada durante a geração (a tarefa sumiu por cascata) ou devolvida para a IA (tarefa cancelada).
  if not found or job.state = 'cancelled' then return '{"state":"skipped","intentIds":[]}'::jsonb; end if;
  if job.kind <> 'reply' or job.state <> 'running' or p_token is null or job.claim_token is distinct from p_token then
    raise exception 'invalid claim' using errcode = '42501';
  end if;
  select * into conv from public.conversations
    where id = job.conversation_id and organization_id = job.organization_id for update;
  if not found or not private.ai_reply_eligible(conv) then
    update public.ai_jobs set state = 'cancelled', claim_token = null, claimed_until = null where id = job.id;
    return '{"state":"skipped","intentIds":[]}'::jsonb;
  end if;

  if p_result->>'lastMessageId' is not null then
    select m.id into v_last from public.messages m
      where m.id = (p_result->>'lastMessageId')::uuid and m.conversation_id = conv.id
        and m.direction = 'inbound' and m.sender_type = 'contact';
    if v_last is null then raise exception 'invalid last message' using errcode = '22023'; end if;
  else
    select m.id into v_last from public.messages m
      where m.conversation_id = conv.id and m.direction = 'inbound' and m.sender_type = 'contact' and not m.is_internal_note
      order by m.created_at desc, m.id desc limit 1;
  end if;

  if v_cls is not null and v_last is not null then
    perform private.ai_apply_classification(conv, v_last, v_cls);
  end if;

  if v_handoff is not null then
    v_intents := private.ai_handoff(conv.id, v_handoff->>'reason', v_handoff->>'detail');
    v_state := 'handoff';
  else
    v_text := v_reply->>'text';
    select ch.type into v_type from public.channels ch where ch.id = conv.channel_id;
    if char_length(v_text) > 4096 or (v_type = 'instagram' and octet_length(v_text) > 1000) then
      v_block := 'reply_too_long';
    elsif v_type = 'instagram' then
      v_block := private.ai_instagram_blocker(conv);
    end if;
    if v_block is null and not public.consume_ai_quota(conv.organization_id, 'reply') then
      v_block := 'quota_exceeded';
    end if;
    if v_block is not null then
      v_intents := private.ai_handoff(conv.id, v_block, null);
      v_state := 'handoff';
    else
      v_intent := private.ai_deliver(conv, v_text,
        jsonb_build_object('usedChunkIds', v_reply->'usedChunkIds', 'factCheck', coalesce(v_reply->'factCheck', 'null'::jsonb)),
        job.id);
      if v_intent is null then
        v_state := 'sent';
      else
        v_state := 'queued';
        v_intents := array[v_intent];
      end if;
    end if;
  end if;

  update public.ai_jobs set state = 'done', claim_token = null, claimed_until = null, last_error = null where id = job.id;
  return jsonb_build_object('state', v_state, 'intentIds', to_jsonb(v_intents));
end $$;

-- Atalho do worker (sem chave e casos semelhantes): transfere sem classificação nem resposta.
create function public.handoff_ai_job(p_job uuid, p_token uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.ai_jobs; conv public.conversations; v_intents uuid[];
begin
  if private.ai_handoff_label(p_reason) is null then raise exception 'invalid handoff reason' using errcode = '22023'; end if;
  select * into job from public.ai_jobs where id = p_job for update;
  if not found or job.state = 'cancelled' then return '{"state":"skipped","intentIds":[]}'::jsonb; end if;
  if job.kind <> 'reply' or job.state <> 'running' or p_token is null or job.claim_token is distinct from p_token then
    raise exception 'invalid claim' using errcode = '42501';
  end if;
  select * into conv from public.conversations
    where id = job.conversation_id and organization_id = job.organization_id for update;
  if not found or not private.ai_reply_eligible(conv) then
    update public.ai_jobs set state = 'cancelled', claim_token = null, claimed_until = null where id = job.id;
    return '{"state":"skipped","intentIds":[]}'::jsonb;
  end if;
  v_intents := private.ai_handoff(conv.id, p_reason, null);
  update public.ai_jobs set state = 'done', claim_token = null, claimed_until = null, last_error = null where id = job.id;
  return jsonb_build_object('state', 'handoff', 'intentIds', to_jsonb(v_intents));
end $$;

-- Chamado por fail_ai_job ao esgotar as tentativas. Nunca pode levantar erro.
create or replace function private.ai_job_gave_up(job public.ai_jobs) returns void
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if job.kind = 'index_document' then
      update public.knowledge_documents d
        set status = 'error',
            error = case when job.last_error = 'not_configured' then 'IA não configurada na plataforma'
                         else 'Não foi possível processar o documento. Tente reprocessar.' end
        where d.id = job.document_id and d.organization_id = job.organization_id
          and d.generation = job.document_generation;
    elsif job.kind = 'reply' then
      perform 1 from public.conversations c
        where c.id = job.conversation_id and c.organization_id = job.organization_id
          and c.handled_by = 'ai' and c.status = 'open'
        for update;
      if found then
        perform private.ai_handoff(job.conversation_id,
          case job.last_error when 'not_configured' then 'not_configured' else 'ai_failure' end, null, false);
      end if;
    end if;
  exception when others then
    raise warning 'ai_job_gave_up: job % failed with SQLSTATE %', job.id, sqlstate;
  end;
end $$;

-- ---------------------------------------------------------------- devolver para a IA
-- Nome do usuário atual, com a mesma resolução de log_conversation_system_message.
create function private.ai_actor_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select nullif(btrim(p.full_name), '') from public.profiles p where p.id = auth.uid()), 'Alguém');
$$;

create function public.return_to_ai(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare conv public.conversations;
begin
  select * into conv from public.conversations where id = p_conversation for update;
  if not found or not public.has_role(conv.organization_id, 'agent') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.channels ch
                 where ch.id = conv.channel_id and ch.type in ('simulator', 'instagram')) then
    raise exception 'ai unsupported channel' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ai_agents a
                 where a.organization_id = conv.organization_id and a.is_active and a.auto_reply) then
    raise exception 'ai inactive' using errcode = '22023';
  end if;
  -- Já está com a IA: nada a fazer (sem nota duplicada; a tarefa em curso continua válida).
  if conv.handled_by = 'ai' and conv.status = 'open' then return; end if;
  -- Uma resposta gerada antes da devolução não deve ser gravada depois dela.
  update public.ai_jobs set state = 'cancelled', claim_token = null, claimed_until = null
    where conversation_id = conv.id and kind = 'reply' and state = 'running';
  update public.conversations set handled_by = 'ai', status = 'open', handoff_reason = null, assigned_to = null
    where id = conv.id;
  insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id, content, status)
    values (conv.organization_id, conv.id, conv.channel_id, 'outbound', 'system', auth.uid(),
      private.ai_actor_name() || ' devolveu a conversa para a IA', 'delivered');
end $$;

-- ---------------------------------------------------------------- área de teste
create function public.prepare_ai_playground(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('agent', private.ai_agent_json(o.id), 'company', o.company_info::text,
    'stages', private.ai_open_stages(o.id))
  from public.organizations o where o.id = p_org;
$$;

-- ---------------------------------------------------------------- grants
revoke all on function
  private.ai_handoff_label(text),
  private.ai_reply_eligible(public.conversations),
  private.ai_reply_limit(uuid),
  private.ai_reply_quota_left(uuid),
  private.ai_actor_name(),
  private.ai_default_pipeline(uuid),
  private.ai_open_stages(uuid),
  private.ai_agent_json(uuid),
  private.ai_instagram_blocker(public.conversations),
  private.ai_deliver(public.conversations, text, jsonb, uuid),
  private.ai_handoff(uuid, text, text, boolean),
  private.ai_validate_reply_result(jsonb),
  private.ai_apply_classification(public.conversations, uuid, jsonb),
  public.ai_enqueue_reply(),
  public.ai_human_takes_over(),
  public.ai_cancel_on_human(),
  public.ai_clear_handoff_on_reopen(),
  public.prepare_ai_reply(uuid, uuid),
  public.complete_ai_reply(uuid, uuid, jsonb),
  public.handoff_ai_job(uuid, uuid, text),
  public.prepare_ai_playground(uuid)
  from public, anon, authenticated;
grant execute on function
  public.prepare_ai_reply(uuid, uuid),
  public.complete_ai_reply(uuid, uuid, jsonb),
  public.handoff_ai_job(uuid, uuid, text),
  public.prepare_ai_playground(uuid)
  to service_role;
revoke all on function public.return_to_ai(uuid) from public, anon;
grant execute on function public.return_to_ai(uuid) to authenticated, service_role;
