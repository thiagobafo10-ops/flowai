-- Fase 2 / Tarefa 2: métricas do dashboard (KPIs, séries diárias e funil) a partir
-- dos eventos de domínio e do estado atual das tabelas.
-- SECURITY INVOKER: o RLS do chamador continua decidindo o que é visível.

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

  select count(distinct e.conversation_id) into v_msg_convs
    from public.events e
    where e.organization_id = p_org and e.type = 'message_received'
      and e.created_at >= v_start and e.created_at <= v_end;
  select count(distinct e.conversation_id) into v_closed_convs
    from public.events e
    where e.organization_id = p_org and e.type = 'conversation_closed'
      and e.created_at >= v_start and e.created_at <= v_end;
  select count(*) filter (where e.type = 'deal_created'),
         count(*) filter (where e.type = 'deal_won')
    into v_created, v_won
    from public.events e
    where e.organization_id = p_org and e.type in ('deal_created', 'deal_won')
      and e.created_at >= v_start and e.created_at <= v_end;

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
    'potential_value', (
      select coalesce(sum(d.value), 0) from public.deals d
      where d.organization_id = p_org and d.status = 'open'),
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
                where d.organization_id = s.organization_id and d.stage_id = s.id)
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
