begin;
-- Opção "celular do checkout vale como autorização de WhatsApp".
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.cart(p_conn uuid,p_ext text,p_email text) returns uuid
language sql as $$
  select public.ingest_yampi_event(p_conn,jsonb_build_object('kind','cart','event','cart.reminder','merchantAlias','loja',
    'customer',jsonb_build_object('email',p_email,'name','Ana Souza','phone','+5511987654321'),
    'cart',jsonb_build_object('externalId',p_ext,'token','tok-'||p_ext,'total',89.9,'recoveryUrl','https://allowed.host/r/'||p_ext,
      'items','[]'::jsonb)),'h-'||p_ext);
  select id from public.store_carts where connection_id=p_conn and external_id=p_ext;
$$;

select tests.create_user('owner66@t.test','Owner') as ua \gset
select tests.create_user('agent66@t.test','Agente') as ug \gset
select tests.create_org(:'ua','Org66') as oa \gset
select tests.add_member(:'oa',:'ug','agent');
select tests.authenticate_as(:'ua');
select public.save_store_connection(:'oa','loja','s3cr3t') as conn \gset
select tests.clear_authentication();
update public.store_connections set checkout_hosts='{allowed.host}' where id=:'conn';

select pg_temp.cart(:'conn','c1','ana66@ex.com') as c1 \gset
select contact_id as k1 from public.store_carts where id=:'c1' \gset

-- Desligada (padrão): continua exigindo autorização registrada.
select is(private.cart_whatsapp_block_reason(:'c1'),'Sem autorização de contato registrada','off by default: blocked');
select tests.authenticate_as(:'ua');
select is(public.get_store_cart(:'oa',:'c1')->'permission','null'::jsonb,'off: no permission shown');

-- Só admin liga; salvar sem o parâmetro mantém o valor.
select tests.authenticate_as(:'ug');
select throws_ok(format($$select public.save_cart_recovery_settings(%L,'Oi {link} tudo bem',array['allowed.host'],true)$$,:'oa'),
  '42501',null,'agent cannot enable');
select tests.authenticate_as(:'ua');
select lives_ok(format($$select public.save_cart_recovery_settings(%L,'Oi {link} tudo bem',array['allowed.host'],true)$$,:'oa'),'admin enables');
select lives_ok(format($$select public.save_cart_recovery_settings(%L,'Oi {link} tudo bem',array['allowed.host'])$$,:'oa'),'save without flag');
select is((select checkout_whatsapp_consent from public.cart_recovery_settings where organization_id=:'oa'),true,'flag kept when omitted');

-- Ligada: checkout vale como autorização e aparece como origem.
select tests.clear_authentication();
select is(private.cart_whatsapp_block_reason(:'c1'),null,'on: checkout counts as consent');
select tests.authenticate_as(:'ua');
select is(public.get_store_cart(:'oa',:'c1')->'permission'->>'status','granted','on: permission granted');
select is(public.get_store_cart(:'oa',:'c1')->'permission'->>'source','Checkout da Yampi','on: source is checkout');

-- Revogação e bloqueio continuam vencendo.
select tests.authenticate_as(:'ug');
select isnt(public.record_contact_permission(:'oa',:'k1','revoked','Pediu para não receber',now()-interval '1 minute'),null,'revoke');
select is(public.get_store_cart(:'oa',:'c1')->'permission'->>'status','revoked','revoked shown');
select tests.clear_authentication();
select is(private.cart_whatsapp_block_reason(:'c1'),'WhatsApp bloqueado pelo cliente','revoked still blocks');
select tests.authenticate_as(:'ug');
select public.set_contact_blocked(:'oa',(select contact_id from public.store_carts where id=:'c1'),true,'Spam');
select tests.clear_authentication();
select is(private.cart_whatsapp_block_reason(:'c1'),'Cliente bloqueado para contato','blocked still blocks');

-- Desligar volta a exigir autorização registrada.
select pg_temp.cart(:'conn','c2','bia66@ex.com') as c2 \gset
select tests.authenticate_as(:'ua');
select public.save_cart_recovery_settings(:'oa','Oi {link} tudo bem',array['allowed.host'],false);
select tests.clear_authentication();
select is(private.cart_whatsapp_block_reason(:'c2'),'Sem autorização de contato registrada','off again: blocked');

select * from finish();
rollback;
