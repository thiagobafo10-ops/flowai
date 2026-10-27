-- Automações do MCP (formato simples guardado em mcp_spec) e "uma vez por contato" (oncePerUser) nos gatilhos
-- keyword_detected e instagram_story.

-- ---------------------------------------------------------------- colunas
-- mcp_spec: formato simples da automação criada pelo MCP (nulo para as criadas no painel).
-- mcp_spec_stale: o grafo foi salvo pelo painel depois do MCP; o MCP só sobrescreve com confirmação.
alter table public.automations
  add column mcp_spec jsonb,
  add column mcp_spec_stale boolean not null default false;
grant select (mcp_spec, mcp_spec_stale) on public.automations to authenticated;

-- ---------------------------------------------------------------- salvar automação
-- Igual a 20261022000001, mais: salvar pelo painel uma automação do MCP marca mcp_spec_stale.
create or replace function public.save_automation(
  p_org uuid, p_id uuid, p_name text, p_trigger_type public.automation_trigger_type,
  p_trigger_config jsonb, p_graph jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_name text := btrim(coalesce(p_name, ''));
  v_status public.automation_status;
  n jsonb; e jsonb; v_ids uuid[] := '{}'; v_eids uuid[] := '{}'; v_rows int; v_nid uuid; v_src uuid; v_dst uuid;
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if not public.has_role(p_org, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_trigger_type is null or jsonb_typeof(p_trigger_config) is distinct from 'object'
     or jsonb_typeof(p_graph) is distinct from 'object'
     or jsonb_typeof(p_graph -> 'nodes') is distinct from 'array'
     or jsonb_typeof(p_graph -> 'edges') is distinct from 'array' then
    raise exception 'invalid_graph' using errcode = '22023';
  end if;
  if p_trigger_type = 'instagram_comment' and not private.instagram_comment_public_replies_valid(p_trigger_config) then
    raise exception 'invalid_trigger_config' using errcode = '22023';
  end if;

  if v_id is not null then
    select status into v_status from public.automations where id = v_id and organization_id = p_org for update;
    if not found then raise exception 'automation_not_found' using errcode = 'P0002'; end if;
  end if;

  -- validação estrutural mínima (a validade semântica é do server action)
  for n in select * from jsonb_array_elements(p_graph -> 'nodes') loop
    if jsonb_typeof(n) <> 'object' or jsonb_typeof(n -> 'id') is distinct from 'string'
       or (n ->> 'id') !~ v_uuid_re then
      raise exception 'invalid_node_id' using errcode = '22023';
    end if;
    v_nid := (n ->> 'id')::uuid;
    if v_nid = any (v_ids) then raise exception 'duplicate_node_id' using errcode = '22023'; end if;
    v_ids := v_ids || v_nid;
    if jsonb_typeof(n -> 'type') is distinct from 'string' or not exists (
      select 1 from unnest(enum_range(null::public.automation_node_type)) t where t::text = n ->> 'type') then
      raise exception 'invalid_node_type' using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(n -> 'config', '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(n -> 'position', '{"x":0,"y":0}'::jsonb)) <> 'object' then
      raise exception 'invalid_node' using errcode = '22023';
    end if;
    if exists (select 1 from public.automation_nodes x where x.id = v_nid
        and (x.organization_id <> p_org or x.automation_id is distinct from v_id)) then
      raise exception 'node_id_in_use' using errcode = '22023';
    end if;
  end loop;
  for e in select * from jsonb_array_elements(p_graph -> 'edges') loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'id') is distinct from 'string'
       or (e ->> 'id') !~ v_uuid_re then
      raise exception 'invalid_edge_id' using errcode = '22023';
    end if;
    if jsonb_typeof(e -> 'source') is distinct from 'string' or jsonb_typeof(e -> 'target') is distinct from 'string'
       or (e ->> 'source') !~ v_uuid_re or (e ->> 'target') !~ v_uuid_re then
      raise exception 'invalid_edge' using errcode = '22023';
    end if;
    if (e ->> 'id')::uuid = any (v_eids) then raise exception 'duplicate_edge_id' using errcode = '22023'; end if;
    v_eids := v_eids || (e ->> 'id')::uuid;
    v_src := (e ->> 'source')::uuid; v_dst := (e ->> 'target')::uuid;
    if not (v_src = any (v_ids)) or not (v_dst = any (v_ids)) then
      raise exception 'edge_unknown_node' using errcode = '22023';
    end if;
    if exists (select 1 from public.automation_edges x where x.id = (e ->> 'id')::uuid
        and (x.organization_id <> p_org or x.automation_id is distinct from v_id)) then
      raise exception 'edge_id_in_use' using errcode = '22023';
    end if;
  end loop;

  if v_id is null then
    insert into public.automations (organization_id, name, trigger_type, trigger_config, created_by)
      values (p_org, v_name, p_trigger_type, p_trigger_config, (select auth.uid()))
      returning id into v_id;
  else
    update public.automations set name = v_name, trigger_type = p_trigger_type, trigger_config = p_trigger_config,
      mcp_spec_stale = mcp_spec is not null
      where id = v_id;
  end if;

  -- nodes: mantém ids (runs e steps referenciam nodes); remove os ausentes
  delete from public.automation_edges where organization_id = p_org and automation_id = v_id;
  delete from public.automation_nodes where organization_id = p_org and automation_id = v_id
    and not (id = any (v_ids));
  for n in select * from jsonb_array_elements(p_graph -> 'nodes') loop
    insert into public.automation_nodes (id, organization_id, automation_id, type, config, position)
      values ((n ->> 'id')::uuid, p_org, v_id, (n ->> 'type')::public.automation_node_type,
        coalesce(n -> 'config', '{}'::jsonb), coalesce(n -> 'position', '{"x":0,"y":0}'::jsonb))
    on conflict (id) do update set type = excluded.type, config = excluded.config, position = excluded.position
      where public.automation_nodes.automation_id = v_id and public.automation_nodes.organization_id = p_org;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'node_id_in_use' using errcode = '22023'; end if;
  end loop;
  for e in select * from jsonb_array_elements(p_graph -> 'edges') loop
    insert into public.automation_edges (id, organization_id, automation_id, source_node_id, target_node_id, source_handle)
      values ((e ->> 'id')::uuid, p_org, v_id, (e ->> 'source')::uuid, (e ->> 'target')::uuid,
        coalesce(e ->> 'sourceHandle', 'default'));
  end loop;

  if v_status = 'active' then perform private.snapshot_automation(p_org, v_id); end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- salvar automação do MCP
-- Cria (p_id nulo) ou edita uma automação do MCP pelo caminho de save_automation (mesmas validações) e grava o
-- formato simples. Automação do painel (sem mcp_spec) → not_mcp_automation; editada no painel depois do MCP
-- (mcp_spec_stale) → panel_modified, salvo com p_confirm_overwrite.
create function public.save_mcp_automation(
  p_org uuid, p_id uuid, p_name text, p_spec jsonb, p_trigger_type public.automation_trigger_type,
  p_trigger_config jsonb, p_graph jsonb, p_confirm_overwrite boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.automations; v_id uuid;
begin
  if not public.has_role(p_org, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_spec) is distinct from 'object' then raise exception 'invalid_spec' using errcode = '22023'; end if;
  if p_id is not null then
    select * into a from public.automations where id = p_id and organization_id = p_org for update;
    if not found then raise exception 'automation_not_found' using errcode = 'P0002'; end if;
    if a.mcp_spec is null then raise exception 'not_mcp_automation' using errcode = '22023'; end if;
    if a.mcp_spec_stale and not coalesce(p_confirm_overwrite, false) then
      raise exception 'panel_modified' using errcode = '22023';
    end if;
  end if;
  v_id := public.save_automation(p_org, p_id, p_name, p_trigger_type, p_trigger_config, p_graph);
  update public.automations set mcp_spec = p_spec, mcp_spec_stale = false where id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- uma vez por contato
-- O contato já teve execução desta automação: qualquer estado conta, exceto falha antes do primeiro envio
-- (execução 'failed' sem mensagem de saída não falhada).
create function private.automation_contact_already_ran(p_auto uuid, p_contact uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_contact is not null and exists (
    select 1 from public.automation_runs r
    where r.automation_id = p_auto and r.contact_id = p_contact
      and (r.status <> 'failed' or exists (
        select 1 from public.messages m
        where m.organization_id = r.organization_id and m.conversation_id = r.conversation_id
          and m.direction = 'outbound' and m.status <> 'failed'
          and m.context -> 'automation' ->> 'runId' = r.id::text)))
$$;

-- ---------------------------------------------------------------- mensagem recebida
-- Igual a 20261014000002, mais: keyword_detected e instagram_story com oncePerUser (padrão false) ignoram a
-- automação quando o contato já teve execução dela (private.automation_contact_already_ran).
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
      and (
        v.trigger_type not in ('keyword_detected', 'instagram_story')
        or v.trigger_config -> 'oncePerUser' is distinct from 'true'::jsonb
        or not private.automation_contact_already_ran(a.id, conv.contact_id)
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

-- ---------------------------------------------------------------- grants
revoke all on function private.automation_contact_already_ran(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_mcp_automation(uuid, uuid, text, jsonb, public.automation_trigger_type, jsonb, jsonb,
  boolean) from public, anon;
grant execute on function public.save_mcp_automation(uuid, uuid, text, jsonb, public.automation_trigger_type, jsonb,
  jsonb, boolean) to authenticated;
