begin;
-- E-mails da loja: conexão Yampi, entrada de eventos (carrinho/pedido) e agendamento da jornada de carrinho.
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.cart(p_conn uuid,p_ext text,p_token text,p_email text,p_name text,p_hash text) returns text
language sql as $$
  select public.ingest_yampi_event(p_conn,jsonb_build_object('kind','cart','event','cart.reminder','merchantAlias','loja',
    'customer',jsonb_build_object('email',p_email,'name',p_name,'phone','+5511999990000'),
    'cart',jsonb_build_object('externalId',p_ext,'token',p_token,'total',199.9,'recoveryUrl','https://loja.test/r/'||p_ext,
      'items',jsonb_build_array(jsonb_build_object('name','Camiseta','variant',null,'quantity',1,'price',199.9,'imageUrl',null)))),p_hash)->>'state'
$$;
create function pg_temp.ord(p_conn uuid,p_event text,p_ext text,p_cart_token text,p_email text,p_paid boolean,p_hash text) returns text
language sql as $$
  select public.ingest_yampi_event(p_conn,jsonb_build_object('kind','order','event',p_event,'merchantAlias','loja',
    'customer',jsonb_build_object('email',p_email,'name','Ana','phone',null),
    'order',jsonb_build_object('externalId',p_ext,'number','N'||p_ext,'statusAlias','created','paymentAlias','pix','total',199.9,
      'cartToken',p_cart_token,'paid',p_paid,'items','[]'::jsonb,'trackCode',null,'trackUrl',null)),p_hash)->>'state'
$$;

select tests.create_user('owner61@t.test','Owner') as ua \gset
select tests.create_user('agent61@t.test','Agent') as ub \gset
select tests.create_user('other61@t.test','Other') as uc \gset
select tests.create_org(:'ua','Org61') as oa \gset
select tests.create_org(:'uc','Org61b') as ob \gset
select tests.add_member(:'oa',:'ub','agent');

-- 1. Conexão: só admin salva; segredo só para service_role.
select tests.authenticate_as(:'ub');
select throws_ok(format('select public.save_store_connection(%L,%L,%L)',:'oa','loja','s3cr3t'),'42501',null,'non-admin cannot save store connection');
select tests.authenticate_as(:'ua');
select public.save_store_connection(:'oa','loja','s3cr3t') as conn \gset
select is(public.save_store_connection(:'oa','loja2','n0v0'),:'conn'::uuid,'saving again updates the same connection');
select throws_ok(format('select public.read_yampi_connection(%L)',:'conn'),'42501',null,'authenticated cannot read the connection secret');
select tests.clear_authentication();
select is(public.read_yampi_connection(:'conn'),jsonb_build_object('organizationId',:'oa','secret','n0v0'),'read_yampi_connection returns org and secret');
select is(public.read_yampi_connection(gen_random_uuid()),null,'unknown connection reads null');

-- 2. Jornada de carrinho com os 3 passos padrão.
select tests.authenticate_as(:'ua');
select public.set_email_journey_enabled(:'oa','cart',true) as journey \gset
select is(public.set_email_journey_enabled(:'oa','cart',true),:'journey'::uuid,'enabling again returns the same journey');
select tests.clear_authentication();
select is((select array_agg(delay_minutes order by position) from public.email_journey_steps where journey_id=:'journey'),
  array[60,1440,2880],'cart journey gets 3 default steps');

-- 3. Evento de carrinho: contato novo com e-mail normalizado e 3 envios agendados.
select is(pg_temp.cart(:'conn','c1','tok1','Ana@Ex.com','Ana Souza','h1'),'processed','cart event processed');
select id as ana from public.contacts where organization_id=:'oa' and email='ana@ex.com' \gset
select ok(:'ana' is not null,'new contact created with lowercased e-mail');
select id as cart1 from public.store_carts where connection_id=:'conn' and external_id='c1' \gset
select is((select array_agg(send_at-now() order by send_at) from public.email_sends where cart_id=:'cart1' and state='scheduled'),
  array[interval '60 minutes',interval '1440 minutes',interval '2880 minutes'],'3 scheduled sends at now()+delay');
select is((select count(*)::int from public.email_sends where cart_id=:'cart1' and contact_id=:'ana' and to_email='ana@ex.com'),3,'sends bound to the contact');

-- 4. Reminder repetido com outro corpo: não duplica envios.
select is(pg_temp.cart(:'conn','c1','tok1','ana@ex.com','Ana Souza','h2'),'processed','second reminder processed');
select is((select count(*)::int from public.email_sends where cart_id=:'cart1'),3,'reminder twice keeps 3 sends');

-- 5. Mesmo corpo: duplicado.
select is(pg_temp.cart(:'conn','c1','tok1','ana@ex.com','Ana Souza','h2'),'duplicate','same event and body hash is duplicate');

-- 6. Sem fusão por nome; mesmo e-mail reaproveita.
insert into public.contacts(organization_id,name) values(:'oa','Bia Lima');
select pg_temp.cart(:'conn','c2','tok2','bia@ex.com','Bia Lima','h3');
select is((select count(*)::int from public.contacts where organization_id=:'oa' and name='Bia Lima'),2,'no merge by name');
select is((select email from public.contacts c join public.store_carts s on s.contact_id=c.id where s.external_id='c2'),'bia@ex.com','new contact has the e-mail');
insert into public.contacts(organization_id,name,email) values(:'oa','Caio',' Caio@Ex.com ') returning id as caio \gset
select pg_temp.cart(:'conn','c3','tok3','caio@ex.com','Caio Outro','h4');
select is((select contact_id from public.store_carts where external_id='c3'),:'caio'::uuid,'existing contact with same e-mail reused');

-- 7. Jornada desligada: carrinho gravado, nenhum envio.
select tests.authenticate_as(:'ua');
select public.set_email_journey_enabled(:'oa','cart',false);
select tests.clear_authentication();
select is(pg_temp.cart(:'conn','c4','tok4','dani@ex.com','Dani','h5'),'processed','cart processed with journey off');
select is((select count(*)::int from public.email_sends s join public.store_carts c on c.id=s.cart_id where c.external_id='c4'),0,'journey off schedules nothing');
select ok(exists(select 1 from public.store_carts where external_id='c4'),'cart stored with journey off');
select tests.authenticate_as(:'ua');
select public.set_email_journey_enabled(:'oa','cart',true);
select tests.clear_authentication();
select is((select count(*)::int from public.email_journey_steps where journey_id=:'journey'),3,'re-enabling does not duplicate steps');

-- 8. Pedido com o token do carrinho: conversão cancela os envios.
select is(pg_temp.ord(:'conn','order.created','o1','tok1','ana@ex.com',false,'h6'),'processed','order processed');
select ok((select converted_at is not null from public.store_carts where id=:'cart1'),'cart marked converted');
select is((select array_agg(distinct state||'/'||cancel_reason) from public.email_sends where cart_id=:'cart1'),array['cancelled/converted'],'converted cart sends cancelled');
select is((select count(*)::int from public.store_orders where external_id='o1' and contact_id=:'ana'),1,'order stored for the contact');

-- 9. Pago cancela os envios de outro carrinho do mesmo contato.
select pg_temp.cart(:'conn','c5','tok5','ana@ex.com','Ana Souza','h7');
select id as cart5 from public.store_carts where external_id='c5' \gset
select is((select count(*)::int from public.email_sends where cart_id=:'cart5' and state='scheduled'),3,'new cart of the same contact scheduled');
select is(pg_temp.ord(:'conn','order.paid','o2',null,'ana@ex.com',true,'h8'),'processed','paid order processed');
select is((select array_agg(distinct state||'/'||cancel_reason) from public.email_sends where cart_id=:'cart5'),array['cancelled/paid'],'paid cancels contact cart sends');
select ok((select paid_at is not null from public.store_orders where external_id='o2'),'paid order has paid_at');

-- 10. Sem e-mail: ignorado.
select is(public.ingest_yampi_event(:'conn',jsonb_build_object('kind','cart','event','cart.reminder','merchantAlias','loja',
  'customer',jsonb_build_object('email',null,'name','X','phone',null),
  'cart',jsonb_build_object('externalId','c6','token','tok6','total',1,'recoveryUrl',null,'items','[]'::jsonb)),'h9')->>'state','ignored','missing e-mail ignored');
select is((select count(*)::int from public.store_carts where external_id='c6'),0,'no cart for missing e-mail');
select ok(exists(select 1 from public.store_events where connection_id=:'conn' and body_hash='h9'),'ignored event still recorded');
select is(public.ingest_yampi_event(:'conn','{"kind":"ignored","event":"product.created"}'::jsonb,'h10')->>'state','ignored','ignored kind');

-- 11. RLS: outra organização não vê; membro vê.
select tests.authenticate_as(:'uc');
select is((select count(*)::int from public.store_carts),0,'other org cannot see carts');
select is((select count(*)::int from public.email_sends),0,'other org cannot see sends');
select tests.authenticate_as(:'ub');
select ok((select count(*)::int from public.store_carts)>0,'member sees own carts');
select throws_ok($$insert into public.email_suppressions(organization_id,email,reason) values(gen_random_uuid(),'x@x.com','x')$$,'42501',null,'no direct writes');
select tests.clear_authentication();

-- Edição de passo (admin).
select id as step1 from public.email_journey_steps where journey_id=:'journey' and position=1 \gset
select tests.authenticate_as(:'ub');
select throws_ok(format('select public.save_email_journey_step(%L,%L,%L)',:'oa',:'step1','{"subject":"x"}'),'42501',null,'non-admin cannot edit step');
select tests.authenticate_as(:'ua');
select public.save_email_journey_step(:'oa',:'step1','{"subject":"Novo assunto","delayMinutes":30,"coupon":null}');
select tests.clear_authentication();
select is((select subject||'/'||delay_minutes||'/'||coupon from public.email_journey_steps where id=:'step1'),'Novo assunto/30/','step edited, untouched fields kept');

select * from finish();
rollback;
