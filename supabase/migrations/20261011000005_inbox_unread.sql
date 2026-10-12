create function public.inbox_unread_count(p_org uuid)
returns bigint language plpgsql stable security invoker set search_path = ''
as $$
declare v_count bigint;
begin
  if not public.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select count(*) into v_count
  from public.conversations c
  join lateral (
    select m.direction, m.created_at
    from public.messages m
    where m.organization_id=p_org and m.conversation_id=c.id
      and not m.is_internal_note and m.sender_type <> 'system'
    order by m.created_at desc, m.id desc limit 1
  ) latest on true
  where c.organization_id=p_org and c.status <> 'closed'
    and (c.assigned_to=auth.uid() or (c.assigned_to is null and c.status='open'))
    and latest.direction='inbound'
    and (c.last_read_at is null or latest.created_at > c.last_read_at);
  return v_count;
end;
$$;
revoke all on function public.inbox_unread_count(uuid) from public, anon;
grant execute on function public.inbox_unread_count(uuid) to authenticated;
