begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
select tests.create_user('owner32@t.test','Owner') as ua \gset
select tests.create_user('agent32@t.test','Agent') as ug \gset
select tests.create_user('other32@t.test','Other') as ub \gset
select tests.create_org(:'ua','Org32A') as oa \gset
select tests.create_org(:'ub','Org32B') as ob \gset
select tests.add_member(:'oa',:'ug','agent');
select public.save_instagram_connection(:'ua',:'oa','{"appId":"32001","appSecret":"a","accessToken":"a","accountId":"32789","apiVersion":"v26.0"}') as plain \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"32002","appSecret":"h","accessToken":"h","accountId":"32790","apiVersion":"v26.0"}') as hist \gset
select (:'plain'::jsonb->>'connectionId') as plain_conn \gset
select (:'plain'::jsonb->>'channelId') as plain_chan \gset
select (:'hist'::jsonb->>'connectionId') as hist_conn \gset
select (:'hist'::jsonb->>'channelId') as hist_chan \gset

-- Admin autenticado não cria nem apaga canais Instagram pela API.
select tests.authenticate_as(:'ua');
select throws_ok(format($$insert into public.channels(organization_id,type,name) values(%L,'instagram','Direto')$$,:'oa'), '42501', null, 'admin não insere canal Instagram');
select lives_ok(format($$insert into public.channels(organization_id,type,name) values(%L,'simulator','Simulador')$$,:'oa'), 'simulador continua permitido');
delete from public.channels where id=:'plain_chan';
select tests.clear_authentication();
select is((select count(*)::int from public.channels where id=:'plain_chan'), 1, 'admin não apaga canal Instagram');
select ok(not has_function_privilege('authenticated','public.remove_instagram_connection(uuid,uuid,uuid)','execute'), 'remoção é só de serviço');

-- Validação de ator.
select throws_ok(format($$select public.remove_instagram_connection(%L,%L,%L)$$,:'ug',:'oa',:'plain_conn'), '42501', null, 'agente não remove conexão');
select throws_ok(format($$select public.remove_instagram_connection(%L,%L,%L)$$,:'ub',:'ob',:'plain_conn'), '42501', null, 'outra organização não remove conexão');

-- Sem histórico: remove canal, conexão e segredos.
select public.remove_instagram_connection(:'ua',:'oa',:'plain_conn');
select is((select count(*)::int from public.channels where id=:'plain_chan'), 0, 'canal sem histórico removido');
select is((select count(*)::int from public.meta_connections where id=:'plain_conn'), 0, 'conexão sem histórico removida');
select is((select count(*)::int from vault.secrets where name like 'flowai-meta-'||:'plain_conn'||'-%' or name like 'flowai-meta-'||:'plain_chan'||'-%'), 0, 'segredos sem histórico apagados');

-- Com histórico: desconecta, apaga segredos e preserva o canal e as conversas.
select public.set_meta_connection_verification(:'hist_conn','token',true,null,1);
select public.set_meta_connection_verification(:'hist_conn','webhook',true,null,1);
select public.ingest_instagram_event(:'hist_conn',jsonb_build_object('kind','message','accountId','32790','externalId','m32','senderExternalId','932','text','Oi','occurredAt',now()));
select public.remove_instagram_connection(:'ua',:'oa',:'hist_conn');
select is((select count(*)::int from public.messages where external_id='m32'), 1, 'histórico preservado');
select ok((select disconnected_at is not null from public.meta_connections where id=:'hist_conn'), 'conexão com histórico fica desconectada');
select is((select status::text from public.channels where id=:'hist_chan'), 'needs_setup', 'canal com histórico deixa de receber');
select is((select count(*)::int from vault.secrets where name like 'flowai-meta-'||:'hist_conn'||'-%' or name like 'flowai-meta-'||:'hist_chan'||'-%'), 0, 'segredos com histórico apagados');
select is(public.read_meta_connection_secrets(:'hist_conn'), null, 'nenhum segredo legível após remover');

-- Reconectar com novas credenciais recria os segredos.
select public.save_instagram_connection(:'ua',:'oa',jsonb_build_object('connectionId',:'hist_conn','appId','32002','appSecret','novo','accessToken','novo-token','accountId','32790','apiVersion','v26.0'));
select is(public.read_meta_connection_secrets(:'hist_conn')->>'appSecret', 'novo', 'reconexão recria segredo do app');
select is(public.read_meta_connection_secrets(:'hist_conn')->'channels'->0->>'accessToken', 'novo-token', 'reconexão recria token de acesso');
select * from finish();
rollback;
