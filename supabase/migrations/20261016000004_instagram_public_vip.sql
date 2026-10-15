-- Public replies and requested private invitations never change automation selection.
create table public.instagram_vip_settings (
 channel_id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 enabled boolean not null default false,
 public_reply_text text not null check(octet_length(public_reply_text) between 1 and 1000 and public_reply_text ~ '[^[:space:]]'),
 group_url text not null check(group_url ~ '^https://chat[.]whatsapp[.]com/[A-Za-z0-9_-]+$'),
 activated_at timestamptz,
 last_error text,
 comments_verified_at timestamptz,
 comments_generation integer,
 comments_error text,
 foreign key(organization_id,channel_id) references public.channels(organization_id,id) on delete cascade
);
alter table public.instagram_vip_settings enable row level security;
revoke all on public.instagram_vip_settings from anon,authenticated;
grant select on public.instagram_vip_settings to authenticated;
create policy instagram_vip_admin_read on public.instagram_vip_settings for select to authenticated using(public.has_role(organization_id,'admin'));

create function public.save_instagram_vip_settings(p_channel_id uuid,p_enabled boolean,p_public_reply_text text,p_group_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ch public.channels; cfg public.instagram_vip_settings; mc public.meta_connections;
begin
 select * into ch from public.channels where id=p_channel_id for update;
 if not found or not public.has_role(ch.organization_id,'admin') then raise exception 'forbidden' using errcode='42501'; end if;
 if ch.type<>'instagram' or p_enabled is null or p_public_reply_text is null or octet_length(p_public_reply_text) not between 1 and 1000
   or p_public_reply_text !~ '[^[:space:]]' or p_group_url is null or p_group_url !~ '^https://chat[.]whatsapp[.]com/[A-Za-z0-9_-]+$'
   then raise exception 'invalid VIP settings' using errcode='22023'; end if;
 select * into cfg from public.instagram_vip_settings where channel_id=ch.id for update;
 select * into mc from public.meta_connections where id=ch.meta_connection_id;
 if p_enabled and (ch.status<>'active' or mc.id is null or mc.disconnected_at is not null or mc.token_verified_at is null
   or cfg.comments_verified_at is null or cfg.comments_generation is distinct from mc.credential_generation or cfg.comments_error is not null)
   then raise exception 'verify comments permission and reconnect Instagram' using errcode='22023'; end if;
 insert into public.instagram_vip_settings(channel_id,organization_id,enabled,public_reply_text,group_url,activated_at)
 values(ch.id,ch.organization_id,p_enabled,p_public_reply_text,p_group_url,case when p_enabled then clock_timestamp() end)
 on conflict(channel_id) do update set enabled=excluded.enabled,public_reply_text=excluded.public_reply_text,group_url=excluded.group_url,
 activated_at=case when excluded.enabled and not instagram_vip_settings.enabled then clock_timestamp() else instagram_vip_settings.activated_at end;
 if not p_enabled then
   update public.instagram_vip_intents set state='cancelled',error_code='settings_disabled' where channel_id=ch.id and state='pending';
 end if;
 return (select to_jsonb(s) from public.instagram_vip_settings s where channel_id=ch.id);
end $$;
revoke all on function public.save_instagram_vip_settings(uuid,boolean,text,text) from public,anon;
grant execute on function public.save_instagram_vip_settings(uuid,boolean,text,text) to authenticated;

create function public.record_instagram_vip_capability(p_channel_id uuid,p_generation integer,p_success boolean,p_error_code text)
returns void language plpgsql security definer set search_path='' as $$
declare ch public.channels; mc public.meta_connections;
begin
 select * into ch from public.channels where id=p_channel_id and type='instagram' for update;
 select * into mc from public.meta_connections where id=ch.meta_connection_id;
 if mc.id is null or mc.disconnected_at is not null or mc.credential_generation is distinct from p_generation then raise exception 'credentials changed' using errcode='40001'; end if;
 if p_error_code is not null and p_error_code not in ('comments_permission_required','invalid_account','provider_unavailable','invalid_token','permission_denied') then raise exception 'invalid code' using errcode='22023'; end if;
 insert into public.instagram_vip_settings(channel_id,organization_id,public_reply_text,group_url)
 values(ch.id,ch.organization_id,'Quer entrar no nosso grupo VIP do WhatsApp? Comente VIP para receber o link no Direct.','https://chat.whatsapp.com/FFHuLdtAehRCoIDP67bX5r') on conflict do nothing;
 update public.instagram_vip_settings set comments_verified_at=case when p_success then now() end,comments_generation=p_generation,
 comments_error=case when p_success then null else coalesce(p_error_code,'comments_permission_required') end,
 last_error=case when p_success then null else coalesce(p_error_code,'comments_permission_required') end,
 enabled=case when p_success then enabled else false end where channel_id=ch.id;
end $$;

create table public.instagram_vip_intents (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 channel_id uuid not null, event_id uuid references public.instagram_events(id) on delete set null,
 comment_id text not null, kind text not null check(kind in ('public','private')),
 state text not null default 'pending' check(state in ('pending','sending','sent','failed','uncertain','cancelled')),
 claim_token uuid, claimed_at timestamptz, claimed_connection_id uuid, claimed_generation integer, external_id text, error_code text,
 unique(channel_id,comment_id,kind), foreign key(organization_id,channel_id) references public.channels(organization_id,id) on delete cascade
);
alter table public.instagram_vip_intents enable row level security;
revoke all on public.instagram_vip_intents from anon,authenticated;
grant select on public.instagram_vip_intents to authenticated;
create policy instagram_vip_intents_read on public.instagram_vip_intents for select to authenticated using(public.has_role(organization_id,'admin'));

-- Every mutation that needs both rows locks settings before intents. In-flight
-- requests retain their lease and are reconciled, never silently cancelled.
create function private.pause_instagram_vip_connection() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.instagram_vip_settings; reason text;
begin
 if new.credential_generation is not distinct from old.credential_generation and new.disconnected_at is not distinct from old.disconnected_at then return new; end if;
 reason:=case when new.disconnected_at is not null then 'connection_disconnected' else 'credentials_changed' end;
 -- Disconnect/remove update channels after updating this connection. Acquire
 -- those channel locks before any settings lock, matching claim/save/channel
 -- lifecycle order. Claims only read the connection row, never lock it.
 perform 1 from public.channels where meta_connection_id=new.id order by id for update;
 for s in select cfg.* from public.instagram_vip_settings cfg join public.channels ch on ch.id=cfg.channel_id
   where ch.meta_connection_id=new.id order by cfg.channel_id for update of cfg loop
   update public.instagram_vip_settings set enabled=false,comments_verified_at=null,comments_generation=null,
     comments_error=reason,last_error=reason where channel_id=s.channel_id;
   update public.instagram_vip_intents set state='cancelled',error_code=reason where channel_id=s.channel_id and state='pending';
 end loop;
 return new;
end $$;
create trigger instagram_vip_connection_lifecycle after update of credential_generation,disconnected_at on public.meta_connections
 for each row execute function private.pause_instagram_vip_connection();

create function private.pause_instagram_vip_channel() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.type='instagram' and (new.meta_connection_id is distinct from old.meta_connection_id or (new.status is distinct from old.status and new.status<>'active')) then
   perform 1 from public.instagram_vip_settings where channel_id=new.id for update;
   update public.instagram_vip_settings set enabled=false,comments_verified_at=null,comments_generation=null,
     comments_error='channel_changed',last_error='channel_changed' where channel_id=new.id;
   update public.instagram_vip_intents set state='cancelled',error_code='channel_changed' where channel_id=new.id and state='pending';
 end if;
 return new;
end $$;
create trigger instagram_vip_channel_lifecycle after update of meta_connection_id,status on public.channels
 for each row execute function private.pause_instagram_vip_channel();

create function public.sweep_instagram_vip_leases() returns integer language plpgsql security definer set search_path='' as $$
declare s public.instagram_vip_settings; affected integer; total integer:=0;
begin
 -- Includes disabled channels and durable intents whose raw event was purged.
 for s in select cfg.* from public.instagram_vip_settings cfg where exists(
   select 1 from public.instagram_vip_intents i where i.channel_id=cfg.channel_id and i.state='sending' and i.claimed_at<now()-interval '1 minute')
   order by cfg.channel_id limit 100 for update of cfg skip locked loop
   update public.instagram_vip_intents set state='uncertain',error_code='expired_send_lease'
     where channel_id=s.channel_id and state='sending' and claimed_at<now()-interval '1 minute';
   get diagnostics affected=row_count;
   if affected>0 then update public.instagram_vip_settings set last_error='send_uncertain' where channel_id=s.channel_id; end if;
   total:=total+affected;
 end loop;
 return total;
end $$;

create or replace function public.read_instagram_work(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare work jsonb;
begin
 perform public.sweep_instagram_vip_leases();
 select coalesce(jsonb_agg(jsonb_build_object('queueId',msg_id,'eventId',message->>'eventId',
   'task',coalesce(message->>'task','comment')) order by msg_id),'[]'::jsonb) into work
 from pgmq.read('instagram_work',300,least(greatest(p_limit,1),10));
 return work;
end $$;

create function private.enqueue_instagram_vip() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.instagram_vip_settings s where s.channel_id=new.channel_id and s.organization_id=new.organization_id
   and s.enabled and new.occurred_at>=s.activated_at) then
   perform pgmq.send('instagram_work',jsonb_build_object('eventId',new.id,'task','vip'));
 end if;
 return new;
end $$;
create trigger instagram_vip_enqueue after insert on public.instagram_events for each row when(new.kind='comment') execute function private.enqueue_instagram_vip();

create function public.prepare_instagram_vip_send(p_event_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ev public.instagram_events; cfg public.instagram_vip_settings; ch public.channels; mc public.meta_connections;
begin
 select * into ev from public.instagram_events where id=p_event_id and kind='comment';
 if not found or ev.payload->>'purged'='true' then return 'null'; end if;
 select * into ch from public.channels where id=ev.channel_id and organization_id=ev.organization_id;
 select * into mc from public.meta_connections where id=ch.meta_connection_id;
 select * into cfg from public.instagram_vip_settings where channel_id=ch.id and organization_id=ev.organization_id;
 if not coalesce(cfg.enabled,false) or ch.status<>'active' or mc.id is null or mc.disconnected_at is not null
   or cfg.comments_verified_at is null or cfg.comments_generation is distinct from mc.credential_generation or cfg.comments_error is not null
   or ev.occurred_at<cfg.activated_at then return 'null'; end if;
 insert into public.instagram_vip_intents(organization_id,channel_id,event_id,comment_id,kind)
 select ev.organization_id,ch.id,ev.id,ev.payload->>'commentId',k from unnest(array['public','private']) k
 where coalesce(ev.payload->>'commentId','')<>'' on conflict do nothing;
 return jsonb_build_object('eventId',ev.id,'organizationId',ev.organization_id,'channelId',ch.id,'connectionId',ch.meta_connection_id,
 'commentId',ev.payload->>'commentId','mediaId',ev.payload->>'mediaId','senderExternalId',ev.payload->>'senderExternalId',
 'activatedAt',cfg.activated_at,'operations',(select jsonb_agg(jsonb_build_object('id',i.id,'kind',i.kind,'state',i.state)) from public.instagram_vip_intents i where i.channel_id=ch.id and i.comment_id=ev.payload->>'commentId'));
end $$;

create function public.claim_instagram_vip_send(p_intent_id uuid,p_comment_at timestamptz,p_comment_text text,p_expected_connection_id uuid,p_expected_generation integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.instagram_vip_intents; s public.instagram_vip_settings; ch public.channels; mc public.meta_connections;
begin
 select * into i from public.instagram_vip_intents where id=p_intent_id;
 if not found then return 'null'; end if;
 -- Shared with legacy private sends, preserving whichever operation reserves first.
 perform pg_advisory_xact_lock(hashtextextended('instagram-private:'||i.channel_id||':'||i.comment_id,0));
 select * into ch from public.channels where id=i.channel_id and organization_id=i.organization_id for update;
 select * into s from public.instagram_vip_settings where channel_id=ch.id and organization_id=i.organization_id for update;
 select * into mc from public.meta_connections where id=ch.meta_connection_id;
 select * into i from public.instagram_vip_intents where id=p_intent_id for update;
 if i.state<>'pending' then return 'null'; end if;
 if not coalesce(s.enabled,false) or ch.status<>'active' or mc.id is null or mc.disconnected_at is not null
   or p_expected_connection_id is null or p_expected_generation is null
   or ch.meta_connection_id is distinct from p_expected_connection_id or mc.credential_generation is distinct from p_expected_generation
   or s.comments_verified_at is null or s.comments_generation is distinct from mc.credential_generation or s.comments_error is not null
   or p_comment_at is null or p_comment_at<s.activated_at or p_comment_at>now() then return 'null'; end if;
 if i.kind='private' and (p_comment_at<=now()-interval '7 days' or coalesce(p_comment_text,'') !~* '(^|[^[:alnum:]_])VIP([^[:alnum:]_]|$)') then return 'null'; end if;
 if i.kind='private' and exists(select 1 from public.instagram_send_intents old where old.channel_id=i.channel_id and old.comment_id=i.comment_id and old.kind='private_reply' and old.state in ('sending','sent','uncertain')) then
   update public.instagram_vip_intents set state='cancelled',error_code='private_reply_reserved' where id=i.id; return 'null'; end if;
 update public.instagram_vip_intents set state='sending',claim_token=gen_random_uuid(),claimed_at=now(),
   claimed_connection_id=p_expected_connection_id,claimed_generation=p_expected_generation where id=i.id returning * into i;
 return jsonb_build_object('id',i.id,'claimToken',i.claim_token,'kind',i.kind,'text',case when i.kind='public' then s.public_reply_text else 'Aqui está o convite para o nosso grupo VIP do WhatsApp: '||s.group_url end);
end $$;

create function private.guard_instagram_private_reply() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='private_reply' and new.state='sending' and old.state is distinct from 'sending' then
   perform pg_advisory_xact_lock(hashtextextended('instagram-private:'||new.channel_id||':'||new.comment_id,0));
   if exists(select 1 from public.instagram_vip_intents i where i.channel_id=new.channel_id and i.comment_id=new.comment_id and i.kind='private' and i.state in ('sending','sent','uncertain')) then
     raise exception 'private reply already reserved' using errcode='23505';
   end if;
 end if;
 return new;
end $$;
create trigger instagram_private_reply_conflict before update on public.instagram_send_intents for each row execute function private.guard_instagram_private_reply();

create function public.complete_instagram_vip_send(p_intent_id uuid,p_claim_token uuid,p_state text,p_external_id text,p_error_code text) returns void language plpgsql security definer set search_path='' as $$
declare i public.instagram_vip_intents; s public.instagram_vip_settings; current_credentials boolean;
begin
 if p_state is null or p_state not in ('sent','failed','uncertain','pending','cancelled') or (p_error_code is not null and p_error_code !~ '^[a-z_]{1,60}$') then raise exception 'invalid result' using errcode='22023'; end if;
 if p_state='pending' and p_error_code is distinct from 'rate_limited' then raise exception 'unsafe retry' using errcode='22023'; end if;
 select * into i from public.instagram_vip_intents where id=p_intent_id;
 if not found then return; end if;
 select * into s from public.instagram_vip_settings where channel_id=i.channel_id for update;
 select exists(select 1 from public.channels ch join public.meta_connections mc on mc.id=ch.meta_connection_id
   where ch.id=i.channel_id and ch.meta_connection_id=i.claimed_connection_id and mc.credential_generation=i.claimed_generation
     and s.comments_generation=i.claimed_generation and mc.disconnected_at is null) into current_credentials;
 update public.instagram_vip_intents set state=p_state,external_id=p_external_id,error_code=p_error_code
 where id=p_intent_id and state='sending' and claim_token=p_claim_token returning * into i;
 if i.id is not null and p_state='pending' and (not current_credentials or not s.enabled) then
   update public.instagram_vip_intents set state='cancelled',error_code='credentials_changed' where id=i.id;
 end if;
 if i.id is not null and p_error_code is not null and current_credentials then
   update public.instagram_vip_settings set last_error=p_error_code,
     enabled=case when p_error_code in ('permission_denied','invalid_token') then false else enabled end,
     comments_verified_at=case when p_error_code in ('permission_denied','invalid_token') then null else comments_verified_at end,
     comments_error=case when p_error_code in ('permission_denied','invalid_token') then p_error_code else comments_error end where channel_id=i.channel_id;
 end if;
end $$;

create function public.finish_instagram_vip_work(p_queue_id bigint,p_state text,p_error_code text,p_expected_connection_id uuid default null,p_expected_generation integer default null) returns void language plpgsql security definer set search_path='' as $$
declare q record; ev uuid;
begin
 select * into q from pgmq.q_instagram_work where msg_id=p_queue_id and message->>'task'='vip' for update;
 if not found then return; end if;
 ev:=(q.message->>'eventId')::uuid;
 if p_error_code is not null and p_error_code !~ '^[a-z_]{1,60}$' then raise exception 'unsafe error' using errcode='22023'; end if;
 if p_state='retry' and q.read_ct<5 then perform pgmq.set_vt('instagram_work',p_queue_id,60*q.read_ct); return; end if;
 if p_error_code is not null then
   update public.instagram_vip_settings s set last_error=p_error_code,
     enabled=case when p_error_code in ('permission_denied','invalid_token') then false else s.enabled end,
     comments_verified_at=case when p_error_code in ('permission_denied','invalid_token') then null else s.comments_verified_at end,
     comments_error=case when p_error_code in ('permission_denied','invalid_token') then p_error_code else s.comments_error end
   from public.instagram_events e join public.channels ch on ch.id=e.channel_id join public.meta_connections mc on mc.id=ch.meta_connection_id
   where e.id=ev and s.channel_id=e.channel_id and ch.meta_connection_id=p_expected_connection_id
     and mc.credential_generation=p_expected_generation and s.comments_generation=p_expected_generation;
 end if;
 update public.instagram_vip_intents set state='cancelled',error_code=coalesce(p_error_code,'comment_not_eligible') where event_id=ev and state='pending';
 perform pgmq.archive('instagram_work',p_queue_id);
end $$;

revoke all on function private.enqueue_instagram_vip(),private.guard_instagram_private_reply(),private.pause_instagram_vip_connection(),private.pause_instagram_vip_channel(),public.sweep_instagram_vip_leases(),public.record_instagram_vip_capability(uuid,integer,boolean,text),public.prepare_instagram_vip_send(uuid),public.claim_instagram_vip_send(uuid,timestamptz,text,uuid,integer),public.complete_instagram_vip_send(uuid,uuid,text,text,text),public.finish_instagram_vip_work(bigint,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.sweep_instagram_vip_leases(),public.record_instagram_vip_capability(uuid,integer,boolean,text),public.prepare_instagram_vip_send(uuid),public.claim_instagram_vip_send(uuid,timestamptz,text,uuid,integer),public.complete_instagram_vip_send(uuid,uuid,text,text,text),public.finish_instagram_vip_work(bigint,text,text,uuid,integer) to service_role;
