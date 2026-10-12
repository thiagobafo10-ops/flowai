-- Lista do Inbox e contadores no banco (filtros, busca e paginação por keyset).

create function public.list_inbox(
  p_org uuid,
  p_tab text,
  p_q text,
  p_channel uuid,
  p_cursor_at timestamptz,
  p_cursor_id uuid,
  p_limit int
) returns table (
  id uuid,
  status public.conversation_status,
  handled_by public.handler_type,
  assigned_to uuid,
  assignee_name text,
  last_message_at timestamptz,
  last_read_at timestamptz,
  contact_id uuid,
  contact_name text,
  contact_phone text,
  contact_email text,
  channel_id uuid,
  channel_type public.channel_type,
  preview text,
  preview_from_team boolean,
  last_inbound_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_pattern text;
  v_digits text;
  v_me uuid := auth.uid();
begin
  if not public.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_q is not null then
    v_pattern := '%' || extensions.unaccent(lower(
      replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_'))) || '%';
    v_digits := regexp_replace(v_q, '\D', '', 'g');
    if length(v_digits) < 3 then
      v_digits := null;
    end if;
  end if;

  return query
  select c.id, c.status, c.handled_by, c.assigned_to, p.full_name, c.last_message_at, c.last_read_at,
         k.id, k.name, k.phone, k.email, ch.id, ch.type,
         lm.content,
         coalesce(lm.sender_type = 'human', false),
         case when lm.direction = 'inbound' then lm.created_at end
  from public.conversations c
  join public.contacts k on k.organization_id = c.organization_id and k.id = c.contact_id
  join public.channels ch on ch.organization_id = c.organization_id and ch.id = c.channel_id
  left join public.profiles p on p.id = c.assigned_to
  left join lateral (
    select m.content, m.sender_type, m.direction, m.created_at
    from public.messages m
    where m.conversation_id = c.id and m.organization_id = c.organization_id
      and not m.is_internal_note and m.sender_type <> 'system'
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  where c.organization_id = p_org
    and case p_tab
      when 'minhas' then c.assigned_to = v_me and c.status <> 'closed'
      when 'nao-atribuidas' then c.assigned_to is null and c.status = 'open'
      when 'aguardando' then c.status = 'pending_human'
      when 'fechadas' then c.status = 'closed'
      else c.status <> 'closed'
    end
    and (p_channel is null or c.channel_id = p_channel)
    and (v_q is null
         or extensions.unaccent(lower(coalesce(k.name, ''))) like v_pattern
         or (v_digits is not null
             and regexp_replace(coalesce(k.phone, ''), '\D', '', 'g') like '%' || v_digits || '%')
         or extensions.unaccent(lower(coalesce(lm.content, ''))) like v_pattern)
    and (p_cursor_at is null or p_cursor_id is null
         or (c.last_message_at, c.id) < (p_cursor_at, p_cursor_id))
  order by c.last_message_at desc, c.id desc
  limit greatest(coalesce(p_limit, 50), 0);
end $$;

revoke all on function public.list_inbox(uuid, text, text, uuid, timestamptz, uuid, int) from public, anon;
grant execute on function public.list_inbox(uuid, text, text, uuid, timestamptz, uuid, int) to authenticated;

create function public.inbox_counts(p_org uuid) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if not public.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'minhas', count(*) filter (where c.assigned_to = v_me and c.status <> 'closed'),
      'nao-atribuidas', count(*) filter (where c.assigned_to is null and c.status = 'open'),
      'aguardando', count(*) filter (where c.status = 'pending_human'),
      'todas', count(*) filter (where c.status <> 'closed'),
      'fechadas', 0)
    from public.conversations c
    where c.organization_id = p_org);
end $$;

revoke all on function public.inbox_counts(uuid) from public, anon;
grant execute on function public.inbox_counts(uuid) to authenticated;
