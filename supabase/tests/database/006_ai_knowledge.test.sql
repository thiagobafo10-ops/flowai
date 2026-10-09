begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

select tests.create_user('a@t.test') as ua \gset
select tests.create_user('b@t.test') as ub \gset
select tests.create_user('view@t.test') as uview \gset
select tests.create_user('agent@t.test') as uagent \gset
select tests.create_user('admin@t.test') as uadmin \gset
select tests.create_org(:'ua', 'Org A') as org_a \gset
select tests.create_org(:'ub', 'Org B') as org_b \gset
select tests.add_member(:'org_a', :'uview', 'viewer');
select tests.add_member(:'org_a', :'uagent', 'agent');
select tests.add_member(:'org_a', :'uadmin', 'admin');

-- fixtures (postgres)
insert into public.contacts (id, organization_id, name) values
  ('00000000-0000-0000-0000-0000000000c1', :'org_a', 'Contato A'),
  ('00000000-0000-0000-0000-0000000000c2', :'org_b', 'Contato B');
insert into public.channels (id, organization_id, type, name, external_account_id) values
  ('00000000-0000-0000-0000-0000000000d1', :'org_a', 'whatsapp', 'WA A', 'phone-1'),
  ('00000000-0000-0000-0000-0000000000d2', :'org_b', 'whatsapp', 'WA B', 'phone-2');
insert into public.conversations (id, organization_id, contact_id, channel_id) values
  ('00000000-0000-0000-0000-0000000000e1', :'org_a', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000e2', :'org_b', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d2');
insert into public.messages (id, organization_id, conversation_id, channel_id, direction, sender_type, content) values
  ('00000000-0000-0000-0000-0000000000f1', :'org_a', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'inbound', 'contact', 'oi'),
  ('00000000-0000-0000-0000-0000000000f2', :'org_b', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d2', 'inbound', 'contact', 'oi B');
insert into public.ai_agents (id, organization_id, name) values
  ('00000000-0000-0000-0000-0000000000a2', :'org_b', 'Agente B');
insert into public.knowledge_documents (id, organization_id, title, content) values
  ('00000000-0000-0000-0000-0000000000b1', :'org_a', 'Doc A', 'conteudo A'),
  ('00000000-0000-0000-0000-0000000000b2', :'org_b', 'Doc B', 'conteudo B');
insert into public.knowledge_chunks (id, organization_id, document_id, chunk_index, content, token_count, embedding) values
  ('00000000-0000-0000-0000-0000000000a5', :'org_a', '00000000-0000-0000-0000-0000000000b1', 0, 'chunk A0', 3, array_fill(0.1::real, array[1536])::extensions.vector),
  ('00000000-0000-0000-0000-0000000000a6', :'org_b', '00000000-0000-0000-0000-0000000000b2', 0, 'chunk B0', 3, array_fill(0.1::real, array[1536])::extensions.vector);
insert into public.ai_classifications (id, organization_id, message_id, conversation_id, sentiment, lead_score, needs_human, model) values
  ('00000000-0000-0000-0000-0000000000a7', :'org_a', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'positive', 80, false, 'm1'),
  ('00000000-0000-0000-0000-0000000000a8', :'org_b', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2', 'neutral', 10, true, 'm1');

-- ai_agents: defaults
select is((select (auto_reply, human_handoff, is_active, tone)::text from public.ai_agents where id = '00000000-0000-0000-0000-0000000000a2'),
  '(f,t,f,"profissional e cordial")', 'defaults do agente');

-- ai_agents: admin+ escreve
select tests.authenticate_as(:'uagent');
select throws_ok(format($$insert into public.ai_agents(organization_id, name) values (%L, 'X')$$, :'org_a'), '42501', null, 'agent não insere ai_agents');
select tests.authenticate_as(:'uadmin');
select lives_ok(format($$insert into public.ai_agents(id, organization_id, name) values ('00000000-0000-0000-0000-0000000000a1', %L, 'Assistente')$$, :'org_a'), 'admin insere agente');
select throws_ok(format($$insert into public.ai_agents(organization_id, name) values (%L, 'Segundo')$$, :'org_a'), '23505', null, 'um único agente por org');
select lives_ok($$update public.ai_agents set is_active = true, auto_reply = true, tone = 'casual' where id = '00000000-0000-0000-0000-0000000000a1'$$, 'admin atualiza agente');
select throws_ok($$update public.ai_agents set organization_id = gen_random_uuid() where id = '00000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'organization_id do agente imutável');
select throws_ok($$update public.ai_agents set system_prompt = repeat('x', 8001) where id = '00000000-0000-0000-0000-0000000000a1'$$, '23514', null, 'system_prompt > 8000 chars falha');
select lives_ok($$update public.ai_agents set system_prompt = repeat('x', 8000) where id = '00000000-0000-0000-0000-0000000000a1'$$, 'system_prompt de 8000 chars ok');
select tests.authenticate_as(:'uagent');
update public.ai_agents set name = 'Hack' where id = '00000000-0000-0000-0000-0000000000a1';
delete from public.ai_agents where id = '00000000-0000-0000-0000-0000000000a1';
select tests.clear_authentication();
select is((select name from public.ai_agents where id = '00000000-0000-0000-0000-0000000000a1'), 'Assistente', 'agent não altera nem apaga agente');
select tests.authenticate_as(:'uview');
select is((select count(*)::int from public.ai_agents), 1, 'viewer lê agente da própria org');
select tests.authenticate_as(:'ub');
select is((select count(*)::int from public.ai_agents where organization_id = :'org_a'), 0, 'B não vê agente de A');
select throws_ok(format($$insert into public.ai_agents(organization_id, name) values (%L, 'X')$$, :'org_a'), '42501', null, 'B não insere agente em A');
select tests.authenticate_as(:'uadmin');
select lives_ok($$delete from public.ai_agents where id = '00000000-0000-0000-0000-0000000000a1'$$, 'admin apaga agente');
select tests.clear_authentication();
select is((select count(*)::int from public.ai_agents where organization_id = :'org_a'), 0, 'agente apagado');

-- knowledge_documents
select tests.authenticate_as(:'uagent');
select throws_ok(format($$insert into public.knowledge_documents(organization_id, title, content) values (%L, 't', 'c')$$, :'org_a'), '42501', null, 'agent não insere documento');
select tests.authenticate_as(:'uadmin');
select lives_ok(format($$insert into public.knowledge_documents(organization_id, title, content) values (%L, 'Novo', 'texto')$$, :'org_a'), 'admin insere documento');
select throws_ok(format($$insert into public.knowledge_documents(organization_id, title, content, status) values (%L, 't', 'c', 'ready')$$, :'org_a'), '42501', null, 'admin não define status na criação');
select throws_ok(format($$insert into public.knowledge_documents(organization_id, title, content) values (%L, repeat('x', 201), 'c')$$, :'org_a'), '23514', null, 'title > 200 chars falha');
select throws_ok(format($$insert into public.knowledge_documents(organization_id, title, content) values (%L, 't', repeat('x', 200001))$$, :'org_a'), '23514', null, 'content > 200000 chars falha');
select lives_ok($$update public.knowledge_documents set title = 'Novo 2', content = 'texto 2' where title like 'Novo%'$$, 'admin edita título e conteúdo');
select throws_ok($$update public.knowledge_documents set status = 'ready' where title like 'Novo%'$$, '42501', null, 'admin não altera status (worker)');
select throws_ok($$update public.knowledge_documents set error = 'x' where title like 'Novo%'$$, '42501', null, 'admin não altera error (worker)');
select tests.clear_authentication();
select is((select status::text from public.knowledge_documents where title like 'Novo%'), 'processing', 'status padrão processing');
select tests.authenticate_as(:'uagent');
update public.knowledge_documents set title = 'Hack' where title like 'Novo%';
select tests.clear_authentication();
select is((select title from public.knowledge_documents where title like 'Novo%'), 'Novo 2', 'agent não edita documento');
select tests.authenticate_as(:'uview');
select is((select count(*)::int from public.knowledge_documents), 2, 'viewer lê documentos da própria org');
select tests.authenticate_as(:'ub');
select is((select count(*)::int from public.knowledge_documents where organization_id = :'org_a'), 0, 'B não vê documentos de A');

-- knowledge_chunks: somente leitura para authenticated
select tests.authenticate_as(:'uagent');
select throws_ok(format($$insert into public.knowledge_chunks(organization_id, document_id, chunk_index, content, embedding) values (%L, '00000000-0000-0000-0000-0000000000b1', 5, 'x', array_fill(0.1::real, array[1536])::extensions.vector)$$, :'org_a'), '42501', null, 'agent não insere chunk');
select tests.authenticate_as(:'ua');
select throws_ok(format($$insert into public.knowledge_chunks(organization_id, document_id, chunk_index, content, embedding) values (%L, '00000000-0000-0000-0000-0000000000b1', 5, 'x', array_fill(0.1::real, array[1536])::extensions.vector)$$, :'org_a'), '42501', null, 'owner não insere chunk');
select throws_ok($$update public.knowledge_chunks set content = 'x'$$, '42501', null, 'owner não atualiza chunk');
select throws_ok($$delete from public.knowledge_chunks$$, '42501', null, 'owner não apaga chunk');
select is((select count(*)::int from public.knowledge_chunks), 1, 'owner lê chunks da própria org');
select tests.authenticate_as(:'ub');
select is((select count(*)::int from public.knowledge_chunks where organization_id = :'org_a'), 0, 'B não vê chunks de A');
select tests.clear_authentication();
select throws_ok(format($$insert into public.knowledge_chunks(organization_id, document_id, chunk_index, content, embedding) values (%L, '00000000-0000-0000-0000-0000000000b1', 0, 'dup', array_fill(0.1::real, array[1536])::extensions.vector)$$, :'org_a'), '23505', null, 'unique (document_id, chunk_index)');
select throws_ok(format($$insert into public.knowledge_chunks(organization_id, document_id, chunk_index, content, embedding) values (%L, '00000000-0000-0000-0000-0000000000b1', 1, 'cruzado', array_fill(0.1::real, array[1536])::extensions.vector)$$, :'org_b'), '23503', null, 'chunk não referencia documento de outra org');
select has_index('public', 'knowledge_chunks', 'knowledge_chunks_embedding_idx', 'índice hnsw do embedding');

-- ai_classifications: somente leitura para authenticated
select tests.authenticate_as(:'ua');
select throws_ok(format($$insert into public.ai_classifications(organization_id, message_id, conversation_id, sentiment, lead_score, needs_human, model) values (%L, '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'neutral', 5, false, 'm')$$, :'org_a'), '42501', null, 'owner não insere classificação');
select is((select count(*)::int from public.ai_classifications), 1, 'owner lê classificações da própria org');
select tests.authenticate_as(:'ub');
select is((select count(*)::int from public.ai_classifications where organization_id = :'org_a'), 0, 'B não vê classificações de A');
select tests.clear_authentication();
select throws_ok(format($$insert into public.ai_classifications(organization_id, message_id, conversation_id, sentiment, lead_score, needs_human, model) values (%L, '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'neutral', 5, false, 'm')$$, :'org_b'), '23503', null, 'classificação não referencia mensagem de outra org');
select throws_ok(format($$insert into public.ai_classifications(organization_id, message_id, conversation_id, sentiment, lead_score, needs_human, model) values (%L, '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'neutral', 101, false, 'm')$$, :'org_a'), '23514', null, 'lead_score > 100 falha');
select lives_ok(format($$insert into public.ai_classifications(organization_id, message_id, conversation_id, sentiment, lead_score, needs_human, model, suggested_stage) values (%L, '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'negative', 0, true, 'm', 'Proposta')$$, :'org_a'), 'service role (postgres) insere classificação');

-- cascata
select tests.authenticate_as(:'uadmin');
select lives_ok($$delete from public.knowledge_documents where id = '00000000-0000-0000-0000-0000000000b1'$$, 'admin apaga documento');
select tests.clear_authentication();
select is((select count(*)::int from public.knowledge_chunks where document_id = '00000000-0000-0000-0000-0000000000b1'), 0, 'apagar documento remove seus chunks');

select * from finish();
rollback;
