begin;
-- Telefones de contatos antigos (full_number cru da Yampi) normalizados para +55 celular.
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. normalize_br_mobile segue normalizeBrazilMobile (packages/core/src/store/recovery.ts).
select is(private.normalize_br_mobile('(11) 98765-4321'),'+5511987654321','masked local mobile');
select is(private.normalize_br_mobile('5511987654321'),'+5511987654321','raw full_number');
select is(private.normalize_br_mobile('+55 11 98765-4321'),'+5511987654321','formatted E.164');
select is(private.normalize_br_mobile('1134567890'),null,'landline rejected');
select is(private.normalize_br_mobile('(00) 98765-4321'),null,'invalid DDD rejected');
select is(private.normalize_br_mobile(null),null,'null stays null');

select tests.create_user('owner65@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org65') as oa \gset
select tests.authenticate_as(:'ua');
select public.save_store_connection(:'oa','loja','s3cr3t') as conn \gset
select tests.clear_authentication();

-- 2. Backfill: cru vira +55; o que não normaliza fica intacto.
insert into public.contacts(organization_id,name,email,phone) values
  (:'oa','Raw','raw@ex.com','5511999990000'),
  (:'oa','Bad','bad@ex.com','1134567890'),
  (:'oa','Ok','ok@ex.com','+5511911112222');
select private.normalize_contact_phones();
select is((select phone from public.contacts where email='raw@ex.com'),'+5511999990000','raw phone normalized');
select is((select phone from public.contacts where email='bad@ex.com'),'1134567890','unnormalizable phone kept');

-- 3. Contato existente com telefone cru recebe o normalizado do novo cart.reminder.
insert into public.contacts(organization_id,name,email,phone) values(:'oa','Old','old@ex.com','5521988887777');
select public.ingest_yampi_event(:'conn',jsonb_build_object('kind','cart','event','cart.reminder','merchantAlias','loja',
  'customer',jsonb_build_object('email','old@ex.com','name','Old','phone','+5521988887777'),
  'cart',jsonb_build_object('externalId','c65a','token','tk65a','total',10,'recoveryUrl',null,'abandonedAt',null,
    'items','[]'::jsonb)),'h65a');
select is((select phone from public.contacts where email='old@ex.com'),'+5521988887777','existing raw phone replaced');
select is(private.cart_whatsapp_phone((select id from public.store_carts where external_id='c65a')),'+5521988887777',
  'cart_whatsapp_phone returns updated phone');

-- 4. Telefone válido existente nunca é sobrescrito.
select public.ingest_yampi_event(:'conn',jsonb_build_object('kind','cart','event','cart.reminder','merchantAlias','loja',
  'customer',jsonb_build_object('email','ok@ex.com','name','Ok','phone','+5511933334444'),
  'cart',jsonb_build_object('externalId','c65b','token','tk65b','total',10,'recoveryUrl',null,'abandonedAt',null,
    'items','[]'::jsonb)),'h65b');
select is((select phone from public.contacts where email='ok@ex.com'),'+5511911112222','valid phone kept');
select is((select count(*)::int from public.contacts where email='ok@ex.com'),1,'no duplicate contact');

select * from finish();
rollback;
