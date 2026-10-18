-- Suporte a 'oncePerUser' no gatilho de comentário do Instagram (evita múltiplos disparos para a mesma pessoa)

create index if not exists instagram_events_comment_sender_idx
  on public.instagram_events (channel_id, automation_id, (payload->>'senderExternalId'))
  where kind = 'comment';

create or replace function public.ingest_instagram_event(p_connection_id uuid,p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ch public.channels; ev public.instagram_events; a public.automations;
  v_kind text:=p_event->>'kind'; v_external text:=p_event->>'externalId'; v_at timestamptz;
  v_message uuid; v_state text:='done'; v_context jsonb; signed jsonb; v_click text; v_open jsonb;
begin
  select channels.* into ch from public.channels join public.meta_connections mc on mc.id=channels.meta_connection_id
    where mc.id=p_connection_id and mc.disconnected_at is null and channels.external_account_id=p_event->>'accountId'
      and channels.type='instagram' for share of channels,mc;
  if not found or ch.status<>'active' then return jsonb_build_object('state','ignored'); end if;
  if v_kind is null or v_kind not in ('message','button','comment','status','ignored','referral') or coalesce(v_external,'')=''
    or length(v_external)>2048 then raise exception 'invalid event' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('instagram-event:'||ch.id||':'||v_kind||':'||v_external,0));
  select * into ev from public.instagram_events where channel_id=ch.id and kind=v_kind and external_id=v_external;
  if found then return jsonb_build_object('eventId',ev.id,'messageId',ev.message_id,'state',ev.state); end if;
  v_at:=least((p_event->>'occurredAt')::timestamptz,now());
  if v_at is null then raise exception 'missing timestamp' using errcode='22023'; end if;
  if v_kind in ('message','button') then
    v_context:=case when v_kind='button' then jsonb_build_object('origin','button','payload',p_event->>'payload')
      else coalesce(p_event->'context','{}'::jsonb) end;
    -- Match the seven-argument ingester's message -> sender -> conversation -> run order.
    perform pg_advisory_xact_lock(hashtextextended('ingest:msg:'||ch.id||':'||v_external,0));
    if v_kind='button' or v_context ? 'payload' then
      v_click:=private.instagram_automation_click_kind(ch.id,p_event->>'senderExternalId',v_context->>'payload');
    end if;
    if v_click='forged' then v_state:='ignored';
    else
      -- Authentic but stale: ordinary text without the payload (never resumes the current wait).
      if v_click='stale' and left(v_context->>'payload',4)<>'fd1.' then v_context:=(v_context-'payload')||'{"staleClick":true}'::jsonb; end if;
      -- 7B: the entry link opens first (unknown/archived codes are ignored; the message always enters).
      -- Same echo guard as the referral kind: the account itself never opens a link.
      if v_kind='message' and jsonb_typeof(v_context->'referral')='object'
         and coalesce(p_event->>'senderExternalId','')<>'' and p_event->>'senderExternalId'<>ch.external_account_id then
        perform private.entry_link_open(ch.id,p_event->>'senderExternalId',v_context#>>'{referral,ref}',v_external,
          null,v_at);
      end if;
      v_message:=public.ingest_inbound_message(ch.id,v_external,p_event->>'senderExternalId',p_event->>'senderName',
        case when v_kind='button' then p_event->>'title' else p_event->>'text' end,v_at,v_context);
      if exists(select 1 from public.messages m where m.id=v_message and m.context ? 'payload' and left(m.context->>'payload',4)<>'fd1.') then
        signed:=private.automation_verify_payload(v_context->>'payload');
        insert into public.events(organization_id,type,conversation_id,contact_id,actor_type,payload)
          select m.organization_id,'button_clicked',m.conversation_id,c.contact_id,'contact',signed
          from public.messages m join public.conversations c on c.id=m.conversation_id where m.id=v_message;
      end if;
    end if;
  elsif v_kind='referral' then
    if coalesce(p_event->>'senderExternalId','')='' or p_event->>'senderExternalId'=ch.external_account_id then
      v_state:='ignored';
    else
      v_open:=private.entry_link_open(ch.id,p_event->>'senderExternalId',p_event->>'ref',v_external,null,v_at);
      if coalesce((v_open->>'ignored')::boolean,true) then v_state:='ignored'; end if;
    end if;
  elsif v_kind='comment' then
    if p_event->>'senderExternalId' is distinct from ch.external_account_id and coalesce(p_event->>'senderExternalId','')<>'' then
      select x.* into a from public.automations x join public.automation_versions v
        on v.automation_id=x.id and v.version=x.current_version
        where x.organization_id=ch.organization_id and x.status='active' and x.activated_at<=now()
          and v.trigger_type='instagram_comment' and v.trigger_config->>'channelId'=ch.id::text
          and (v.trigger_config->>'mediaId' is null or v.trigger_config->>'mediaId'=p_event->>'mediaId')
          and private.automation_keyword_matches(p_event->>'text',v.trigger_config)
          and private.instagram_comment_first_node(v.graph) is not null
          and (
            coalesce((v.trigger_config->>'oncePerUser')::boolean, true) = false
            or not exists (
              select 1 from public.instagram_events prev
              where prev.channel_id = ch.id
                and prev.kind = 'comment'
                and prev.automation_id = x.id
                and prev.payload->>'senderExternalId' = p_event->>'senderExternalId'
                and (v.trigger_config->>'mediaId' is null or prev.payload->>'mediaId' = p_event->>'mediaId')
                and prev.state in ('pending', 'done', 'uncertain')
            )
          )
        order by x.activated_at,x.id limit 1;
    end if;
    v_state:=case when a.id is null then 'ignored' else 'pending' end;
  elsif v_kind='status' then
    if p_event->>'state'<>'read' or coalesce(p_event->>'messageExternalId','')='' then raise exception 'invalid receipt' using errcode='22023'; end if;
    update public.messages set status='read' where channel_id=ch.id and external_id=p_event->>'messageExternalId'
      and direction='outbound' and not is_internal_note returning id into v_message;
  else v_state:='ignored'; end if;
  insert into public.instagram_events(organization_id,channel_id,kind,external_id,payload,occurred_at,
    automation_id,automation_version,automation_activated_at,message_id,state)
    values(ch.organization_id,ch.id,v_kind,v_external,p_event,v_at,a.id,a.current_version,a.activated_at,v_message,v_state)
    returning * into ev;
  if v_state='pending' then perform pgmq.send('instagram_work',jsonb_build_object('eventId',ev.id)); end if;
  return jsonb_build_object('eventId',ev.id,'messageId',ev.message_id,'state',ev.state);
end $$;

create or replace function public.reselect_instagram_comment_rule(p_event_id uuid,p_comment_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ev public.instagram_events; a public.automations; item public.instagram_send_intents; body jsonb;
begin
  if p_comment_at is null then return 'null'::jsonb; end if;
  select * into ev from public.instagram_events where id=p_event_id and kind='comment' for update;
  if not found or ev.state not in ('pending','uncertain') then return 'null'::jsonb; end if;
  select * into item from public.instagram_send_intents where event_id=ev.id for update;
  if found and (item.state<>'pending' or item.automation_run_id is not null) then return 'null'::jsonb; end if;
  select x.* into a from public.automations x join public.automation_versions v on v.automation_id=x.id and v.version=x.current_version
    where x.organization_id=ev.organization_id and x.status='active' and x.activated_at<=p_comment_at
      and v.trigger_type='instagram_comment' and v.trigger_config->>'channelId'=ev.channel_id::text
      and (v.trigger_config->>'mediaId' is null or v.trigger_config->>'mediaId'=ev.payload->>'mediaId')
      and private.automation_keyword_matches(ev.payload->>'text',v.trigger_config)
      and private.instagram_comment_first_node(v.graph) is not null
      and (
        coalesce((v.trigger_config->>'oncePerUser')::boolean, true) = false
        or not exists (
          select 1 from public.instagram_events prev
          where prev.channel_id = ev.channel_id
            and prev.kind = 'comment'
            and prev.id <> ev.id
            and prev.automation_id = x.id
            and prev.payload->>'senderExternalId' = ev.payload->>'senderExternalId'
            and (v.trigger_config->>'mediaId' is null or prev.payload->>'mediaId' = ev.payload->>'mediaId')
            and prev.state in ('pending', 'done', 'uncertain')
        )
      )
    order by x.activated_at,x.id limit 1;
  if a.id is null then return 'null'::jsonb; end if;
  update public.instagram_events set automation_id=a.id,automation_version=a.current_version,automation_activated_at=a.activated_at
    where id=ev.id returning * into ev;
  body:=private.instagram_comment_body(ev.automation_run_id,private.instagram_comment_node(ev));
  update public.instagram_send_intents set text=coalesce(body->>'text',body#>>'{attachment,payload,text}'),message_payload=body
    where event_id=ev.id and state='pending';
  return public.prepare_instagram_comment_send(ev.id);
end $$;

revoke all on function public.ingest_instagram_event(uuid,jsonb),
  public.reselect_instagram_comment_rule(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.ingest_instagram_event(uuid,jsonb),
  public.reselect_instagram_comment_rule(uuid,timestamptz) to service_role;
