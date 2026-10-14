-- -----------------------------------------------------------------------------
-- Fase 9: Função analytics_metrics para o módulo de Analytics
-- -----------------------------------------------------------------------------

create or replace function public.analytics_metrics(
  p_org uuid,
  p_days int,
  p_channel_id uuid default null
)
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
  v_prev_start timestamptz;
  v_prev_end timestamptz;

  v_has_activity boolean;

  -- Resumo Atual
  v_cur_total_convs int;
  v_cur_resolved_convs int;
  v_cur_resolution_rate numeric;
  v_cur_new_contacts int;
  v_cur_new_leads int;
  v_cur_pipeline_value numeric;
  v_cur_won_value numeric;
  v_cur_conversion_rate numeric;
  v_cur_ai_containment_rate numeric;

  -- Resumo Anterior (para deltas)
  v_prev_total_convs int;
  v_prev_resolved_convs int;
  v_prev_resolution_rate numeric;
  v_prev_new_contacts int;

  -- Tendências (deltas %)
  v_convs_trend numeric;
  v_resolution_trend numeric;
  v_contacts_trend numeric;

  -- Seções
  v_daily_volume jsonb;
  v_by_channel jsonb;
  v_by_status jsonb;

  v_daily_ai_vs_human jsonb;
  v_total_ai_messages int;
  v_total_handoffs int;
  v_top_handoff_reasons jsonb;

  v_funnel jsonb;
  v_daily_deals jsonb;
  v_avg_ticket numeric;

  v_period_label text;
begin
  if p_days is null or p_days not in (1, 7, 30, 90) then
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

  -- Janela anterior para comparativo de mesma duração
  v_prev_start := (v_today_local - (p_days * 2 - 1))::timestamp at time zone v_tz;
  v_prev_end := v_start - interval '1 microsecond';

  v_period_label := case p_days
    when 1 then 'Hoje'
    when 7 then 'Últimos 7 dias'
    when 30 then 'Últimos 30 dias'
    when 90 then 'Últimos 90 dias'
    else p_days || ' dias'
  end;

  -- 1. Verificação de atividade geral
  select exists (
    select 1 from public.events e
    where e.organization_id = p_org
      and e.created_at >= v_start and e.created_at <= v_end
  ) into v_has_activity;

  -- 2. Métricas de Conversas (Janela Atual)
  select count(distinct e.conversation_id)
    into v_cur_total_convs
    from public.events e
    join public.conversations c on c.id = e.conversation_id
    where e.organization_id = p_org
      and e.type = 'message_received'
      and e.created_at >= v_start and e.created_at <= v_end
      and (p_channel_id is null or c.channel_id = p_channel_id);

  select count(distinct e.conversation_id)
    into v_cur_resolved_convs
    from public.events e
    join public.conversations c on c.id = e.conversation_id
    where e.organization_id = p_org
      and e.type = 'conversation_closed'
      and e.created_at >= v_start and e.created_at <= v_end
      and (p_channel_id is null or c.channel_id = p_channel_id);

  if v_cur_total_convs > 0 then
    v_cur_resolution_rate := round((v_cur_resolved_convs::numeric / v_cur_total_convs::numeric) * 100, 1);
  else
    v_cur_resolution_rate := null;
  end if;

  -- Métricas de Conversas (Janela Anterior para Tendência)
  select count(distinct e.conversation_id)
    into v_prev_total_convs
    from public.events e
    join public.conversations c on c.id = e.conversation_id
    where e.organization_id = p_org
      and e.type = 'message_received'
      and e.created_at >= v_prev_start and e.created_at <= v_prev_end
      and (p_channel_id is null or c.channel_id = p_channel_id);

  select count(distinct e.conversation_id)
    into v_prev_resolved_convs
    from public.events e
    join public.conversations c on c.id = e.conversation_id
    where e.organization_id = p_org
      and e.type = 'conversation_closed'
      and e.created_at >= v_prev_start and e.created_at <= v_prev_end
      and (p_channel_id is null or c.channel_id = p_channel_id);

  if v_prev_total_convs > 0 then
    v_prev_resolution_rate := round((v_prev_resolved_convs::numeric / v_prev_total_convs::numeric) * 100, 1);
  else
    v_prev_resolution_rate := null;
  end if;

  -- Cálculo de tendências
  if v_prev_total_convs > 0 then
    v_convs_trend := round(((v_cur_total_convs - v_prev_total_convs)::numeric / v_prev_total_convs::numeric) * 100, 1);
  elsif v_cur_total_convs > 0 then
    v_convs_trend := 100;
  else
    v_convs_trend := null;
  end if;

  if v_prev_resolution_rate is not null and v_cur_resolution_rate is not null then
    v_resolution_trend := round(v_cur_resolution_rate - v_prev_resolution_rate, 1);
  else
    v_resolution_trend := null;
  end if;

  -- 3. Contatos e Leads
  select count(*)
    into v_cur_new_contacts
    from public.events e
    where e.organization_id = p_org
      and e.type = 'contact_created'
      and e.created_at >= v_start and e.created_at <= v_end;

  select count(*)
    into v_prev_new_contacts
    from public.events e
    where e.organization_id = p_org
      and e.type = 'contact_created'
      and e.created_at >= v_prev_start and e.created_at <= v_prev_end;

  if v_prev_new_contacts > 0 then
    v_contacts_trend := round(((v_cur_new_contacts - v_prev_new_contacts)::numeric / v_prev_new_contacts::numeric) * 100, 1);
  elsif v_cur_new_contacts > 0 then
    v_contacts_trend := 100;
  else
    v_contacts_trend := null;
  end if;

  select count(*)
    into v_cur_new_leads
    from public.contacts ct
    where ct.organization_id = p_org
      and ct.status = 'lead'
      and ct.created_at >= v_start and ct.created_at <= v_end;

  -- 4. Vendas & Pipeline
  select coalesce(sum(d.value), 0)
    into v_cur_pipeline_value
    from public.deals d
    where d.organization_id = p_org
      and d.status = 'open';

  select coalesce(sum(d.value), 0)
    into v_cur_won_value
    from public.deals d
    where d.organization_id = p_org
      and d.status = 'won'
      and d.updated_at >= v_start and d.updated_at <= v_end;

  -- Conversão
  declare
    v_created_deals int;
    v_won_deals int;
  begin
    select count(*) filter (where w.has_created),
           count(*) filter (where w.has_created and w.has_won)
      into v_created_deals, v_won_deals
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

    if v_created_deals > 0 then
      v_cur_conversion_rate := round((v_won_deals::numeric / v_created_deals::numeric) * 100, 1);
    else
      v_cur_conversion_rate := null;
    end if;

    if v_won_deals > 0 then
      v_avg_ticket := round(v_cur_won_value / v_won_deals, 2);
    else
      v_avg_ticket := 0;
    end if;
  end;

  -- 5. IA: Contenção, Mensagens e Handoffs
  declare
    v_ai_convs int;
    v_handoff_convs int;
  begin
    select count(distinct e.conversation_id)
      into v_ai_convs
      from public.events e
      where e.organization_id = p_org
        and e.type = 'ai_replied'
        and e.created_at >= v_start and e.created_at <= v_end;

    select count(distinct e.conversation_id)
      into v_handoff_convs
      from public.events e
      where e.organization_id = p_org
        and e.type = 'handoff'
        and e.created_at >= v_start and e.created_at <= v_end;

    select count(*)
      into v_total_ai_messages
      from public.events e
      where e.organization_id = p_org
        and e.type = 'ai_replied'
        and e.created_at >= v_start and e.created_at <= v_end;

    select count(*)
      into v_total_handoffs
      from public.events e
      where e.organization_id = p_org
        and e.type = 'handoff'
        and e.created_at >= v_start and e.created_at <= v_end;

    if v_ai_convs > 0 then
      v_cur_ai_containment_rate := round((greatest(0, v_ai_convs - v_handoff_convs)::numeric / v_ai_convs::numeric) * 100, 1);
    else
      v_cur_ai_containment_rate := null;
    end if;
  end;

  -- 6. Séries e Quebras

  -- 6.1 Volume diário de conversas
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day', to_char(d.day, 'YYYY-MM-DD'),
      'received', coalesce(v.received, 0),
      'resolved', coalesce(v.resolved, 0)
    ) order by d.day
  ), '[]'::jsonb)
  into v_daily_volume
  from (
    select generate_series(v_start::date, v_today_local, '1 day'::interval)::date as day
  ) d
  left join (
    select (e.created_at at time zone v_tz)::date as day,
           count(distinct e.conversation_id) filter (where e.type = 'message_received') as received,
           count(distinct e.conversation_id) filter (where e.type = 'conversation_closed') as resolved
      from public.events e
      join public.conversations c on c.id = e.conversation_id
      where e.organization_id = p_org
        and e.type in ('message_received', 'conversation_closed')
        and e.created_at >= v_start and e.created_at <= v_end
        and (p_channel_id is null or c.channel_id = p_channel_id)
      group by 1
  ) v on v.day = d.day;

  -- 6.2 Conversas por canal
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'channel_id', ch.id,
      'channel_name', ch.name,
      'channel_type', ch.type,
      'count', coalesce(cnt.total, 0)
    ) order by coalesce(cnt.total, 0) desc
  ), '[]'::jsonb)
  into v_by_channel
  from public.channels ch
  left join (
    select c.channel_id, count(distinct c.id) as total
    from public.conversations c
    where c.organization_id = p_org
      and c.last_message_at >= v_start and c.last_message_at <= v_end
    group by c.channel_id
  ) cnt on cnt.channel_id = ch.id
  where ch.organization_id = p_org
    and (p_channel_id is null or ch.id = p_channel_id);

  -- 6.3 Conversas por status
  select coalesce(jsonb_agg(
    jsonb_build_object('status', s.status, 'count', coalesce(st.count, 0))
  ), '[]'::jsonb)
  into v_by_status
  from (values ('open'::text), ('waiting'::text), ('closed'::text)) as s(status)
  left join (
    select c.status::text as status, count(*) as count
    from public.conversations c
    where c.organization_id = p_org
      and (p_channel_id is null or c.channel_id = p_channel_id)
    group by c.status
  ) st on st.status = s.status;

  -- 6.4 IA vs Humano por dia
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day', to_char(d.day, 'YYYY-MM-DD'),
      'ai_replied', coalesce(v.ai_replied, 0),
      'handoffs', coalesce(v.handoffs, 0)
    ) order by d.day
  ), '[]'::jsonb)
  into v_daily_ai_vs_human
  from (
    select generate_series(v_start::date, v_today_local, '1 day'::interval)::date as day
  ) d
  left join (
    select (e.created_at at time zone v_tz)::date as day,
           count(*) filter (where e.type = 'ai_replied') as ai_replied,
           count(*) filter (where e.type = 'handoff') as handoffs
      from public.events e
      where e.organization_id = p_org
        and e.type in ('ai_replied', 'handoff')
        and e.created_at >= v_start and e.created_at <= v_end
      group by 1
  ) v on v.day = d.day;

  -- 6.5 Top motivos de handoff
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'reason', coalesce(nullif(trim(e.metadata->>'reason'), ''), 'Solicitação do cliente'),
      'count', count(*)
    ) order by count(*) desc
  ), '[]'::jsonb)
  into v_top_handoff_reasons
  from public.events e
  where e.organization_id = p_org
    and e.type = 'handoff'
    and e.created_at >= v_start and e.created_at <= v_end
  group by 1
  limit 5;

  -- 6.6 Funil do CRM
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'stage_id', ps.id,
      'stage_name', ps.name,
      'position', ps.position,
      'count', coalesce(d.count, 0),
      'value', coalesce(d.total_value, 0)
    ) order by ps.position
  ), '[]'::jsonb)
  into v_funnel
  from public.pipeline_stages ps
  left join (
    select dl.stage_id, count(*) as count, coalesce(sum(dl.value), 0) as total_value
    from public.deals dl
    where dl.organization_id = p_org
      and dl.status = 'open'
    group by dl.stage_id
  ) d on d.stage_id = ps.id
  where ps.organization_id = p_org;

  -- 6.7 Deals criados vs ganhos por dia
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day', to_char(d.day, 'YYYY-MM-DD'),
      'created', coalesce(v.created, 0),
      'won', coalesce(v.won, 0)
    ) order by d.day
  ), '[]'::jsonb)
  into v_daily_deals
  from (
    select generate_series(v_start::date, v_today_local, '1 day'::interval)::date as day
  ) d
  left join (
    select (e.created_at at time zone v_tz)::date as day,
           count(*) filter (where e.type = 'deal_created') as created,
           count(*) filter (where e.type = 'deal_won') as won
      from public.events e
      where e.organization_id = p_org
        and e.type in ('deal_created', 'deal_won')
        and e.created_at >= v_start and e.created_at <= v_end
      group by 1
  ) v on v.day = d.day;

  return jsonb_build_object(
    'period_days', p_days,
    'period_label', v_period_label,
    'has_activity', v_has_activity,
    'summary', jsonb_build_object(
      'total_conversations', v_cur_total_convs,
      'conversations_trend', v_convs_trend,
      'resolution_rate', v_cur_resolution_rate,
      'resolution_trend', v_resolution_trend,
      'new_contacts', v_cur_new_contacts,
      'contacts_trend', v_contacts_trend,
      'new_leads', v_cur_new_leads,
      'total_pipeline_value', v_cur_pipeline_value,
      'won_deals_value', v_cur_won_value,
      'conversion_rate', v_cur_conversion_rate,
      'ai_containment_rate', v_cur_ai_containment_rate
    ),
    'conversations_section', jsonb_build_object(
      'daily_volume', v_daily_volume,
      'by_channel', v_by_channel,
      'by_status', v_by_status
    ),
    'ai_section', jsonb_build_object(
      'daily_ai_vs_human', v_daily_ai_vs_human,
      'total_ai_messages', v_total_ai_messages,
      'total_handoffs', v_total_handoffs,
      'top_handoff_reasons', v_top_handoff_reasons
    ),
    'crm_section', jsonb_build_object(
      'funnel', v_funnel,
      'daily_deals', v_daily_deals,
      'avg_ticket', v_avg_ticket
    )
  );
end;
$$;
