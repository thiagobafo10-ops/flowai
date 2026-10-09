-- Fase 2 / revisão final: endurecimento das métricas do dashboard.
--  1. resolution_rate e conversion_rate sempre em [0,1] (numerador ⊆ denominador).
--  2. organizations.timezone validado contra o catálogo de fusos.
--  3. Mudança de is_won/is_lost numa etapa propaga para o status dos deals.
--  4. Conversa criada já em pending_human/closed emite handoff/conversation_closed.
--  5. potential_value e valor do funil somam só deals em BRL.

-- ---------------------------------------------------------------- 2. timezone
-- IMMUTABLE de propósito: CHECK constraints exigem funções determinísticas e o
-- catálogo de fusos (tzdata) só muda com upgrade do servidor. Se um nome deixar de
-- existir após um upgrade, as linhas antigas continuam gravadas; só novas escritas
-- com esse nome passam a falhar — comportamento desejado.
create or replace function public.is_valid_timezone(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p);
$$;

revoke all on function public.is_valid_timezone(text) from public, anon;
grant execute on function public.is_valid_timezone(text) to authenticated, service_role;

alter table public.organizations
  add constraint organizations_timezone_valid check (public.is_valid_timezone(timezone));

-- ---------------------------------------------------------------- 4. conversas
create or replace function public.trg_conversations_emit_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_event(new.organization_id, 'conversation_created', new.id, new.contact_id, null,
      jsonb_build_object('channel_id', new.channel_id));
    if new.status = 'pending_human' then
      perform public.emit_event(new.organization_id, 'handoff', new.id, new.contact_id, null,
        jsonb_build_object('from_status', null));
    elsif new.status = 'closed' then
      perform public.emit_event(new.organization_id, 'conversation_closed', new.id, new.contact_id, null,
        jsonb_build_object('from_status', null));
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'pending_human' then
      perform public.emit_event(new.organization_id, 'handoff', new.id, new.contact_id, null,
        jsonb_build_object('from_status', old.status));
    elsif new.status = 'closed' then
      perform public.emit_event(new.organization_id, 'conversation_closed', new.id, new.contact_id, null,
        jsonb_build_object('from_status', old.status));
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.trg_conversations_emit_events() from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. etapas -> deals
-- Reaplica o status derivado (o BEFORE trigger deals_set_status recalcula a partir
-- da etapa). Se reabrir um deal violar deals_one_open_per_contact_pipeline, o 23505
-- propaga e a mudança da flag falha.
create or replace function public.trg_pipeline_stages_propagate_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.deals d
    set status = d.status
    where d.organization_id = new.organization_id and d.stage_id = new.id;
  return null;
end;
$$;

revoke all on function public.trg_pipeline_stages_propagate_status() from public, anon, authenticated;

create trigger pipeline_stages_propagate_status
  after update of is_won, is_lost on public.pipeline_stages
  for each row
  when (old.is_won is distinct from new.is_won or old.is_lost is distinct from new.is_lost)
  execute function public.trg_pipeline_stages_propagate_status();

-- ---------------------------------------------------------------- 1 + 5. métricas
create or replace function public.dashboard_metrics(p_org uuid, p_days int)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text;
  v_today_local date;
  v_today_start timestamptz;
  v_start timestamptz;
  v_end timestamptz := now();
  v_msg_convs int;
  v_closed_convs int;
  v_created int;
  v_won int;
  v_kpis jsonb;
  v_conv_series jsonb;
  v_ai_series jsonb;
  v_funnel jsonb;
  v_has_activity boolean;
begin
  if p_days is null or p_days not in (1, 7, 30) then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if not public.is_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select o.timezone into v_tz from public.organizations o where o.id = p_org;
  if v_tz is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  v_today_local := date_trunc('day', v_end at time zone v_tz)::date;
  v_today_start := v_today_local::timestamp at time zone v_tz;
  v_start := (v_today_local - (p_days - 1))::timestamp at time zone v_tz;

  -- resolution_rate: conversas com message_received na janela que também tiveram
  -- conversation_closed na janela ÷ conversas com message_received na janela.
  select count(*) filter (where w.has_msg),
         count(*) filter (where w.has_msg and w.has_closed)
    into v_msg_convs, v_closed_convs
    from (
      select bool_or(e.type = 'message_received') as has_msg,
             bool_or(e.type = 'conversation_closed') as has_closed
        from public.events e
        where e.organization_id = p_org
          and e.type in ('message_received', 'conversation_closed')
          and e.conversation_id is not null
          and e.created_at >= v_start and e.created_at <= v_end
        group by e.conversation_id
    ) w;

  -- conversion_rate: deals com deal_created na janela que também tiveram deal_won
  -- na janela ÷ deals com deal_created na janela (ganhos repetidos contam uma vez).
  select count(*) filter (where w.has_created),
         count(*) filter (where w.has_created and w.has_won)
    into v_created, v_won
    from (
      select bool_or(e.type = 'deal_created') as has_created,
             bool_or(e.type = 'deal_won') as has_won
        from public.events e
        where e.organization_id = p_org
          and e.type in ('deal_created', 'deal_won')
          and e.deal_id is not null
          and e.created_at >= v_start and e.created_at <= v_end
        group by e.deal_id
    ) w;

  v_kpis := jsonb_build_object(
    'conversations_today', (
      select count(distinct e.conversation_id) from public.events e
      where e.organization_id = p_org and e.type = 'message_received'
        and e.created_at >= v_today_start and e.created_at <= v_end),
    'new_contacts', (
      select count(*) from public.events e
      where e.organization_id = p_org and e.type = 'contact_created'
        and e.created_at >= v_start and e.created_at <= v_end),
    'leads', (
      select count(*) from public.contacts c
      where c.organization_id = p_org and c.status = 'lead'),
    'opportunities', (
      select count(*) from public.deals d
      join public.pipelines p on p.organization_id = d.organization_id and p.id = d.pipeline_id
      join public.pipeline_stages s on s.organization_id = d.organization_id and s.id = d.stage_id
      where d.organization_id = p_org and d.status = 'open' and p.is_default and s.position > 0),
    -- Só BRL: sem conversão de moeda, somar moedas diferentes não faz sentido.
    'potential_value', (
      select coalesce(sum(d.value), 0) from public.deals d
      where d.organization_id = p_org and d.status = 'open' and d.currency = 'BRL'),
    'ai_handled_conversations', (
      select count(distinct e.conversation_id) from public.events e
      where e.organization_id = p_org and e.type = 'ai_replied'
        and e.created_at >= v_start and e.created_at <= v_end),
    'handoffs', (
      select count(*) from public.events e
      where e.organization_id = p_org and e.type = 'handoff'
        and e.created_at >= v_start and e.created_at <= v_end),
    'resolution_rate', case when v_msg_convs = 0 then null
      else v_closed_convs::float8 / v_msg_convs end,
    'conversion_rate', case when v_created = 0 then null
      else v_won::float8 / v_created end
  );

  with days as (
    select (v_today_local - (p_days - 1) + g)::date as d
    from generate_series(0, p_days - 1) g
  ),
  ev as (
    select (e.created_at at time zone v_tz)::date as d, e.type, e.conversation_id
    from public.events e
    where e.organization_id = p_org
      and e.type in ('message_received', 'ai_replied', 'handoff')
      and e.created_at >= v_start and e.created_at <= v_end
  ),
  agg as (
    select days.d,
      (select count(distinct ev.conversation_id) from ev
        where ev.d = days.d and ev.type = 'message_received') as convs,
      (select count(distinct ev.conversation_id) from ev
        where ev.d = days.d and ev.type = 'ai_replied') as ai,
      (select count(*) from ev
        where ev.d = days.d and ev.type = 'handoff') as handoff
    from days
  )
  select
    jsonb_agg(jsonb_build_object('day', to_char(agg.d, 'YYYY-MM-DD'), 'count', agg.convs) order by agg.d),
    jsonb_agg(jsonb_build_object('day', to_char(agg.d, 'YYYY-MM-DD'), 'ai', agg.ai, 'handoff', agg.handoff) order by agg.d)
  into v_conv_series, v_ai_series
  from agg;

  select coalesce(jsonb_agg(jsonb_build_object(
      'stage_id', s.id,
      'name', s.name,
      'position', s.position,
      'count', (select count(*) from public.deals d
                where d.organization_id = s.organization_id and d.stage_id = s.id),
      'value', (select coalesce(sum(d.value), 0) from public.deals d
                where d.organization_id = s.organization_id and d.stage_id = s.id
                  and d.currency = 'BRL')
    ) order by s.position), '[]'::jsonb)
  into v_funnel
  from public.pipeline_stages s
  join public.pipelines p on p.organization_id = s.organization_id and p.id = s.pipeline_id
  where s.organization_id = p_org and p.is_default;

  v_has_activity := exists (select 1 from public.events e where e.organization_id = p_org)
    or exists (select 1 from public.channels ch where ch.organization_id = p_org and ch.status = 'active');

  return jsonb_build_object(
    'period_days', p_days,
    'has_activity', v_has_activity,
    'kpis', v_kpis,
    'series', jsonb_build_object(
      'conversations_per_day', v_conv_series,
      'ai_vs_handoff_per_day', v_ai_series),
    'funnel', v_funnel
  );
end;
$$;

revoke all on function public.dashboard_metrics(uuid, int) from public, anon;
grant execute on function public.dashboard_metrics(uuid, int) to authenticated;
