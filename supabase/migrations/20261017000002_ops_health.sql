-- Painel de Saúde/Ops: agrega sinais operacionais da organização para a tela
-- Configurações -> Saúde. As filas internas (instagram_events, ai_jobs) não são
-- legíveis por `authenticated`, então a leitura é feita por esta função
-- SECURITY DEFINER, restrita a administradores da própria organização.
-- Nenhum segredo é exposto: apenas metadados de verificação da conexão Meta.

create or replace function public.ops_health(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_tz text;
  v_events jsonb;
  v_event_errors jsonb;
  v_intents jsonb;
  v_intent_errors jsonb;
  v_runs jsonb;
  v_jobs jsonb;
  v_vip jsonb;
  v_channels jsonb;
begin
  if not public.has_role(p_org,'admin') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  select o.timezone into v_tz from public.organizations o where o.id=p_org;
  if v_tz is null then raise exception 'forbidden' using errcode='42501'; end if;

  -- Eventos do worker (comentários, DMs de automação, recibos de leitura).
  select jsonb_build_object(
    'pending', count(*) filter (where state='pending'),
    'uncertain', count(*) filter (where state='uncertain'),
    'failed', count(*) filter (where state='failed'),
    'ignored_24h', count(*) filter (where state='ignored' and created_at >= now()-interval '24 hours'),
    'pending_24h', count(*) filter (where created_at >= now()-interval '24 hours'),
    'oldest_pending_at', min(occurred_at) filter (where state='pending')
  ) into v_events
  from public.instagram_events where organization_id=p_org;

  select coalesce(jsonb_agg(jsonb_build_object('code',t.code,'count',t.total) order by t.total desc),'[]'::jsonb)
  into v_event_errors
  from (
    select coalesce(last_error,'unknown') code, count(*) total
    from public.instagram_events
    where organization_id=p_org and last_error is not null and created_at >= now()-interval '7 days'
    group by 1 order by count(*) desc limit 5
  ) t;

  -- Envios (Direct e respostas privadas de comentário).
  select jsonb_build_object(
    'pending', count(*) filter (where state='pending'),
    'sending', count(*) filter (where state='sending'),
    'failed', count(*) filter (where state='failed'),
    'uncertain', count(*) filter (where state='uncertain'),
    'sent_24h', count(*) filter (where state='sent' and created_at >= now()-interval '24 hours')
  ) into v_intents
  from public.instagram_send_intents where organization_id=p_org;

  select coalesce(jsonb_agg(jsonb_build_object('code',t.code,'count',t.total) order by t.total desc),'[]'::jsonb)
  into v_intent_errors
  from (
    select coalesce(error_code,'unknown') code, count(*) total
    from public.instagram_send_intents
    where organization_id=p_org and state in ('failed','uncertain') and error_code is not null
      and created_at >= now()-interval '7 days'
    group by 1 order by count(*) desc limit 5
  ) t;

  -- Execuções de automação (inclui as que ficaram presas além do esperado).
  select jsonb_build_object(
    'pending', count(*) filter (where status='pending'),
    'running', count(*) filter (where status='running'),
    'waiting', count(*) filter (where status='waiting'),
    'failed_24h', count(*) filter (where status='failed' and updated_at >= now()-interval '24 hours'),
    'stalled', count(*) filter (
      where (status in ('pending','running') and updated_at < now()-interval '15 minutes')
         or (status='waiting' and resume_at < now()-interval '5 minutes'))
  ) into v_runs
  from public.automation_runs where organization_id=p_org;

  -- Tarefas de IA (respostas e indexação de conhecimento).
  select jsonb_build_object(
    'pending', count(*) filter (where state='pending'),
    'running', count(*) filter (where state='running'),
    'failed_24h', count(*) filter (where state='failed' and updated_at >= now()-interval '24 hours'),
    'stuck', count(*) filter (where state='running' and claimed_until is not null and claimed_until < now())
  ) into v_jobs
  from public.ai_jobs where organization_id=p_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'channel_id', s.channel_id, 'enabled', s.enabled, 'last_error', s.last_error,
    'comments_error', s.comments_error, 'comments_verified_at', s.comments_verified_at
  ) order by s.channel_id),'[]'::jsonb)
  into v_vip
  from public.instagram_vip_settings s where s.organization_id=p_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'type', c.type, 'status', c.status,
    'last_error', c.last_error, 'updated_at', c.updated_at,
    'connection', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'app_id', m.app_id, 'api_version', m.api_version,
      'credential_generation', m.credential_generation,
      'token_verified_at', m.token_verified_at, 'webhook_verified_at', m.webhook_verified_at,
      'disconnected_at', m.disconnected_at, 'last_error', m.last_error
    ) end
  ) order by c.created_at),'[]'::jsonb)
  into v_channels
  from public.channels c left join public.meta_connections m on m.id=c.meta_connection_id
  where c.organization_id=p_org;

  return jsonb_build_object(
    'generated_at', now(),
    'timezone', v_tz,
    'channels', v_channels,
    'instagram_events', v_events || jsonb_build_object('top_errors', v_event_errors),
    'send_intents', v_intents || jsonb_build_object('top_errors', v_intent_errors),
    'automation_runs', v_runs,
    'ai_jobs', v_jobs,
    'vip', v_vip
  );
end $$;

revoke all on function public.ops_health(uuid) from public, anon;
grant execute on function public.ops_health(uuid) to authenticated, service_role;
