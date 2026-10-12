begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
select tests.create_user('owner26@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org26A') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"126","appSecret":"app","accessToken":"access","accountId":"78926","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select tests.authenticate_as(:'ua');
select public.save_instagram_comment_rule(jsonb_build_object('channelId',:'chan','keyword','guia','replyText','Aqui','active',true)) as rule \gset
select tests.clear_authentication();
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78926','externalId','c26','commentId','c26','mediaId','p26','senderExternalId','926','text','guia','occurredAt',now())) as evt \gset
select (:'evt'::jsonb->>'eventId') as event_id \gset
select has_function('public','prepare_instagram_comment_send',array['uuid'],'prepare exists');
select public.prepare_instagram_comment_send(:'event_id') as work \gset
select is(public.prepare_instagram_comment_send(:'event_id')->>'intentId',:'work'::jsonb->>'intentId','one intent per comment');
select public.claim_instagram_send((:'work'::jsonb->>'intentId')::uuid) as claim \gset
select public.complete_instagram_send((:'work'::jsonb->>'intentId')::uuid,jsonb_build_object('claimToken',:'claim'::jsonb->>'claimToken','state','sent','externalId','out26','recipientId','926'));
select is((select count(*)::int from public.messages where external_id='out26'),1,'private reply appears in history');
select is((select count(*)::int from public.messages where channel_id=:'chan' and direction='inbound'),0,'private reply never creates inbound');
select is((select context->>'origin' from public.messages where external_id='out26'),'comment','private reply context');
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78926','externalId','c26b','commentId','c26b','mediaId','p26','senderExternalId','927','text','guia','occurredAt',now())) as evt2 \gset
select tests.authenticate_as(:'ua');
select public.save_instagram_comment_rule(jsonb_build_object('id',:'rule','channelId',:'chan','keyword','guia','replyText','Changed','active',false));
select tests.clear_authentication();
select is(public.prepare_instagram_comment_send((:'evt2'::jsonb->>'eventId')::uuid),'null'::jsonb,'changed rule prevents preparing');
select ok(not has_function_privilege('authenticated','public.read_instagram_work(integer)','execute'),'user cannot consume queue');
select public.read_instagram_work(10) as jobs \gset
select public.finish_instagram_work((:'jobs'::jsonb->0->>'queueId')::bigint,'done',null);
select is((select count(*)::int from pgmq.q_instagram_work),1,'finished job removed, pending job retained');
update public.instagram_events set created_at=now()-interval '31 days' where id=:'event_id';
select public.cleanup_instagram_events();
select is((select count(*)::int from public.messages where external_id='out26'),1,'cleanup keeps history');
select * from finish();
rollback;
