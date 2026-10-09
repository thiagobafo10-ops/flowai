-- Fase 2 / Tarefa 1: eventos de domínio emitidos por gatilhos e status do deal
-- acompanhando a etapa.

-- ---------------------------------------------------------------- emit_event
create or replace function public.emit_event(
  p_org uuid,
  p_type text,
  p_conversation_id uuid,
  p_contact_id uuid,
  p_deal_id uuid,
  p_payload jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  insert into public.events (
    organization_id, type, conversation_id, contact_id, deal_id,
    actor_type, actor_id, payload
  ) values (
    p_org, p_type, p_conversation_id, p_contact_id, p_deal_id,
    case when v_uid is null then 'system' else 'user' end,
    v_uid,
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.emit_event(uuid, text, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- contacts
create or replace function public.trg_contacts_emit_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.emit_event(new.organization_id, 'contact_created', null, new.id, null,
    jsonb_build_object('source', new.source));
  return null;
end;
$$;

-- ---------------------------------------------------------------- conversations
create or replace function public.trg_conversations_emit_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_event(new.organization_id, 'conversation_created', new.id, new.contact_id, null,
      jsonb_build_object('channel_id', new.channel_id));
  elsif new.status is distinct from old.status then
    if new.status = 'pending_human' then
      perform public.emit_event(new.organization_id, 'handoff', new.id, new.contact_id, null,
        jsonb_build_object('from_status', old.status));
    elsif new.status = 'closed' then
      perform public.emit_event(new.organization_id, 'conversation_closed', new.id, new.contact_id, null,
        jsonb_build_object('from_status', old.status));
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------- messages
create or replace function public.trg_messages_emit_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
begin
  if (new.direction = 'inbound' and not new.is_internal_note) or new.sender_type = 'ai' then
    select c.contact_id into v_contact
      from public.conversations c
      where c.organization_id = new.organization_id and c.id = new.conversation_id;
  end if;

  if new.direction = 'inbound' and not new.is_internal_note then
    perform public.emit_event(new.organization_id, 'message_received', new.conversation_id, v_contact, null,
      jsonb_build_object('message_id', new.id));
  end if;
  if new.sender_type = 'ai' then
    perform public.emit_event(new.organization_id, 'ai_replied', new.conversation_id, v_contact, null,
      jsonb_build_object('message_id', new.id));
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------- deals
create or replace function public.trg_deals_set_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_won boolean;
  v_lost boolean;
begin
  select s.is_won, s.is_lost into v_won, v_lost
    from public.pipeline_stages s
    where s.organization_id = new.organization_id and s.id = new.stage_id;
  new.status := case
    when coalesce(v_won, false) then 'won'
    when coalesce(v_lost, false) then 'lost'
    else 'open'
  end;
  return new;
end;
$$;

create or replace function public.trg_deals_emit_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_event(new.organization_id, 'deal_created', null, new.contact_id, new.id,
      jsonb_build_object('stage_id', new.stage_id, 'value', new.value));
  elsif new.stage_id is distinct from old.stage_id then
    perform public.emit_event(new.organization_id, 'deal_stage_changed', null, new.contact_id, new.id,
      jsonb_build_object('from_stage_id', old.stage_id, 'to_stage_id', new.stage_id));
  end if;

  if (tg_op = 'INSERT' or new.status is distinct from old.status) and new.status = 'won' then
    perform public.emit_event(new.organization_id, 'deal_won', null, new.contact_id, new.id,
      jsonb_build_object('value', new.value));
  elsif (tg_op = 'INSERT' or new.status is distinct from old.status) and new.status = 'lost' then
    perform public.emit_event(new.organization_id, 'deal_lost', null, new.contact_id, new.id,
      jsonb_build_object('value', new.value));
  end if;
  return null;
end;
$$;

revoke all on function
  public.trg_contacts_emit_events(),
  public.trg_conversations_emit_events(),
  public.trg_messages_emit_events(),
  public.trg_deals_set_status(),
  public.trg_deals_emit_events()
  from public, anon, authenticated;

create trigger contacts_emit_events after insert on public.contacts
  for each row execute function public.trg_contacts_emit_events();
create trigger conversations_emit_events after insert or update of status on public.conversations
  for each row execute function public.trg_conversations_emit_events();
create trigger messages_emit_events after insert on public.messages
  for each row execute function public.trg_messages_emit_events();
create trigger deals_set_status before insert or update of stage_id, status on public.deals
  for each row execute function public.trg_deals_set_status();
create trigger deals_emit_events after insert or update on public.deals
  for each row execute function public.trg_deals_emit_events();
