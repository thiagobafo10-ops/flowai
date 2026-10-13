begin;
-- Authenticated automation authoring fixture (no privileged write bypass).
create function pg_temp.save_comment_automation(p_input jsonb) returns uuid
language plpgsql as $$
declare org uuid; aid uuid; t uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); e uuid:=gen_random_uuid();
begin
  select organization_id into org from public.channels where id=(p_input->>'channelId')::uuid;
  aid:=public.save_automation(org,(p_input->>'id')::uuid,'Comentário','instagram_comment',
    jsonb_build_object('channelId',p_input->>'channelId','mediaId',p_input->>'mediaId',
      'keywords',jsonb_build_array(p_input->>'keyword'),'mode','contains'),
    jsonb_build_object('nodes',jsonb_build_array(
      jsonb_build_object('id',t,'type','trigger','config','{}'::jsonb),
      jsonb_build_object('id',m,'type','message','config',jsonb_build_object('mode','text','text',p_input->>'replyText')),
      jsonb_build_object('id',e,'type','end','config','{}'::jsonb)),
      'edges',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'source',t,'target',m,'sourceHandle','default'),
        jsonb_build_object('id',gen_random_uuid(),'source',m,'target',e,'sourceHandle','default'))));
  if (p_input->>'active')::boolean then perform public.activate_automation(aid);
  else perform public.pause_automation(aid); end if;
  return aid;
end $$;
create extension if not exists pgtap with schema extensions;
select plan(8);
select tests.create_user('owner27@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org27A') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"127","appSecret":"app","accessToken":"access","accountId":"78927","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select tests.authenticate_as(:'ua');
select throws_ok(format($$select public.save_instagram_comment_rule(jsonb_build_object('channelId',%L,'keyword','guia','replyText','Aqui','mediaId','80001','active',false))$$,:'chan'),'42501',null,'legacy rule RPC is denied after migration');
select tests.clear_authentication();
select public.verify_instagram_media(:'conn',:'chan','80001',1);
select tests.authenticate_as(:'ua');
select lives_ok(format($$select pg_temp.save_comment_automation(jsonb_build_object('channelId',%L,'keyword','guia','replyText','Aqui','mediaId','80001','active',false))$$,:'chan'),'owned media configuration saved as automation; worker verifies ownership');
select tests.clear_authentication();
select throws_ok(format($$select public.verify_instagram_media(%L,%L,'80002',0)$$,:'conn',:'chan'),'40001',null,'stale credential cannot validate media');
select ok(not has_function_privilege('authenticated','public.verify_instagram_media(uuid,uuid,text,integer)','execute'),'user cannot forge media seal');
select ok(not has_table_privilege('authenticated','public.instagram_verified_media','insert'),'user cannot write media seal');
select (select id from public.automations where organization_id=:'oa') as rule \gset
update public.meta_connections set credential_generation=2 where id=:'conn';
select tests.authenticate_as(:'ua');
select lives_ok(format($$select public.pause_automation(%L)$$,:'rule'),'automation can be paused after credentials rotate');
select ok(not has_table_privilege('authenticated','public.instagram_comment_rules','insert'),'legacy insert privilege revoked');
select ok(not has_table_privilege('authenticated','public.instagram_comment_rules','update'),'legacy update privilege revoked');
select * from finish();
rollback;
