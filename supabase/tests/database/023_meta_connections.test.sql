begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
select tests.create_user('owner23@t.test', 'Owner') as ua \gset
select tests.create_user('other23@t.test', 'Other') as ub \gset
select tests.create_user('agent23@t.test', 'Agent') as ug \gset
select tests.create_org(:'ua', 'Org23A') as oa \gset
select tests.create_org(:'ub', 'Org23B') as ob \gset
select tests.add_member(:'oa', :'ug', 'agent');

select has_table('public', 'meta_connections', 'app connections exist');
select has_function('public', 'save_instagram_connection', array['uuid','uuid','jsonb'], 'privileged credential writer exists');
select ok(not has_table_privilege('authenticated','vault.decrypted_secrets','select'), 'authenticated cannot decrypt Vault');
select ok(not has_function_privilege('authenticated','public.save_instagram_connection(uuid,uuid,jsonb)','execute'), 'credential writer not user-callable');
select ok(not has_function_privilege('anon','public.read_meta_connection_secrets(uuid)','execute'), 'anonymous cannot read secrets');
select throws_ok(format($$select public.save_instagram_connection(%L,%L,'{"appId":"123","appSecret":"app-secret","accessToken":"access-secret","accountId":"789","apiVersion":"v26.0"}')$$, :'ua', :'ob'), '42501', null, 'owner cannot save in foreign organization');
select throws_ok(format($$select public.save_instagram_connection(%L,%L,'{"appId":"123","appSecret":"app-secret","accessToken":"access-secret","accountId":"789","apiVersion":"v26.0"}')$$, :'ug', :'oa'), '42501', null, 'agent cannot save');
select public.save_instagram_connection(:'ua', :'oa', '{"name":"Instagram A","appId":"123","appSecret":"app-secret","accessToken":"access-secret","accountId":"789","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select is((select status::text from public.channels where id=:'chan'), 'needs_setup', 'save does not activate');
select ok(not (:'saved'::jsonb ? 'appSecret') and not (:'saved'::jsonb ? 'accessToken'), 'save result contains no secrets');
select is(public.read_meta_connection_secrets(:'conn')->>'appSecret', 'app-secret', 'service can read correct secret');
-- Unverified claims across organizations: see 031. Same organization never duplicates an app.
select throws_ok(format($$select public.save_instagram_connection(%L,%L,'{"appId":"123","appSecret":"other","accessToken":"other","accountId":"790","apiVersion":"v26.0"}')$$, :'ua', :'oa'), '23505', null, 'app cannot be duplicated in the same organization');
select is((select count(*)::int from vault.secrets where name like 'flowai-meta-%'), 3, 'failed save leaves no orphan secrets');
select tests.authenticate_as(:'ua');
select throws_ok(format($$update public.channels set status='active' where id=%L$$, :'chan'), '42501', null, 'owner cannot activate Instagram by direct UPDATE');
select throws_ok(format($$update public.channels set meta_connection_id=null where id=%L$$, :'chan'), '42501', null, 'user cannot alter connection binding');
select tests.clear_authentication();
select public.set_meta_connection_verification(:'conn', 'token', true, null, 1);
select is((select status::text from public.channels where id=:'chan'), 'needs_setup', 'token verification alone insufficient');
select public.set_meta_connection_verification(:'conn', 'webhook', true, null, 1);
select is((select status::text from public.channels where id=:'chan'), 'active', 'both verifications activate');
select public.set_meta_connection_verification(:'conn', 'token', false, 'invalid_token', 1);
select is((select status::text from public.channels where id=:'chan'), 'error', 'invalid token blocks active channel');
select throws_ok(format($$select public.set_meta_connection_verification(%L,'token',true,null,0)$$, :'conn'), '40001', null, 'old credential verification cannot reactivate rotated connection');
select throws_ok(format($$insert into public.channels (organization_id,type,name,meta_connection_id) values (%L,'instagram','Foreign',%L)$$, :'ob', :'conn'), '23503', null, 'cross tenant FK blocks channel binding');
select tests.authenticate_as(:'ub');
select is((select count(*)::int from public.meta_connections), 0, 'connection metadata tenant isolated');
select * from finish();
rollback;
