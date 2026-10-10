-- Esquema do Inbox (Fase 4): leitura, simulador único, closed_at por gatilho,
-- trava de identidade de canal em contacts, mensagens de sistema e last_message_at.

alter table public.conversations add column last_read_at timestamptz;

-- No máximo um canal simulator por organização.
create unique index channels_one_simulator_per_org
  on public.channels (organization_id) where type = 'simulator';

-- closed_at é responsabilidade do gatilho.
create function public.conversations_set_closed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.closed_at := now();
  elsif new.status <> 'closed' and old.status = 'closed' then
    new.closed_at := null;
  end if;
  return new;
end $$;

create trigger conversations_closed_at
  before update of status on public.conversations
  for each row execute function public.conversations_set_closed_at();

revoke update (closed_at) on public.conversations from authenticated;
grant update (status, handled_by, assigned_to, last_read_at) on public.conversations to authenticated;

-- Contatos: identidade do canal só por funções definer / service role. O privilégio de
-- INSERT de tabela é substituído por uma lista de colunas (revogar só colunas não bastaria).
revoke insert on public.contacts from authenticated;
grant insert (organization_id, name, phone, email, avatar_url, status, lead_score, assigned_to)
  on public.contacts to authenticated;

-- save_contact sem a coluna source (usa o default 'manual'); demais semânticas inalteradas.
create or replace function public.save_contact(
  p_org uuid,
  p_contact_id uuid,
  p_data jsonb,
  p_tag_ids uuid[],
  p_custom_fields jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
begin
  if p_contact_id is null then
    insert into public.contacts (organization_id, name, phone, email, status, assigned_to, lead_score)
    values (
      p_org,
      v_data ->> 'name',
      v_data ->> 'phone',
      v_data ->> 'email',
      coalesce((v_data ->> 'status')::public.contact_status, 'lead'),
      (v_data ->> 'assigned_to')::uuid,
      coalesce((v_data ->> 'lead_score')::int, 0)
    )
    returning id into v_id;
  else
    update public.contacts c set
      name = case when v_data ? 'name' then v_data ->> 'name' else c.name end,
      phone = case when v_data ? 'phone' then v_data ->> 'phone' else c.phone end,
      email = case when v_data ? 'email' then v_data ->> 'email' else c.email end,
      status = case when v_data ? 'status' then (v_data ->> 'status')::public.contact_status else c.status end,
      assigned_to = case when v_data ? 'assigned_to' then (v_data ->> 'assigned_to')::uuid else c.assigned_to end,
      lead_score = case when v_data ? 'lead_score' then (v_data ->> 'lead_score')::int else c.lead_score end
    where c.id = p_contact_id and c.organization_id = p_org
    returning c.id into v_id;
    if v_id is null then
      raise exception 'contact not found' using errcode = 'P0002';
    end if;
  end if;

  if p_tag_ids is not null then
    delete from public.contact_tags where contact_id = v_id and organization_id = p_org;
    if cardinality(p_tag_ids) > 0 then
      insert into public.contact_tags (organization_id, contact_id, tag_id)
      select p_org, v_id, t from unnest(p_tag_ids) as t group by t;
    end if;
  end if;

  if p_custom_fields is not null then
    delete from public.contact_custom_fields where contact_id = v_id and organization_id = p_org;
    if jsonb_array_length(p_custom_fields) > 0 then
      insert into public.contact_custom_fields (organization_id, contact_id, key, value)
      select p_org, v_id, f ->> 'key', f ->> 'value'
      from jsonb_array_elements(p_custom_fields) f;
    end if;
  end if;

  return v_id;
end $$;

revoke all on function public.save_contact(uuid, uuid, jsonb, uuid[], jsonb) from public, anon;
grant execute on function public.save_contact(uuid, uuid, jsonb, uuid[], jsonb) to authenticated;

-- last_message_at: só mensagens reais (contato/humano/IA/automação), nunca nota nem sistema.
create function public.messages_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_internal_note = false and new.sender_type in ('contact', 'human', 'ai', 'automation') then
    update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  end if;
  return null;
end $$;
revoke all on function public.messages_touch_conversation() from public, anon, authenticated;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.messages_touch_conversation();

create function public.log_conversation_system_message(
  p_conversation uuid,
  p_kind text,
  p_target_user uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_channel uuid;
  v_actor text;
  v_target text;
  v_text text;
begin
  select organization_id, channel_id into v_org, v_channel
  from public.conversations where id = p_conversation;
  if v_org is null or not public.has_role(v_org, 'agent') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('assumed', 'assigned', 'unassigned', 'closed', 'reopened') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Alguém') into v_actor
  from public.profiles where id = auth.uid();
  v_actor := coalesce(v_actor, 'Alguém');

  if p_kind = 'assigned' then
    if p_target_user is null or not exists (
      select 1 from public.memberships where organization_id = v_org and user_id = p_target_user
    ) then
      raise exception 'invalid target' using errcode = '22023';
    end if;
    select coalesce(nullif(btrim(full_name), ''), 'Alguém') into v_target
    from public.profiles where id = p_target_user;
    v_target := coalesce(v_target, 'Alguém');
  end if;

  v_text := case p_kind
    when 'assumed' then v_actor || ' assumiu a conversa'
    when 'assigned' then v_actor || ' transferiu para ' || v_target
    when 'unassigned' then v_actor || ' removeu o responsável'
    when 'closed' then 'Conversa fechada por ' || v_actor
    when 'reopened' then 'Conversa reaberta por ' || v_actor
  end;

  insert into public.messages (organization_id, conversation_id, channel_id, direction,
    sender_type, sender_user_id, content, status)
  values (v_org, p_conversation, v_channel, 'outbound', 'system', auth.uid(), v_text, 'delivered');
end $$;
revoke all on function public.log_conversation_system_message(uuid, text, uuid) from public, anon;
grant execute on function public.log_conversation_system_message(uuid, text, uuid) to authenticated;

create function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.conversations where id = p_conversation;
  if v_org is null or not public.is_member(v_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.conversations set last_read_at = now() where id = p_conversation;
end $$;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
