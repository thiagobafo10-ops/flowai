-- Request IDs identify one immutable human intent, including its actor/text.
create or replace function public.create_instagram_send_intent(p_conversation_id uuid,p_text text,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare conv public.conversations; ch public.channels; existing public.instagram_send_intents;
  v_intent uuid; v_message uuid; v_recipient text;
begin
  select * into conv from public.conversations where id=p_conversation_id;
  if not found or not public.has_role(conv.organization_id,'agent') then raise exception 'forbidden' using errcode='42501'; end if;
  select * into ch from public.channels where id=conv.channel_id;
  if ch.type<>'instagram' or ch.status<>'active' or conv.status='closed' then raise exception 'conversation unavailable' using errcode='22023'; end if;
  if p_request_id is null or p_text is null or p_text !~ '[^[:space:]]' or octet_length(p_text)>1000 then raise exception 'invalid content' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('instagram-request:'||conv.organization_id||':'||p_request_id,0));
  select * into existing from public.instagram_send_intents where organization_id=conv.organization_id and request_id=p_request_id;
  if found then
    if existing.actor_id is distinct from auth.uid() or existing.conversation_id<>conv.id or existing.text<>p_text then raise exception 'request id conflict' using errcode='22023'; end if;
    return existing.id;
  end if;
  if not exists(select 1 from public.messages where conversation_id=conv.id and direction='inbound' and sender_type='contact' and created_at>now()-interval '24 hours') then raise exception 'messaging window closed' using errcode='22023'; end if;
  select instagram_id into v_recipient from public.contacts where id=conv.contact_id;
  if coalesce(v_recipient,'')='' then raise exception 'missing recipient' using errcode='22023'; end if;
  insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,sender_user_id,content,status)
    values(conv.organization_id,conv.id,ch.id,'outbound','human',auth.uid(),p_text,'pending') returning id into v_message;
  insert into public.instagram_send_intents(organization_id,channel_id,conversation_id,message_id,actor_id,request_id,recipient_external_id,text)
    values(conv.organization_id,ch.id,conv.id,v_message,auth.uid(),p_request_id,v_recipient,p_text) returning id into v_intent;
  return v_intent;
end $$;

create function public.retry_instagram_send_intent(p_message_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare item public.instagram_send_intents; conv public.conversations;
begin
  select * into item from public.instagram_send_intents where message_id=p_message_id and kind='direct' for update;
  if not found or item.actor_id is distinct from auth.uid() or not public.has_role(item.organization_id,'agent')
    or item.state<>'failed' or item.error_code not in ('invalid_config','invalid_content','invalid_token','permission_denied','rate_limited','provider_rejected') then
    raise exception 'retry forbidden' using errcode='42501';
  end if;
  select * into conv from public.conversations where id=item.conversation_id;
  if conv.status='closed' or not exists(select 1 from public.channels where id=item.channel_id and status='active')
    or not exists(select 1 from public.messages where conversation_id=conv.id and direction='inbound' and created_at>now()-interval '24 hours') then raise exception 'conversation unavailable' using errcode='22023'; end if;
  update public.instagram_send_intents set state='pending',claim_token=null,claimed_at=null,error_code=null where id=item.id;
  update public.messages set status='pending',error=null where id=p_message_id and status='failed';
  return item.id;
end $$;
revoke all on function public.retry_instagram_send_intent(uuid) from public,anon;
grant execute on function public.retry_instagram_send_intent(uuid) to authenticated;
