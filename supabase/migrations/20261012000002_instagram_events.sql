alter table public.messages add column context jsonb not null default '{}'::jsonb;
grant select(context) on public.messages to authenticated;
select pgmq.create('instagram_work');

create table public.instagram_comment_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid not null,
  keyword text not null check(length(btrim(keyword)) between 1 and 100),
  reply_text text not null check(octet_length(reply_text) between 1 and 1000 and reply_text ~ '[^[:space:]]'),
  media_id text,
  active boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,id),
  foreign key(organization_id,channel_id) references public.channels(organization_id,id)
);
create table public.instagram_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid not null,
  kind text not null check(kind in ('message','comment','status','ignored')),
  external_id text not null,
  payload jsonb not null,
  occurred_at timestamptz not null,
  rule_id uuid,
  rule_version integer,
  message_id uuid,
  state text not null default 'done' check(state in ('pending','done','ignored','failed','uncertain')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  unique(channel_id,kind,external_id),
  foreign key(organization_id,channel_id) references public.channels(organization_id,id),
  foreign key(organization_id,rule_id) references public.instagram_comment_rules(organization_id,id)
);
create table public.instagram_send_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid not null,
  conversation_id uuid,
  message_id uuid,
  actor_id uuid,
  request_id uuid,
  event_id uuid unique references public.instagram_events(id),
  kind text not null default 'direct' check(kind in ('direct','private_reply')),
  recipient_external_id text,
  comment_id text,
  text text not null check(octet_length(text) between 1 and 1000 and text ~ '[^[:space:]]'),
  state text not null default 'pending' check(state in ('pending','sending','sent','failed','uncertain')),
  claim_token uuid,
  claimed_at timestamptz,
  external_id text,
  error_code text,
  created_at timestamptz not null default now(),
  unique(organization_id,request_id),
  foreign key(organization_id,channel_id) references public.channels(organization_id,id),
  foreign key(organization_id,conversation_id,channel_id) references public.conversations(organization_id,id,channel_id)
);
create index instagram_events_pending_idx on public.instagram_events(state,created_at);
create index instagram_events_status_idx on public.instagram_events(channel_id,(payload->>'messageExternalId')) where kind='status';
create index instagram_intents_channel_idx on public.instagram_send_intents(channel_id);
create index instagram_rules_channel_idx on public.instagram_comment_rules(channel_id,active,created_at);
alter table public.instagram_comment_rules enable row level security;
alter table public.instagram_events enable row level security;
alter table public.instagram_send_intents enable row level security;
revoke all on public.instagram_comment_rules,public.instagram_events,public.instagram_send_intents from anon,authenticated;
grant select on public.instagram_comment_rules,public.instagram_send_intents to authenticated;
create policy instagram_rules_select on public.instagram_comment_rules for select to authenticated using(public.has_role(organization_id,'admin'));
create policy instagram_intents_select on public.instagram_send_intents for select to authenticated using(public.has_role(organization_id,'agent'));

create function public.instagram_keyword_matches(p_text text,p_keyword text) returns boolean
language plpgsql immutable set search_path='' as $$
declare t text:=lower(extensions.unaccent(regexp_replace(btrim(p_text),'\s+',' ','g')));
  k text:=lower(extensions.unaccent(regexp_replace(btrim(p_keyword),'\s+',' ','g')));
  n integer; start_at integer:=1;
begin
  if coalesce(k,'')='' or coalesce(t,'')='' then return false; end if;
  loop
    n:=strpos(substr(t,start_at),k);
    if n=0 then return false; end if;
    n:=n+start_at-1;
    if (n=1 or substr(t,n-1,1) !~ '[[:alnum:]_]') and
       (n+length(k)>length(t) or substr(t,n+length(k),1) !~ '[[:alnum:]_]') then return true; end if;
    start_at:=n+1;
  end loop;
end $$;
revoke all on function public.instagram_keyword_matches(text,text) from public,anon,authenticated;

create function public.save_instagram_comment_rule(p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ch public.channels; rule public.instagram_comment_rules; v_id uuid;
begin
  select * into ch from public.channels where id=(p_input->>'channelId')::uuid and type='instagram';
  if not found or not public.has_role(ch.organization_id,'admin') then raise exception 'forbidden' using errcode='42501'; end if;
  if coalesce((p_input->>'active')::boolean,false) and ch.status<>'active' then raise exception 'channel inactive' using errcode='22023'; end if;
  if p_input->>'mediaId' is not null and p_input->>'mediaId' !~ '^[0-9]{1,100}$' then raise exception 'invalid media id' using errcode='22023'; end if;
  if nullif(p_input->>'id','') is null then
    insert into public.instagram_comment_rules(organization_id,channel_id,keyword,reply_text,media_id,active)
      values(ch.organization_id,ch.id,btrim(p_input->>'keyword'),p_input->>'replyText',nullif(p_input->>'mediaId',''),coalesce((p_input->>'active')::boolean,false)) returning id into v_id;
  else
    update public.instagram_comment_rules set keyword=btrim(p_input->>'keyword'),reply_text=p_input->>'replyText',
      media_id=nullif(p_input->>'mediaId',''),active=coalesce((p_input->>'active')::boolean,false),version=version+1,updated_at=now()
      where id=(p_input->>'id')::uuid and organization_id=ch.organization_id and channel_id=ch.id returning id into v_id;
    if v_id is null then raise exception 'rule not owned' using errcode='42501'; end if;
  end if;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id)
    values(ch.organization_id,auth.uid(),'instagram_rule_saved','instagram_comment_rule',v_id);
  return v_id;
end $$;

create function public.ingest_instagram_event(p_connection_id uuid,p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ch public.channels; ev public.instagram_events; rule public.instagram_comment_rules;
  v_kind text:=p_event->>'kind'; v_external text:=p_event->>'externalId'; v_at timestamptz;
  v_message uuid; v_state text:='done';
begin
  select channels.* into ch from public.channels join public.meta_connections mc on mc.id=channels.meta_connection_id
    where mc.id=p_connection_id and mc.disconnected_at is null and channels.external_account_id=p_event->>'accountId' and channels.type='instagram' for share of channels,mc;
  if not found or ch.status<>'active' then return jsonb_build_object('state','ignored'); end if;
  if v_kind is null or v_kind not in ('message','comment','status','ignored') or coalesce(v_external,'')='' or length(v_external)>2048 then raise exception 'invalid event' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('instagram-event:'||ch.id||':'||v_kind||':'||v_external,0));
  select * into ev from public.instagram_events where channel_id=ch.id and kind=v_kind and external_id=v_external;
  if found then return jsonb_build_object('eventId',ev.id,'messageId',ev.message_id,'state',ev.state); end if;
  v_at:=least((p_event->>'occurredAt')::timestamptz,now());
  if v_at is null then raise exception 'missing timestamp' using errcode='22023'; end if;
  if v_kind='message' then
    v_message:=public.ingest_inbound_message(ch.id,v_external,p_event->>'senderExternalId',p_event->>'senderName',p_event->>'text',v_at);
    update public.messages set context=coalesce(p_event->'context','{}'::jsonb) where id=v_message;
  elsif v_kind='comment' then
    if p_event->>'senderExternalId' is distinct from ch.external_account_id and coalesce(p_event->>'senderExternalId','')<>'' then
      select * into rule from public.instagram_comment_rules where channel_id=ch.id and active
        and (media_id is null or media_id=p_event->>'mediaId')
        and created_at<=v_at and public.instagram_keyword_matches(p_event->>'text',keyword) order by created_at,id limit 1;
    end if;
    v_state:=case when rule.id is null then 'ignored' else 'pending' end;
  elsif v_kind='status' then
    if p_event->>'state'<>'read' or coalesce(p_event->>'messageExternalId','')='' then raise exception 'invalid receipt' using errcode='22023'; end if;
    update public.messages set status='read' where channel_id=ch.id and external_id=p_event->>'messageExternalId' and direction='outbound' and not is_internal_note returning id into v_message;
  else v_state:='ignored'; end if;
  insert into public.instagram_events(organization_id,channel_id,kind,external_id,payload,occurred_at,rule_id,rule_version,message_id,state)
    values(ch.organization_id,ch.id,v_kind,v_external,p_event,v_at,rule.id,rule.version,v_message,v_state) returning * into ev;
  if v_state='pending' then perform pgmq.send('instagram_work',jsonb_build_object('eventId',ev.id)); end if;
  return jsonb_build_object('eventId',ev.id,'messageId',ev.message_id,'state',ev.state);
end $$;

create function public.create_instagram_send_intent(p_conversation_id uuid,p_text text,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare conv public.conversations; ch public.channels; v_intent uuid; v_message uuid; v_recipient text;
begin
  select * into conv from public.conversations where id=p_conversation_id;
  if not found or not public.has_role(conv.organization_id,'agent') then raise exception 'forbidden' using errcode='42501'; end if;
  select * into ch from public.channels where id=conv.channel_id;
  if ch.type<>'instagram' or ch.status<>'active' or conv.status='closed' then raise exception 'conversation unavailable' using errcode='22023'; end if;
  if p_request_id is null or p_text is null or p_text !~ '[^[:space:]]' or octet_length(p_text)>1000 then raise exception 'invalid content' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('instagram-request:'||conv.organization_id||':'||p_request_id,0));
  select id into v_intent from public.instagram_send_intents where organization_id=conv.organization_id and request_id=p_request_id;
  if found then return v_intent; end if;
  if not exists(select 1 from public.messages where conversation_id=conv.id and direction='inbound' and sender_type='contact' and created_at>now()-interval '24 hours') then raise exception 'messaging window closed' using errcode='22023'; end if;
  select instagram_id into v_recipient from public.contacts where id=conv.contact_id;
  if coalesce(v_recipient,'')='' then raise exception 'missing recipient' using errcode='22023'; end if;
  insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,sender_user_id,content,status)
    values(conv.organization_id,conv.id,ch.id,'outbound','human',auth.uid(),p_text,'pending') returning id into v_message;
  insert into public.instagram_send_intents(organization_id,channel_id,conversation_id,message_id,actor_id,request_id,recipient_external_id,text)
    values(conv.organization_id,ch.id,conv.id,v_message,auth.uid(),p_request_id,v_recipient,p_text) returning id into v_intent;
  return v_intent;
end $$;

create function public.claim_instagram_send(p_intent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.instagram_send_intents; ch public.channels; v_connection uuid;
begin
  select * into item from public.instagram_send_intents where id=p_intent_id for update;
  if not found then return 'null'::jsonb; end if;
  if item.state='sending' and item.claimed_at<now()-interval '1 minute' then
    update public.instagram_send_intents set state='uncertain',error_code='expired_send_lease' where id=item.id;
    update public.messages set error='Envio sem confirmação. Verifique o Instagram antes de tentar novamente.' where id=item.message_id;
    return 'null'::jsonb;
  end if;
  if item.state<>'pending' then return 'null'::jsonb; end if;
  select * into ch from public.channels where id=item.channel_id;
  if ch.status<>'active' then raise exception 'channel inactive' using errcode='22023'; end if;
  if item.kind='direct' and not exists(select 1 from public.messages where conversation_id=item.conversation_id and direction='inbound' and created_at>now()-interval '24 hours') then raise exception 'messaging window closed' using errcode='22023'; end if;
  update public.instagram_send_intents set state='sending',claim_token=gen_random_uuid(),claimed_at=now() where id=item.id returning * into item;
  return jsonb_build_object('intentId',item.id,'channelId',ch.id,'connectionId',ch.meta_connection_id,'actorId',item.actor_id,
    'recipientExternalId',item.recipient_external_id,'commentId',item.comment_id,'kind',item.kind,'text',item.text,'claimToken',item.claim_token);
end $$;

create function public.complete_instagram_send(p_intent_id uuid,p_result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare item public.instagram_send_intents; v_state text:=p_result->>'state'; v_status public.message_status;
begin
  select * into item from public.instagram_send_intents where id=p_intent_id for update;
  if not found or item.state<>'sending' or item.claim_token is distinct from (p_result->>'claimToken')::uuid then raise exception 'invalid claim' using errcode='40001'; end if;
  if v_state is null or v_state not in ('sent','failed','uncertain') then raise exception 'invalid result' using errcode='22023'; end if;
  if v_state='sent' and coalesce(p_result->>'externalId','')='' then raise exception 'missing external id' using errcode='22023'; end if;
  if p_result->>'errorCode' is not null and p_result->>'errorCode' !~ '^[a-z_]{1,60}$' then raise exception 'unsafe error' using errcode='22023'; end if;
  update public.instagram_send_intents set state=v_state,external_id=p_result->>'externalId',error_code=p_result->>'errorCode' where id=item.id;
  v_status:=case when v_state='sent' then 'sent'::public.message_status when v_state='failed' then 'failed'::public.message_status else 'pending'::public.message_status end;
  if v_state='sent' and exists(select 1 from public.instagram_events where channel_id=item.channel_id and kind='status' and payload->>'messageExternalId'=p_result->>'externalId' and payload->>'state'='read') then v_status:='read'; end if;
  update public.messages set external_id=case when v_state='sent' then p_result->>'externalId' else external_id end,
    status=case when status='read' or (status='delivered' and v_status in ('sent','failed','pending')) then status else v_status end,
    error=case when v_state='uncertain' then 'Envio sem confirmação. Verifique o Instagram antes de tentar novamente.' when v_state='failed' then 'Não foi possível enviar pelo Instagram.' else null end
    where id=item.message_id;
end $$;

revoke all on function public.save_instagram_comment_rule(jsonb),public.create_instagram_send_intent(uuid,text,uuid) from public,anon;
grant execute on function public.save_instagram_comment_rule(jsonb),public.create_instagram_send_intent(uuid,text,uuid) to authenticated;
revoke all on function public.ingest_instagram_event(uuid,jsonb),public.claim_instagram_send(uuid),public.complete_instagram_send(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_instagram_event(uuid,jsonb),public.claim_instagram_send(uuid),public.complete_instagram_send(uuid,jsonb) to service_role;
