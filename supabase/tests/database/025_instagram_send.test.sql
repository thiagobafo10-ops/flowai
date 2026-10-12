begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
select tests.create_user('owner25@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org25A') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"125","appSecret":"app","accessToken":"access","accountId":"78925","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78925','externalId','m25','senderExternalId','925','text','Oi','occurredAt',now()));
select (select conversation_id from public.messages where external_id='m25') as conv \gset
select tests.authenticate_as(:'ua');
select public.create_instagram_send_intent(:'conv','Resposta','00000000-0000-0000-0000-000000002501') as intent \gset
select throws_ok(format($$select public.create_instagram_send_intent(%L,'Changed','00000000-0000-0000-0000-000000002501')$$,:'conv'),'22023',null,'request id cannot change content');
select tests.clear_authentication();
select public.claim_instagram_send(:'intent') as claim \gset
select public.complete_instagram_send(:'intent',jsonb_build_object('claimToken',:'claim'::jsonb->>'claimToken','state','failed','errorCode','invalid_token'));
select (select message_id from public.instagram_send_intents where id=:'intent') as msg \gset
select tests.authenticate_as(:'ua');
select is(public.retry_instagram_send_intent(:'msg'),:'intent'::uuid,'explicit retry reuses failed intent');
select tests.clear_authentication();
select is((select state from public.instagram_send_intents where id=:'intent'),'pending','retry resets safe failure');
select public.claim_instagram_send(:'intent') as claim2 \gset
select throws_ok(format($$select public.complete_instagram_send(%L,%L::jsonb)$$,:'intent',jsonb_build_object('claimToken',:'claim'::jsonb->>'claimToken','state','sent','externalId','stale')),'40001',null,'old claim cannot complete new attempt');
select public.complete_instagram_send(:'intent',jsonb_build_object('claimToken',:'claim2'::jsonb->>'claimToken','state','uncertain','errorCode','network_error'));
select tests.authenticate_as(:'ua');
select throws_ok(format($$select public.retry_instagram_send_intent(%L)$$,:'msg'),'42501',null,'uncertain cannot be retried');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where conversation_id=:'conv' and direction='outbound'),1,'retry creates no second message');
select * from finish();
rollback;
