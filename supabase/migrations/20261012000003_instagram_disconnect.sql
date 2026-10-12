create function public.disconnect_instagram_connection(p_actor_id uuid,p_org_id uuid,p_connection_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.memberships where user_id=p_actor_id and organization_id=p_org_id and role in ('admin','owner')) then raise exception 'forbidden' using errcode='42501'; end if;
  perform 1 from public.meta_connections where id=p_connection_id and organization_id=p_org_id for update;
  if not found then raise exception 'connection not owned' using errcode='42501'; end if;
  update public.meta_connections set disconnected_at=now(),token_verified_at=null,webhook_verified_at=null where id=p_connection_id;
  update public.channels set status='needs_setup' where meta_connection_id=p_connection_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id) values(p_org_id,p_actor_id,'instagram_disconnected','meta_connection',p_connection_id);
end $$;
revoke all on function public.disconnect_instagram_connection(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.disconnect_instagram_connection(uuid,uuid,uuid) to service_role;
