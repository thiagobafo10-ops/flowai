begin;
create extension if not exists pgtap with schema extensions;
select plan(2);
select tests.create_user('owner29@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org29A') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"129","appSecret":"app","accessToken":"access","accountId":"78929","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78929','externalId','m29','senderExternalId','929','text','Oi','occurredAt',now()));
select (select conversation_id from public.messages where external_id='m29') as conv \gset
select (select contact_id from public.conversations where id=:'conv') as contact \gset
select tests.authenticate_as(:'ua');
select public.create_instagram_send_intent(:'conv','Resposta',gen_random_uuid());
select lives_ok(format($$delete from public.contacts where id=%L$$,:'contact'),'contact deletion keeps existing CRM semantics after Instagram intent');
select tests.clear_authentication();
select is((select count(*)::int from public.instagram_send_intents where conversation_id=:'conv'),0,'conversation deletion removes associated send intents');
select * from finish();
rollback;
