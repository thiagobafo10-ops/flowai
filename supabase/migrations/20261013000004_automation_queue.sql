-- Fase 7A: fila de execuções (reserva, preparo, aplicação idempotente de passos, falhas, varredura,
-- reexecução) e despacho do automation-worker.
--
-- Contrato com o automation-worker (Task 9):
-- * claim_automation_runs → [{runId, claimToken}]; prepare_automation_run → {"action":"skip"} | {"action":"run", ...}.
-- * apply_automation_step(run, token, step), step = {nodeId, iteration, handle|null, effects: Effect[],
--   route: {next: uuid} | {waitReply: {until}} | {waitDelay: {until}} | {end: true}, aiReply?: {text, usedChunkIds},
--   error?: code}. Devolve {state, intentIds, payloads, result, currentNodeId}; o worker continua de
--   currentNodeId enquanto state = 'running'.
-- * Retomada de espera (prepare devolve waitingFor ≠ null): o worker chama apply no PRÓPRIO nó de espera
--   (nodeId = currentNodeId) com o handle resolvido (opt:<id> | no_reply | default), effects [] e rota
--   next/end; isso conclui o passo da espera. Depois segue normalmente com o próximo nó.
-- * Cota da IA: um efeito ai_message com aiReply consome a cota de respostas. Cota esgotada → nada é
--   enviado, o passo grava result 'quota_exceeded' e handle 'handoff', e a execução segue pela saída
--   'handoff' do bloco (currentNodeId = alvo dessa saída; sem saída → concluída). O mesmo vale para
--   'reply_too_long'. Ou seja: o worker roteia 'handoff' seguindo o currentNodeId devolvido. prepare
--   antecipa a cota em ai.quotaLeft para o worker nem chamar a OpenAI quando ela já acabou.
-- * ai_message sem aiReply não envia nada (o worker usa a saída handoff quando a IA decide transferir).
-- * Resultados de passo (result): sent | queued | no_conversation | conversation_busy | conversation_closed |
--   window_closed | quota_exceeded | reply_too_long | channel_unavailable | max_steps | <código de erro>.
-- * Erros: 42501 = reserva perdida (o worker não chama fail); 22023 = passo inválido (fail 'invalid_step').
-- * Ordem de travas: conversa → execução (a mesma de automation_inbound/stop_automation).

-- ---------------------------------------------------------------- auxiliares de grafo
create function private.automation_run_graph(p_run public.automation_runs) returns jsonb
language sql stable security definer set search_path = '' as $$
  select v.graph from public.automation_versions v where v.automation_id = p_run.automation_id and v.version = p_run.version;
$$;

create function private.automation_graph_node(p_graph jsonb, p_node uuid) returns jsonb
language sql immutable set search_path = '' as $$
  select n from jsonb_array_elements(case when jsonb_typeof(p_graph -> 'nodes') = 'array' then p_graph -> 'nodes'
    else '[]'::jsonb end) n
  where n ->> 'id' = p_node::text limit 1;
$$;

create function private.automation_graph_target(p_graph jsonb, p_source uuid, p_handle text) returns uuid
language sql immutable set search_path = '' as $$
  select (e ->> 'target')::uuid from jsonb_array_elements(case when jsonb_typeof(p_graph -> 'edges') = 'array'
    then p_graph -> 'edges' else '[]'::jsonb end) e
  where e ->> 'source' = p_source::text and coalesce(e ->> 'sourceHandle', 'default') = p_handle
  order by e ->> 'id' limit 1;
$$;

create function private.automation_is_ai_node(p_node jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_node ->> 'type' = 'message' and p_node -> 'config' ->> 'mode' = 'ai', false);
$$;

-- {optionId: payload assinado} das opções que esperam clique (botões path e respostas rápidas) de um bloco.
create function private.automation_node_payloads(p_run uuid, p_node jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb := '{}'::jsonb; o jsonb; v_cfg jsonb := p_node -> 'config';
begin
  if p_node is null or p_node ->> 'type' <> 'message' or v_cfg ->> 'mode' is distinct from 'text' then return v_out; end if;
  for o in
    select x from jsonb_array_elements(case when jsonb_typeof(v_cfg -> 'buttons') = 'array' then v_cfg -> 'buttons'
      else '[]'::jsonb end) x where x ->> 'kind' = 'path'
    union all
    select x from jsonb_array_elements(case when jsonb_typeof(v_cfg -> 'quickReplies') = 'array' then v_cfg -> 'quickReplies'
      else '[]'::jsonb end) x
  loop
    if o ->> 'id' ~ '^[a-z0-9]{1,12}$' then
      v_out := v_out || jsonb_build_object(o ->> 'id', private.automation_payload(p_run, (p_node ->> 'id')::uuid, o ->> 'id'));
    end if;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------- auxiliares de execução
-- Trava conversa → execução. Devolve a linha travada (campos nulos quando a execução não existe).
create function private.automation_lock_run(p_run uuid) returns public.automation_runs
language plpgsql security definer set search_path = '' as $$
declare v_conv uuid; r public.automation_runs;
begin
  select conversation_id into v_conv from public.automation_runs where id = p_run;
  if v_conv is not null then
    perform 1 from public.conversations where id = v_conv for update;
  end if;
  select * into r from public.automation_runs where id = p_run for update;
  if found and r.conversation_id is not null and r.conversation_id is distinct from v_conv then
    perform 1 from public.conversations where id = r.conversation_id for update;
  end if;
  return r;
end $$;

-- Execução terminou: a conversa deixa de estar em automação e a IA volta a atender.
create function private.automation_release(p_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations set automation_run_id = null where automation_run_id = p_run;
end $$;

create function private.automation_cancel_run(p_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.automation_runs set status = 'cancelled', claim_token = null, claimed_until = null, resume_at = null
    where id = p_run;
  perform private.automation_release(p_run);
end $$;

-- Exclusão de conversa/contato: cancela também a execução em curso (o worker recebe skip / 42501).
create or replace function private.automation_conversation_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.automation_runs set status = 'cancelled', claim_token = null, claimed_until = null, resume_at = null
    where conversation_id = old.id and status in ('pending', 'running', 'waiting');
  return old;
end $$;

create or replace function private.automation_contact_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.automation_runs set status = 'cancelled', claim_token = null, claimed_until = null, resume_at = null
    where contact_id = old.id and status in ('pending', 'running', 'waiting');
  return old;
end $$;

-- Conversa aberta mais recente do contato (a mesma escolha do disparo de CRM).
create function private.automation_contact_conversation(p_org uuid, p_contact uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.conversations c
    where c.organization_id = p_org and c.contact_id = p_contact and c.status <> 'closed'
    order by c.last_message_at desc nulls last, c.created_at desc, c.id desc
    limit 1;
$$;

-- RunContext do motor (packages/core/src/automation/engine.ts).
create function private.automation_run_context(p_run public.automation_runs, p_conv uuid, p_channel_type text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'contact', jsonb_build_object(
      'name', k.name,
      'tagIds', coalesce((select jsonb_agg(ct.tag_id order by ct.tag_id) from public.contact_tags ct
                          where ct.contact_id = k.id), '[]'::jsonb),
      'stageId', (select d.stage_id from public.deals d
                  where d.contact_id = k.id and d.pipeline_id = private.ai_default_pipeline(p_run.organization_id)
                  order by (d.status = 'open') desc, d.updated_at desc limit 1),
      'leadScore', k.lead_score),
    'lastInboundText', (select m.content from public.messages m
                        where m.conversation_id = p_conv and m.direction = 'inbound' and m.sender_type = 'contact'
                          and not m.is_internal_note
                        order by m.created_at desc, m.id desc limit 1),
    'lastIntent', (select c.intent from public.conversations c where c.id = p_conv),
    'now', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'timezone', o.timezone,
    'channelType', p_channel_type)
  from public.contacts k join public.organizations o on o.id = k.organization_id
  where k.id = p_run.contact_id and k.organization_id = p_run.organization_id;
$$;

-- Contexto do pipeline de IA da Fase 6 (mesmo formato de prepare_ai_reply) + cota disponível.
create function private.automation_ai_context(p_run public.automation_runs, p_conv uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'agent', private.ai_agent_json(p_run.organization_id),
    'company', (select o.company_info::text from public.organizations o where o.id = p_run.organization_id),
    'contact', (select jsonb_build_object(
        'name', k.name,
        'tags', coalesce((select jsonb_agg(t.name order by lower(t.name), t.id)
                          from public.contact_tags ct join public.tags t on t.id = ct.tag_id
                          where ct.contact_id = k.id), '[]'::jsonb),
        'stage', (select s.name from public.deals d join public.pipeline_stages s on s.id = d.stage_id
                  where d.contact_id = k.id and d.pipeline_id = private.ai_default_pipeline(p_run.organization_id)
                    and d.status = 'open' limit 1),
        'leadScore', k.lead_score)
      from public.contacts k where k.id = p_run.contact_id and k.organization_id = p_run.organization_id),
    'stages', private.ai_open_stages(p_run.organization_id),
    'conversation', (select coalesce(jsonb_agg(jsonb_build_object('role', h.role, 'text', h.content)
        order by h.created_at, h.id), '[]'::jsonb)
      from (select m.id, m.created_at, m.content,
              case m.sender_type when 'contact' then 'contact' when 'human' then 'human' else 'ai' end as role
            from public.messages m
            where m.conversation_id = p_conv and not m.is_internal_note and m.sender_type <> 'system'
            order by m.created_at desc, m.id desc limit 20) h),
    'quotaLeft', private.ai_reply_quota_left(p_run.organization_id));
$$;

-- Validação estrutural do passo, antes de qualquer escrita (22023).
create function private.automation_validate_step(p_step jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_route jsonb; v_key text; e jsonb; v_ai jsonb;
begin
  if p_step is null or jsonb_typeof(p_step) <> 'object'
     or jsonb_typeof(p_step -> 'nodeId') is distinct from 'string' or (p_step ->> 'nodeId') !~ v_uuid
     or jsonb_typeof(p_step -> 'iteration') is distinct from 'number' or (p_step ->> 'iteration') !~ '^[0-9]{1,9}$'
     or coalesce(jsonb_typeof(p_step -> 'handle'), 'null') not in ('string', 'null')
     or (p_step ->> 'handle') !~ '^(default|true|false|no_reply|sent|handoff|opt:[a-z0-9]{1,12})$'
     or jsonb_typeof(p_step -> 'effects') is distinct from 'array' or jsonb_array_length(p_step -> 'effects') > 20
     or coalesce(jsonb_typeof(p_step -> 'error'), 'null') not in ('string', 'null') then
    raise exception 'invalid step' using errcode = '22023';
  end if;

  v_route := p_step -> 'route';
  if jsonb_typeof(v_route) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_route)) <> 1 then
    raise exception 'invalid route' using errcode = '22023';
  end if;
  select k into v_key from jsonb_object_keys(v_route) k;
  if not ((v_key = 'next' and jsonb_typeof(v_route -> 'next') = 'string' and (v_route ->> 'next') ~ v_uuid)
       or (v_key in ('waitReply', 'waitDelay') and jsonb_typeof(v_route -> v_key) = 'object'
           and jsonb_typeof(v_route -> v_key -> 'until') = 'string')
       or (v_key = 'end' and v_route -> 'end' = 'true'::jsonb)) then
    raise exception 'invalid route' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_step -> 'effects') loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'type') is distinct from 'string' then
      raise exception 'invalid effect' using errcode = '22023';
    end if;
    case e ->> 'type'
      when 'add_tag', 'remove_tag' then
        if jsonb_typeof(e -> 'tagId') is distinct from 'string' or (e ->> 'tagId') !~ v_uuid then raise exception 'invalid effect' using errcode = '22023'; end if;
      when 'assign_user' then
        if jsonb_typeof(e -> 'userId') is distinct from 'string' or (e ->> 'userId') !~ v_uuid then raise exception 'invalid effect' using errcode = '22023'; end if;
      when 'move_stage' then
        if jsonb_typeof(e -> 'stageId') is distinct from 'string' or (e ->> 'stageId') !~ v_uuid then raise exception 'invalid effect' using errcode = '22023'; end if;
      when 'send_text' then
        if jsonb_typeof(e -> 'text') is distinct from 'string' or (e ->> 'text') !~ '[^[:space:]]'
           or coalesce(jsonb_typeof(e -> 'buttons'), 'array') <> 'array' or jsonb_array_length(coalesce(e -> 'buttons', '[]')) > 3
           or coalesce(jsonb_typeof(e -> 'quickReplies'), 'array') <> 'array' or jsonb_array_length(coalesce(e -> 'quickReplies', '[]')) > 13
           or coalesce(jsonb_typeof(e -> 'instagram'), 'null') not in ('object', 'null') then
          raise exception 'invalid effect' using errcode = '22023';
        end if;
      when 'ai_message', 'webhook', 'close_conversation', 'handoff_ai', 'handoff_human' then
        null;
      else
        raise exception 'invalid effect' using errcode = '22023';
    end case;
  end loop;

  v_ai := nullif(p_step -> 'aiReply', 'null'::jsonb);
  if v_ai is not null and (jsonb_typeof(v_ai) <> 'object'
      or jsonb_typeof(v_ai -> 'text') is distinct from 'string' or (v_ai ->> 'text') !~ '[^[:space:]]'
      or jsonb_typeof(v_ai -> 'usedChunkIds') is distinct from 'array' or jsonb_array_length(v_ai -> 'usedChunkIds') > 50
      or exists (select 1 from jsonb_array_elements(v_ai -> 'usedChunkIds') x
                 where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~* v_uuid)) then
    raise exception 'invalid ai reply' using errcode = '22023';
  end if;
end $$;

-- Negócio no pipeline padrão garantido na etapa escolhida (qualquer etapa do pipeline padrão, inclusive
-- ganho/perdido; o status do negócio segue a etapa pelo gatilho deals_set_status).
create function private.automation_move_stage(p_org uuid, p_contact uuid, p_stage uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_pipeline uuid := private.ai_default_pipeline(p_org); v_deal uuid; v_title text;
begin
  if v_pipeline is null or p_contact is null or not exists (select 1 from public.pipeline_stages s
      where s.id = p_stage and s.organization_id = p_org and s.pipeline_id = v_pipeline) then
    return;
  end if;
  select d.id into v_deal from public.deals d
    where d.contact_id = p_contact and d.pipeline_id = v_pipeline and d.status = 'open' for update;
  if v_deal is null then
    select coalesce(nullif(btrim(k.name), ''), 'Novo contato') into v_title from public.contacts k where k.id = p_contact;
    insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title)
      values (p_org, v_pipeline, p_stage, p_contact, v_title)
      on conflict (contact_id, pipeline_id) where status = 'open' do nothing
      returning id into v_deal;
    if v_deal is not null then return; end if;
    select d.id into v_deal from public.deals d
      where d.contact_id = p_contact and d.pipeline_id = v_pipeline and d.status = 'open' for update;
  end if;
  update public.deals set stage_id = p_stage where id = v_deal and stage_id is distinct from p_stage;
end $$;

-- Grava a mensagem da automação na conversa (já travada). Simulador: delivered. Instagram: pending + intent
-- com message_payload e automation_run_id, após a checagem da janela de 24h (a mesma da Fase 6).
-- result: sent | queued | conversation_closed | window_closed | channel_unavailable.
create function private.automation_deliver(p_run uuid, p_conv public.conversations, p_node uuid, p_text text,
  p_buttons jsonb, p_quick_replies jsonb, p_instagram jsonb, p_ai_metadata jsonb, out result text, out intent_id uuid)
language plpgsql security definer set search_path = '' as $$
declare v_type public.channel_type; v_message uuid; v_recipient text; v_block text; v_context jsonb;
begin
  if p_conv.status = 'closed' then result := 'conversation_closed'; return; end if;
  select ch.type into v_type from public.channels ch where ch.id = p_conv.channel_id;
  v_context := jsonb_build_object('automation', jsonb_build_object('runId', p_run, 'nodeId', p_node,
    'buttons', coalesce(p_buttons, '[]'::jsonb), 'quickReplies', coalesce(p_quick_replies, '[]'::jsonb)));
  if v_type = 'instagram' then
    if octet_length(p_text) > 1000 then raise exception 'text too long' using errcode = '22023'; end if;
    v_block := private.ai_instagram_blocker(p_conv);
    if v_block = 'window_closed' then result := 'window_closed'; return; end if;
    if v_block is not null then result := 'channel_unavailable'; return; end if;
    select k.instagram_id into v_recipient from public.contacts k
      where k.id = p_conv.contact_id and k.organization_id = p_conv.organization_id;
    insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status,
        context, ai_metadata)
      values (p_conv.organization_id, p_conv.id, p_conv.channel_id, 'outbound', 'automation', p_text, 'pending',
        v_context, p_ai_metadata)
      returning id into v_message;
    insert into public.instagram_send_intents (organization_id, channel_id, conversation_id, message_id, actor_id,
        request_id, recipient_external_id, text, message_payload, automation_run_id)
      values (p_conv.organization_id, p_conv.channel_id, p_conv.id, v_message, null, null, v_recipient, p_text,
        p_instagram, p_run)
      returning id into intent_id;
    result := 'queued';
    return;
  end if;
  if v_type is distinct from 'simulator' then result := 'channel_unavailable'; return; end if;
  if char_length(p_text) > 4096 then raise exception 'text too long' using errcode = '22023'; end if;
  insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status,
      context, ai_metadata)
    values (p_conv.organization_id, p_conv.id, p_conv.channel_id, 'outbound', 'automation', p_text, 'delivered',
      v_context, p_ai_metadata);
  result := 'sent';
end $$;

-- ---------------------------------------------------------------- reserva
create function public.claim_automation_runs(p_limit int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  with picked as (
    select r.id from public.automation_runs r
      where (r.status = 'pending' and coalesce(r.resume_at, '-infinity'::timestamptz) <= now())
         or (r.status = 'waiting' and r.resume_at <= now())
      order by r.resume_at nulls first, r.created_at
      limit least(greatest(coalesce(p_limit, 1), 1), 50)
      for update skip locked
  ), upd as (
    update public.automation_runs r set status = 'running', attempts = r.attempts + 1, claim_token = gen_random_uuid(),
      claimed_until = now() + interval '3 minutes'
    from picked where r.id = picked.id
    returning r.id, r.claim_token, r.resume_at, r.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('runId', id, 'claimToken', claim_token)
      order by resume_at nulls first, created_at), '[]'::jsonb)
    into v_result from upd;
  return v_result;
end $$;

-- ---------------------------------------------------------------- preparo
create function public.prepare_automation_run(p_run uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run public.automation_runs; conv public.conversations; v_type text; v_ctx_conv uuid; v_graph jsonb; v_node jsonb;
  v_ai boolean;
begin
  if p_token is null then return '{"action":"skip"}'::jsonb; end if;
  run := private.automation_lock_run(p_run);
  if run.id is null or run.status <> 'running' or run.claim_token is distinct from p_token then
    return '{"action":"skip"}'::jsonb;
  end if;
  -- contato excluído (contact_id nulo pela FK) ou conversa fechada/excluída: cancela
  if run.contact_id is null then
    perform private.automation_cancel_run(run.id);
    return '{"action":"skip"}'::jsonb;
  end if;
  if run.conversation_id is not null then
    select * into conv from public.conversations where id = run.conversation_id;
    if not found or conv.status = 'closed' then
      perform private.automation_cancel_run(run.id);
      return '{"action":"skip"}'::jsonb;
    end if;
    v_ctx_conv := conv.id;
  else
    -- execução de contato: o canal é o da conversa que seria ligada no primeiro envio (null sem conversa)
    v_ctx_conv := private.automation_contact_conversation(run.organization_id, run.contact_id);
  end if;
  select ch.type::text into v_type from public.conversations c join public.channels ch on ch.id = c.channel_id
    where c.id = v_ctx_conv;
  v_graph := private.automation_run_graph(run);
  if v_graph is null then
    perform private.automation_cancel_run(run.id);
    return '{"action":"skip"}'::jsonb;
  end if;
  v_node := private.automation_graph_node(v_graph, run.current_node_id);
  -- ai: no bloco de IA atual ou num sucessor direto (retomada de espera ou rota seguida sem novo prepare)
  v_ai := private.automation_is_ai_node(v_node) or exists (
    select 1 from jsonb_array_elements(coalesce(v_graph -> 'edges', '[]'::jsonb)) e
    where e ->> 'source' = run.current_node_id::text
      and private.automation_is_ai_node(private.automation_graph_node(v_graph, (e ->> 'target')::uuid)));

  return jsonb_build_object(
    'action', 'run',
    'runId', run.id,
    'organizationId', run.organization_id,
    'conversationId', run.conversation_id,
    'channelType', v_type,
    'currentNodeId', run.current_node_id,
    'input', run.input,
    'waitingFor', run.waiting_for,
    'stepCount', run.step_count,
    'iteration', run.iteration,
    'version', run.version,
    'graph', v_graph,
    'context', private.automation_run_context(run, v_ctx_conv, v_type))
    || case when v_ai then jsonb_build_object('ai', private.automation_ai_context(run, v_ctx_conv)) else '{}'::jsonb end;
end $$;

-- ---------------------------------------------------------------- payloads (duas fases)
create function public.automation_button_payloads(p_run uuid, p_token uuid, p_node_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run public.automation_runs; v_node jsonb;
begin
  select * into run from public.automation_runs where id = p_run;
  if not found or run.status <> 'running' or p_token is null or run.claim_token is distinct from p_token then
    raise exception 'invalid claim' using errcode = '42501';
  end if;
  v_node := private.automation_graph_node(private.automation_run_graph(run), p_node_id);
  if v_node is null then raise exception 'invalid node' using errcode = '22023'; end if;
  return private.automation_node_payloads(run.id, v_node);
end $$;

-- ---------------------------------------------------------------- aplicação do passo
create function private.automation_apply_step(p_run uuid, p_token uuid, p_step jsonb) returns jsonb
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
  e jsonb; v_text text; v_type public.channel_type; v_send record; v_cand uuid; v_send_block text; v_conv_checked boolean := false;
  v_result text; v_intents uuid[] := '{}'; v_payloads jsonb := '{}'::jsonb; v_status public.run_status; v_error text;
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

  -- retomada da espera: conclui o passo do nó de espera com o handle resolvido
  if v_resume then
    if jsonb_array_length(p_step -> 'effects') > 0 or v_kind not in ('next', 'end') or v_handle is null then
      raise exception 'invalid resume' using errcode = '22023';
    end if;
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
      'currentNodeId', case when v_kind = 'next' then v_next else v_node_id end);
    update public.automation_run_steps set status = 'completed', handle = v_handle, output = v_out
      where run_id = run.id and node_id = v_node_id and iteration = v_iteration;
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

  if run.conversation_id is not null then
    select * into conv from public.conversations where id = run.conversation_id;
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
    when 'close_conversation' then
      if conv.id is not null then
        update public.conversations set status = 'closed' where id = conv.id and status <> 'closed';
      end if;
    when 'handoff_ai' then
      if conv.id is not null then
        update public.conversations set handled_by = 'ai', status = 'open', handoff_reason = null, automation_run_id = null
          where id = conv.id;
      end if;
    when 'handoff_human' then
      if conv.id is not null then
        update public.conversations set status = 'pending_human', handled_by = 'human' where id = conv.id;
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
            elsif exists (select 1 from public.automation_runs r
                where r.organization_id = run.organization_id and r.id <> run.id
                  and (r.conversation_id = conv.id or r.id = conv.automation_run_id)
                  and r.status in ('pending', 'running', 'waiting')) then
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
      select ch.type into v_type from public.channels ch where ch.id = conv.channel_id;
      if e ->> 'type' = 'ai_message' then
        v_text := v_ai ->> 'text';
        if char_length(v_text) > 4096 or (v_type = 'instagram' and octet_length(v_text) > 1000) then
          v_result := 'reply_too_long';
          continue;
        end if;
        if v_type = 'instagram' and private.ai_instagram_blocker(conv) = 'window_closed' then
          v_result := 'window_closed';
          continue;
        end if;
        if not public.consume_ai_quota(run.organization_id, 'reply') then
          v_result := 'quota_exceeded';
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
  if v_result = 'channel_unavailable' then
    v_status := 'failed'; v_error := 'channel_unavailable';
  elsif v_result = 'window_closed' then
    v_status := 'completed';
  elsif v_result in ('quota_exceeded', 'reply_too_long') then
    v_handle := 'handoff';
    v_next := private.automation_graph_target(v_graph, v_node_id, 'handoff');
    v_status := case when v_next is null then 'completed' else 'running' end;
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
  return v_out;
end $$;

-- Liga o ator 'automation' (eventos emitidos não disparam automações) só durante a aplicação.
create function public.apply_automation_step(p_run uuid, p_token uuid, p_step jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev text := current_setting('flowai.automation_actor', true); v_out jsonb;
begin
  perform private.automation_validate_step(p_step);
  perform set_config('flowai.automation_actor', 'on', true);
  v_out := private.automation_apply_step(p_run, p_token, p_step);
  perform set_config('flowai.automation_actor', coalesce(v_prev, ''), true);
  return v_out;
end $$;

-- ---------------------------------------------------------------- falhas e varredura
create function public.fail_automation_run(p_run uuid, p_token uuid, p_code text, p_retryable boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare run public.automation_runs; v_code text;
begin
  if p_token is null then return; end if;
  run := private.automation_lock_run(p_run);
  if run.id is null or run.status <> 'running' or run.claim_token is distinct from p_token then return; end if;
  v_code := case when p_code ~ '^[a-z0-9_]{1,64}$' then p_code else 'invalid_code' end;
  if coalesce(p_retryable, false) and run.attempts < 3 then
    update public.automation_runs set status = 'pending', error = v_code, claim_token = null, claimed_until = null,
      resume_at = now() + (array[10, 30, 90])[greatest(run.attempts, 1)] * interval '1 second'
      where id = run.id;
  else
    update public.automation_runs set status = 'failed', error = v_code, claim_token = null, claimed_until = null,
      resume_at = null where id = run.id;
    perform private.automation_release(run.id);
  end if;
end $$;

create function public.sweep_automation_runs() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- sem trava aqui: fail_automation_run trava conversa → execução e confere o token de novo
  for r in select id, claim_token from public.automation_runs
      where status = 'running' and claimed_until < now() order by claimed_until loop
    begin
      perform public.fail_automation_run(r.id, r.claim_token, 'claim_expired', true);
    exception when others then
      raise warning 'sweep_automation_runs: run % failed with SQLSTATE %', r.id, sqlstate;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------- reexecução (admin)
create function public.rerun_automation_from(p_run uuid, p_node uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; run public.automation_runs; v_iteration int;
begin
  select organization_id into v_org from public.automation_runs where id = p_run and public.is_member(organization_id);
  if v_org is null then raise exception 'run_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(v_org, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  run := private.automation_lock_run(p_run);
  if run.status not in ('failed', 'completed') then raise exception 'run_not_rerunnable' using errcode = '22023'; end if;
  if p_node is null or private.automation_graph_node(private.automation_run_graph(run), p_node) is null then
    raise exception 'invalid_node' using errcode = '22023';
  end if;
  -- uma execução ativa por conversa
  if run.conversation_id is not null and exists (select 1 from public.automation_runs r
      join public.conversations c on c.id = run.conversation_id
      where r.organization_id = run.organization_id and r.id <> run.id
        and (r.conversation_id = c.id or r.id = c.automation_run_id)
        and r.status in ('pending', 'running', 'waiting')) then
    raise exception 'conversation_busy' using errcode = '22023';
  end if;
  update public.automation_runs set iteration = iteration + 1, current_node_id = p_node, status = 'pending',
      resume_at = now(), error = null, attempts = 0, step_count = 0, waiting_for = null, wait_node_id = null,
      input = null, claim_token = null, claimed_until = null
    where id = run.id
    returning iteration into v_iteration;
  if run.conversation_id is not null then
    perform private.automation_link_run(run.conversation_id, run.id);
  end if;
  return v_iteration;
end $$;

-- ---------------------------------------------------------------- worker
create table private.automation_worker_config (
  singleton boolean primary key default true check (singleton),
  base_url text not null,
  service_key_secret_id uuid not null,
  worker_secret_id uuid not null
);
alter table private.automation_worker_config enable row level security;
revoke all on private.automation_worker_config from anon, authenticated;

create function public.configure_automation_worker(p_base_url text, p_service_key text, p_worker_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare old_config private.automation_worker_config; service_id uuid; worker_id uuid;
begin
  if p_base_url !~ '^(https://[a-z0-9.-]+(:[0-9]+)?|http://(localhost|127\.0\.0\.1|kong|supabase_kong_flowai)(:[0-9]+)?)$'
    or coalesce(length(p_service_key), 0) < 20 or coalesce(length(p_worker_secret), 0) < 32 then
    raise exception 'invalid worker config' using errcode = '22023';
  end if;
  select * into old_config from private.automation_worker_config for update;
  if found then
    perform vault.update_secret(old_config.service_key_secret_id, p_service_key);
    perform vault.update_secret(old_config.worker_secret_id, p_worker_secret);
    update private.automation_worker_config set base_url = p_base_url;
  else
    select vault.create_secret(p_service_key, 'flowai-automation-worker-service') into service_id;
    select vault.create_secret(p_worker_secret, 'flowai-automation-worker-secret') into worker_id;
    insert into private.automation_worker_config values (true, p_base_url, service_id, worker_id);
  end if;
end $$;

create function public.read_automation_worker_config() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('workerSecret', s.decrypted_secret)
  from private.automation_worker_config c join vault.decrypted_secrets s on s.id = c.worker_secret_id;
$$;

create function public.dispatch_automation_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare config private.automation_worker_config; service_key text; worker_secret text;
begin
  perform public.sweep_automation_runs();
  select * into config from private.automation_worker_config;
  if not found then return; end if;
  if not exists (select 1 from public.automation_runs
      where (status = 'pending' and coalesce(resume_at, '-infinity'::timestamptz) <= clock_timestamp())
         or (status = 'waiting' and resume_at <= clock_timestamp())) then
    return;
  end if;
  select decrypted_secret into service_key from vault.decrypted_secrets where id = config.service_key_secret_id;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where id = config.worker_secret_id;
  perform net.http_post(url := config.base_url || '/functions/v1/automation-worker', body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key,
      'apikey', service_key, 'X-FlowAI-Worker', worker_secret), timeout_milliseconds := 150000);
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function
  private.automation_run_graph(public.automation_runs),
  private.automation_graph_node(jsonb, uuid),
  private.automation_graph_target(jsonb, uuid, text),
  private.automation_is_ai_node(jsonb),
  private.automation_node_payloads(uuid, jsonb),
  private.automation_lock_run(uuid),
  private.automation_release(uuid),
  private.automation_cancel_run(uuid),
  private.automation_contact_conversation(uuid, uuid),
  private.automation_run_context(public.automation_runs, uuid, text),
  private.automation_ai_context(public.automation_runs, uuid),
  private.automation_validate_step(jsonb),
  private.automation_move_stage(uuid, uuid, uuid),
  private.automation_deliver(uuid, public.conversations, uuid, text, jsonb, jsonb, jsonb, jsonb),
  private.automation_apply_step(uuid, uuid, jsonb),
  public.claim_automation_runs(int),
  public.prepare_automation_run(uuid, uuid),
  public.automation_button_payloads(uuid, uuid, uuid),
  public.apply_automation_step(uuid, uuid, jsonb),
  public.fail_automation_run(uuid, uuid, text, boolean),
  public.sweep_automation_runs(),
  public.configure_automation_worker(text, text, text),
  public.read_automation_worker_config(),
  public.dispatch_automation_worker()
  from public, anon, authenticated;
grant execute on function
  public.claim_automation_runs(int),
  public.prepare_automation_run(uuid, uuid),
  public.automation_button_payloads(uuid, uuid, uuid),
  public.apply_automation_step(uuid, uuid, jsonb),
  public.fail_automation_run(uuid, uuid, text, boolean),
  public.sweep_automation_runs(),
  public.configure_automation_worker(text, text, text),
  public.read_automation_worker_config(),
  public.dispatch_automation_worker()
  to service_role;
revoke all on function public.rerun_automation_from(uuid, uuid) from public, anon;
grant execute on function public.rerun_automation_from(uuid, uuid) to authenticated;

select cron.schedule('flowai-automation-worker', '5 seconds', 'select public.dispatch_automation_worker()');
