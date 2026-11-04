begin;
-- Dois modelos de WhatsApp; o operador escolhe qual preparar.
create extension if not exists pgtap with schema extensions;
select no_plan();

select tests.create_user('owner67@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org67') as oa \gset
select tests.authenticate_as(:'ua');
select public.save_store_connection(:'oa','loja','s3cr3t') as conn \gset
select tests.clear_authentication();
update public.store_connections set checkout_hosts='{allowed.host}' where id=:'conn';
select public.ingest_yampi_event(:'conn',jsonb_build_object('kind','cart','event','cart.reminder','merchantAlias','loja',
  'customer',jsonb_build_object('email','ana67@ex.com','name','Ana Souza','phone','+5511987654321'),
  'cart',jsonb_build_object('externalId','c1','token','tok-c1','total',89.9,'recoveryUrl','https://allowed.host/r/c1','items','[]'::jsonb)),'h-c1');
select id as c1 from public.store_carts where connection_id=:'conn' and external_id='c1' \gset

select tests.authenticate_as(:'ua');
-- Sem configuração: os dois usam o modelo padrão.
select public.save_cart_recovery_settings(:'oa','Oi {primeiro_nome}, CUPOM10: {link}',array['allowed.host'],true) ;
select is(public.prepare_cart_whatsapp(:'oa',:'c1',gen_random_uuid()::text,2)->>'message',
  public.prepare_cart_whatsapp(:'oa',:'c1',gen_random_uuid()::text,1)->>'message','template 2 falls back to template 1 when unset');

select lives_ok(format($$select public.save_cart_recovery_settings(%L,'Oi {primeiro_nome}, CUPOM10: {link}',array['allowed.host'],null,'Olá {primeiro_nome}, CUPOM20: {link}')$$,:'oa'),
  'saves template 2');
select throws_ok(format($$select public.save_cart_recovery_settings(%L,'Oi {primeiro_nome}, CUPOM10: {link}',array['allowed.host'],null,'curto')$$,:'oa'),
  '22023',null,'short template 2 rejected');

select is(public.prepare_cart_whatsapp(:'oa',:'c1','rk-1')->>'message','Oi Ana, CUPOM10: https://allowed.host/r/c1','default slot is template 1');
select is(public.prepare_cart_whatsapp(:'oa',:'c1','rk-2',2)->>'message','Olá Ana, CUPOM20: https://allowed.host/r/c1','slot 2 uses template 2');
select throws_ok(format($$select public.prepare_cart_whatsapp(%L,%L,'rk-3',3)$$,:'oa',:'c1'),'22023',null,'invalid slot rejected');
select throws_ok(format($$select public.prepare_cart_whatsapp(%L,%L,'rk-2',1)$$,:'oa',:'c1'),'22023',null,'same key with other slot conflicts');
select tests.clear_authentication();

select is((select note from public.cart_contact_actions where request_key='rk-2'),'Modelo 2','history records template 2');
select is((select note from public.cart_contact_actions where request_key='rk-1'),'Modelo 1','history records template 1');
-- Salvar sem modelo 2 mantém o salvo.
select tests.authenticate_as(:'ua');
select public.save_cart_recovery_settings(:'oa','Oi {primeiro_nome}, CUPOM10: {link}',array['allowed.host']);
select tests.clear_authentication();
select is((select whatsapp_template_2 from public.cart_recovery_settings where organization_id=:'oa'),'Olá {primeiro_nome}, CUPOM20: {link}','template 2 kept when omitted');

select * from finish();
rollback;
