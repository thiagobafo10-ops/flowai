begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
select tests.create_user('owner24@t.test','Owner') as ua \gset
select tests.create_user('other24@t.test','Other') as ub \gset
select tests.create_org(:'ua','Org24A') as oa \gset
select tests.create_org(:'ub','Org24B') as ob \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"124","appSecret":"app","accessToken":"access","accountId":"78924","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select has_table('public','instagram_events','event store exists');
select has_function('public','ingest_instagram_event',array['uuid','jsonb'],'ingest exists');
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78924','externalId','m24','senderExternalId','924','senderName','Cliente','text','Olá','occurredAt',now(),'context',jsonb_build_object('origin','story_reply','storyId','s24'))) as first_event \gset
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78924','externalId','m24','senderExternalId','924','text','DUP','occurredAt',now())), :'first_event'::jsonb,'duplicate same result');
select is((select count(*)::int from public.messages where channel_id=:'chan'),1,'duplicate one message');
select is((select context->>'storyId' from public.messages where channel_id=:'chan'),'s24','story context persisted');
select (select conversation_id from public.messages where channel_id=:'chan') as conv \gset
select tests.authenticate_as(:'ub');
select throws_ok(format($$select public.create_instagram_send_intent(%L,'Oi',gen_random_uuid())$$,:'conv'),'42501',null,'foreign user cannot send');
select tests.authenticate_as(:'ua');
select public.create_instagram_send_intent(:'conv','Resposta','00000000-0000-0000-0000-000000002401') as intent \gset
select is(public.create_instagram_send_intent(:'conv','Resposta','00000000-0000-0000-0000-000000002401'),:'intent'::uuid,'request id dedup');
select public.save_instagram_comment_rule(jsonb_build_object('channelId',:'chan','keyword','guia','replyText','Aqui','active',true)) as rule \gset
select tests.clear_authentication();
select public.claim_instagram_send(:'intent') as claim \gset
select ok(:'claim'::jsonb->>'claimToken' is not null,'claim returns token');
select is(public.claim_instagram_send(:'intent'),'null'::jsonb,'second claim cannot send');
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','status','accountId','78924','externalId','out24:read','messageExternalId','out24','state','read','occurredAt',now()));
select public.complete_instagram_send(:'intent',jsonb_build_object('claimToken',:'claim'::jsonb->>'claimToken','state','sent','externalId','out24'));
select is((select status::text from public.messages where external_id='out24'),'read','early read reconciled');
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78924','externalId','c24','commentId','c24','mediaId','p24','senderExternalId','925','text','GUIA!','occurredAt',now()));
select is((select count(*)::int from public.messages where direction='inbound' and channel_id=:'chan'),1,'comment not fake inbound');
select is((select rule_id from public.instagram_events where external_id='c24'),:'rule'::uuid,'keyword rule snapshot');
select is((select count(*)::int from pgmq.q_instagram_work),1,'one durable queue item');
select tests.authenticate_as(:'ua');
select public.save_instagram_comment_rule(jsonb_build_object('id',:'rule','channelId',:'chan','keyword','guia','replyText','Novo','active',true));
select tests.clear_authentication();
select is((select rule_version from public.instagram_events where external_id='c24'),1,'queued snapshot version unchanged');
select tests.authenticate_as(:'ua');
select public.create_instagram_send_intent(:'conv','expired','00000000-0000-0000-0000-000000002402') as timeout_intent \gset
select tests.clear_authentication();
select public.claim_instagram_send(:'timeout_intent');
update public.instagram_send_intents set claimed_at=now()-interval '2 minutes' where id=:'timeout_intent';
select is(public.claim_instagram_send(:'timeout_intent'),'null'::jsonb,'expired sending lease never resent');
select is((select state from public.instagram_send_intents where id=:'timeout_intent'),'uncertain','expired lease uncertain');
select ok(not has_function_privilege('authenticated','public.ingest_instagram_event(uuid,jsonb)','execute'),'user cannot inject webhook');
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78924','externalId','self24','commentId','self24','mediaId','p24','senderExternalId','78924','text','GUIA','occurredAt',now()));
select is((select rule_id from public.instagram_events where external_id='self24'),null::uuid,'self-comment no rule');
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','foreign','externalId','x','occurredAt',now()))->>'state','ignored','foreign account ignored');
select throws_ok(format($$select public.ingest_instagram_event(%L,'{"kind":"message","accountId":"78924","externalId":"broken","text":"Hi","occurredAt":"invalid"}')$$,:'conn'),'22007',null,'invalid timestamp rolls back');
select is((select count(*)::int from public.instagram_events where external_id='broken'),0,'invalid event not persisted');
select is((select count(*)::int from public.messages where channel_id=:'chan' and direction='inbound'),1,'failures no inbound side effects');
select * from finish();
rollback;
