-- Fase 7A: funções de autoria (única via de escrita em automations/nodes/edges).

create function private.automation_graph(p_org uuid, p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'type', n.type, 'config', n.config,
        'position', n.position) order by n.created_at, n.id)
      from public.automation_nodes n where n.organization_id = p_org and n.automation_id = p_id), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'source', e.source_node_id,
        'target', e.target_node_id, 'sourceHandle', e.source_handle) order by e.created_at, e.id)
      from public.automation_edges e where e.organization_id = p_org and e.automation_id = p_id), '[]'::jsonb))
$$;
revoke all on function private.automation_graph(uuid, uuid) from public, anon, authenticated;

create function private.snapshot_automation(p_org uuid, p_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare a public.automations; v int;
begin
  select * into a from public.automations where id = p_id and organization_id = p_org for update;
  v := a.current_version + 1;
  insert into public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph)
    values (p_org, p_id, v, a.trigger_type, a.trigger_config, private.automation_graph(p_org, p_id));
  update public.automations set current_version = v where id = p_id;
  return v;
end $$;
revoke all on function private.snapshot_automation(uuid, uuid) from public, anon, authenticated;

create function public.save_automation(
  p_org uuid, p_id uuid, p_name text, p_trigger_type public.automation_trigger_type,
  p_trigger_config jsonb, p_graph jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_name text := btrim(coalesce(p_name, ''));
  v_status public.automation_status;
  n jsonb; e jsonb; v_ids uuid[] := '{}'; v_nid uuid; v_src uuid; v_dst uuid;
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
    update public.automations set name = v_name, trigger_type = p_trigger_type, trigger_config = p_trigger_config
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
    on conflict (id) do update set type = excluded.type, config = excluded.config, position = excluded.position;
  end loop;
  for e in select * from jsonb_array_elements(p_graph -> 'edges') loop
    insert into public.automation_edges (id, organization_id, automation_id, source_node_id, target_node_id, source_handle)
      values ((e ->> 'id')::uuid, p_org, v_id, (e ->> 'source')::uuid, (e ->> 'target')::uuid,
        coalesce(e ->> 'sourceHandle', 'default'));
  end loop;

  if v_status = 'active' then perform private.snapshot_automation(p_org, v_id); end if;
  return v_id;
end $$;

create function public.activate_automation(p_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare a public.automations; v int;
begin
  select * into a from public.automations where id = p_id and public.is_member(organization_id) for update;
  if not found then raise exception 'automation_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(a.organization_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if a.status = 'active' then return a.current_version; end if;
  v := private.snapshot_automation(a.organization_id, p_id);
  update public.automations set status = 'active', activated_at = now() where id = p_id;
  return v;
end $$;

create function public.pause_automation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.automations;
begin
  select * into a from public.automations where id = p_id and public.is_member(organization_id) for update;
  if not found then raise exception 'automation_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(a.organization_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.automations set status = 'paused' where id = p_id and status = 'active';
end $$;

create function public.delete_automation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.automations;
begin
  select * into a from public.automations where id = p_id and public.is_member(organization_id) for update;
  if not found then raise exception 'automation_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(a.organization_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.automation_runs set status = 'cancelled', resume_at = null, claim_token = null, claimed_until = null
    where automation_id = p_id and status in ('pending', 'running', 'waiting');
  update public.conversations set automation_run_id = null
    where organization_id = a.organization_id
      and automation_run_id in (select id from public.automation_runs where automation_id = p_id);
  delete from public.automations where id = p_id;
end $$;

create function public.duplicate_automation(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.automations; v_new uuid; v_map jsonb;
begin
  select * into a from public.automations where id = p_id and public.is_member(organization_id);
  if not found then raise exception 'automation_not_found' using errcode = 'P0002'; end if;
  if not public.has_role(a.organization_id, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.automations (organization_id, name, description, trigger_type, trigger_config, created_by)
    values (a.organization_id, left('Cópia de ' || a.name, 100), a.description, a.trigger_type, a.trigger_config,
      (select auth.uid()))
    returning id into v_new;
  select coalesce(jsonb_object_agg(n.id::text, gen_random_uuid()::text), '{}'::jsonb) into v_map
    from public.automation_nodes n where n.automation_id = p_id;
  insert into public.automation_nodes (id, organization_id, automation_id, type, config, position)
    select (v_map ->> n.id::text)::uuid, n.organization_id, v_new, n.type, n.config, n.position
    from public.automation_nodes n where n.automation_id = p_id;
  insert into public.automation_edges (organization_id, automation_id, source_node_id, target_node_id, source_handle)
    select e.organization_id, v_new, (v_map ->> e.source_node_id::text)::uuid,
      (v_map ->> e.target_node_id::text)::uuid, e.source_handle
    from public.automation_edges e where e.automation_id = p_id;
  return v_new;
end $$;

revoke all on function public.save_automation(uuid, uuid, text, public.automation_trigger_type, jsonb, jsonb),
  public.activate_automation(uuid), public.pause_automation(uuid), public.delete_automation(uuid),
  public.duplicate_automation(uuid) from public, anon;
grant execute on function public.save_automation(uuid, uuid, text, public.automation_trigger_type, jsonb, jsonb),
  public.activate_automation(uuid), public.pause_automation(uuid), public.delete_automation(uuid),
  public.duplicate_automation(uuid) to authenticated;
