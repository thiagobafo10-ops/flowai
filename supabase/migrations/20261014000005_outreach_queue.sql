-- Fase 7B: reservation, atomic delivery, signed outreach clicks and cron dispatch.
-- Cross-system lock order: contact KEY SHARE -> conversation -> sequence SHARE ->
-- enrollment / campaign -> delivery. Never wait for a conversation while holding a delivery.
-- The caller already owns the expected conversation (or resolved none). This helper
-- never acquires a conversation, including when sweep holds earlier parent locks.
create function private.outreach_lock_parent_delivery(p_id uuid,p_expected_conv uuid) returns public.outreach_deliveries
language plpgsql security definer set search_path = '' as $$
declare d public.outreach_deliveries; v_sequence uuid;
begin
  select * into d from public.outreach_deliveries where id=p_id;
  if not found then return null; end if;
  if private.sequence_conversation(d.organization_id,d.contact_id,array[d.channel_id]) is distinct from p_expected_conv then return null; end if;
  if d.enrollment_id is not null then
    select sequence_id into v_sequence from public.sequence_enrollments where id=d.enrollment_id;
    perform 1 from public.sequences where id=v_sequence for share;
    perform 1 from public.sequence_enrollments where id=d.enrollment_id for update;
  elsif d.campaign_id is not null then
    perform 1 from public.campaigns where id=d.campaign_id for update;
  end if;
  select * into d from public.outreach_deliveries where id=p_id for update;
  -- Revalidate the optimistic resolution. A new/replaced conversation is retried by the sweep;
  -- do not acquire a second conversation lock after acquiring the parent/delivery locks.
  if d.id is not null and private.sequence_conversation(d.organization_id,d.contact_id,array[d.channel_id])
      is distinct from p_expected_conv then return null; end if;
  return d;
end $$;

create function private.outreach_lock_delivery(p_id uuid) returns public.outreach_deliveries
language plpgsql security definer set search_path = '' as $$
declare d public.outreach_deliveries; v_conv uuid;
begin
  select * into d from public.outreach_deliveries where id=p_id;
  if not found then return null; end if;
  perform 1 from public.contacts where id=d.contact_id and organization_id=d.organization_id for key share;
  v_conv:=private.sequence_conversation(d.organization_id,d.contact_id,array[d.channel_id]);
  perform 1 from public.conversations where id=v_conv and organization_id=d.organization_id for update;
  return private.outreach_lock_parent_delivery(p_id,v_conv);
end $$;

create function private.outreach_result(d public.outreach_deliveries) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('state',coalesce(d.status,'skip'),'intentIds',
    case when d.intent_id is null then '[]'::jsonb else jsonb_build_array(d.intent_id) end)
$$;

create function private.outreach_finish(p_id uuid,p_status text,p_reason text) returns public.outreach_deliveries
language plpgsql security definer set search_path = '' as $$
declare d public.outreach_deliveries;
begin
  update public.outreach_deliveries set status=p_status,reason=p_reason,claim_token=null,claimed_until=null
    where id=p_id returning * into d;
  if d.source='sequence' then perform private.sequence_schedule_next(d.enrollment_id);
  else perform private.campaign_maybe_complete(d.campaign_id); end if;
  return d;
end $$;

create function private.outreach_active(d public.outreach_deliveries) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_reason text;
begin
  if d.contact_id is null or not exists(select 1 from public.contacts where id=d.contact_id and organization_id=d.organization_id) then
    v_reason:='contact_deleted';
  elsif d.source='campaign' then
    if not exists(select 1 from public.campaigns where id=d.campaign_id and organization_id=d.organization_id and status='sending') then v_reason:='campaign_cancelled'; end if;
  elsif exists(select 1 from public.sequence_enrollments e join public.sequences s on s.id=e.sequence_id
      where e.id=d.enrollment_id and e.organization_id=d.organization_id and e.status='active' and s.status='paused') then
    -- Task5 excludes/reuses cancelled paused deliveries; preserve the unsent step.
    v_reason:='paused';
  elsif not exists(select 1 from public.sequence_enrollments e join public.sequences s on s.id=e.sequence_id
      where e.id=d.enrollment_id and e.organization_id=d.organization_id and e.status='active' and s.status='active') then
    v_reason:='sequence_inactive';
  elsif not exists(select 1 from public.sequence_steps s where s.id=d.step_id and s.organization_id=d.organization_id and s.removed_at is null and s.position is not null) then
    perform private.outreach_finish(d.id,'skipped','step_removed'); return false;
  end if;
  if v_reason is not null then perform private.outreach_finish(d.id,'cancelled',v_reason); return false; end if;
  return true;
end $$;

create function private.outreach_payload(p_delivery uuid,p_option text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_secret text; v_body text;
begin
  if p_delivery is null or p_option is null or p_option !~ '^[a-z0-9]{1,12}$' then raise exception 'invalid_payload' using errcode='22023'; end if;
  select s.decrypted_secret into v_secret from private.automation_secrets a join vault.decrypted_secrets s on s.id=a.payload_secret_id;
  if v_secret is null then raise exception 'payload_secret_missing' using errcode='P0002'; end if;
  v_body:=p_delivery::text||'.'||p_option;
  return 'fd1.'||v_body||'.'||left(encode(extensions.hmac(v_body,v_secret,'sha256'),'hex'),16);
end $$;

create function private.outreach_verify_payload(p_payload text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[];
begin
  if p_payload is null or p_payload !~ '^fd1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,12}\.[0-9a-f]{16}$' then return null; end if;
  v_parts:=string_to_array(p_payload,'.');
  if private.outreach_payload(v_parts[2]::uuid,v_parts[3]) is distinct from p_payload then return null; end if;
  return jsonb_build_object('deliveryId',v_parts[2],'optionId',v_parts[3]);
end $$;

create function private.outreach_message(d public.outreach_deliveries) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare msg jsonb; v_name text; v_text text; o jsonb; v_payloads jsonb:='{}'; v_buttons jsonb:='[]'; v_replies jsonb:='[]';
begin
  if d.source='campaign' then select message into msg from public.campaigns where id=d.campaign_id and organization_id=d.organization_id;
  else select message into msg from public.sequence_steps where id=d.step_id and organization_id=d.organization_id; end if;
  select btrim(coalesce(name,'')) into v_name from public.contacts where id=d.contact_id and organization_id=d.organization_id;
  v_text:=replace(replace(msg->>'text','{primeiro_nome}',split_part(coalesce(v_name,''),' ',1)),'{nome}',coalesce(v_name,''));
  for o in select value from jsonb_array_elements(case when jsonb_typeof(msg->'buttons')='array' then msg->'buttons' else '[]'::jsonb end) loop
    if o->>'kind'='automation' then v_payloads:=v_payloads||jsonb_build_object(o->>'id',private.outreach_payload(d.id,o->>'id')); o:=o||jsonb_build_object('payload',v_payloads->>(o->>'id')); end if;
    v_buttons:=v_buttons||jsonb_build_array(o);
  end loop;
  for o in select value from jsonb_array_elements(case when jsonb_typeof(msg->'quickReplies')='array' then msg->'quickReplies' else '[]'::jsonb end) loop
    v_payloads:=v_payloads||jsonb_build_object(o->>'id',private.outreach_payload(d.id,o->>'id'));
    v_replies:=v_replies||jsonb_build_array(o||jsonb_build_object('payload',v_payloads->>(o->>'id')));
  end loop;
  return jsonb_build_object('text',v_text,'buttons',v_buttons,'quickReplies',v_replies,'payloads',v_payloads);
end $$;

-- Same provider body as core.toInstagramMessage. Comparing the whole body prevents
-- a stale or faulty worker from changing a URL, option title or signed payload.
create function private.outreach_instagram_body(p_message jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare o jsonb; v_options jsonb:='[]';
begin
  if jsonb_array_length(p_message->'buttons')>0 then
    for o in select value from jsonb_array_elements(p_message->'buttons') loop
      v_options:=v_options||jsonb_build_array(case when o->>'kind'='url' then jsonb_build_object('type','web_url','url',o->>'url','title',o->>'title')
        else jsonb_build_object('type','postback','title',o->>'title','payload',o->>'payload') end);
    end loop;
    return jsonb_build_object('attachment',jsonb_build_object('type','template','payload',jsonb_build_object('template_type','button','text',p_message->>'text','buttons',v_options)));
  elsif jsonb_array_length(p_message->'quickReplies')>0 then
    for o in select value from jsonb_array_elements(p_message->'quickReplies') loop
      v_options:=v_options||jsonb_build_array(jsonb_build_object('content_type','text','title',o->>'title','payload',o->>'payload'));
    end loop;
    return jsonb_build_object('text',p_message->>'text','quick_replies',v_options);
  end if;
  return jsonb_build_object('text',p_message->>'text');
end $$;

create function public.claim_outreach_deliveries(p_limit int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  with picked as (
    select id from public.outreach_deliveries where status='pending' and run_after<=now()
    order by run_after,id limit least(greatest(coalesce(p_limit,1),1),50) for update skip locked
  ), claimed as (
    update public.outreach_deliveries d set status='sending',claim_token=gen_random_uuid(),claimed_until=now()+interval '3 minutes',attempts=attempts+1
    from picked where d.id=picked.id returning d.id,d.claim_token,d.run_after
  ) select coalesce(jsonb_agg(jsonb_build_object('deliveryId',id,'claimToken',claim_token) order by run_after,id),'[]') into v_result from claimed;
  return v_result;
end $$;

create function public.prepare_outreach_delivery(p_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.outreach_deliveries; msg jsonb; v_type text; v_name text; v_conv uuid;
begin
  if p_token is null then return '{"action":"skip"}'; end if;
  d:=private.outreach_lock_delivery(p_id);
  if d.id is null or d.status<>'sending' or d.claim_token is distinct from p_token or d.claimed_until<=clock_timestamp() then return '{"action":"skip"}'; end if;
  if not private.outreach_active(d) then return '{"action":"skip"}'; end if;
  v_conv:=private.sequence_conversation(d.organization_id,d.contact_id,array[d.channel_id]);
  select type::text into v_type from public.channels where id=d.channel_id and organization_id=d.organization_id;
  select name into v_name from public.contacts where id=d.contact_id and organization_id=d.organization_id;
  msg:=private.outreach_message(d);
  return jsonb_build_object('action','send','deliveryId',d.id,'organizationId',d.organization_id,'channelType',v_type,
    'conversationId',v_conv,'contact',jsonb_build_object('name',v_name),'message',msg-'payloads','payloads',msg->'payloads');
end $$;

create function public.complete_outreach_delivery(p_id uuid,p_token uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.outreach_deliveries; conv public.conversations; msg jsonb; v_type text; v_block text;
  v_send text; v_intent uuid; v_message uuid;
begin
  d:=private.outreach_lock_delivery(p_id);
  if d.id is null or p_token is null or d.claim_token is distinct from p_token or d.status<>'sending' or d.claimed_until<=clock_timestamp() then return private.outreach_result(d); end if;
  if not private.outreach_active(d) then select * into d from public.outreach_deliveries where id=p_id; return private.outreach_result(d); end if;
  select * into conv from public.conversations where id=private.sequence_conversation(d.organization_id,d.contact_id,array[d.channel_id]) and organization_id=d.organization_id;
  if conv.id is null then return private.outreach_result(private.outreach_finish(d.id,'skipped','no_conversation')); end if;
  if private.automation_conversation_busy(d.organization_id,conv.id,null) or private.automation_human_handled(conv) then
    if d.postponements>=6 then return private.outreach_result(private.outreach_finish(d.id,'skipped','conversation_busy')); end if;
    update public.outreach_deliveries set status='pending',postponements=postponements+1,attempts=greatest(attempts-1,0),
      run_after=now()+interval '10 minutes',reason=null,claim_token=null,claimed_until=null,conversation_id=conv.id where id=d.id returning * into d;
    return private.outreach_result(d);
  end if;
  msg:=private.outreach_message(d);
  v_block:=private.automation_send_blocker(conv,msg->>'text');
  select type::text into v_type from public.channels where id=d.channel_id;
  if v_type='instagram' and jsonb_array_length(msg->'buttons')>0 and char_length(msg->>'text')>640 then v_block:='reply_too_long'; end if;
  if v_block is not null then return private.outreach_result(private.outreach_finish(d.id,'skipped',v_block)); end if;
  -- The worker only supplies the provider body; all text/options/context come from the database.
  if v_type='instagram' and p_result->'instagram' is distinct from private.outreach_instagram_body(msg) then
    raise exception 'invalid_instagram_payload' using errcode='22023';
  end if;
  select result,intent_id into v_send,v_intent from private.automation_deliver(null,conv,d.id,msg->>'text',msg->'buttons',msg->'quickReplies',p_result->'instagram',null);
  select id into v_message from public.messages where conversation_id=conv.id and organization_id=d.organization_id
    and context#>>'{automation,nodeId}'=d.id::text order by created_at desc,id desc limit 1;
  update public.messages set context=(context-'automation')||jsonb_build_object('outreach',jsonb_build_object('deliveryId',d.id,'buttons',msg->'buttons','quickReplies',msg->'quickReplies')) where id=v_message;
  update public.outreach_deliveries set message_id=v_message,intent_id=v_intent,conversation_id=conv.id where id=d.id;
  return private.outreach_result(private.outreach_finish(d.id,'sent',null));
end $$;

create function public.fail_outreach_delivery(p_id uuid,p_token uuid,p_code text,p_retryable boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.outreach_deliveries;
begin
  if p_code is null or p_code !~ '^[a-z0-9_]{1,64}$' then raise exception 'invalid_error_code' using errcode='22023'; end if;
  d:=private.outreach_lock_delivery(p_id);
  if d.id is null or p_token is null or d.status<>'sending' or d.claim_token is distinct from p_token or d.claimed_until<=clock_timestamp() then return; end if;
  if not private.outreach_active(d) then return; end if;
  if p_retryable and d.attempts<3 then
    update public.outreach_deliveries set status='pending',reason=p_code,run_after=now()+case when attempts=1 then interval '10 seconds' else interval '30 seconds' end,
      claim_token=null,claimed_until=null where id=d.id;
  else perform private.outreach_finish(d.id,'failed',p_code); end if;
end $$;

create function public.sweep_outreach_deliveries() returns void
language plpgsql security definer set search_path = '' as $$
declare r record; d public.outreach_deliveries; v_batch jsonb;
begin
  -- All conversation waits happen before any enrollment/campaign/delivery is locked.
  -- Inbound on a later conversation can therefore still opt out an earlier enrollment.
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'contactId',x.contact_id,'conversationId',
    private.sequence_conversation(x.organization_id,x.contact_id,array[x.channel_id])) order by x.id),'[]') into v_batch
    from (select id,organization_id,contact_id,channel_id from public.outreach_deliveries
      where status='sending' and claimed_until<=clock_timestamp() order by id limit 100) x;
  perform 1 from public.contacts c where c.id in(select (x->>'contactId')::uuid from jsonb_array_elements(v_batch) x)
    order by c.id for key share;
  perform 1 from public.conversations c where c.id in(select (x->>'conversationId')::uuid from jsonb_array_elements(v_batch) x)
    order by c.id for update;
  for r in select (x->>'id')::uuid id,(x->>'conversationId')::uuid conversation_id from jsonb_array_elements(v_batch) x loop
    d:=private.outreach_lock_parent_delivery(r.id,r.conversation_id);
    if d.id is null or d.status<>'sending' or d.claimed_until>clock_timestamp() then continue; end if;
    if not private.outreach_active(d) then continue; end if;
    if d.attempts>=3 then perform private.outreach_finish(d.id,'failed','reservation_expired');
    else update public.outreach_deliveries set status='pending',reason='reservation_expired',
      run_after=now()+case when attempts=1 then interval '10 seconds' else interval '30 seconds' end,
      claim_token=null,claimed_until=null where id=d.id; end if;
  end loop;
end $$;

create or replace function public.dispatch_automation_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare config private.automation_worker_config; service_key text; worker_secret text;
begin
  perform public.sweep_automation_runs();
  perform public.sweep_outreach_deliveries();
  perform private.start_due_campaigns();
  select * into config from private.automation_worker_config;
  if not found then return; end if;
  if not exists(select 1 from public.automation_runs where
    (status='pending' and coalesce(resume_at,'-infinity'::timestamptz)<=clock_timestamp()) or (status='waiting' and resume_at<=clock_timestamp()))
    and not exists(select 1 from public.outreach_deliveries where status='pending' and run_after<=clock_timestamp()) then return; end if;
  select decrypted_secret into service_key from vault.decrypted_secrets where id=config.service_key_secret_id;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where id=config.worker_secret_id;
  perform net.http_post(url:=config.base_url||'/functions/v1/automation-worker',body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||service_key,'apikey',service_key,'X-FlowAI-Worker',worker_secret),timeout_milliseconds:=150000);
end $$;

revoke all on function private.outreach_lock_delivery(uuid),private.outreach_lock_parent_delivery(uuid,uuid),private.outreach_result(public.outreach_deliveries),
  private.outreach_finish(uuid,text,text),private.outreach_active(public.outreach_deliveries),private.outreach_payload(uuid,text),
  private.outreach_verify_payload(text),private.outreach_message(public.outreach_deliveries),private.outreach_instagram_body(jsonb)
  from public,anon,authenticated;
revoke all on function public.claim_outreach_deliveries(int),public.prepare_outreach_delivery(uuid,uuid),
  public.complete_outreach_delivery(uuid,uuid,jsonb),public.fail_outreach_delivery(uuid,uuid,text,boolean),public.sweep_outreach_deliveries()
  from public,anon,authenticated;
grant execute on function public.claim_outreach_deliveries(int),public.prepare_outreach_delivery(uuid,uuid),
  public.complete_outreach_delivery(uuid,uuid,jsonb),public.fail_outreach_delivery(uuid,uuid,text,boolean),public.sweep_outreach_deliveries()
  to service_role;

-- fd1 is a separate namespace; fa1 keeps its latest 7A validation and resume semantics.
create function private.outreach_click_kind(p_org uuid,p_contact uuid,p_conv uuid,p_payload text) returns text
language plpgsql security definer set search_path = '' as $$
declare signed jsonb:=private.outreach_verify_payload(p_payload); d public.outreach_deliveries; o jsonb;
begin
  if signed is null or p_contact is null then return 'forged'; end if;
  select * into d from public.outreach_deliveries where id=(signed->>'deliveryId')::uuid and organization_id=p_org and contact_id=p_contact;
  if not found then return 'forged'; end if;
  if d.status<>'sent' or not exists(select 1 from public.conversations where id=p_conv and organization_id=p_org and contact_id=p_contact and channel_id=d.channel_id) then return 'stale'; end if;
  if d.source='sequence' and not exists(select 1 from public.sequence_steps where id=d.step_id and removed_at is null and position is not null) then return 'stale'; end if;
  select opt into o from public.messages m,
    lateral jsonb_array_elements(coalesce(m.context#>'{outreach,buttons}','[]')||coalesce(m.context#>'{outreach,quickReplies}','[]')) opt
    where m.id=d.message_id and m.organization_id=p_org and opt->>'id'=signed->>'optionId'
      and (opt->>'kind'='automation' or opt->>'kind' is null) limit 1;
  if o is null or not exists(select 1 from public.automations where id=(o->>'automationId')::uuid and organization_id=p_org and status='active') then return 'stale'; end if;
  if d.source='sequence' and not exists(select 1 from public.sequence_steps s,
      lateral jsonb_array_elements(case when jsonb_typeof(s.message->'buttons')='array' then s.message->'buttons' else '[]'::jsonb end
        ||case when jsonb_typeof(s.message->'quickReplies')='array' then s.message->'quickReplies' else '[]'::jsonb end) current_option
      where s.id=d.step_id and s.organization_id=p_org and current_option->>'id'=signed->>'optionId'
        and current_option->>'automationId'=o->>'automationId') then return 'stale'; end if;
  return 'valid';
end $$;

create or replace function private.automation_click_kind(p_org uuid,p_contact uuid,p_conv uuid,p_payload text) returns text
language plpgsql security definer set search_path = '' as $$
declare signed jsonb;
begin
  if left(p_payload,4)='fd1.' then return private.outreach_click_kind(p_org,p_contact,p_conv,p_payload); end if;
  signed:=private.automation_verify_payload(p_payload);
  if signed is null or p_contact is null then return 'forged'; end if;
  if not exists(select 1 from public.automation_runs r where r.id=(signed->>'runId')::uuid and r.organization_id=p_org and r.contact_id=p_contact) then return 'forged'; end if;
  if private.automation_signed_reply(p_org,p_conv,p_payload) is not null then return 'valid'; end if;
  return 'stale';
end $$;

create function private.outreach_inbound() returns trigger
language plpgsql security definer set search_path = '' as $$
declare conv public.conversations; d public.outreach_deliveries; signed jsonb; o jsonb; auto public.automations; v_event uuid; v_run uuid;
begin
  select * into conv from public.conversations where id=new.conversation_id and organization_id=new.organization_id for update;
  if conv.id is null or private.outreach_click_kind(conv.organization_id,conv.contact_id,conv.id,new.context->>'payload')<>'valid' then return null; end if;
  signed:=private.outreach_verify_payload(new.context->>'payload');
  select * into d from public.outreach_deliveries where id=(signed->>'deliveryId')::uuid and organization_id=conv.organization_id;
  insert into public.events(organization_id,type,conversation_id,contact_id,actor_type,payload)
    values(conv.organization_id,'outreach_click',conv.id,conv.contact_id,'contact',signed) returning id into v_event;
  if private.automation_conversation_busy(conv.organization_id,conv.id,null) or private.automation_human_handled(conv) then return null; end if;
  select opt into o from public.messages m,
    lateral jsonb_array_elements(coalesce(m.context#>'{outreach,buttons}','[]')||coalesce(m.context#>'{outreach,quickReplies}','[]')) opt
    where m.id=d.message_id and m.organization_id=conv.organization_id and opt->>'id'=signed->>'optionId' limit 1;
  select * into auto from public.automations where id=(o->>'automationId')::uuid and organization_id=conv.organization_id and status='active' for share;
  if auto.id is null then return null; end if;
  v_run:=private.automation_start_run(auto,v_event,conv.id,conv.contact_id);
  if v_run is not null then perform private.automation_link_run(conv.id,v_run); end if;
  return null;
end $$;
create trigger a0_outreach_inbound after insert on public.messages
  for each row when(new.direction='inbound' and new.sender_type='contact' and not new.is_internal_note and left(new.context->>'payload',4)='fd1.')
  execute function private.outreach_inbound();
revoke all on function private.outreach_click_kind(uuid,uuid,uuid,text),private.outreach_inbound() from public,anon,authenticated;
create or replace function public.click_automation_button(p_message_id uuid, p_option_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
  v_type public.channel_type;
  v_status public.channel_status;
  v_auto jsonb;
  v_title text;
  v_run uuid;
  v_node uuid;
  k public.contacts;
  v_msg uuid;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  select * into m from public.messages where id = p_message_id;
  if not found or not public.has_role(m.organization_id, 'agent') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select ch.type, ch.status into v_type, v_status from public.channels ch where ch.id = m.channel_id;
  if v_type is distinct from 'simulator' then
    raise exception 'not_simulator' using errcode = '22023';
  end if;

  -- Outreach uses the sent message's immutable options and contact-scoped fd1 ingress.
  if jsonb_typeof(m.context->'outreach')='object' then
    v_auto:=m.context->'outreach';
    if m.sender_type<>'automation' or m.direction<>'outbound' or v_status<>'active'
      or coalesce(p_option_id,'') !~ '^[a-z0-9]{1,12}$' then raise exception 'unknown_option' using errcode='22023'; end if;
    select o->>'title' into v_title from (
      select x o from jsonb_array_elements(coalesce(v_auto->'buttons','[]')) x where x->>'kind'='automation'
      union all select x from jsonb_array_elements(coalesce(v_auto->'quickReplies','[]')) x
    ) opts where o->>'id'=p_option_id limit 1;
    if v_title is null or coalesce(v_auto->>'deliveryId','') !~ v_uuid or not exists(
      select 1 from public.outreach_deliveries d where d.id=(v_auto->>'deliveryId')::uuid and d.organization_id=m.organization_id
        and d.message_id=m.id and d.conversation_id=m.conversation_id and d.status='sent') then
      raise exception 'unknown_option' using errcode='22023';
    end if;
    select k2.* into k from public.conversations c join public.contacts k2 on k2.id=c.contact_id and k2.organization_id=c.organization_id where c.id=m.conversation_id;
    if k.id is null then raise exception 'not_waiting' using errcode='22023'; end if;
    v_msg:=private.ingest_inbound_core(m.organization_id,m.channel_id,v_type,'click:'||gen_random_uuid()::text,
      coalesce(nullif(btrim(k.phone),''),'contact:'||k.id::text),k.name,v_title,now(),
      jsonb_build_object('origin','button','payload',private.outreach_payload((v_auto->>'deliveryId')::uuid,p_option_id)),k.id);
    if v_msg is null then raise exception 'not_waiting' using errcode='22023'; end if;
    return v_msg;
  end if;

  -- só botões 'path' e respostas rápidas esperam clique (botões de link abrem a URL)
  v_auto := m.context -> 'automation';
  if m.sender_type <> 'automation' or jsonb_typeof(v_auto) is distinct from 'object'
     or coalesce(p_option_id, '') !~ '^[a-z0-9]{1,12}$' then
    raise exception 'unknown_option' using errcode = '22023';
  end if;
  select o ->> 'title' into v_title from (
    select x as o from jsonb_array_elements(case when jsonb_typeof(v_auto -> 'buttons') = 'array'
      then v_auto -> 'buttons' else '[]'::jsonb end) x where x ->> 'kind' = 'path'
    union all
    select x from jsonb_array_elements(case when jsonb_typeof(v_auto -> 'quickReplies') = 'array'
      then v_auto -> 'quickReplies' else '[]'::jsonb end) x
  ) opts where o ->> 'id' = p_option_id limit 1;
  if v_title is null or v_title !~ '[^[:space:]]' or char_length(v_title) > 4096 then
    raise exception 'unknown_option' using errcode = '22023';
  end if;

  -- ids malformados no context: tratados como botão expirado (nunca 22P02)
  if coalesce(v_auto ->> 'runId', '') !~ v_uuid or coalesce(v_auto ->> 'nodeId', '') !~ v_uuid then
    raise exception 'not_waiting' using errcode = '22023';
  end if;
  v_run := (v_auto ->> 'runId')::uuid;
  v_node := (v_auto ->> 'nodeId')::uuid;

  -- a execução precisa ainda aguardar resposta neste nó (verificação rápida; o núcleo confere sob as travas)
  if v_status is distinct from 'active' or not exists (select 1 from public.automation_runs r
      where r.id = v_run and r.organization_id = m.organization_id
        and r.conversation_id = m.conversation_id and r.status = 'waiting' and r.waiting_for = 'reply'
        and r.input is null and r.wait_node_id = v_node) then
    raise exception 'not_waiting' using errcode = '22023';
  end if;

  select k2.* into k from public.conversations c
    join public.contacts k2 on k2.id = c.contact_id and k2.organization_id = c.organization_id
    where c.id = m.conversation_id;
  if k.id is null then
    raise exception 'not_waiting' using errcode = '22023';
  end if;

  -- remetente: o telefone do contato (como no Simulador) ou, sem telefone, o id do contato; só serializa
  v_msg := private.ingest_inbound_core(m.organization_id, m.channel_id, v_type, 'click:' || gen_random_uuid()::text,
    coalesce(nullif(btrim(k.phone), ''), 'contact:' || k.id::text), k.name, v_title, now(),
    jsonb_build_object('origin', 'button', 'payload', private.automation_payload(v_run, v_node, p_option_id)), k.id);
  -- descartado, ou vencido sob as travas (o núcleo o gravou como texto): desfaz tudo
  if v_msg is null or not exists (select 1 from public.messages x where x.id = v_msg and x.context ? 'payload') then
    raise exception 'not_waiting' using errcode = '22023';
  end if;

  insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, payload)
    select c.organization_id, 'button_clicked', c.id, c.contact_id, 'contact',
      jsonb_build_object('runId', v_run, 'nodeId', v_node, 'optionId', p_option_id)
    from public.messages x join public.conversations c on c.id = x.conversation_id where x.id = v_msg;
  return v_msg;
end $$;
create or replace function private.ingest_inbound_core(
  p_org uuid,
  p_channel uuid,
  p_type public.channel_type,
  p_external_id text,
  p_sender_external_id text,
  p_sender_name text,
  p_text text,
  p_at timestamptz,
  p_context jsonb,
  p_contact uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg uuid;
  v_contact uuid;
  v_conv uuid;
  conv public.conversations;
  v_name text := nullif(btrim(coalesce(p_sender_name, '')), '');
  -- Only a verified fd1 payload can set the sequence reply exemption.
  v_context jsonb := coalesce(p_context, '{}'::jsonb) - 'outreachClick';
  v_click text;
begin
  -- serializa duplicatas e primeiras mensagens simultaneas do mesmo remetente
  perform pg_advisory_xact_lock(hashtextextended('ingest:msg:' || p_channel::text || ':' || p_external_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('ingest:sender:' || p_org::text || ':' || p_type::text || ':' || p_sender_external_id, 0));

  -- duplicada: sem nenhum efeito
  select id into v_msg from public.messages
  where channel_id = p_channel and external_id = p_external_id;
  if v_msg is not null then
    return v_msg;
  end if;

  -- 4. contato (busca)
  if p_contact is not null then
    select id into v_contact from public.contacts where id = p_contact and organization_id = p_org;
    if v_contact is null then return null; end if;
  else
    v_contact := private.inbound_find_contact(p_org, p_type, p_sender_external_id);
  end if;
  -- Clique assinado: adulterado / de outra organização ou contato é descartado (nunca cria contato nem conversa).
  -- Autêntico mas vencido entra como texto comum, sem payload e marcado (não retoma a espera atual).
  -- A serialização do remetente foi feita acima, antes das travas de conversa → execução.
  if v_context ? 'payload' then
    if v_contact is not null then
      select id into v_conv from public.conversations
        where organization_id = p_org and contact_id = v_contact and channel_id = p_channel
        order by created_at desc, id desc limit 1;
    end if;
    v_click := private.automation_click_kind(p_org, v_contact, v_conv, v_context ->> 'payload');
    if v_click = 'forged' then return null; end if;
    if left(v_context->>'payload',4)='fd1.' then v_context:=v_context||'{"outreachClick":true}'::jsonb; end if;
    if v_click = 'stale' then v_context := (v_context - 'payload') || '{"staleClick":true}'::jsonb; end if;
  end if;

  -- 4–5. contato (criação) e conversa (a mais recente do contato no canal)
  conv := private.inbound_conversation(p_org, p_channel, p_type, p_sender_external_id, v_name, p_at, v_contact);
  v_contact := conv.contact_id;
  v_conv := conv.id;

  -- 6. mensagem (created_at = p_at; o gatilho move last_message_at para frente). O context vai
  -- na inserção para que os gatilhos AFTER INSERT (automações) o enxerguem.
  insert into public.messages (organization_id, conversation_id, channel_id, direction,
    sender_type, content, status, external_id, created_at, context)
  values (p_org, v_conv, p_channel, 'inbound', 'contact', p_text, 'delivered', p_external_id, p_at, v_context)
  on conflict (channel_id, external_id) do nothing
  returning id into v_msg;
  if v_msg is null then
    select id into v_msg from public.messages
    where channel_id = p_channel and external_id = p_external_id;
    return v_msg;
  end if;

  -- 7. interacao do contato (apenas para frente)
  update public.contacts
  set last_interaction_at = greatest(coalesce(last_interaction_at, p_at), p_at),
      name = coalesce(name, v_name),
      whatsapp_id = case when p_type = 'whatsapp' then coalesce(whatsapp_id, p_sender_external_id) else whatsapp_id end
  where id = v_contact;

  return v_msg;
end $$;


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


create or replace function private.sequence_exit_inbound() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_contact uuid;
  r record;
begin
  select contact_id into v_contact from public.conversations
    where id = new.conversation_id and organization_id = new.organization_id;
  if v_contact is null then return null; end if;
  for r in
    select e.id, s.name, s.settings from public.sequence_enrollments e join public.sequences s on s.id = e.sequence_id
      where e.organization_id = new.organization_id and e.contact_id = v_contact and e.status = 'active'
        and (e.channel_id = new.channel_id or coalesce(s.settings -> 'channelIds' ? new.channel_id::text, false))
      order by e.created_at, e.id
      for update of e
  loop
    if private.is_exit_word(new.content,
        case when r.settings ? 'exitWords' then r.settings -> 'exitWords' else '["sair","parar","cancelar"]'::jsonb end) then
      perform private.sequence_end_enrollment(r.id, 'exited', 'exit_word');
      insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status,
          created_at)
        values (new.organization_id, new.conversation_id, new.channel_id, 'outbound', 'system',
          'Saiu da sequência ' || r.name, 'delivered', greatest(now(), new.created_at + interval '1 millisecond'));
    elsif r.settings -> 'exitOnReply' = 'true'::jsonb and coalesce(new.context->>'outreachClick','false')<>'true'
      and left(coalesce(new.context->>'payload',''),4)<>'fd1.' then
      perform private.sequence_end_enrollment(r.id, 'exited', 'replied');
    end if;
  end loop;
  return null;
end $$;
