-- slugify: unaccent não é immutable (depende do dicionário) -> declarada stable.
create function public.slugify(p text) returns text
language sql stable set search_path = '' as $$
  select left(
    trim(both '-' from regexp_replace(lower(extensions.unaccent(coalesce(p, ''))), '[^a-z0-9]+', '-', 'g')),
    40);
$$;
revoke all on function public.slugify(text) from public, anon;
grant execute on function public.slugify(text) to authenticated;

create function public.create_organization_with_owner(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_org uuid;
  v_pipeline uuid;
  v_base text;
  v_try int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if char_length(v_name) = 0 or char_length(v_name) > 80 then
    raise exception 'invalid_organization_name' using errcode = '22023';
  end if;
  v_base := public.slugify(v_name);

  loop
    v_try := v_try + 1;
    begin
      insert into public.organizations (name, slug)
      values (v_name, v_base || '-' || substr(encode(extensions.gen_random_bytes(3), 'hex'), 1, 6))
      returning id into v_org;
      exit;
    exception when unique_violation then
      if v_try >= 3 then raise; end if;
    end;
  end loop;

  insert into public.memberships (organization_id, user_id, role) values (v_org, v_uid, 'owner');

  insert into public.pipelines (organization_id, name, is_default)
  values (v_org, 'Pipeline padrão', true) returning id into v_pipeline;

  insert into public.pipeline_stages (organization_id, pipeline_id, name, position, is_won, is_lost) values
    (v_org, v_pipeline, 'Novo', 0, false, false),
    (v_org, v_pipeline, 'Interessado', 1, false, false),
    (v_org, v_pipeline, 'Qualificado', 2, false, false),
    (v_org, v_pipeline, 'Orçamento', 3, false, false),
    (v_org, v_pipeline, 'Negociação', 4, false, false),
    (v_org, v_pipeline, 'Ganho', 5, true, false),
    (v_org, v_pipeline, 'Perdido', 6, false, true);

  insert into public.ai_agents (organization_id, name, is_active, auto_reply, human_handoff)
  values (v_org, 'Assistente', false, false, true);

  perform public.write_audit_log(v_org, 'organization.created', 'organization', v_org);
  return v_org;
end $$;

revoke all on function public.create_organization_with_owner(text) from public, anon;
grant execute on function public.create_organization_with_owner(text) to authenticated;
