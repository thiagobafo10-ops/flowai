-- Instagram app connections. Secret values are only read by service Edge handlers.
create extension if not exists supabase_vault with schema vault;

create table public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  app_id text not null unique check(app_id ~ '^[0-9]{1,100}$'),
  api_version text not null check(api_version ~ '^v[0-9]+\.0$'),
  app_secret_id uuid not null,
  verify_token_secret_id uuid not null,
  credential_generation integer not null default 1,
  token_verified_at timestamptz,
  webhook_verified_at timestamptz,
  disconnected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,id)
);
alter table public.channels add column meta_connection_id uuid;
alter table public.channels add constraint channels_meta_connection_fk
  foreign key (organization_id,meta_connection_id) references public.meta_connections(organization_id,id);
create index channels_meta_connection_idx on public.channels(meta_connection_id);
create trigger meta_connections_updated before update on public.meta_connections
  for each row execute function public.set_updated_at();
alter table public.meta_connections enable row level security;
revoke all on public.meta_connections from anon, authenticated;
grant select(id,organization_id,app_id,api_version,credential_generation,token_verified_at,webhook_verified_at,disconnected_at,last_error,created_at,updated_at) on public.meta_connections to authenticated;
create policy meta_connections_select on public.meta_connections for select to authenticated
  using(public.has_role(organization_id,'admin'));
grant select(meta_connection_id) on public.channels to authenticated;
revoke all on vault.secrets, vault.decrypted_secrets from anon, authenticated;

-- Preserve simulator permissions without allowing an administrator to bypass
-- the remote checks by updating the generic channel status column.
create function public.guard_instagram_channel_status() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.type='instagram' and auth.role()='authenticated' and
     (new.status is distinct from old.status or new.meta_connection_id is distinct from old.meta_connection_id) then
    raise exception 'Instagram state requires verified service operation' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_instagram_channel_status() from public, anon, authenticated;
create trigger channels_instagram_status before update on public.channels
  for each row execute function public.guard_instagram_channel_status();

create function public.save_instagram_connection(p_actor_id uuid,p_org_id uuid,p_input jsonb)
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
  if nullif(p_input->>'connectionId','') is not null then
    select * into v_connection from public.meta_connections
      where id=(p_input->>'connectionId')::uuid and organization_id=p_org_id for update;
    if not found or v_connection.app_id<>p_input->>'appId' then
      raise exception 'connection not owned or immutable app changed' using errcode='42501';
    end if;
    select * into v_channel from public.channels where meta_connection_id=v_connection.id and external_account_id=p_input->>'accountId' for update;
    if not found then raise exception 'account binding is immutable' using errcode='22023'; end if;
    perform vault.update_secret(v_connection.app_secret_id,p_input->>'appSecret');
    perform vault.update_secret(v_channel.access_token_secret_id,p_input->>'accessToken');
    update public.meta_connections set api_version=p_input->>'apiVersion', credential_generation=credential_generation+1,
      token_verified_at=null,webhook_verified_at=null,disconnected_at=null,last_error=null where id=v_connection.id;
    update public.channels set name=coalesce(nullif(btrim(p_input->>'name'),''),'Instagram'),status='needs_setup',last_error=null where id=v_channel.id;
  else
    -- Reject duplicates before creating secrets. The transaction also rolls back
    -- every secret if any later FK/unique check fails.
    if exists(select 1 from public.meta_connections where app_id=p_input->>'appId') then
      raise exception 'app already connected' using errcode='23505';
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

create function public.read_meta_connection_secrets(p_connection_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('connectionId',c.id,'organizationId',c.organization_id,'appId',c.app_id,
    'apiVersion',c.api_version,'generation',c.credential_generation,'disconnected',c.disconnected_at is not null,
    'appSecret',a.decrypted_secret,'verifyToken',v.decrypted_secret,
    'channels',coalesce((select jsonb_agg(jsonb_build_object('channelId',ch.id,'accountId',ch.external_account_id,
      'status',ch.status,'accessToken',t.decrypted_secret)) from public.channels ch
      join vault.decrypted_secrets t on t.id=ch.access_token_secret_id where ch.meta_connection_id=c.id),'[]'::jsonb))
  from public.meta_connections c join vault.decrypted_secrets a on a.id=c.app_secret_id
    join vault.decrypted_secrets v on v.id=c.verify_token_secret_id where c.id=p_connection_id;
$$;

create function public.set_meta_connection_verification(p_connection_id uuid,p_kind text,p_success boolean,p_error_code text,p_generation integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_connection public.meta_connections;
begin
  if p_kind not in ('token','webhook') or p_success is null then raise exception 'invalid verification kind' using errcode='22023'; end if;
  if p_error_code is not null and p_error_code not in ('invalid_token','permission_denied','invalid_account','subscription_missing','provider_unavailable') then
    raise exception 'unsafe error code' using errcode='22023';
  end if;
  select * into v_connection from public.meta_connections where id=p_connection_id for update;
  if not found or v_connection.disconnected_at is not null then raise exception 'connection unavailable' using errcode='P0002'; end if;
  if p_generation is null or v_connection.credential_generation<>p_generation then raise exception 'stale credential verification' using errcode='40001'; end if;
  update public.meta_connections set
    token_verified_at=case when p_kind='token' then case when p_success then now() else null end else token_verified_at end,
    webhook_verified_at=case when p_kind='webhook' then case when p_success then now() else null end else webhook_verified_at end,
    last_error=case when p_success then null else coalesce(p_error_code,'provider_unavailable') end
    where id=p_connection_id returning * into v_connection;
  update public.channels set status=case when not p_success then 'error'::public.channel_status
    when v_connection.token_verified_at is not null and v_connection.webhook_verified_at is not null then 'active'::public.channel_status
    else 'needs_setup'::public.channel_status end,last_error=v_connection.last_error
    where meta_connection_id=p_connection_id;
end $$;

revoke all on function public.save_instagram_connection(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.read_meta_connection_secrets(uuid) from public,anon,authenticated;
revoke all on function public.set_meta_connection_verification(uuid,text,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.save_instagram_connection(uuid,uuid,jsonb), public.read_meta_connection_secrets(uuid),
  public.set_meta_connection_verification(uuid,text,boolean,text,integer) to service_role;
