begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
select tests.create_user('a31@t.test','A') as ua \gset
select tests.create_user('b31@t.test','B') as ub \gset
select tests.create_user('c31@t.test','C') as uc \gset
select tests.create_org(:'ua','Org31A') as org_a31 \gset
select tests.create_org(:'ub','Org31B') as ob \gset
select tests.create_org(:'uc','Org31C') as oc \gset

-- Org A registra (sem verificar) o app e a conta que pertencem a B.
select public.save_instagram_connection(:'ua',:'org_a31','{"appId":"31001","appSecret":"a","accessToken":"a","accountId":"31789","apiVersion":"v26.0"}') as squat \gset
select (:'squat'::jsonb->>'connectionId') as squat_conn \gset
select lives_ok(format($$select public.save_instagram_connection(%L,%L,'{"appId":"31001","appSecret":"b","accessToken":"b","accountId":"31789","apiVersion":"v26.0"}')$$,:'ub',:'ob'),
  'claim não verificado de outra organização não bloqueia o cadastro');
select (select id from public.meta_connections where organization_id=:'ob') as conn_b \gset
select throws_ok(format($$select public.save_instagram_connection(%L,%L,'{"appId":"31001","appSecret":"b","accessToken":"b","accountId":"31790","apiVersion":"v26.0"}')$$,:'ub',:'ob'),
  '23505', null, 'mesma organização não duplica o app');
select lives_ok(format($$select public.set_meta_connection_verification(%L,'token',true,null,1)$$,:'conn_b'),
  'verificação de B não é bloqueada pelo claim não verificado de A');
select is((select count(*)::int from public.meta_connections where id=:'squat_conn'), 0, 'claim não verificado de A é removido quando B verifica');
select is((select count(*)::int from public.channels where organization_id=:'org_a31' and type='instagram'), 0, 'canal não verificado de A é removido');
select is((select count(*)::int from vault.secrets where name like 'flowai-meta-'||:'squat_conn'||'-%'), 0, 'segredos do claim removido são apagados');
select ok((select owner_verified_at is not null from public.meta_connections where id=:'conn_b'), 'B passa a ser o dono verificado');

-- Agora que B verificou, ninguém mais registra o mesmo app ou a mesma conta.
select throws_ok(format($$select public.save_instagram_connection(%L,%L,'{"appId":"31001","appSecret":"a","accessToken":"a","accountId":"31789","apiVersion":"v26.0"}')$$,:'ua',:'org_a31'),
  '23505', null, 'app verificado de outra organização bloqueia');
select throws_ok(format($$select public.save_instagram_connection(%L,%L,'{"appId":"31002","appSecret":"c","accessToken":"c","accountId":"31789","apiVersion":"v26.0"}')$$,:'uc',:'oc'),
  '23505', null, 'conta verificada de outra organização bloqueia mesmo com outro app');
select throws_ok(format($$insert into public.channels(organization_id,type,name,external_account_id,instagram_claimed) values(%L,'instagram','X','31789',true)$$,:'oc'),
  '23505', null, 'índice único garante uma única conta verificada');

-- Limpeza diária remove claims não verificados com mais de 24h, nunca o dono verificado.
select public.save_instagram_connection(:'uc',:'oc','{"appId":"31003","appSecret":"c","accessToken":"c","accountId":"31800","apiVersion":"v26.0"}') as old_claim \gset
select public.save_instagram_connection(:'ua',:'org_a31','{"appId":"31004","appSecret":"a","accessToken":"a","accountId":"31801","apiVersion":"v26.0"}') as new_claim \gset
alter table public.meta_connections disable trigger meta_connections_updated;
update public.meta_connections set created_at=now()-interval '25 hours', updated_at=now()-interval '25 hours' where id in ((:'old_claim'::jsonb->>'connectionId')::uuid, :'conn_b');
alter table public.meta_connections enable trigger meta_connections_updated;
select public.cleanup_instagram_events();
select is((select count(*)::int from public.meta_connections where id=(:'old_claim'::jsonb->>'connectionId')::uuid), 0, 'claim não verificado antigo é removido');
select is((select count(*)::int from vault.secrets where name like 'flowai-meta-'||(:'old_claim'::jsonb->>'connectionId')||'-%'), 0, 'segredos do claim antigo são apagados');
select is((select count(*)::int from public.meta_connections where id=(:'new_claim'::jsonb->>'connectionId')::uuid), 1, 'claim recente é mantido');
select is((select count(*)::int from public.meta_connections where id=:'conn_b'), 1, 'dono verificado nunca é limpo');

-- Desconectar libera a conta; o novo dono verificado assume.
select public.disconnect_instagram_connection(:'ub',:'ob',:'conn_b');
select public.save_instagram_connection(:'ua',:'org_a31','{"appId":"31001","appSecret":"a2","accessToken":"a2","accountId":"31789","apiVersion":"v26.0"}') as again \gset
select lives_ok(format($$select public.set_meta_connection_verification(%L,'token',true,null,1)$$,(:'again'::jsonb->>'connectionId')),
  'conta desconectada pode ser verificada por outra organização');
select is((select count(*)::int from public.meta_connections where id=:'conn_b'), 1, 'conexão desconectada de B é preservada');
select throws_ok(format($$select public.save_instagram_connection(%L,%L,'{"connectionId":"%s","appId":"31001","appSecret":"b2","accessToken":"b2","accountId":"31789","apiVersion":"v26.0"}')$$,:'ub',:'ob',:'conn_b'),
  '23505', null, 'reconectar B não toma a conta verificada por A');
select * from finish();
rollback;
