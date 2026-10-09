-- Rate limit por usuário (30/h) nos eventos de autenticação; excedente é descartado sem erro.
create or replace function public.log_auth_event(p_action text, p_ip inet default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('auth.login') then
    raise exception 'invalid auth event' using errcode = '22023';
  end if;
  if not public.check_rate_limit('auth_event:' || v_uid::text, 30, 3600) then
    return;
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, ip)
  values (null, v_uid, p_action, 'user', v_uid, p_ip);
end $$;

revoke all on function public.log_auth_event(text, inet) from public, anon;
grant execute on function public.log_auth_event(text, inet) to authenticated;
