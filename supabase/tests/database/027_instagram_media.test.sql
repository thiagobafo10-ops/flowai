begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
select tests.create_user('owner27@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org27A') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"127","appSecret":"app","accessToken":"access","accountId":"78927","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select tests.authenticate_as(:'ua');
select throws_ok(format($$select public.save_instagram_comment_rule(jsonb_build_object('channelId',%L,'keyword','guia','replyText','Aqui','mediaId','80001','active',false))$$,:'chan'),'22023',null,'unverified media cannot be selected through direct RPC');
select tests.clear_authentication();
select public.verify_instagram_media(:'conn',:'chan','80001',1);
select tests.authenticate_as(:'ua');
select lives_ok(format($$select public.save_instagram_comment_rule(jsonb_build_object('channelId',%L,'keyword','guia','replyText','Aqui','mediaId','80001','active',false))$$,:'chan'),'verified owned media can be selected');
select tests.clear_authentication();
select throws_ok(format($$select public.verify_instagram_media(%L,%L,'80002',0)$$,:'conn',:'chan'),'40001',null,'stale credential cannot validate media');
select ok(not has_function_privilege('authenticated','public.verify_instagram_media(uuid,uuid,text,integer)','execute'),'user cannot forge media seal');
select ok(not has_table_privilege('authenticated','public.instagram_verified_media','insert'),'user cannot write media seal');
select (select id from public.instagram_comment_rules where channel_id=:'chan') as rule \gset
update public.meta_connections set credential_generation=2 where id=:'conn';
select tests.authenticate_as(:'ua');
select lives_ok(format($$select public.save_instagram_comment_rule(jsonb_build_object('id',%L,'channelId',%L,'keyword','guia','replyText','Aqui','mediaId','80001','active',false))$$,:'rule',:'chan'),'unchanged post rule can be disabled after credentials rotate');
select * from finish();
rollback;
