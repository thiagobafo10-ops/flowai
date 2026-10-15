begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_table('public','instagram_vip_settings','persistent VIP settings exist');
select has_table('public','instagram_vip_intents','public and private operations persist separately');
select has_function('public','save_instagram_vip_settings',array['uuid','boolean','text','text'],'authenticated settings RPC exists');
select has_function('public','claim_instagram_vip_send',array['uuid','timestamp with time zone','text','uuid','integer'],'atomic reservation revalidates actual comment');
-- Function existence is the first red run; behavioral checks follow after the DDL.
select tests.create_user('vip-owner@t.test') as owner \gset
select tests.create_user('vip-outsider@t.test') as outsider \gset
select tests.authenticate_as(:'owner');
select public.create_organization_with_owner('VIP') as org \gset
select tests.clear_authentication();
insert into public.meta_connections(organization_id,app_id,api_version,app_secret_id,verify_token_secret_id,token_verified_at)
values(:'org','990052','v26.0',gen_random_uuid(),gen_random_uuid(),now()) returning id as conn \gset
insert into public.channels(organization_id,type,name,status,external_account_id,meta_connection_id,instagram_username)
values(:'org','instagram','VIP','active','789',:'conn','empresa') returning id as ch \gset
select tests.authenticate_as(:'owner');
select throws_ok(format('select public.save_instagram_vip_settings(%L,true,%L,%L)',:'ch','Convite','https://chat.whatsapp.com/abc'),'22023',null,'activation requires service permission verification');
select lives_ok(format('select public.save_instagram_vip_settings(%L,false,%L,%L)',:'ch','Convite','https://chat.whatsapp.com/abc'),'saving disabled needs no permission');
select throws_ok(format('select public.save_instagram_vip_settings(%L,false,%L,%L)',:'ch','Convite','https://evil.test/abc'),'22023',null,'foreign group URL rejected');
select tests.authenticate_as(:'outsider');
select throws_ok(format('select public.save_instagram_vip_settings(%L,false,%L,%L)',:'ch','Convite','https://chat.whatsapp.com/abc'),'42501',null,'other tenant cannot configure');
select is((select count(*)::int from public.instagram_vip_settings),0,'RLS hides foreign settings');
select tests.clear_authentication();
select public.record_instagram_vip_capability(:'ch',1,true,null);
select tests.authenticate_as(:'owner');
select public.save_instagram_vip_settings(:'ch',true,'Convite','https://chat.whatsapp.com/abc');
select tests.clear_authentication();
update public.instagram_vip_settings set activated_at=now()-interval '1 second' where channel_id=:'ch';
insert into public.instagram_events(organization_id,channel_id,kind,external_id,payload,occurred_at)
values(:'org',:'ch','comment','123',jsonb_build_object('commentId','123','mediaId','456','senderExternalId','900','text','VIP',:'conn',1),now()+interval '1 second') returning id as ev \gset
select is((select count(*)::int from pgmq.q_instagram_work where message->>'task'='vip' and message->>'eventId'=:'ev'),1,'new comment independently enqueues VIP even with no automation');
select public.prepare_instagram_vip_send(:'ev') as prepared \gset
select is(jsonb_array_length(:'prepared'::jsonb->'operations'),2,'independent public and private intents');
select public.prepare_instagram_vip_send(:'ev');
select is((select count(*)::int from public.instagram_vip_intents where event_id=:'ev'),2,'duplicate preparation cannot duplicate intents');
select id as pub from public.instagram_vip_intents where event_id=:'ev' and kind='public' \gset
select id as priv from public.instagram_vip_intents where event_id=:'ev' and kind='private' \gset
select is(public.claim_instagram_vip_send(:'priv',now(),'VIPER',:'conn',1),'null'::jsonb,'VIP is a whole word');
select is(public.claim_instagram_vip_send(:'priv',now()-interval '8 days','VIP',:'conn',1),'null'::jsonb,'private reply expires after seven days');
select isnt(public.claim_instagram_vip_send(:'pub',now(),'VIP',:'conn',1),'null'::jsonb,'public operation reserved once');
select is(public.claim_instagram_vip_send(:'pub',now(),'VIP',:'conn',1),'null'::jsonb,'concurrent or duplicate reservation cannot send');
update public.instagram_vip_intents set claimed_at=now()-interval '10 minutes' where id=:'pub';
select public.sweep_instagram_vip_leases();
select is((select state from public.instagram_vip_intents where id=:'pub'),'uncertain','expired lease becomes uncertain');
select is(public.claim_instagram_vip_send(:'pub',now(),'VIP',:'conn',1),'null'::jsonb,'uncertain is never sent again');
update public.instagram_vip_settings set enabled=false where channel_id=:'ch';
select is(public.claim_instagram_vip_send(:'priv',now(),'VIP',:'conn',1),'null'::jsonb,'pause between preparation and reservation blocks private operation');
update public.instagram_vip_settings set enabled=true where channel_id=:'ch';
update public.meta_connections set disconnected_at=now() where id=:'conn';
select is((select enabled from public.instagram_vip_settings where channel_id=:'ch'),false,'disconnect atomically disables VIP');
select is((select state from public.instagram_vip_intents where id=:'priv'),'cancelled','disconnect cancels prepared private work');
select is(public.claim_instagram_vip_send(:'priv',now(),'VIP',:'conn',1),'null'::jsonb,'disconnect blocks reservation');
update public.meta_connections set disconnected_at=null,credential_generation=2 where id=:'conn';
select is(public.claim_instagram_vip_send(:'priv',now(),'VIP',:'conn',1),'null'::jsonb,'credential rotation invalidates capability');
select public.record_instagram_vip_capability(:'ch',2,true,null);
select is((select enabled from public.instagram_vip_settings where channel_id=:'ch'),false,'reconnection verification cannot reactivate VIP');
select tests.authenticate_as(:'owner');
select public.save_instagram_vip_settings(:'ch',true,'Convite','https://chat.whatsapp.com/abc');
select tests.clear_authentication();
select ok((select activated_at>now()-interval '1 second' from public.instagram_vip_settings where channel_id=:'ch'),'explicit reactivation advances cutoff');
update public.instagram_vip_settings set activated_at=now()-interval '1 second' where channel_id=:'ch';
insert into public.instagram_events(organization_id,channel_id,kind,external_id,payload,occurred_at)
values(:'org',:'ch','comment','124',jsonb_build_object('commentId','124','mediaId','456','senderExternalId','900','text','VIP',:'conn',2),now()+interval '1 second') returning id as newev \gset
select public.prepare_instagram_vip_send(:'newev');
select id as priv from public.instagram_vip_intents where event_id=:'newev' and kind='private' \gset
select is(public.claim_instagram_vip_send(:'priv',now()-interval '10 seconds','VIP',:'conn',2),'null'::jsonb,'comment predating activation is blocked');
select public.claim_instagram_vip_send(:'priv',now(),'VIP',:'conn',2) as private_claim \gset
select isnt(:'private_claim'::jsonb,'null'::jsonb,'private request has its own reservation');
select public.complete_instagram_vip_send(:'priv',gen_random_uuid(),'sent','fake',null);
select is((select state from public.instagram_vip_intents where id=:'priv'),'sending','wrong claim token cannot complete');
select public.complete_instagram_vip_send(:'priv',(:'private_claim'::jsonb->>'claimToken')::uuid,'failed',null,'permission_denied');
select is((select enabled from public.instagram_vip_settings where channel_id=:'ch'),false,'provider permission failure pauses VIP');
select is((select last_error from public.instagram_vip_settings where channel_id=:'ch'),'permission_denied','permission failure is visible');
select public.record_instagram_vip_capability(:'ch',2,true,null);
update public.instagram_vip_settings set enabled=true where channel_id=:'ch';
select tests.authenticate_as(:'owner');
select public.save_instagram_vip_settings(:'ch',false,'Convite','https://chat.whatsapp.com/abc');
select public.save_instagram_vip_settings(:'ch',true,'Convite','https://chat.whatsapp.com/abc');
select tests.clear_authentication();
select is((select count(*)::int from public.instagram_vip_intents where state='pending' and channel_id=:'ch'),0,'pause does not revive pending operations when reactivated');
select msg_id as queue from pgmq.q_instagram_work where message->>'task'='vip' and message->>'eventId'=:'ev' \gset
select public.finish_instagram_vip_work(:'queue','failed','permission_denied',:'conn',2);
select is((select enabled from public.instagram_vip_settings where channel_id=:'ch'),false,'metadata permission failure pauses capability too');
delete from public.instagram_events where id=:'ev';
select is((select count(*)::int from public.instagram_vip_intents where channel_id=:'ch' and comment_id='123'),2,'comment dedupe survives raw event retention cleanup');
update public.instagram_vip_intents set state='sending',claimed_at=now()-interval '10 minutes' where channel_id=:'ch' and comment_id='123';
select public.read_instagram_work(1);
select is((select count(*)::int from public.instagram_vip_intents where channel_id=:'ch' and comment_id='123' and state='uncertain'),2,'paused and eventless expired leases reconcile');
select is((select last_error from public.instagram_vip_settings where channel_id=:'ch'),'send_uncertain','eventless expired leases remain visible');
select public.record_instagram_vip_capability(:'ch',2,true,null);
update public.instagram_vip_settings set enabled=true,activated_at=now()-interval '1 second' where channel_id=:'ch';
insert into public.instagram_events(organization_id,channel_id,kind,external_id,payload,occurred_at)
values(:'org',:'ch','comment','125',jsonb_build_object('commentId','125','mediaId','456','senderExternalId','900','text','VIP'),now()) returning id as genev \gset
select public.prepare_instagram_vip_send(:'genev');
select id as genpub from public.instagram_vip_intents where event_id=:'genev' and kind='public' \gset
select is(public.claim_instagram_vip_send(:'genpub',now(),'VIP',:'conn',1),'null'::jsonb,'metadata fetched with old credentials cannot reserve against new generation');
select is(public.claim_instagram_vip_send(:'genpub',now(),'VIP',gen_random_uuid(),2),'null'::jsonb,'metadata fetched through another connection cannot reserve');
select public.claim_instagram_vip_send(:'genpub',now(),'VIP',:'conn',2) as generation_claim \gset
select isnt(:'generation_claim'::jsonb,'null'::jsonb,'matching metadata credential snapshot reserves');
update public.meta_connections set credential_generation=3 where id=:'conn';
select is((select enabled from public.instagram_vip_settings where channel_id=:'ch'),false,'credential rotation atomically pauses VIP');
select public.record_instagram_vip_capability(:'ch',3,true,null);
select tests.authenticate_as(:'owner');
select public.save_instagram_vip_settings(:'ch',true,'Convite','https://chat.whatsapp.com/abc');
select tests.clear_authentication();
select public.complete_instagram_vip_send(:'genpub',(:'generation_claim'::jsonb->>'claimToken')::uuid,'failed',null,'permission_denied');
select is((select enabled from public.instagram_vip_settings where channel_id=:'ch'),true,'late old credential completion cannot disable reverified configuration');
select is((select comments_error from public.instagram_vip_settings where channel_id=:'ch'),null,'late credential failure cannot invalidate new permission seal');
select msg_id as genqueue from pgmq.q_instagram_work where message->>'task'='vip' and message->>'eventId'=:'genev' \gset
select public.finish_instagram_vip_work(:'genqueue','failed','permission_denied',:'conn',2);
select is((select enabled from public.instagram_vip_settings where channel_id=:'ch'),true,'late metadata error acknowledgement cannot disable new configuration');
select is((select last_error from public.instagram_vip_settings where channel_id=:'ch'),null,'old generation acknowledgement cannot overwrite current status');
select * from finish();
rollback;
