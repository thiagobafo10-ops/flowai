-- Renovação automática do token longo do Instagram (60 dias) por um cron diário que chama a
-- Edge Function meta-token-refresh com o segredo interno dos workers. O token renovado é gravado
-- no mesmo segredo do Vault e NÃO incrementa credential_generation: o token antigo continua válido
-- até expirar, então reservas/envios em andamento (que conferem a geração) não são invalidados.

alter table public.channels
  add column access_token_expires_at timestamptz,
  add column access_token_refreshed_at timestamptz;

-- Canais Instagram ativos cujo token expira em menos de 15 dias (ou expiração desconhecida) e que
-- não foram renovados nas últimas 24 h (a Meta só renova tokens com pelo menos 24 h).
create function public.meta_token_refresh_candidates() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('channelId',ch.id,'generation',m.credential_generation,
      'accessToken',t.decrypted_secret,'apiVersion',m.api_version)
      order by ch.access_token_expires_at nulls first, ch.id),'[]'::jsonb)
  from public.channels ch
  join public.meta_connections m on m.id=ch.meta_connection_id
  join vault.decrypted_secrets t on t.id=ch.access_token_secret_id
  where ch.type='instagram' and ch.status='active' and m.disconnected_at is null
    and (ch.access_token_expires_at is null or ch.access_token_expires_at < now()+interval '15 days')
    and (ch.access_token_refreshed_at is null or ch.access_token_refreshed_at < now()-interval '24 hours');
$$;

-- Grava o resultado de uma renovação. Geração diferente (credenciais trocadas pelo admin no meio
-- da renovação) → ignora. Sucesso → mesmo segredo do Vault, nova expiração, limpa o erro de
-- renovação. Falha → last_error da conexão (só códigos fixos; nunca texto da Meta).
create function public.record_meta_token_refresh(p_channel uuid,p_generation int,p_token text,p_expires_in int,p_error text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_connection_id uuid;
  v_connection public.meta_connections;
  v_channel public.channels;
begin
  if p_channel is null or p_generation is null then raise exception 'invalid refresh result' using errcode='22023'; end if;
  if p_error is not null and p_error not in ('token_refresh_failed','invalid_token') then
    raise exception 'unsafe error code' using errcode='22023';
  end if;
  if p_error is null and (coalesce(length(p_token),0) not between 1 and 8192 or coalesce(p_expires_in,0) <= 0) then
    raise exception 'invalid refresh result' using errcode='22023';
  end if;
  select meta_connection_id into v_connection_id from public.channels where id=p_channel and type='instagram';
  if v_connection_id is null then return; end if;
  -- Mesma ordem de bloqueio de save_instagram_connection: conexão, depois canal.
  select * into v_connection from public.meta_connections where id=v_connection_id for update;
  select * into v_channel from public.channels where id=p_channel for update;
  if v_connection.id is null or v_connection.disconnected_at is not null
     or v_connection.credential_generation<>p_generation
     or v_channel.meta_connection_id is distinct from v_connection.id
     or v_channel.access_token_secret_id is null then
    return;
  end if;
  if p_error is not null then
    update public.meta_connections set last_error=p_error where id=v_connection.id;
    return;
  end if;
  perform vault.update_secret(v_channel.access_token_secret_id,p_token);
  update public.channels set access_token_expires_at=now()+make_interval(secs=>p_expires_in),
    access_token_refreshed_at=now() where id=p_channel;
  update public.meta_connections set last_error=null
    where id=v_connection.id and last_error in ('token_refresh_failed','invalid_token');
end $$;

-- Disparo diário no padrão de dispatch_automation_worker (mesma configuração e segredo interno).
create function public.dispatch_meta_token_refresh() returns void
language plpgsql security definer set search_path='' as $$
declare config private.automation_worker_config; service_key text; worker_secret text;
begin
  select * into config from private.automation_worker_config;
  if not found then return; end if;
  select decrypted_secret into service_key from vault.decrypted_secrets where id=config.service_key_secret_id;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where id=config.worker_secret_id;
  perform net.http_post(url := config.base_url || '/functions/v1/meta-token-refresh', body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key,
      'apikey', service_key, 'X-FlowAI-Worker', worker_secret), timeout_milliseconds := 150000);
end $$;

-- Igual a 20261012000011, mais: salvar/trocar o token marca access_token_refreshed_at=now() e zera a
-- expiração, para a renovação automática não tentar um token com menos de 24 h.
create or replace function public.save_instagram_connection(p_actor_id uuid,p_org_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_connection public.meta_connections;
  v_channel public.channels;
  v_app_secret uuid;
  v_verify_secret uuid;
  v_access_secret uuid;
  v_verify_token text;
begin
  if not exists(select 1 from public.memberships where user_id=p_actor_id and organization_id=p_org_id and role in ('admin','owner')) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_input->>'appId' is null or p_input->>'appId' !~ '^[0-9]{1,100}$'
     or p_input->>'accountId' is null or p_input->>'accountId' !~ '^[0-9]{1,100}$'
     or p_input->>'apiVersion' is null or p_input->>'apiVersion' !~ '^v[0-9]+\.0$'
     or coalesce(length(btrim(p_input->>'appSecret')),0) not between 1 and 8192
     or coalesce(length(btrim(p_input->>'accessToken')),0) not between 1 and 8192 then
    raise exception 'invalid connection input' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('meta-app:'||(p_input->>'appId'),0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('meta-account:'||(p_input->>'accountId'),0));
  if private.instagram_claimed_elsewhere(p_org_id, p_input->>'appId', p_input->>'accountId') then
    raise exception 'instagram account already connected' using errcode='23505';
  end if;
  if nullif(p_input->>'connectionId','') is not null then
    select * into v_connection from public.meta_connections
      where id=(p_input->>'connectionId')::uuid and organization_id=p_org_id for update;
    if not found or v_connection.app_id<>p_input->>'appId' then
      raise exception 'connection not owned or immutable app changed' using errcode='42501';
    end if;
    select * into v_channel from public.channels where meta_connection_id=v_connection.id and external_account_id=p_input->>'accountId' for update;
    if not found then raise exception 'account binding is immutable' using errcode='22023'; end if;
    -- Uma conexão removida com histórico não tem mais segredos: recria.
    if v_connection.app_secret_id is null then
      select vault.create_secret(p_input->>'appSecret','flowai-meta-'||v_connection.id||'-app') into v_app_secret;
    else
      perform vault.update_secret(v_connection.app_secret_id,p_input->>'appSecret');
      v_app_secret:=v_connection.app_secret_id;
    end if;
    if v_connection.verify_token_secret_id is null then
      select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'flowai-meta-'||v_connection.id||'-verify') into v_verify_secret;
    else
      v_verify_secret:=v_connection.verify_token_secret_id;
    end if;
    if v_channel.access_token_secret_id is null then
      select vault.create_secret(p_input->>'accessToken','flowai-meta-'||v_channel.id||'-access') into v_access_secret;
    else
      perform vault.update_secret(v_channel.access_token_secret_id,p_input->>'accessToken');
      v_access_secret:=v_channel.access_token_secret_id;
    end if;
    update public.meta_connections set api_version=p_input->>'apiVersion', credential_generation=credential_generation+1,
      app_secret_id=v_app_secret, verify_token_secret_id=v_verify_secret,
      token_verified_at=null,webhook_verified_at=null,disconnected_at=null,last_error=null where id=v_connection.id;
    update public.channels set name=coalesce(nullif(btrim(p_input->>'name'),''),'Instagram'),status='needs_setup',last_error=null,
      access_token_secret_id=v_access_secret,access_token_refreshed_at=now(),access_token_expires_at=null where id=v_channel.id;
  else
    -- Duplicatas na mesma organização: atualize a conexão existente.
    if exists(select 1 from public.meta_connections where app_id=p_input->>'appId' and organization_id=p_org_id)
       or exists(select 1 from public.channels where type='instagram' and organization_id=p_org_id and external_account_id=p_input->>'accountId') then
      raise exception 'app already connected in organization' using errcode='23505', hint='same_organization';
    end if;
    v_connection.id:=gen_random_uuid();
    v_channel.id:=gen_random_uuid();
    v_verify_token:=encode(extensions.gen_random_bytes(32),'hex');
    select vault.create_secret(p_input->>'appSecret','flowai-meta-'||v_connection.id||'-app') into v_app_secret;
    select vault.create_secret(v_verify_token,'flowai-meta-'||v_connection.id||'-verify') into v_verify_secret;
    select vault.create_secret(p_input->>'accessToken','flowai-meta-'||v_channel.id||'-access') into v_access_secret;
    insert into public.meta_connections(id,organization_id,app_id,api_version,app_secret_id,verify_token_secret_id)
      values(v_connection.id,p_org_id,p_input->>'appId',p_input->>'apiVersion',v_app_secret,v_verify_secret);
    insert into public.channels(id,organization_id,type,name,external_account_id,access_token_secret_id,meta_connection_id,access_token_refreshed_at)
      values(v_channel.id,p_org_id,'instagram',coalesce(nullif(btrim(p_input->>'name'),''),'Instagram'),p_input->>'accountId',v_access_secret,v_connection.id,now());
  end if;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id)
    values(p_org_id,p_actor_id,'instagram_connection_saved','meta_connection',v_connection.id);
  return jsonb_build_object('connectionId',v_connection.id,'channelId',v_channel.id);
end $$;

-- ---------------------------------------------------------------- Saúde/Ops
-- Igual a 20261022000001, mais: cada canal informa tokenExpiresAt e tokenRefreshError.
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

  -- Envios (Direct, respostas privadas e respostas públicas a comentários): os contadores
  -- cobrem as mesmas fontes que a lista de principais erros abaixo.
  select jsonb_build_object(
    'pending', count(*) filter (where state='pending'),
    'sending', count(*) filter (where state='sending'),
    'failed', count(*) filter (where state='failed'),
    'uncertain', count(*) filter (where state='uncertain'),
    'sent_24h', count(*) filter (where state='sent' and created_at >= now()-interval '24 hours')
  ) into v_intents
  from (
    select state, created_at from public.instagram_send_intents where organization_id=p_org
    union all
    select state, created_at from public.instagram_comment_public_replies where organization_id=p_org
  ) s;

  -- Principais erros de envio: Direct/respostas privadas e respostas públicas a comentários.
  select coalesce(jsonb_agg(jsonb_build_object('code',t.code,'count',t.total) order by t.total desc),'[]'::jsonb)
  into v_intent_errors
  from (
    select coalesce(x.error_code,'unknown') code, count(*) total
    from (
      select error_code from public.instagram_send_intents
      where organization_id=p_org and state in ('failed','uncertain') and error_code is not null
        and created_at >= now()-interval '7 days'
      union all
      select error_code from public.instagram_comment_public_replies
      where organization_id=p_org and state in ('failed','uncertain') and error_code is not null
        and created_at >= now()-interval '7 days'
    ) x
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
    'tokenExpiresAt', c.access_token_expires_at,
    'tokenRefreshError', case when m.last_error in ('token_refresh_failed','invalid_token') then m.last_error end,
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

-- ---------------------------------------------------------------- grants
revoke all on function public.meta_token_refresh_candidates(),
  public.record_meta_token_refresh(uuid,int,text,int,text),
  public.dispatch_meta_token_refresh() from public,anon,authenticated;
grant execute on function public.meta_token_refresh_candidates(),
  public.record_meta_token_refresh(uuid,int,text,int,text),
  public.dispatch_meta_token_refresh() to service_role;

select cron.schedule('flowai-meta-token-refresh', '0 6 * * *', 'select public.dispatch_meta_token_refresh()');
