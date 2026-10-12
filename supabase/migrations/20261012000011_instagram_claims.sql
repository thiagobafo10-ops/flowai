-- Posse de app/conta Instagram só vale para conexões VERIFICADAS. Antes, a
-- unicidade global de app_id e de (type, external_account_id) deixava qualquer
-- organização "reservar" o app ou a conta de outra sem provar posse do token.
alter table public.meta_connections add column owner_verified_at timestamptz;
alter table public.channels add column instagram_claimed boolean not null default false;
comment on column public.meta_connections.owner_verified_at is
  'Momento em que um token válido provou a posse do app/conta. Nulo = claim não verificado (expira em 24h). Desconectar limpa.';
comment on column public.channels.instagram_claimed is
  'Verdadeiro quando a conexão Instagram do canal está verificada e conectada; a conta só pode ser reivindicada uma vez.';

update public.meta_connections set owner_verified_at = token_verified_at
  where token_verified_at is not null and disconnected_at is null;
update public.channels ch set instagram_claimed = true from public.meta_connections mc
  where mc.id = ch.meta_connection_id and mc.owner_verified_at is not null;

alter table public.meta_connections drop constraint meta_connections_app_id_key;
create unique index meta_connections_verified_app_key on public.meta_connections(app_id)
  where owner_verified_at is not null and disconnected_at is null;
create unique index meta_connections_org_app_key on public.meta_connections(organization_id, app_id);
drop index public.channels_type_external_account_key;
create unique index channels_type_external_account_key on public.channels(type, external_account_id)
  where external_account_id is not null and type <> 'instagram';
create unique index channels_instagram_claimed_account_key on public.channels(external_account_id)
  where type = 'instagram' and instagram_claimed;
create unique index channels_instagram_org_account_key on public.channels(organization_id, external_account_id)
  where type = 'instagram';

-- Conexões removidas com histórico ficam sem segredos (ids nulos) até reconectar.
alter table public.meta_connections alter column app_secret_id drop not null,
  alter column verify_token_secret_id drop not null;

-- Canais Instagram só nascem e morrem pelas funções de serviço.
alter policy channels_insert on public.channels
  with check (public.has_role(organization_id, 'admin') and type <> 'instagram');
alter policy channels_delete on public.channels
  using (public.has_role(organization_id, 'admin') and type <> 'instagram');

create function private.instagram_channel_has_history(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.instagram_events where channel_id = p_channel)
      or exists(select 1 from public.conversations where channel_id = p_channel)
      or exists(select 1 from public.messages where channel_id = p_channel);
$$;

-- Apaga os segredos Vault de uma conexão e de seus canais (sem tocar em histórico).
create function private.delete_instagram_secrets(p_connection uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[];
begin
  select array_remove(array[mc.app_secret_id, mc.verify_token_secret_id], null)
    || coalesce((select array_agg(ch.access_token_secret_id) from public.channels ch
                 where ch.meta_connection_id = mc.id and ch.access_token_secret_id is not null), '{}')
    into v_ids from public.meta_connections mc where mc.id = p_connection;
  update public.channels set access_token_secret_id = null where meta_connection_id = p_connection;
  update public.meta_connections set app_secret_id = null, verify_token_secret_id = null where id = p_connection;
  delete from vault.secrets where id = any(coalesce(v_ids, '{}'));
end $$;

-- Remove por completo uma conexão SEM histórico (regras, selos de mídia, canal, segredos).
create function private.purge_instagram_connection(p_connection uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_channel uuid;
begin
  perform private.delete_instagram_secrets(p_connection);
  for v_channel in select id from public.channels where meta_connection_id = p_connection loop
    delete from public.instagram_send_intents where channel_id = v_channel;
    delete from public.instagram_comment_rules where channel_id = v_channel;
    delete from public.instagram_verified_media where channel_id = v_channel;
    delete from public.channels where id = v_channel;
  end loop;
  delete from public.meta_connections where id = p_connection;
end $$;
revoke all on function private.instagram_channel_has_history(uuid), private.delete_instagram_secrets(uuid),
  private.purge_instagram_connection(uuid) from public, anon, authenticated;

-- Conta/app verificados por OUTRA organização (claims vivos).
create function private.instagram_claimed_elsewhere(p_org uuid, p_app text, p_account text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.meta_connections where app_id = p_app and organization_id <> p_org
                  and owner_verified_at is not null and disconnected_at is null)
      or exists(select 1 from public.channels where type = 'instagram' and external_account_id = p_account
                  and organization_id <> p_org and instagram_claimed);
$$;
revoke all on function private.instagram_claimed_elsewhere(uuid, text, text) from public, anon, authenticated;

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
      access_token_secret_id=v_access_secret where id=v_channel.id;
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
    insert into public.channels(id,organization_id,type,name,external_account_id,access_token_secret_id,meta_connection_id)
      values(v_channel.id,p_org_id,'instagram',coalesce(nullif(btrim(p_input->>'name'),''),'Instagram'),p_input->>'accountId',v_access_secret,v_connection.id);
  end if;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id)
    values(p_org_id,p_actor_id,'instagram_connection_saved','meta_connection',v_connection.id);
  return jsonb_build_object('connectionId',v_connection.id,'channelId',v_channel.id);
end $$;

create or replace function public.set_meta_connection_verification(p_connection_id uuid,p_kind text,p_success boolean,p_error_code text,p_generation integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_connection public.meta_connections; v_other uuid; v_accounts text[];
begin
  if p_kind not in ('token','webhook') or p_success is null then raise exception 'invalid verification kind' using errcode='22023'; end if;
  if p_error_code is not null and p_error_code not in ('invalid_token','permission_denied','invalid_account','subscription_missing','provider_unavailable') then
    raise exception 'unsafe error code' using errcode='22023';
  end if;
  -- Mesma ordem de locks de save_instagram_connection (app, depois conta).
  select * into v_connection from public.meta_connections where id=p_connection_id;
  if found and p_kind='token' and p_success then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('meta-app:'||v_connection.app_id,0));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('meta-account:'||external_account_id,0))
      from (select external_account_id from public.channels where meta_connection_id=p_connection_id order by 1) accounts;
  end if;
  select * into v_connection from public.meta_connections where id=p_connection_id for update;
  if not found or v_connection.disconnected_at is not null then raise exception 'connection unavailable' using errcode='P0002'; end if;
  if p_generation is null or v_connection.credential_generation<>p_generation then raise exception 'stale credential verification' using errcode='40001'; end if;
  if p_kind='token' and p_success then
    select array_agg(external_account_id) into v_accounts from public.channels where meta_connection_id=p_connection_id;
    -- Um dono verificado em outra organização bloqueia; claims não verificados sem histórico cedem.
    if exists(select 1 from public.meta_connections mc where mc.organization_id<>v_connection.organization_id
                and mc.owner_verified_at is not null and mc.disconnected_at is null
                and (mc.app_id=v_connection.app_id or exists(select 1 from public.channels ch where ch.meta_connection_id=mc.id and ch.external_account_id=any(v_accounts)))) then
      raise exception 'instagram account already connected' using errcode='23505';
    end if;
    for v_other in select mc.id from public.meta_connections mc where mc.organization_id<>v_connection.organization_id
        and mc.owner_verified_at is null and mc.disconnected_at is null
        and (mc.app_id=v_connection.app_id or exists(select 1 from public.channels ch where ch.meta_connection_id=mc.id and ch.external_account_id=any(v_accounts)))
        and not exists(select 1 from public.channels ch where ch.meta_connection_id=mc.id and private.instagram_channel_has_history(ch.id)) loop
      perform private.purge_instagram_connection(v_other);
    end loop;
  end if;
  update public.meta_connections set
    token_verified_at=case when p_kind='token' then case when p_success then now() else null end else token_verified_at end,
    webhook_verified_at=case when p_kind='webhook' then case when p_success then now() else null end else webhook_verified_at end,
    owner_verified_at=case when p_kind='token' and p_success then coalesce(owner_verified_at,now()) else owner_verified_at end,
    last_error=case when p_success then null else coalesce(p_error_code,'provider_unavailable') end
    where id=p_connection_id returning * into v_connection;
  update public.channels set status=case when not p_success then 'error'::public.channel_status
    when v_connection.token_verified_at is not null and v_connection.webhook_verified_at is not null then 'active'::public.channel_status
    else 'needs_setup'::public.channel_status end,last_error=v_connection.last_error,
    instagram_claimed=v_connection.owner_verified_at is not null
    where meta_connection_id=p_connection_id;
end $$;

create or replace function public.disconnect_instagram_connection(p_actor_id uuid,p_org_id uuid,p_connection_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.memberships where user_id=p_actor_id and organization_id=p_org_id and role in ('admin','owner')) then raise exception 'forbidden' using errcode='42501'; end if;
  perform 1 from public.meta_connections where id=p_connection_id and organization_id=p_org_id for update;
  if not found then raise exception 'connection not owned' using errcode='42501'; end if;
  update public.meta_connections set disconnected_at=now(),token_verified_at=null,webhook_verified_at=null,owner_verified_at=null where id=p_connection_id;
  update public.channels set status='needs_setup',instagram_claimed=false where meta_connection_id=p_connection_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id) values(p_org_id,p_actor_id,'instagram_disconnected','meta_connection',p_connection_id);
end $$;

-- Remoção pedida pelo admin: sem histórico apaga tudo; com histórico desconecta.
-- Nos dois casos os segredos Vault deixam de existir.
create function public.remove_instagram_connection(p_actor_id uuid,p_org_id uuid,p_connection_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_history boolean;
begin
  if not exists(select 1 from public.memberships where user_id=p_actor_id and organization_id=p_org_id and role in ('admin','owner')) then raise exception 'forbidden' using errcode='42501'; end if;
  perform 1 from public.meta_connections where id=p_connection_id and organization_id=p_org_id for update;
  if not found then raise exception 'connection not owned' using errcode='42501'; end if;
  select exists(select 1 from public.channels ch where ch.meta_connection_id=p_connection_id and private.instagram_channel_has_history(ch.id)) into v_history;
  if v_history then
    update public.meta_connections set disconnected_at=coalesce(disconnected_at,now()),token_verified_at=null,webhook_verified_at=null,owner_verified_at=null where id=p_connection_id;
    update public.channels set status='needs_setup',instagram_claimed=false where meta_connection_id=p_connection_id;
    update public.instagram_comment_rules set active=false where channel_id in (select id from public.channels where meta_connection_id=p_connection_id) and active;
    perform private.delete_instagram_secrets(p_connection_id);
  else
    perform private.purge_instagram_connection(p_connection_id);
  end if;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id)
    values(p_org_id,p_actor_id,'instagram_connection_removed','meta_connection',p_connection_id);
  return jsonb_build_object('removed',not v_history,'disconnected',v_history);
end $$;
revoke all on function public.remove_instagram_connection(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.remove_instagram_connection(uuid,uuid,uuid) to service_role;

-- Limpeza diária: também expira claims nunca verificados com mais de 24h.
create or replace function public.cleanup_instagram_events() returns void
language plpgsql security definer set search_path='' as $$
declare v_connection uuid;
begin
  delete from public.instagram_events e where e.created_at<now()-interval '30 days' and e.state<>'pending'
    and not exists(select 1 from pgmq.q_instagram_work q where q.message->>'eventId'=e.id::text);
  delete from pgmq.a_instagram_work where archived_at<now()-interval '30 days';
  for v_connection in select mc.id from public.meta_connections mc
      where mc.owner_verified_at is null and mc.disconnected_at is null and mc.updated_at<now()-interval '24 hours'
        and not exists(select 1 from public.channels ch where ch.meta_connection_id=mc.id and private.instagram_channel_has_history(ch.id)) loop
    perform private.purge_instagram_connection(v_connection);
  end loop;
end $$;
