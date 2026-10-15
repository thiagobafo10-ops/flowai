create or replace function public.read_meta_connection_secrets(p_connection_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('connectionId',c.id,'organizationId',c.organization_id,'appId',c.app_id,
    'apiVersion',c.api_version,'generation',c.credential_generation,'disconnected',c.disconnected_at is not null,
    'appSecret',a.decrypted_secret,'verifyToken',v.decrypted_secret,
    'channels',coalesce((select jsonb_agg(jsonb_build_object('channelId',ch.id,'accountId',ch.external_account_id,
      'username',ch.instagram_username,'status',ch.status,'accessToken',t.decrypted_secret)) from public.channels ch
      join vault.decrypted_secrets t on t.id=ch.access_token_secret_id where ch.meta_connection_id=c.id),'[]'::jsonb))
  from public.meta_connections c join vault.decrypted_secrets a on a.id=c.app_secret_id
    join vault.decrypted_secrets v on v.id=c.verify_token_secret_id where c.id=p_connection_id;
$$;
