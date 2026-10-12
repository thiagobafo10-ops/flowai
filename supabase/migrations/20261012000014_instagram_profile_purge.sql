-- Item: nome do contato via perfil do Instagram (best-effort) e expurgo de dados
-- do remetente quando o contato é excluído do CRM.

-- Direct de contato ainda sem nome agenda uma tarefa de perfil para o worker.
create function public.enqueue_instagram_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id
            join public.contacts ct on ct.id=c.contact_id where m.id=new.message_id and ct.name is null) then
    perform pgmq.send('instagram_work',jsonb_build_object('eventId',new.id,'task','profile'));
  end if;
  return new;
end $$;
revoke all on function public.enqueue_instagram_profile() from public,anon,authenticated;
create trigger instagram_profile_enqueue after insert on public.instagram_events
  for each row when (new.kind='message' and new.message_id is not null) execute function public.enqueue_instagram_profile();

create or replace function public.read_instagram_work(p_limit integer) returns jsonb
language sql security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('queueId',msg_id,'eventId',message->>'eventId',
    'task',coalesce(message->>'task','comment')) order by msg_id),'[]'::jsonb)
  from pgmq.read('instagram_work',300,least(greatest(p_limit,1),10));
$$;

create function public.prepare_instagram_profile(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
  select jsonb_build_object('eventId',e.id,'organizationId',e.organization_id,'channelId',ch.id,
      'connectionId',ch.meta_connection_id,'contactId',ct.id,'senderExternalId',ct.instagram_id) into v
    from public.instagram_events e join public.channels ch on ch.id=e.channel_id
    join public.messages m on m.id=e.message_id join public.conversations c on c.id=m.conversation_id
    join public.contacts ct on ct.id=c.contact_id
    where e.id=p_event_id and e.kind='message' and ch.status='active' and ct.name is null and ct.instagram_id is not null;
  return coalesce(v,'null'::jsonb);
end $$;

create function public.save_instagram_contact_name(p_event_id uuid,p_name text) returns void
language plpgsql security definer set search_path='' as $$
declare v_name text:=left(btrim(regexp_replace(coalesce(p_name,''),'[[:cntrl:]]',' ','g')),120);
begin
  if v_name='' then return; end if;
  update public.contacts ct set name=v_name
    from public.instagram_events e join public.messages m on m.id=e.message_id join public.conversations c on c.id=m.conversation_id
    where e.id=p_event_id and e.kind='message' and ct.id=c.contact_id and ct.name is null;
end $$;
revoke all on function public.prepare_instagram_profile(uuid),public.save_instagram_contact_name(uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_instagram_profile(uuid),public.save_instagram_contact_name(uuid,text) to service_role;

create or replace function public.finish_instagram_work(p_queue_id bigint,p_state text,p_error_code text) returns void
language plpgsql security definer set search_path='' as $$
declare v_message jsonb; v_event uuid; v_attempts integer;
begin
  if p_state not in ('done','ignored','retry','failed','uncertain') or p_state is null then raise exception 'invalid work state' using errcode='22023'; end if;
  if p_error_code is not null and p_error_code !~ '^[a-z_]{1,60}$' then raise exception 'unsafe error code' using errcode='22023'; end if;
  select message into v_message from pgmq.q_instagram_work where msg_id=p_queue_id for update;
  if not found then return; end if;
  -- Perfil é best-effort: nunca altera o evento nem é refeito.
  if v_message->>'task'='profile' then perform pgmq.archive('instagram_work',p_queue_id); return; end if;
  v_event:=(v_message->>'eventId')::uuid;
  update public.instagram_events set attempts=attempts+1,last_error=p_error_code where id=v_event returning attempts into v_attempts;
  if p_state='retry' and v_attempts<5 then
    perform pgmq.set_vt('instagram_work',p_queue_id,(30*power(2,v_attempts-1))::integer);
    return;
  end if;
  update public.instagram_events set state=case when p_state='retry' then 'failed' else p_state end where id=v_event;
  -- Comentário encerrado sem envio: a resposta privada pendente nunca sairá.
  if p_state in ('ignored','failed','retry') then
    update public.instagram_send_intents set state='failed',error_code=coalesce(p_error_code,'comment_not_eligible')
      where event_id=v_event and state='pending';
  end if;
  perform pgmq.archive('instagram_work',p_queue_id);
end $$;

-- Excluir o contato do CRM apaga os dados brutos do remetente guardados nos
-- eventos e encerra respostas privadas ainda não enviadas para ele.
create function public.purge_instagram_contact_data() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.instagram_events set payload=jsonb_build_object('purged',true),
      state=case when state='pending' then 'ignored' else state end,
      last_error=case when state='pending' then 'contact_deleted' else last_error end
    where organization_id=old.organization_id and kind in ('message','comment')
      and payload->>'senderExternalId'=old.instagram_id;
  update public.instagram_send_intents set state='failed',error_code='contact_deleted'
    where organization_id=old.organization_id and kind='private_reply' and state='pending'
      and recipient_external_id=old.instagram_id;
  return old;
end $$;
revoke all on function public.purge_instagram_contact_data() from public,anon,authenticated;
create trigger contacts_instagram_purge after delete on public.contacts
  for each row when (old.instagram_id is not null) execute function public.purge_instagram_contact_data();
create index instagram_events_sender_idx on public.instagram_events(organization_id,(payload->>'senderExternalId'))
  where kind in ('message','comment');
