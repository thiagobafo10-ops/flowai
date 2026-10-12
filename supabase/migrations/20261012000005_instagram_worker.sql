alter table public.instagram_send_intents drop constraint instagram_send_intents_event_id_fkey;
alter table public.instagram_send_intents add constraint instagram_send_intents_event_id_fkey
  foreign key(event_id) references public.instagram_events(id) on delete set null;
grant select(id,organization_id,channel_id,rule_id,state,last_error,created_at) on public.instagram_events to authenticated;
create policy instagram_events_admin_select on public.instagram_events for select to authenticated using(public.has_role(organization_id,'admin'));

create function public.prepare_instagram_comment_send(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ev public.instagram_events; rule public.instagram_comment_rules; ch public.channels; item public.instagram_send_intents;
begin
  select * into ev from public.instagram_events where id=p_event_id and kind='comment' for update;
  if not found or ev.state not in ('pending','uncertain') then return 'null'::jsonb; end if;
  select * into rule from public.instagram_comment_rules where id=ev.rule_id;
  select * into ch from public.channels where id=ev.channel_id;
  if not coalesce(rule.active,false) or rule.version is distinct from ev.rule_version or ch.status<>'active'
    or ev.payload->>'senderExternalId'=ch.external_account_id then return 'null'::jsonb; end if;
  insert into public.instagram_send_intents(organization_id,channel_id,event_id,kind,recipient_external_id,comment_id,text)
    values(ev.organization_id,ch.id,ev.id,'private_reply',ev.payload->>'senderExternalId',ev.payload->>'commentId',rule.reply_text)
    on conflict(event_id) do nothing;
  select * into item from public.instagram_send_intents where event_id=ev.id for update;
  if item.state='failed' and item.error_code='rate_limited' then
    update public.instagram_send_intents set state='pending',claim_token=null,claimed_at=null,error_code=null where id=item.id returning * into item;
  end if;
  if item.state='sending' and item.claimed_at<now()-interval '1 minute' then
    update public.instagram_send_intents set state='uncertain',error_code='expired_send_lease' where id=item.id returning * into item;
  end if;
  return jsonb_build_object('eventId',ev.id,'organizationId',ev.organization_id,'channelId',ch.id,'connectionId',ch.meta_connection_id,
    'intentId',item.id,'commentId',item.comment_id,'mediaId',ev.payload->>'mediaId','senderExternalId',ev.payload->>'senderExternalId',
    'ruleEffectiveAt',rule.updated_at,'state',item.state);
end $$;

create or replace function public.claim_instagram_send(p_intent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.instagram_send_intents; ch public.channels;
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
  if item.kind='private_reply' and not exists(select 1 from public.instagram_events e join public.instagram_comment_rules r on r.id=e.rule_id
    where e.id=item.event_id and e.state='pending' and r.active and r.version=e.rule_version) then return 'null'::jsonb; end if;
  update public.instagram_send_intents set state='sending',claim_token=gen_random_uuid(),claimed_at=now() where id=item.id returning * into item;
  return jsonb_build_object('intentId',item.id,'channelId',ch.id,'connectionId',ch.meta_connection_id,'actorId',item.actor_id,
    'recipientExternalId',item.recipient_external_id,'commentId',item.comment_id,'kind',item.kind,'text',item.text,'claimToken',item.claim_token);
end $$;

create function public.record_instagram_private_reply() returns trigger
language plpgsql security definer set search_path='' as $$
declare contact uuid; conv uuid; msg uuid; ev public.instagram_events; receipt boolean;
begin
  if new.kind<>'private_reply' or new.state<>'sent' or old.state='sent' then return new; end if;
  select * into ev from public.instagram_events where id=new.event_id;
  perform pg_advisory_xact_lock(hashtextextended('ingest:sender:'||new.organization_id||':instagram:'||new.recipient_external_id,0));
  select id into contact from public.contacts where organization_id=new.organization_id and instagram_id=new.recipient_external_id;
  if contact is null then
    insert into public.contacts(organization_id,instagram_id,name,source) values(new.organization_id,new.recipient_external_id,ev.payload->>'senderName','instagram') returning id into contact;
  end if;
  select id into conv from public.conversations where organization_id=new.organization_id and channel_id=new.channel_id and contact_id=contact order by created_at desc,id desc limit 1 for update;
  if conv is null then insert into public.conversations(organization_id,channel_id,contact_id,status,handled_by) values(new.organization_id,new.channel_id,contact,'open','human') returning id into conv;
  else update public.conversations set status='open',closed_at=null where id=conv and status='closed'; end if;
  select exists(select 1 from public.instagram_events where channel_id=new.channel_id and kind='status' and payload->>'messageExternalId'=new.external_id) into receipt;
  insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,status,external_id,context)
    values(new.organization_id,conv,new.channel_id,'outbound','automation',new.text,case when receipt then 'read'::public.message_status else 'sent'::public.message_status end,new.external_id,jsonb_build_object('origin','comment','commentId',new.comment_id)) returning id into msg;
  update public.instagram_send_intents set conversation_id=conv,message_id=msg where id=new.id;
  return new;
end $$;
revoke all on function public.record_instagram_private_reply() from public,anon,authenticated;
create trigger instagram_private_reply_history after update on public.instagram_send_intents for each row execute function public.record_instagram_private_reply();

create or replace function public.complete_instagram_send(p_intent_id uuid,p_result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare item public.instagram_send_intents; v_state text:=p_result->>'state'; v_status public.message_status;
begin
  select * into item from public.instagram_send_intents where id=p_intent_id for update;
  if not found or item.state<>'sending' or item.claim_token is distinct from (p_result->>'claimToken')::uuid then raise exception 'invalid claim' using errcode='40001'; end if;
  if v_state is null or v_state not in ('sent','failed','uncertain') then raise exception 'invalid result' using errcode='22023'; end if;
  if v_state='sent' and coalesce(p_result->>'externalId','')='' then raise exception 'missing external id' using errcode='22023'; end if;
  if item.kind='private_reply' and v_state='sent' and coalesce(p_result->>'recipientId','') !~ '^[0-9]{1,100}$' then raise exception 'missing recipient' using errcode='22023'; end if;
  if p_result->>'errorCode' is not null and p_result->>'errorCode' !~ '^[a-z_]{1,60}$' then raise exception 'unsafe error' using errcode='22023'; end if;
  update public.instagram_send_intents set state=v_state,external_id=p_result->>'externalId',error_code=p_result->>'errorCode',
    recipient_external_id=case when kind='private_reply' and v_state='sent' then p_result->>'recipientId' else recipient_external_id end where id=item.id;
  v_status:=case when v_state='sent' then 'sent'::public.message_status when v_state='failed' then 'failed'::public.message_status else 'pending'::public.message_status end;
  if v_state='sent' and exists(select 1 from public.instagram_events where channel_id=item.channel_id and kind='status' and payload->>'messageExternalId'=p_result->>'externalId' and payload->>'state'='read') then v_status:='read'; end if;
  update public.messages set external_id=case when v_state='sent' then p_result->>'externalId' else external_id end,
    status=case when status='read' or (status='delivered' and v_status in ('sent','failed','pending')) then status else v_status end,
    error=case when v_state='uncertain' then 'Envio sem confirmação. Verifique o Instagram antes de tentar novamente.' when v_state='failed' then 'Não foi possível enviar pelo Instagram.' else null end where id=item.message_id;
end $$;

create function public.read_instagram_work(p_limit integer) returns jsonb
language sql security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('queueId',msg_id,'eventId',message->>'eventId') order by msg_id),'[]'::jsonb)
  from pgmq.read('instagram_work',300,least(greatest(p_limit,1),10));
$$;
create function public.finish_instagram_work(p_queue_id bigint,p_state text,p_error_code text) returns void
language plpgsql security definer set search_path='' as $$
declare v_event uuid; v_attempts integer; v_intent public.instagram_send_intents;
begin
  if p_state not in ('done','ignored','retry','failed','uncertain') or p_state is null then raise exception 'invalid work state' using errcode='22023'; end if;
  if p_error_code is not null and p_error_code !~ '^[a-z_]{1,60}$' then raise exception 'unsafe error code' using errcode='22023'; end if;
  select (message->>'eventId')::uuid into v_event from pgmq.q_instagram_work where msg_id=p_queue_id for update;
  if not found then return; end if;
  update public.instagram_events set attempts=attempts+1,last_error=p_error_code where id=v_event returning attempts into v_attempts;
  if p_state='retry' and v_attempts<5 then
    perform pgmq.set_vt('instagram_work',p_queue_id,(30*power(2,v_attempts-1))::integer);
    return;
  end if;
  update public.instagram_events set state=case when p_state='retry' then 'failed' else p_state end where id=v_event;
  perform pgmq.archive('instagram_work',p_queue_id);
end $$;
create function public.cleanup_instagram_events() returns void
language plpgsql security definer set search_path='' as $$
begin
  delete from public.instagram_events e where e.created_at<now()-interval '30 days' and e.state<>'pending'
    and not exists(select 1 from pgmq.q_instagram_work q where q.message->>'eventId'=e.id::text);
  delete from pgmq.a_instagram_work where archived_at<now()-interval '30 days';
end $$;

create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table private.instagram_worker_config (
  singleton boolean primary key default true check(singleton),
  base_url text not null,
  service_key_secret_id uuid not null,
  worker_secret_id uuid not null
);
alter table private.instagram_worker_config enable row level security;
revoke all on private.instagram_worker_config from anon,authenticated;
create function public.configure_instagram_worker(p_base_url text,p_service_key text,p_worker_secret text) returns void
language plpgsql security definer set search_path='' as $$
declare old_config private.instagram_worker_config; service_id uuid; worker_id uuid;
begin
  if p_base_url !~ '^(https://[a-z0-9.-]+(:[0-9]+)?|http://(localhost|127\.0\.0\.1|kong|supabase_kong_flowai)(:[0-9]+)?)$'
    or coalesce(length(p_service_key),0)<20 or coalesce(length(p_worker_secret),0)<32 then raise exception 'invalid worker config' using errcode='22023'; end if;
  select * into old_config from private.instagram_worker_config for update;
  if found then
    perform vault.update_secret(old_config.service_key_secret_id,p_service_key);
    perform vault.update_secret(old_config.worker_secret_id,p_worker_secret);
    update private.instagram_worker_config set base_url=p_base_url;
  else
    select vault.create_secret(p_service_key,'flowai-instagram-worker-service') into service_id;
    select vault.create_secret(p_worker_secret,'flowai-instagram-worker-secret') into worker_id;
    insert into private.instagram_worker_config values(true,p_base_url,service_id,worker_id);
  end if;
end $$;
create function public.read_instagram_worker_config() returns jsonb
language sql security definer set search_path='' as $$
  select jsonb_build_object('workerSecret',s.decrypted_secret) from private.instagram_worker_config c join vault.decrypted_secrets s on s.id=c.worker_secret_id;
$$;
create function public.dispatch_instagram_worker() returns void
language plpgsql security definer set search_path='' as $$
declare config private.instagram_worker_config; service_key text; worker_secret text;
begin
  select * into config from private.instagram_worker_config;
  if not found then return; end if;
  select decrypted_secret into service_key from vault.decrypted_secrets where id=config.service_key_secret_id;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where id=config.worker_secret_id;
  perform net.http_post(url:=config.base_url||'/functions/v1/instagram-worker',body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||service_key,'apikey',service_key,'X-FlowAI-Worker',worker_secret),timeout_milliseconds:=120000);
end $$;
revoke all on function public.prepare_instagram_comment_send(uuid),public.read_instagram_work(integer),public.finish_instagram_work(bigint,text,text),public.cleanup_instagram_events(),public.configure_instagram_worker(text,text,text),public.read_instagram_worker_config(),public.dispatch_instagram_worker() from public,anon,authenticated;
grant execute on function public.prepare_instagram_comment_send(uuid),public.read_instagram_work(integer),public.finish_instagram_work(bigint,text,text),public.cleanup_instagram_events(),public.configure_instagram_worker(text,text,text),public.read_instagram_worker_config(),public.dispatch_instagram_worker() to service_role;
select cron.schedule('flowai-instagram-worker','* * * * *','select public.dispatch_instagram_worker()');
select cron.schedule('flowai-instagram-cleanup','0 3 * * *','select public.cleanup_instagram_events()');
