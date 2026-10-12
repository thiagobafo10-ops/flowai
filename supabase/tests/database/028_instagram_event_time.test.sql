begin;
create extension if not exists pgtap with schema extensions;
select plan(2);
select tests.create_user('owner28@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org28A') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"128","appSecret":"app","accessToken":"access","accountId":"78928","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select tests.authenticate_as(:'ua');
select public.save_instagram_comment_rule(jsonb_build_object('channelId',:'chan','keyword','guia','replyText','Aqui','active',true)) as rule \gset
select tests.clear_authentication();
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78928','externalId','c28','commentId','c28','mediaId','p28','senderExternalId','928','text','guia','occurredAt',date_trunc('second',now()))) as ev \gset
select is((select rule_id from public.instagram_events where external_id='c28'),:'rule'::uuid,'second precision callback captures current rule; worker checks real comment time');
select is(:'ev'::jsonb->>'state','pending','new comment not discarded within same second as rule creation');
select * from finish();
rollback;
