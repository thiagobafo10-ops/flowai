begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select tests.create_user('owner58@t.test','Dona') as ua \gset
select tests.create_user('viewer58@t.test','Viewer') as uv \gset
select tests.create_user('owner58b@t.test','Outra') as ub \gset
select tests.create_org(:'ua','Org58A') as oa \gset
select tests.create_org(:'ub','Org58B') as ob \gset
select tests.add_member(:'oa',:'uv','viewer');

create function pg_temp.n(p_k text) returns uuid language sql as $$ select md5('058' || p_k)::uuid $$;
select pg_temp.n('ig') as ig, pg_temp.n('igb') as igb, pg_temp.n('auto') as auto, pg_temp.n('auto2') as auto2,
  pg_temp.n('autob') as autob, pg_temp.n('m') as nm, pg_temp.n('k1') as k1, pg_temp.n('k2') as k2,
  pg_temp.n('k3') as k3, pg_temp.n('kb') as kb, pg_temp.n('c1') as c1, pg_temp.n('c2') as c2,
  pg_temp.n('cb') as cb \gset

insert into public.channels(id,organization_id,type,name,status) values
  (:'ig',:'oa','instagram','IG58','active'),
  (:'igb',:'ob','instagram','IG58B','active');

create function pg_temp.graph(p_k text) returns jsonb language sql as $$
  select jsonb_build_object(
    'nodes', jsonb_build_array(
      jsonb_build_object('id', pg_temp.n(p_k||'t'), 'type','trigger','config','{}'::jsonb,'position','{"x":0,"y":0}'::jsonb),
      jsonb_build_object('id', pg_temp.n('m'), 'type','message','config',
        '{"mode":"text","text":"Escolha","buttons":[{"id":"a1","title":"Sim","kind":"path"},{"id":"u1","title":"Site","kind":"url","url":"https://exemplo.com.br/oferta"}],"quickReplies":[]}'::jsonb,
        'position','{"x":0,"y":0}'::jsonb)),
    'edges', jsonb_build_array(jsonb_build_object('id', pg_temp.n(p_k||'e'), 'source', pg_temp.n(p_k||'t'),
      'target', pg_temp.n('m'), 'sourceHandle','default'))) $$;
create function pg_temp.automation(p_id uuid, p_org uuid, p_name text) returns void language sql as $$
  insert into public.automations (id, organization_id, name, trigger_type, trigger_config, status, activated_at, current_version)
    values (p_id, p_org, p_name, 'keyword_detected', '{"keywords":["x"],"mode":"contains"}', 'paused', now(), 1);
  insert into public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph)
    values (p_org, p_id, 1, 'keyword_detected', '{"keywords":["x"],"mode":"contains"}', pg_temp.graph(p_id::text)) $$;
select pg_temp.automation(:'auto',:'oa','Preço por DM');
select pg_temp.automation(:'auto2',:'oa','Boas-vindas');
select pg_temp.automation(:'autob',:'ob','De fora');

insert into public.contacts(id, organization_id, name, instagram_id, last_interaction_at) values
  (:'k1',:'oa','Maria Silva','5801', now() - interval '1 hour'),
  (:'k2',:'oa','João Souza','5802', now() - interval '2 hours'),
  (:'k3',:'oa','Marta Sem Execução', null, now()),
  (:'kb',:'ob','Maria de Fora','5809', now());
insert into public.conversations(id, organization_id, contact_id, channel_id) values
  (:'c1',:'oa',:'k1',:'ig'), (:'c2',:'oa',:'k2',:'ig'), (:'cb',:'ob',:'kb',:'igb');
-- comentário que mais tarde vira o @usuário do contato
insert into public.instagram_events(organization_id, channel_id, kind, external_id, payload, occurred_at, state)
  values (:'oa',:'ig','comment','cm58user','{"senderExternalId":"5801","senderName":"maria.silva","text":"oi","mediaId":"1"}', now(), 'done');

create function pg_temp.run(p_k text, p_auto uuid, p_org uuid, p_conv uuid, p_contact uuid, p_status public.run_status default 'completed')
returns uuid language plpgsql as $$
declare v_event uuid; v_run uuid;
begin
  insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, payload)
    values (p_org, 'automation_trigger', p_conv, p_contact, 'system', '{}') returning id into v_event;
  insert into public.automation_runs (id, organization_id, automation_id, trigger_event_id, conversation_id, contact_id,
      status, current_node_id, version)
    values (pg_temp.n('r' || p_k), p_org, p_auto, v_event, p_conv, p_contact, p_status, pg_temp.n('m'), 1)
    returning id into v_run;
  return v_run;
end $$;
select pg_temp.run('1',:'auto',:'oa',:'c1',:'k1') as r1, pg_temp.run('2',:'auto',:'oa',:'c2',:'k2') as r2,
  pg_temp.run('3',:'auto',:'oa',null,:'k1') as r3, pg_temp.run('4',:'auto2',:'oa',null,:'k2') as r4,
  pg_temp.run('b',:'autob',:'ob',:'cb',:'kb') as rb \gset

-- corpo do Instagram como o worker (toInstagramMessage) monta
select '{"attachment":{"type":"template","payload":{"template_type":"button","text":"Escolha","buttons":[{"type":"postback","title":"Sim","payload":"p"},{"type":"web_url","url":"https://exemplo.com.br/oferta","title":"Site"}]}}}'::jsonb as body \gset

-- =============================================================== estrutura
select has_table('public','tracked_links','tabela tracked_links');
select has_table('public','tracked_link_clicks','tabela tracked_link_clicks');
select is((select base_url from private.tracked_link_settings),'https://flowai-web-rust.vercel.app','base_url padrão');
select ok(not has_function_privilege('authenticated','private.tracked_button_url(uuid,text,text)','execute'),'authenticated não gera links');
select ok(has_function_privilege('anon','public.open_tracked_link(text)','execute'),'anon abre link');
select ok(not has_function_privilege('anon','public.automation_results(uuid,timestamptz,timestamptz,uuid)','execute'),'anon não lê resultados');
select ok(not has_function_privilege('anon','public.mcp_contacts(uuid,text,uuid,integer)','execute'),'anon não lista contatos');
select ok(not has_table_privilege('authenticated','public.tracked_links','insert'),'authenticated não escreve links');
select ok(not has_table_privilege('authenticated','public.tracked_link_clicks','insert'),'authenticated não escreve cliques');

-- =============================================================== mensagem do motor com botão de link
select (private.automation_deliver(:'r1', (select c from public.conversations c where id=:'c1'), :'nm', 'Escolha',
  '[{"id":"a1","title":"Sim","kind":"path"},{"id":"u1","title":"Site","kind":"url","url":"https://exemplo.com.br/oferta"}]',
  '[]', :'body', null)).intent_id as intent \gset
select (select message_payload#>>'{attachment,payload,buttons,1,url}' from public.instagram_send_intents where id=:'intent') as tracked \gset
select matches(:'tracked'::text,'^https://flowai-web-rust\.vercel\.app/r/[a-z0-9]{12}$','botão de link vira /r/<código>');
select is((select message_payload#>>'{attachment,payload,buttons,1,title}' from public.instagram_send_intents where id=:'intent'),'Site','título mantido');
select is((select message_payload#>>'{attachment,payload,buttons,0,payload}' from public.instagram_send_intents where id=:'intent'),'p','botão de caminho intacto');
select right(:'tracked',12) as code \gset
select is((select row(organization_id, automation_id, run_id, contact_id, button_title, url)::text from public.tracked_links where code=:'code'),
  row(:'oa'::uuid, :'auto'::uuid, :'r1'::uuid, :'k1'::uuid, 'Site', 'https://exemplo.com.br/oferta')::text,'link guarda organização, automação, execução, contato, botão e destino');
select is(private.tracked_button_url(:'r1','Site','https://exemplo.com.br/oferta'), :'tracked','reenvio reaproveita o código');
select is((select count(*)::int from public.tracked_links where run_id=:'r1'),1,'um link por execução + título + URL');
select isnt(private.tracked_button_url(:'r1','Site','https://exemplo.com.br/outra'), :'tracked','outra URL ganha outro código');
select isnt(private.tracked_button_url(:'r2','Site','https://exemplo.com.br/oferta'), :'tracked','outra execução ganha outro código');
select is(private.tracked_button_url(null,'Site','https://exemplo.com.br/oferta'),'https://exemplo.com.br/oferta','sem execução mantém a URL');
-- simulador / IA: corpo sem botões passa intacto
select is(private.automation_deliver(:'r1', (select c from public.conversations c where id=:'c1'), :'nm', 'Oi', null, null,
  '{"text":"Oi"}', null) is not null, true,'entrega sem botões funciona');
select is((select message_payload from public.instagram_send_intents where message_id=(select id from public.messages
  where conversation_id=:'c1' and content='Oi')),'{"text":"Oi"}'::jsonb,'corpo de texto intacto');
-- entrega de campanha/sequência (sem execução): sem rastreio
select (private.automation_deliver(null, (select c from public.conversations c where id=:'c2'), gen_random_uuid(), 'Escolha',
  null, null, :'body', null)).intent_id as ointent \gset
select is((select message_payload from public.instagram_send_intents where id=:'ointent'), :'body'::jsonb,'entrega sem execução não é rastreada');

-- =============================================================== resposta privada do comentário
select private.instagram_comment_body(:'r1', private.automation_graph_node(pg_temp.graph('x'), :'nm')) as cbody \gset
select is(:'cbody'::jsonb#>>'{attachment,payload,buttons,1,url}', :'tracked','resposta privada usa o mesmo link da execução');
-- execução pré-gerada no evento (ainda sem linha em automation_runs)
insert into public.instagram_events(organization_id, channel_id, kind, external_id, payload, occurred_at, state, automation_id,
  automation_version, automation_run_id)
  values (:'oa',:'ig','comment','cm58pre','{"senderExternalId":"5803","text":"x","mediaId":"1"}', now(), 'done', :'auto', 1,
    pg_temp.n('pre'));
select private.instagram_comment_body(pg_temp.n('pre'), private.automation_graph_node(pg_temp.graph('x'), :'nm')) as prebody \gset
select matches(:'prebody'::jsonb#>>'{attachment,payload,buttons,1,url}','^https://flowai-web-rust\.vercel\.app/r/[a-z0-9]{12}$','execução pré-gerada do comentário é rastreada');
select is((select row(organization_id, automation_id, contact_id)::text from public.tracked_links where run_id=pg_temp.n('pre')),
  row(:'oa'::uuid, :'auto'::uuid, null::uuid)::text,'link do comentário vem do evento');
select is(private.tracked_button_url(gen_random_uuid(),'Site','https://exemplo.com.br/oferta'),'https://exemplo.com.br/oferta','execução desconhecida mantém a URL');

-- =============================================================== sem base_url
update private.tracked_link_settings set base_url = null;
select is(private.tracked_button_url(:'r1','Site','https://exemplo.com.br/oferta'),'https://exemplo.com.br/oferta','sem base_url mantém a URL');
select is((private.instagram_comment_body(:'r2', private.automation_graph_node(pg_temp.graph('x'), :'nm')))#>>'{attachment,payload,buttons,1,url}',
  'https://exemplo.com.br/oferta','sem base_url o corpo do comentário mantém a URL');
update private.tracked_link_settings set base_url = 'https://flowai-web-rust.vercel.app';

-- =============================================================== open_tracked_link (anon)
set local role anon;
select is(public.open_tracked_link(:'code'),'https://exemplo.com.br/oferta','anon abre o link e recebe a URL');
select is(public.open_tracked_link('zzzzzzzzzzzz'),null,'código inexistente → null');
select is(public.open_tracked_link('../x'),null,'código malformado → null');
select is(public.open_tracked_link(repeat('a',200)),null,'código longo → null');
select is(public.open_tracked_link(null),null,'código nulo → null');
select throws_ok('select count(*) from public.tracked_links','42501',null,'anon não lê tracked_links');
select throws_ok('select count(*) from public.tracked_link_clicks','42501',null,'anon não lê tracked_link_clicks');
reset role;
select is((select count(*)::int from public.tracked_link_clicks c join public.tracked_links l on l.id=c.link_id where l.code=:'code'),1,'clique registrado');
select is((select c.organization_id from public.tracked_link_clicks c join public.tracked_links l on l.id=c.link_id where l.code=:'code'),:'oa'::uuid,'clique na organização do link');
set local role anon;
select is((select count(public.open_tracked_link(:'code'))::int from generate_series(1,40)),40,'40 aberturas seguidas devolvem a URL');
select is(public.open_tracked_link(:'code'),'https://exemplo.com.br/oferta','acima do limite ainda devolve a URL');
reset role;
select is((select count(*)::int from public.tracked_link_clicks c join public.tracked_links l on l.id=c.link_id where l.code=:'code'),30,'limite de 30 cliques/min por código');

-- RLS: membro lê a própria organização
select tests.authenticate_as(:'uv');
select ok((select count(*)::int from public.tracked_links) >= 1,'viewer lê links da organização');
select is((select count(*)::int from public.tracked_link_clicks),30,'viewer lê cliques da organização');
select tests.authenticate_as(:'ub');
select is((select count(*)::int from public.tracked_links),0,'outra organização não lê links');
select is((select count(*)::int from public.tracked_link_clicks),0,'outra organização não lê cliques');
select tests.clear_authentication();

-- =============================================================== automation_results
-- DMs: mensagem do motor enviada (r1), uma falha (não conta) e resposta privada enviada (r2)
update public.messages set status='sent' where conversation_id=:'c1' and context->'automation'->>'runId'=:'r1' and content='Escolha';
insert into public.messages(organization_id, conversation_id, channel_id, direction, sender_type, content, status, context)
  values (:'oa',:'c2',:'ig','outbound','automation','Falhou','failed',jsonb_build_object('automation',jsonb_build_object('runId',:'r2')));
insert into public.instagram_send_intents(organization_id, channel_id, kind, comment_id, text, state, automation_run_id)
  values (:'oa',:'ig','private_reply','cm58x','Oi','sent',:'r2'), (:'oa',:'ig','private_reply','cm58y','Oi','failed',:'r3');
-- respostas públicas: uma enviada, uma falha
insert into public.instagram_events(id, organization_id, channel_id, kind, external_id, payload, occurred_at, state, automation_id, automation_version)
  values (pg_temp.n('pe1'),:'oa',:'ig','comment','cm58p1','{"senderExternalId":"5801","text":"x","mediaId":"1"}', now(), 'done', :'auto', 1),
         (pg_temp.n('pe2'),:'oa',:'ig','comment','cm58p2','{"senderExternalId":"5802","text":"x","mediaId":"1"}', now(), 'done', :'auto', 1);
delete from public.instagram_comment_public_replies where event_id in (pg_temp.n('pe1'), pg_temp.n('pe2'));
insert into public.instagram_comment_public_replies(organization_id, channel_id, event_id, automation_id, automation_version, comment_id, text, state)
  values (:'oa',:'ig',pg_temp.n('pe1'),:'auto',1,'cm58p1','Te chamei no direct','sent'),
         (:'oa',:'ig',pg_temp.n('pe2'),:'auto',1,'cm58p2','Te chamei no direct','failed');
-- clique de botão de caminho (r1, opção a1 = "Sim")
insert into public.events(organization_id, type, conversation_id, contact_id, actor_type, payload)
  values (:'oa','button_clicked',:'c1',:'k1','contact',jsonb_build_object('runId',:'r1','nodeId',:'nm','optionId','a1'));
-- fora do período: execução e clique antigos
select pg_temp.run('old',:'auto',:'oa',null,:'k3') as rold \gset
update public.automation_runs set created_at = now() - interval '20 days' where id=:'rold';
insert into public.events(organization_id, type, conversation_id, contact_id, actor_type, payload, created_at)
  values (:'oa','button_clicked',:'c1',:'k1','contact',jsonb_build_object('runId',:'r1','nodeId',:'nm','optionId','a1'), now() - interval '20 days');

select tests.authenticate_as(:'uv');
select public.automation_results(:'oa', now() - interval '7 days', now() + interval '1 hour') as res \gset
select is(jsonb_array_length(:'res'::jsonb),2,'uma linha por automação da organização');
select (select x from jsonb_array_elements(:'res'::jsonb) x where x->>'automationId'=:'auto') as ra \gset
select is(:'ra'::jsonb->>'name','Preço por DM','nome');
select is(:'ra'::jsonb->>'status','paused','status');
select is((:'ra'::jsonb->>'runs')::int,3,'execuções no período (a antiga fica de fora)');
select is((:'ra'::jsonb->>'dmsSent')::int,2,'DMs enviadas: mensagem do motor + resposta privada (falhas e pendentes fora)');
select is((:'ra'::jsonb->>'publicReplies')::int,1,'respostas públicas enviadas');
select is(:'ra'::jsonb->'clicks','{"total":31,"byButton":{"Site":30,"Sim":1}}'::jsonb,'cliques de link e de caminho por botão');
select is((:'ra'::jsonb->>'uniqueContacts')::int,2,'contatos únicos das execuções');
select is(:'ra'::jsonb ?& array['automationId','name','status','runs','dmsSent','publicReplies','clicks','uniqueContacts'],true,'formato');
select is((select (x->>'runs')::int from jsonb_array_elements(:'res'::jsonb) x where x->>'automationId'=:'auto2'),1,'outra automação contada à parte');
select is((select x->'clicks' from jsonb_array_elements(:'res'::jsonb) x where x->>'automationId'=:'auto2'),'{"total":0,"byButton":{}}'::jsonb,'sem cliques');
select is(jsonb_array_length(public.automation_results(:'oa', now() - interval '7 days', now() + interval '1 hour', :'auto2')),1,'filtro por automação');
select is(public.automation_results(:'oa', now() - interval '7 days', now() + interval '1 hour', :'autob'),'[]'::jsonb,'automação de outra organização → vazio');
select is((select (x->>'runs')::int from jsonb_array_elements(public.automation_results(:'oa', now() - interval '30 days', now())) x
  where x->>'automationId'=:'auto'),4,'período maior inclui a execução antiga');
select throws_ok($$select public.automation_results('$$||:'oa'||$$', now() - interval '91 days', now())$$,'22023',null,'91 dias → 22023');
select lives_ok($$select public.automation_results('$$||:'oa'||$$', now() - interval '90 days', now())$$,'90 dias aceito');
select throws_ok($$select public.automation_results('$$||:'oa'||$$', now(), now() - interval '1 day')$$,'22023',null,'início depois do fim → 22023');
select throws_ok($$select public.automation_results('$$||:'oa'||$$', null, now())$$,'22023',null,'período nulo → 22023');
select throws_ok($$select public.automation_results('$$||:'ob'||$$', now() - interval '7 days', now())$$,'42501',null,'não membro → 42501');
select tests.authenticate_as(:'ub');
select is((select count(*)::int from jsonb_array_elements(public.automation_results(:'ob', now() - interval '7 days', now() + interval '1 hour'))),1,
  'outra organização só vê a sua');

-- =============================================================== mcp_contacts
select tests.authenticate_as(:'uv');
select public.mcp_contacts(:'oa', null, null, 100) as allc \gset
select is(jsonb_array_length(:'allc'::jsonb),3,'todos os contatos da organização');
select is(:'allc'::jsonb->0->>'name','Marta Sem Execução','ordenado pela última interação');
select (select x from jsonb_array_elements(:'allc'::jsonb) x where x->>'id'=:'k1') as c1row \gset
select is(:'c1row'::jsonb ?& array['id','name','username','lastInteractionAt','automations'],true,'formato do contato');
select is(:'c1row'::jsonb->>'username','maria.silva','@usuário do último comentário');
select is(:'c1row'::jsonb->'automations','["Preço por DM"]'::jsonb,'automações que o contato recebeu');
select is((select x->'automations' from jsonb_array_elements(:'allc'::jsonb) x where x->>'id'=:'k2'),'["Boas-vindas", "Preço por DM"]'::jsonb,'automações em ordem de nome');
select is((select array_agg(x->>'name' order by x->>'name') from jsonb_array_elements(public.mcp_contacts(:'oa', 'mar', null, 10)) x),
  array['Maria Silva','Marta Sem Execução'],'busca por nome (sem maiúsculas)');
select is((select array_agg(x->>'name') from jsonb_array_elements(public.mcp_contacts(:'oa', 'maria.silva', null, 10)) x),
  array['Maria Silva'],'busca por @usuário');
select is((select array_agg(x->>'name' order by x->>'name') from jsonb_array_elements(public.mcp_contacts(:'oa', null, :'auto2', 10)) x),
  array['João Souza'],'filtro por automação');
select is((select array_agg(x->>'name' order by x->>'name') from jsonb_array_elements(public.mcp_contacts(:'oa', 'maria', :'auto', 10)) x),
  array['Maria Silva'],'busca e automação combinadas');
select is(public.mcp_contacts(:'oa', 'mar', :'auto2', 10),'[]'::jsonb,'busca sem execução da automação → vazio');
select is(jsonb_array_length(public.mcp_contacts(:'oa', null, null, 1)),1,'limite');
select is(public.mcp_contacts(:'oa', '%', null, 10),'[]'::jsonb,'curingas da busca são literais');
select throws_ok($$select public.mcp_contacts('$$||:'oa'||$$', null, null, 0)$$,'22023',null,'limite 0 → 22023');
select throws_ok($$select public.mcp_contacts('$$||:'oa'||$$', null, null, 101)$$,'22023',null,'limite 101 → 22023');
select throws_ok($$select public.mcp_contacts('$$||:'ob'||$$', null, null, 10)$$,'42501',null,'não membro → 42501');
select tests.clear_authentication();

select * from finish();
rollback;
