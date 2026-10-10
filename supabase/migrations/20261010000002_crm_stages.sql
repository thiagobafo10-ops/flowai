-- Fase 3 (CRM): gestão de etapas do pipeline com invariantes
-- (exatamente uma etapa Ganho, uma Perdido e ao menos uma aberta).
--
-- As funções são SECURITY DEFINER com checagem has_role(org, 'admin'); a org é sempre
-- derivada da linha do pipeline/etapa, nunca de parâmetro. Para que os invariantes não
-- possam ser burlados, a escrita direta de `authenticated` em pipeline_stages fica restrita
-- a `update (name)`: insert, delete e update (position, is_won, is_lost) são revogados.
-- As policies de insert/delete existentes ficam, portanto, sem efeito para a API
-- (permanecem apenas como defesa em profundidade). Renomear segue por update direto (RLS admin).

-- Unicidade de nome por pipeline, sem diferenciar maiúsculas.
create unique index pipeline_stages_pipeline_lower_name_key
  on public.pipeline_stages (pipeline_id, lower(name));

alter table public.pipeline_stages
  add constraint pipeline_stages_name_length check (char_length(btrim(name)) between 1 and 40);

revoke insert, delete on public.pipeline_stages from authenticated;
revoke update (position, is_won, is_lost) on public.pipeline_stages from authenticated;

-- ------------------------------------------------------------------ create_stage
create function public.create_stage(p_pipeline uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_pos int;
  v_id uuid;
begin
  select organization_id into v_org from public.pipelines where id = p_pipeline;
  if v_org is null or not public.has_role(v_org, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  perform 1 from public.pipelines where id = p_pipeline for update;

  select coalesce(min(position) filter (where is_won or is_lost), max(position) + 1, 0)
    into v_pos from public.pipeline_stages where pipeline_id = p_pipeline;

  -- unique (pipeline_id, position) é deferrable initially deferred: o deslocamento é seguro.
  update public.pipeline_stages set position = position + 1
    where pipeline_id = p_pipeline and position >= v_pos;

  insert into public.pipeline_stages (organization_id, pipeline_id, name, position)
    values (v_org, p_pipeline, v_name, v_pos)
    returning id into v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------------ reorder_stages
create function public.reorder_stages(p_pipeline uuid, p_stage_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.pipelines where id = p_pipeline;
  if v_org is null or not public.has_role(v_org, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.pipelines where id = p_pipeline for update;

  if p_stage_ids is null
     or cardinality(p_stage_ids) is distinct from (select count(*) from public.pipeline_stages where pipeline_id = p_pipeline)
     or (select count(distinct x) from unnest(p_stage_ids) x) <> cardinality(p_stage_ids)
     or exists (
       select 1 from unnest(p_stage_ids) x
       where not exists (select 1 from public.pipeline_stages s where s.id = x and s.pipeline_id = p_pipeline)
     ) then
    raise exception 'stage_set_mismatch' using errcode = '22023';
  end if;

  update public.pipeline_stages s set position = o.ord::int - 1
    from unnest(p_stage_ids) with ordinality as o(id, ord)
    where s.id = o.id and s.pipeline_id = p_pipeline and s.position is distinct from o.ord::int - 1;
end;
$$;

-- ------------------------------------------------------------------ delete_stage_moving_deals
create function public.delete_stage_moving_deals(p_stage uuid, p_target_stage uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_pipeline uuid;
  v_outcome boolean;
  v_target_outcome boolean;
begin
  -- 1) org/pipeline sem lock (imutáveis) -> checagem de papel
  select organization_id, pipeline_id into v_org, v_pipeline
    from public.pipeline_stages where id = p_stage;
  if v_org is null or not public.has_role(v_org, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 2) trava o pipeline e só então relê as flags (evita corrida com set_stage_outcome)
  perform 1 from public.pipelines where id = v_pipeline for update;

  select (is_won or is_lost) into v_outcome
    from public.pipeline_stages where id = p_stage;
  if v_outcome is null then
    raise exception 'stage_not_found' using errcode = '22023';
  end if;
  if v_outcome then
    raise exception 'stage_is_outcome' using errcode = '22023';
  end if;

  select (is_won or is_lost) into v_target_outcome
    from public.pipeline_stages
    where id = p_target_stage and pipeline_id = v_pipeline;
  if p_target_stage is null or p_target_stage = p_stage or v_target_outcome is null then
    raise exception 'invalid_target_stage' using errcode = '22023';
  end if;
  if v_target_outcome then
    raise exception 'target_is_outcome' using errcode = '22023';
  end if;

  update public.deals set stage_id = p_target_stage where stage_id = p_stage;
  delete from public.pipeline_stages where id = p_stage;

  update public.pipeline_stages s set position = r.rn::int - 1
    from (select id, row_number() over (order by position) as rn
            from public.pipeline_stages where pipeline_id = v_pipeline) r
    where s.id = r.id and s.position is distinct from r.rn::int - 1;

  if (select count(*) from public.pipeline_stages where pipeline_id = v_pipeline and is_won) <> 1
     or (select count(*) from public.pipeline_stages where pipeline_id = v_pipeline and is_lost) <> 1 then
    raise exception 'outcome_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.pipeline_stages
                  where pipeline_id = v_pipeline and not is_won and not is_lost) then
    raise exception 'last_open_stage' using errcode = '22023';
  end if;
end;
$$;

-- ------------------------------------------------------------------ set_stage_outcome
create function public.set_stage_outcome(p_stage uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_pipeline uuid;
begin
  select organization_id, pipeline_id into v_org, v_pipeline
    from public.pipeline_stages where id = p_stage;
  if v_org is null or not public.has_role(v_org, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('won', 'lost') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;

  perform 1 from public.pipelines where id = v_pipeline for update;

  -- Retira a marca da etapa atual (os gatilhos da Fase 2 recalculam o status dos deals;
  -- conflito de deal aberto propaga 23505 e desfaz a transação inteira).
  if p_outcome = 'won' then
    update public.pipeline_stages set is_won = false
      where pipeline_id = v_pipeline and is_won and id <> p_stage;
    update public.pipeline_stages set is_won = true, is_lost = false where id = p_stage;
    if not exists (select 1 from public.pipeline_stages where pipeline_id = v_pipeline and is_lost) then
      raise exception 'outcome_required' using errcode = '22023';
    end if;
  else
    update public.pipeline_stages set is_lost = false
      where pipeline_id = v_pipeline and is_lost and id <> p_stage;
    update public.pipeline_stages set is_lost = true, is_won = false where id = p_stage;
    if not exists (select 1 from public.pipeline_stages where pipeline_id = v_pipeline and is_won) then
      raise exception 'outcome_required' using errcode = '22023';
    end if;
  end if;

  if not exists (select 1 from public.pipeline_stages
                  where pipeline_id = v_pipeline and not is_won and not is_lost) then
    raise exception 'last_open_stage' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.create_stage(uuid, text) from public, anon;
revoke all on function public.reorder_stages(uuid, uuid[]) from public, anon;
revoke all on function public.delete_stage_moving_deals(uuid, uuid) from public, anon;
revoke all on function public.set_stage_outcome(uuid, text) from public, anon;
grant execute on function public.create_stage(uuid, text) to authenticated;
grant execute on function public.reorder_stages(uuid, uuid[]) to authenticated;
grant execute on function public.delete_stage_moving_deals(uuid, uuid) to authenticated;
grant execute on function public.set_stage_outcome(uuid, text) to authenticated;
