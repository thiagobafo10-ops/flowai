-- Instagram comment rules are now automations. Old rows remain readable history.
alter table public.instagram_events
  add column automation_id uuid,
  add column automation_version int,
  add column automation_activated_at timestamptz,
  -- Reserved before verification, without a runnable execution or an FK.
  add column automation_run_id uuid;
alter table public.instagram_events add constraint instagram_events_automation_fk
  foreign key(organization_id,automation_id) references public.automations(organization_id,id)
  on delete set null (automation_id);
alter table public.instagram_events drop constraint instagram_events_kind_check;
alter table public.instagram_events add constraint instagram_events_kind_check
  check(kind in ('message','button','comment','status','ignored'));
create index instagram_events_automation_latest_idx on public.instagram_events(automation_id,created_at desc)
  where automation_id is not null;
grant select(automation_id,automation_version) on public.instagram_events to authenticated;
revoke insert,update,delete on public.instagram_comment_rules from authenticated;
revoke all on function public.save_instagram_comment_rule(jsonb) from public,anon,authenticated;

-- Kept private so upgrade fixtures can exercise the same data migration.
create function private.migrate_instagram_comment_rules() returns void
language plpgsql security definer set search_path='' as $$
declare r public.instagram_comment_rules; t uuid; m uuid; e uuid; cfg jsonb;
begin
  for r in select * from public.instagram_comment_rules loop
    if exists(select 1 from public.automations where id=r.id) then continue; end if;
    t:=md5(r.id::text||':trigger')::uuid; m:=md5(r.id::text||':message')::uuid; e:=md5(r.id::text||':end')::uuid;
    cfg:=jsonb_build_object('channelId',r.channel_id,'mediaId',r.media_id,'keywords',jsonb_build_array(r.keyword),'mode','contains');
    insert into public.automations(id,organization_id,name,trigger_type,trigger_config,status,activated_at,created_at,current_version)
      values(r.id,r.organization_id,left('Comentário: '||r.keyword,100),'instagram_comment',cfg,
        case when r.active then 'active'::public.automation_status else 'draft'::public.automation_status end,
        case when r.active then r.updated_at end,r.created_at,0);
    insert into public.automation_nodes(id,organization_id,automation_id,type,config,position) values
      (t,r.organization_id,r.id,'trigger','{}','{"x":0,"y":0}'),
      (m,r.organization_id,r.id,'message',jsonb_build_object('mode','text','text',r.reply_text),'{"x":0,"y":150}'),
      (e,r.organization_id,r.id,'end','{}','{"x":0,"y":300}');
    insert into public.automation_edges(organization_id,automation_id,source_node_id,target_node_id) values
      (r.organization_id,r.id,t,m),(r.organization_id,r.id,m,e);
    if r.active then perform private.snapshot_automation(r.organization_id,r.id); end if;
  end loop;
end $$;
revoke all on function private.migrate_instagram_comment_rules() from public,anon,authenticated;
select private.migrate_instagram_comment_rules();
update public.instagram_events e set automation_id=a.id,automation_version=a.current_version,
  automation_activated_at=a.activated_at
  from public.automations a where e.rule_id=a.id and a.current_version>0;

create function private.instagram_automation_click_valid(p_channel uuid,p_sender text,p_payload text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare signed jsonb; n jsonb; r public.automation_runs;
begin
  signed:=private.automation_verify_payload(p_payload);
  if signed is null then return false; end if;
  select run.* into r from public.automation_runs run join public.conversations c on c.id=run.conversation_id
    and c.organization_id=run.organization_id join public.contacts ct on ct.id=run.contact_id and ct.organization_id=run.organization_id
    where run.id=(signed->>'runId')::uuid and run.status='waiting' and run.waiting_for='reply' and run.input is null
      and run.wait_node_id=(signed->>'nodeId')::uuid and run.resume_at>now()
      and c.channel_id=p_channel and c.automation_run_id=run.id and ct.instagram_id=p_sender;
  if not found then return false; end if;
  n:=private.automation_graph_node(private.automation_run_graph(r),r.wait_node_id);
  return exists(select 1 from jsonb_array_elements(coalesce(n#>'{config,buttons}','[]')) o
      where o->>'kind'='path' and o->>'id'=signed->>'optionId')
    or exists(select 1 from jsonb_array_elements(coalesce(n#>'{config,quickReplies}','[]')) o
      where o->>'id'=signed->>'optionId');
end $$;

create or replace function public.ingest_instagram_event(p_connection_id uuid,p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ch public.channels; ev public.instagram_events; a public.automations;
  v_kind text:=p_event->>'kind'; v_external text:=p_event->>'externalId'; v_at timestamptz;
  v_message uuid; v_state text:='done'; v_context jsonb; signed jsonb;
begin
  select channels.* into ch from public.channels join public.meta_connections mc on mc.id=channels.meta_connection_id
    where mc.id=p_connection_id and mc.disconnected_at is null and channels.external_account_id=p_event->>'accountId'
      and channels.type='instagram' for share of channels,mc;
  if not found or ch.status<>'active' then return jsonb_build_object('state','ignored'); end if;
  if v_kind is null or v_kind not in ('message','button','comment','status','ignored') or coalesce(v_external,'')=''
    or length(v_external)>2048 then raise exception 'invalid event' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('instagram-event:'||ch.id||':'||v_kind||':'||v_external,0));
  select * into ev from public.instagram_events where channel_id=ch.id and kind=v_kind and external_id=v_external;
  if found then return jsonb_build_object('eventId',ev.id,'messageId',ev.message_id,'state',ev.state); end if;
  v_at:=least((p_event->>'occurredAt')::timestamptz,now());
  if v_at is null then raise exception 'missing timestamp' using errcode='22023'; end if;
  if v_kind in ('message','button') then
    v_context:=case when v_kind='button' then jsonb_build_object('origin','button','payload',p_event->>'payload')
      else coalesce(p_event->'context','{}'::jsonb) end;
    if (v_kind='button' or v_context ? 'payload') and not private.instagram_automation_click_valid(
      ch.id,p_event->>'senderExternalId',v_context->>'payload') then v_state:='ignored';
    else
      v_message:=public.ingest_inbound_message(ch.id,v_external,p_event->>'senderExternalId',p_event->>'senderName',
        case when v_kind='button' then p_event->>'title' else p_event->>'text' end,v_at,v_context);
      if v_context ? 'payload' then
        signed:=private.automation_verify_payload(v_context->>'payload');
        insert into public.events(organization_id,type,conversation_id,contact_id,actor_type,payload)
          select m.organization_id,'button_clicked',m.conversation_id,c.contact_id,'contact',signed
          from public.messages m join public.conversations c on c.id=m.conversation_id where m.id=v_message;
      end if;
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

create function private.instagram_comment_first_node(p_graph jsonb) returns jsonb
language sql immutable set search_path='' as $$
  with v as (
    select p_graph as graph
  ), t as (
    select n from v,jsonb_array_elements(graph->'nodes') n where n->>'type'='trigger'
  ), first_node as (
    select private.automation_graph_node(v.graph,private.automation_graph_target(v.graph,(t.n->>'id')::uuid,'default')) n
      from v,t where (select count(*) from t)=1
        and (select count(*) from jsonb_array_elements(v.graph->'edges') e where e->>'source'=t.n->>'id'
          and coalesce(e->>'sourceHandle','default')='default')=1
  ) select n from first_node where n->>'type'='message' and n#>>'{config,mode}'='text';
$$;
create function private.instagram_comment_node(p_event public.instagram_events) returns jsonb
language sql stable security definer set search_path='' as $$
  select private.instagram_comment_first_node(graph) from public.automation_versions
    where automation_id=p_event.automation_id and version=p_event.automation_version;
$$;

-- Mirrors renderTemplate for a null contact name, preserving line breaks and spacing elsewhere.
create function private.automation_render_null_name(p_text text) returns text
language plpgsql immutable set search_path='' as $$
declare rest text:=p_text; out_text text:=''; matches text[]; marker text; pos int; after_text text; next_text text;
begin
  loop
    matches:=regexp_match(rest,'\{(primeiro_nome|nome)\}');
    if matches is null then return out_text||rest; end if;
    marker:='{'||matches[1]||'}'; pos:=strpos(rest,marker);
    out_text:=out_text||left(rest,pos-1); after_text:=substr(rest,pos+length(marker));
    next_text:=ltrim(after_text,E' \t');
    if out_text='' or right(out_text,1)=E'\n' then after_text:=next_text;
    elsif next_text ~ '^[,.;:!?]' then
      out_text:=regexp_replace(regexp_replace(out_text,'[ \t]+$',''),',$',''); after_text:=next_text;
    elsif after_text=next_text and next_text<>'' and left(next_text,1)<>E'\n' and out_text ~ '[ \t]$' then null;
    else out_text:=regexp_replace(out_text,'[ \t]+$',''); end if;
    rest:=after_text;
  end loop;
end $$;

-- Null-name variable rendering and signed bodies for the first private message.
create function private.instagram_comment_body(p_run uuid,p_node jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare cfg jsonb:=p_node->'config'; txt text; opts jsonb; b jsonb; arr jsonb:='[]';
begin
  if cfg->>'mode' is distinct from 'text' then return null; end if;
  txt:=private.automation_render_null_name(cfg->>'text');
  opts:=private.automation_node_payloads(p_run,p_node);
  if jsonb_array_length(coalesce(cfg->'buttons','[]'))>0 then
    for b in select * from jsonb_array_elements(cfg->'buttons') loop
      arr:=arr||jsonb_build_array(case when b->>'kind'='url' then
        jsonb_build_object('type','web_url','url',b->>'url','title',b->>'title') else
        jsonb_build_object('type','postback','title',b->>'title','payload',opts->> (b->>'id')) end);
    end loop;
    return jsonb_build_object('attachment',jsonb_build_object('type','template','payload',
      jsonb_build_object('template_type','button','text',txt,'buttons',arr)));
  elsif jsonb_array_length(coalesce(cfg->'quickReplies','[]'))>0 then
    for b in select * from jsonb_array_elements(cfg->'quickReplies') loop
      arr:=arr||jsonb_build_array(jsonb_build_object('content_type','text','title',b->>'title','payload',opts->> (b->>'id')));
    end loop;
    return jsonb_build_object('text',txt,'quick_replies',arr);
  end if;
  return jsonb_build_object('text',txt);
end $$;

create or replace function public.prepare_instagram_comment_send(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ev public.instagram_events; ch public.channels; item public.instagram_send_intents; n jsonb; body jsonb; txt text;
begin
  select * into ev from public.instagram_events where id=p_event_id and kind='comment' for update;
  if not found or ev.state not in ('pending','uncertain') or ev.automation_id is null then return 'null'::jsonb; end if;
  select * into ch from public.channels where id=ev.channel_id;
  if ch.status<>'active' or ev.payload->>'senderExternalId'=ch.external_account_id then return 'null'::jsonb; end if;
  n:=private.instagram_comment_node(ev);
  if n is null then return 'null'::jsonb; end if;
  if ev.automation_run_id is null then
    update public.instagram_events set automation_run_id=gen_random_uuid() where id=ev.id returning * into ev;
  end if;
  body:=private.instagram_comment_body(ev.automation_run_id,n);
  txt:=coalesce(body->>'text',body#>>'{attachment,payload,text}');
  if txt is null or txt !~ '[^[:space:]]' or octet_length(txt)>1000 then return 'null'::jsonb; end if;
  insert into public.instagram_send_intents(organization_id,channel_id,event_id,kind,recipient_external_id,comment_id,text,message_payload)
    values(ev.organization_id,ch.id,ev.id,'private_reply',ev.payload->>'senderExternalId',ev.payload->>'commentId',txt,body)
    on conflict(event_id) do nothing;
  select * into item from public.instagram_send_intents where event_id=ev.id for update;
  if item.state='pending' and item.automation_run_id is null then
    update public.instagram_send_intents set text=txt,message_payload=body where id=item.id returning * into item;
  end if;
  if item.state='failed' and item.error_code='rate_limited' then
    update public.instagram_send_intents set state='pending',claim_token=null,claimed_at=null,error_code=null where id=item.id returning * into item;
  end if;
  if item.state='sending' and item.claimed_at<now()-interval '1 minute' then
    update public.instagram_send_intents set state='uncertain',error_code='expired_send_lease' where id=item.id returning * into item;
  end if;
  return jsonb_build_object('eventId',ev.id,'organizationId',ev.organization_id,'channelId',ch.id,'connectionId',ch.meta_connection_id,
    'intentId',item.id,'commentId',item.comment_id,'mediaId',ev.payload->>'mediaId','senderExternalId',ev.payload->>'senderExternalId',
    'ruleEffectiveAt',ev.automation_activated_at,'state',item.state);
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
    order by x.activated_at,x.id limit 1;
  if a.id is null then return 'null'::jsonb; end if;
  update public.instagram_events set automation_id=a.id,automation_version=a.current_version,automation_activated_at=a.activated_at
    where id=ev.id returning * into ev;
  body:=private.instagram_comment_body(ev.automation_run_id,private.instagram_comment_node(ev));
  update public.instagram_send_intents set text=coalesce(body->>'text',body#>>'{attachment,payload,text}'),message_payload=body
    where event_id=ev.id and state='pending';
  return public.prepare_instagram_comment_send(ev.id);
end $$;

create or replace function public.claim_instagram_send(p_intent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.instagram_send_intents; ch public.channels; ev public.instagram_events; n jsonb; eid uuid;
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
  if item.kind='direct' and not exists(select 1 from public.messages where conversation_id=item.conversation_id
    and direction='inbound' and created_at>now()-interval '24 hours') then raise exception 'messaging window closed' using errcode='22023'; end if;
  if item.kind='private_reply' then
    select * into ev from public.instagram_events where id=item.event_id;
    if ev.state is distinct from 'pending' or ev.automation_id is null then return 'null'::jsonb; end if;
    n:=private.instagram_comment_node(ev);
    if n is null then return 'null'::jsonb; end if;
    if item.automation_run_id is null then
      insert into public.events(organization_id,type,actor_type,payload) values(ev.organization_id,'automation_trigger','system',
        jsonb_build_object('automation_id',ev.automation_id,'instagram_event_id',ev.id)) returning id into eid;
      -- Non-runnable until HTTP confirms the reply. No contact/conversation exists yet.
      insert into public.automation_runs(id,organization_id,automation_id,trigger_event_id,status,current_node_id,version,step_count)
        values(ev.automation_run_id,ev.organization_id,ev.automation_id,eid,'waiting',(n->>'id')::uuid,ev.automation_version,1);
      insert into public.automation_run_steps(organization_id,run_id,node_id,status,output)
        values(ev.organization_id,ev.automation_run_id,(n->>'id')::uuid,'pending',jsonb_build_object('result','private_reply_pending'));
      update public.instagram_send_intents set automation_run_id=ev.automation_run_id where id=item.id;
    end if;
  end if;
  update public.instagram_send_intents set state='sending',claim_token=gen_random_uuid(),claimed_at=now() where id=item.id returning * into item;
  return jsonb_build_object('intentId',item.id,'channelId',ch.id,'connectionId',ch.meta_connection_id,'actorId',item.actor_id,
    'recipientExternalId',item.recipient_external_id,'commentId',item.comment_id,'kind',item.kind,'text',item.text,
    'messagePayload',item.message_payload,'claimToken',item.claim_token);
end $$;

-- Runs follow the delivery outcome, without ever enqueueing a duplicate first message.
create function public.link_instagram_comment_run() returns trigger
language plpgsql security definer set search_path='' as $$
declare ev public.instagram_events; n jsonb; conv public.conversations; item public.instagram_send_intents;
begin
  if new.kind<>'private_reply' or new.automation_run_id is null or new.state=old.state then return new; end if;
  if new.state='sent' then
    select * into ev from public.instagram_events where id=new.event_id;
    n:=private.instagram_comment_node(ev);
    select * into item from public.instagram_send_intents where id=new.id;
    select * into conv from public.conversations where id=item.conversation_id for update;
    update public.messages set context=context||jsonb_build_object('automation',jsonb_build_object(
      'runId',new.automation_run_id,'nodeId',n->>'id','buttons',coalesce(n#>'{config,buttons}','[]'),
      'quickReplies',coalesce(n#>'{config,quickReplies}','[]'))) where id=item.message_id;
    update public.automation_runs set conversation_id=conv.id,contact_id=conv.contact_id,waiting_for='reply',
      wait_node_id=current_node_id,resume_at=now()+make_interval(hours=>coalesce((n#>>'{config,replyTimeoutHours}')::int,24))
      where id=new.automation_run_id and status='waiting';
    update public.automation_run_steps set status='waiting',output=jsonb_build_object('result','sent','intentId',new.id)
      where run_id=new.automation_run_id and status='pending';
    if not private.automation_link_run(conv.id,new.automation_run_id) then
      perform private.automation_cancel_run(new.automation_run_id);
    end if;
  elsif new.state in ('failed','uncertain') then
    -- Rate limits can be retried by Phase 5; the run stays parked until success.
    if new.state='failed' and new.error_code='rate_limited' then return new; end if;
    update public.automation_runs set status='failed',resume_at=null,error=coalesce(new.error_code,'private_reply_failed')
      where id=new.automation_run_id and status='waiting';
    update public.automation_run_steps set status='failed',output=jsonb_build_object('result',new.state),
      error=coalesce(new.error_code,'private_reply_failed') where run_id=new.automation_run_id and status='pending';
  end if;
  return new;
end $$;
-- Runs after instagram_private_reply_history; its inner update supplies the new conversation.
create trigger zz_instagram_comment_run after update on public.instagram_send_intents
  for each row execute function public.link_instagram_comment_run();

-- Exhausted verification/rate retries terminate the parked run as well as its intent.
create function public.finish_instagram_comment_run() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.kind='comment' and new.state in ('failed','ignored') and old.state is distinct from new.state then
    update public.automation_runs set status=case when new.state='ignored' then 'cancelled'::public.run_status else 'failed'::public.run_status end,
      resume_at=null,error=coalesce(new.last_error,'comment_not_eligible')
      where id=new.automation_run_id and status='waiting' and conversation_id is null;
    update public.automation_run_steps set status=case when new.state='ignored' then 'cancelled'::public.run_status else 'failed'::public.run_status end,
      error=coalesce(new.last_error,'comment_not_eligible') where run_id=new.automation_run_id and status='pending';
  end if;
  return new;
end $$;
create trigger instagram_comment_run_terminal after update on public.instagram_events
  for each row execute function public.finish_instagram_comment_run();

create function public.cancel_instagram_automation_events() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.instagram_events set state='ignored',last_error='automation_deleted'
    where organization_id=old.organization_id and automation_id=old.id and state in ('pending','uncertain');
  update public.instagram_send_intents set state='failed',error_code='automation_deleted'
    where organization_id=old.organization_id and state='pending' and event_id in (
      select id from public.instagram_events where organization_id=old.organization_id and automation_id=old.id);
  return old;
end $$;
create trigger automations_instagram_deleted before delete on public.automations
  for each row execute function public.cancel_instagram_automation_events();

-- Button events share the Phase 5 name lookup and contact privacy lifecycle.
drop trigger instagram_profile_enqueue on public.instagram_events;
create trigger instagram_profile_enqueue after insert on public.instagram_events
  for each row when (new.kind in ('message','button') and new.message_id is not null)
  execute function public.enqueue_instagram_profile();
create or replace function public.prepare_instagram_profile(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
  select jsonb_build_object('eventId',e.id,'organizationId',e.organization_id,'channelId',ch.id,
      'connectionId',ch.meta_connection_id,'contactId',ct.id,'senderExternalId',ct.instagram_id) into v
    from public.instagram_events e join public.channels ch on ch.id=e.channel_id
    join public.messages m on m.id=e.message_id join public.conversations c on c.id=m.conversation_id
    join public.contacts ct on ct.id=c.contact_id
    where e.id=p_event_id and e.kind in ('message','button') and ch.status='active' and ct.name is null and ct.instagram_id is not null;
  return coalesce(v,'null'::jsonb);
end $$;
create or replace function public.save_instagram_contact_name(p_event_id uuid,p_name text) returns void
language plpgsql security definer set search_path='' as $$
declare v_name text:=left(btrim(regexp_replace(coalesce(p_name,''),'[[:cntrl:]]',' ','g')),120);
begin
  if v_name='' then return; end if;
  update public.contacts ct set name=v_name
    from public.instagram_events e join public.messages m on m.id=e.message_id join public.conversations c on c.id=m.conversation_id
    where e.id=p_event_id and e.kind in ('message','button') and ct.id=c.contact_id and ct.name is null;
end $$;
create or replace function public.purge_instagram_contact_data() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.instagram_events set payload=jsonb_build_object('purged',true),
      state=case when state='pending' then 'ignored' else state end,
      last_error=case when state='pending' then 'contact_deleted' else last_error end
    where organization_id=old.organization_id and kind in ('message','button','comment')
      and payload->>'senderExternalId'=old.instagram_id;
  update public.instagram_send_intents set state='failed',error_code='contact_deleted'
    where organization_id=old.organization_id and kind='private_reply' and state='pending'
      and recipient_external_id=old.instagram_id;
  return old;
end $$;
drop index public.instagram_events_sender_idx;
create index instagram_events_sender_idx on public.instagram_events(organization_id,(payload->>'senderExternalId'))
  where kind in ('message','button','comment');

revoke all on function private.instagram_comment_node(public.instagram_events),private.instagram_comment_body(uuid,jsonb),
  private.instagram_comment_first_node(jsonb),
  private.automation_render_null_name(text),private.instagram_automation_click_valid(uuid,text,text),
  public.link_instagram_comment_run(),public.finish_instagram_comment_run(),public.cancel_instagram_automation_events()
  from public,anon,authenticated;
revoke all on function public.ingest_instagram_event(uuid,jsonb),public.prepare_instagram_comment_send(uuid),
  public.reselect_instagram_comment_rule(uuid,timestamptz),public.claim_instagram_send(uuid) from public,anon,authenticated;
grant execute on function public.ingest_instagram_event(uuid,jsonb),public.prepare_instagram_comment_send(uuid),
  public.reselect_instagram_comment_rule(uuid,timestamptz),public.claim_instagram_send(uuid) to service_role;
