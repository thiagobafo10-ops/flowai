begin;
-- Frete do carrinho vindo da Yampi.
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.cart(p_conn uuid,p_ext text,p_cart jsonb) returns uuid
language sql as $$
  select public.ingest_yampi_event(p_conn,jsonb_build_object('kind','cart','event','cart.reminder','merchantAlias','loja',
    'customer',jsonb_build_object('email','ana68@ex.com','name','Ana','phone','+5511987654321'),
    'cart',jsonb_build_object('externalId',p_ext,'token','tok-'||p_ext,'total',107.54,'recoveryUrl','https://x/r','items','[]'::jsonb)||p_cart),
    'h-'||p_ext||md5(p_cart::text));
  select id from public.store_carts where connection_id=p_conn and external_id=p_ext;
$$;

select tests.create_user('owner68@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org68') as oa \gset
select tests.authenticate_as(:'ua');
select public.save_store_connection(:'oa','loja','s3cr3t') as conn \gset
select tests.clear_authentication();

select pg_temp.cart(:'conn','c1','{"shipping":17.64}') as c1 \gset
select is((select shipping from public.store_carts where id=:'c1'),17.64::numeric,'shipping stored');
select pg_temp.cart(:'conn','c1','{"shipping":0}');
select is((select shipping from public.store_carts where id=:'c1'),0::numeric,'free shipping updates');
select pg_temp.cart(:'conn','c2','{}') as c2 \gset
select is((select shipping from public.store_carts where id=:'c2'),null,'missing shipping is null');

select tests.authenticate_as(:'ua');
select is(public.get_store_cart(:'oa',:'c1')->>'shipping','0.00','get_store_cart returns shipping');
select is(public.get_store_cart(:'oa',:'c2')->'shipping','null'::jsonb,'get_store_cart returns null shipping');
select tests.clear_authentication();

select * from finish();
rollback;
