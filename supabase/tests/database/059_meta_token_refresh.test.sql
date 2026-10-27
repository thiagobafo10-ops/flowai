begin;
create extension if not exists pgtap with schema extensions;
select plan(30);
select tests.create_user('owner59@t.test','Owner') as ua \gset
select tests.create_user('other59@t.test','Other') as ub \gset
select tests.create_org(:'ua','Org59A') as oa \gset
select tests.create_org(:'ub','Org59B') as ob \gset

select has_column('public','channels','access_token_expires_at','canal guarda a expiração do token');
select has_column('public','channels','access_token_refreshed_at','canal guarda a última renovação do token');
select ok(not has_function_privilege('authenticated','public.meta_token_refresh_candidates()','execute'), 'candidatos não são do usuário');
select ok(not has_function_privilege('anon','public.meta_token_refresh_candidates()','execute'), 'anon não lê candidatos');
select ok(not has_function_privilege('anon','public.record_meta_token_refresh(uuid,integer,text,integer,text)','execute'), 'anon não grava renovação');
select ok(has_function_privilege('service_role','public.record_meta_token_refresh(uuid,integer,text,integer,text)','execute'), 'serviço grava renovação');
select ok(not has_function_privilege('authenticated','public.dispatch_meta_token_refresh()','execute'), 'disparo do cron não é do usuário');
select is((select schedule from cron.job where jobname='flowai-meta-token-refresh'), '0 6 * * *', 'cron diário às 06:00');

-- Canal ativo (A) e canal ainda em configuração (B).
select public.save_instagram_connection(:'ua', :'oa', '{"name":"Insta 59","appId":"5901","appSecret":"app-secret","accessToken":"access-secret","accountId":"78959","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select public.save_instagram_connection(:'ub', :'ob', '{"name":"Insta 59B","appId":"5902","appSecret":"app-secret-b","accessToken":"access-secret-b","accountId":"78960","apiVersion":"v26.0"}') as savedb \gset
select (:'savedb'::jsonb->>'channelId') as chanb \gset

-- Usuário autenticado não chama as funções de serviço.
select tests.authenticate_as(:'ua');
select throws_ok('select public.meta_token_refresh_candidates()', '42501', null, 'authenticated → 42501 nos candidatos');
select throws_ok(format('select public.record_meta_token_refresh(%L,1,%L,100,null)', :'chan', 'x'), '42501', null, 'authenticated → 42501 na gravação');
select tests.clear_authentication();

-- Token salvo agora (< 24 h) ainda não pode ser renovado pela Meta.
select is((select access_token_refreshed_at from public.channels where id=:'chan'), now(), 'salvar marca o token como recém-emitido');
select is(jsonb_array_length(public.meta_token_refresh_candidates()), 0, 'canal salvo agora não é candidato');
update public.channels set access_token_refreshed_at=now()-interval '2 days' where id in (:'chan', :'chanb');

select is(public.meta_token_refresh_candidates(),
  jsonb_build_array(jsonb_build_object('channelId',:'chan'::uuid,'generation',1,'accessToken','access-secret','apiVersion','v26.0')),
  'só o canal ativo com expiração desconhecida é candidato');
update public.meta_connections set disconnected_at=now() where id=:'conn';
select is(jsonb_array_length(public.meta_token_refresh_candidates()), 0, 'conexão desconectada não é candidata');
update public.meta_connections set disconnected_at=null where id=:'conn';

-- Renovação bem-sucedida: mesmo segredo no Vault, mesma geração.
select access_token_secret_id as secret_id from public.channels where id=:'chan' \gset
select public.record_meta_token_refresh(:'chan', 1, 'renewed-secret', 5184000, null);
select is((select decrypted_secret from vault.decrypted_secrets where id=:'secret_id'), 'renewed-secret', 'token novo gravado no mesmo segredo do Vault');
select is((select access_token_secret_id from public.channels where id=:'chan'), :'secret_id'::uuid, 'id do segredo não muda');
select is((select credential_generation from public.meta_connections where id=:'conn'), 1, 'refresh_keeps_generation: geração não muda');
select is((select access_token_expires_at from public.channels where id=:'chan'), now()+interval '5184000 seconds', 'expiração = agora + expires_in');
select is((select access_token_refreshed_at from public.channels where id=:'chan'), now(), 'renovação registrada');
select is(jsonb_array_length(public.meta_token_refresh_candidates()), 0, 'token renovado há menos de 24 h não é candidato');

-- Prazo e idade.
update public.channels set access_token_refreshed_at=now()-interval '2 days', access_token_expires_at=now()+interval '30 days' where id=:'chan';
select is(jsonb_array_length(public.meta_token_refresh_candidates()), 0, 'expiração distante (> 15 dias) não é candidata');
update public.channels set access_token_expires_at=now()+interval '10 days' where id=:'chan';
select is(public.meta_token_refresh_candidates()->0->>'accessToken', 'renewed-secret', 'expiração em < 15 dias e token com > 24 h é candidato');

-- Geração antiga é ignorada.
select public.record_meta_token_refresh(:'chan', 0, 'stale-secret', 100, null);
select is((select decrypted_secret from vault.decrypted_secrets where id=:'secret_id'), 'renewed-secret', 'geração antiga não grava token');
select public.record_meta_token_refresh(:'chan', 0, null, null, 'token_refresh_failed');
select is((select last_error from public.meta_connections where id=:'conn'), null, 'geração antiga não grava erro');

-- Falha vai para last_error e aparece na saúde.
select public.record_meta_token_refresh(:'chan', 1, null, null, 'token_refresh_failed');
select is((select last_error from public.meta_connections where id=:'conn'), 'token_refresh_failed', 'falha vai para last_error da conexão');
select throws_ok(format('select public.record_meta_token_refresh(%L,1,null,null,%L)', :'chan', 'access-secret leaked'), '22023', null, 'código de erro arbitrário é recusado');
select tests.authenticate_as(:'ua');
select is(public.ops_health(:'oa')->'channels'->0->>'tokenRefreshError', 'token_refresh_failed', 'ops_health mostra o erro de renovação');
select is((public.ops_health(:'oa')->'channels'->0->>'tokenExpiresAt')::timestamptz, now()+interval '10 days', 'ops_health mostra a expiração do token');
select tests.clear_authentication();

-- Nova renovação limpa o erro.
select public.record_meta_token_refresh(:'chan', 1, 'renewed-again', 5184000, null);
select is((select last_error from public.meta_connections where id=:'conn'), null, 'sucesso limpa o erro de renovação');

-- Trocar o token pelo painel reinicia o relógio da renovação.
update public.channels set access_token_refreshed_at=now()-interval '30 days', access_token_expires_at=now()+interval '1 day' where id=:'chan';
select public.save_instagram_connection(:'ua', :'oa', format('{"connectionId":"%s","name":"Insta 59","appId":"5901","appSecret":"app-secret","accessToken":"replaced-secret","accountId":"78959","apiVersion":"v26.0"}', :'conn')::jsonb);
select is((select row(access_token_refreshed_at, access_token_expires_at)::text from public.channels where id=:'chan'),
  row(now(), null::timestamptz)::text, 'token trocado: renovado agora, expiração desconhecida');
select * from finish();
rollback;
