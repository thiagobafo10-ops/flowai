begin;
create extension if not exists pgtap with schema extensions;
select plan(75);
select tests.create_user('owner37a@t.test','Owner A') as ua \gset
select tests.create_user('owner37b@t.test','Owner B') as ub \gset
select tests.create_user('agent37@t.test','Agent') as uagent \gset
select tests.create_user('viewer37@t.test','Viewer') as uview \gset
select tests.create_org(:'ua','Org37A') as oa \gset
select tests.create_org(:'ub','Org37B') as ob \gset
select tests.add_member(:'oa',:'uagent','agent');
select tests.add_member(:'oa',:'uview','viewer');

-- vetor sintético: 1.0 nas dimensões a (e b)
create function pg_temp.vj(a int, b int default null) returns jsonb language sql as $$
  select jsonb_agg(case when g in (a, b) then 1.0 else 0.0 end order by g) from generate_series(1, 1536) g
$$;

-- estrutura
select has_column('public','knowledge_documents','generation','coluna generation');
select has_column('public','knowledge_documents','chunk_count','coluna chunk_count');
select ok(exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='knowledge_documents'),'realtime inclui knowledge_documents');

-- admin cria; nasce a tarefa de indexação
select tests.authenticate_as(:'ua');
select public.save_knowledge_document(:'oa', null, '  Título  ', 'Conteúdo do documento') as d1 \gset
select tests.clear_authentication();
select is((select title from public.knowledge_documents where id=:'d1'),'Título','título é aparado');
select is((select status::text||':'||generation||':'||chunk_count from public.knowledge_documents where id=:'d1'),'processing:1:0','documento nasce em processing, geração 1');
select is((select count(*)::int from public.ai_jobs where document_id=:'d1' and kind='index_document' and state='pending' and document_generation=1),1,'tarefa index_document geração 1');

-- papéis
select tests.authenticate_as(:'uagent');
select throws_ok(format($$select public.save_knowledge_document(%L,null,'T','C')$$,:'oa'),'42501',null,'agent não salva documento');
select throws_ok(format($$select public.reprocess_knowledge_document(%L)$$,:'d1'),'42501',null,'agent não reprocessa');
select tests.authenticate_as(:'uview');
select throws_ok(format($$select public.save_knowledge_document(%L,null,'T','C')$$,:'oa'),'42501',null,'viewer não salva documento');
select tests.authenticate_as(:'ub');
select throws_ok(format($$select public.save_knowledge_document(%L,null,'T','C')$$,:'oa'),'42501',null,'admin de outra org não salva');
select throws_ok(format($$select public.reprocess_knowledge_document(%L)$$,:'d1'),'42501',null,'admin de outra org não reprocessa');
select tests.clear_authentication();
select throws_ok(format($$select public.save_knowledge_document(%L,null,'T','C')$$,:'oa'),'42501',null,'sem autenticação não salva');

-- escrita direta é negada
select tests.authenticate_as(:'ua');
select throws_ok(format($$insert into public.knowledge_documents(organization_id,title,content) values (%L,'t','c')$$,:'oa'),'42501',null,'insert direto negado');
select throws_ok(format($$update public.knowledge_documents set title='x' where id=%L$$,:'d1'),'42501',null,'update direto negado');

-- validações
select throws_ok(format($$select public.save_knowledge_document(%L,null,'   ','C')$$,:'oa'),'22023',null,'título vazio');
select throws_ok(format($$select public.save_knowledge_document(%L,null,repeat('x',201),'C')$$,:'oa'),'22023',null,'título > 200');
select throws_ok(format($$select public.save_knowledge_document(%L,null,'T',E'  \n ')$$,:'oa'),'22023',null,'conteúdo só com espaços');
select throws_ok(format($$select public.save_knowledge_document(%L,null,'T',repeat('x',200001))$$,:'oa'),'22023',null,'conteúdo > 200000');
select throws_ok(format($$select public.save_knowledge_document(%L,gen_random_uuid(),'T','C')$$,:'oa'),'P0002',null,'documento inexistente');
select tests.clear_authentication();

-- documento de outra org não pode ser editado via p_org próprio
select tests.authenticate_as(:'ub');
select public.save_knowledge_document(:'ob', null, 'Doc B', 'conteúdo B') as dbb \gset
select tests.clear_authentication();
select tests.authenticate_as(:'ua');
select throws_ok(format($$select public.save_knowledge_document(%L,%L,'T','C')$$,:'oa',:'dbb'),'P0002',null,'documento de outra org dá P0002');
select tests.clear_authentication();

-- editar durante a indexação: tarefa antiga vira stale
-- job1 (geração 1) em execução
update public.ai_jobs set state='running', attempts=1, claim_token='00000000-0000-0000-0000-0000000037a1', claimed_until=now()+interval '3 minutes'
  where document_id=:'d1' and state='pending';
select (id)::uuid as j1 from public.ai_jobs where document_id=:'d1' \gset
select tests.authenticate_as(:'ua');
select public.save_knowledge_document(:'oa', :'d1', 'Título 2', 'Conteúdo novo');
select tests.clear_authentication();
select is((select generation from public.knowledge_documents where id=:'d1'),2,'edição incrementa a geração');
select is((select title||':'||content from public.knowledge_documents where id=:'d1'),'Título 2:Conteúdo novo','edição grava título e conteúdo');
select is((select state from public.ai_jobs where id=:'j1'),'running','tarefa em execução da geração antiga é mantida');
select is((select count(*)::int from public.ai_jobs where document_id=:'d1' and state='pending' and document_generation=2),1,'nova tarefa pendente geração 2');
select is(public.prepare_index_document(:'j1','00000000-0000-0000-0000-0000000037a1'),null,'prepare da tarefa antiga devolve null');
select is((select state from public.ai_jobs where id=:'j1'),'cancelled','tarefa antiga cancelada');
select is(public.prepare_index_document(:'j1','00000000-0000-0000-0000-0000000037ff'),null,'prepare com token errado devolve null');

-- complete da antiga devolve stale e não toca os chunks
select (id)::uuid as j2 from public.ai_jobs where document_id=:'d1' and state='pending' \gset
update public.ai_jobs set state='running', attempts=1, claim_token='00000000-0000-0000-0000-0000000037a2', claimed_until=now()+interval '3 minutes' where id=:'j2';
select tests.authenticate_as(:'ua');
select public.save_knowledge_document(:'oa', :'d1', 'Título 3', 'Conteúdo 3');
select tests.clear_authentication();
insert into public.knowledge_chunks(organization_id,document_id,chunk_index,content,token_count,embedding)
  values (:'oa',:'d1',0,'intocado',1,(pg_temp.vj(9))::text::extensions.vector);
select is(public.complete_index_document(:'j2','00000000-0000-0000-0000-0000000037a2',
  jsonb_build_array(jsonb_build_object('index',0,'content','velho','tokenCount',1,'embedding',pg_temp.vj(1)))),'stale','complete da antiga devolve stale');
select is((select state from public.ai_jobs where id=:'j2'),'cancelled','tarefa stale cancelada');
select is((select content from public.knowledge_chunks where document_id=:'d1' and chunk_index=0),'intocado','stale não toca os chunks');
select is((select status::text from public.knowledge_documents where id=:'d1'),'processing','stale não muda o status');

-- salvar de novo cancela a tarefa pendente anterior (sem colidir)
select (id)::uuid as j3 from public.ai_jobs where document_id=:'d1' and state='pending' \gset
select tests.authenticate_as(:'ua');
select public.save_knowledge_document(:'oa', :'d1', 'Título 4', 'Conteúdo 4');
select tests.clear_authentication();
select is((select state from public.ai_jobs where id=:'j3'),'cancelled','tarefa pendente anterior é cancelada');
select is((select count(*)::int from public.ai_jobs where document_id=:'d1' and state='pending'),1,'só uma tarefa pendente por documento');
select is((select count(*)::int from public.knowledge_chunks where document_id=:'d1'),0,'edição apaga os chunks');

-- prepare + complete da geração atual
select (id)::uuid as j4 from public.ai_jobs where document_id=:'d1' and state='pending' \gset
update public.ai_jobs set state='running', attempts=1, claim_token='00000000-0000-0000-0000-0000000037a4', claimed_until=now()+interval '3 minutes' where id=:'j4';
select is(public.prepare_index_document(:'j4','00000000-0000-0000-0000-0000000037a4'),
  jsonb_build_object('documentId',:'d1','organizationId',:'oa','generation',4,'title','Título 4','content','Conteúdo 4'),'prepare devolve o documento');
select throws_ok(format($$select public.complete_index_document(%L,%L,'[]'::jsonb)$$,:'j4','00000000-0000-0000-0000-0000000037ff'),'42501',null,'complete com token errado');
select throws_ok(format($$select public.complete_index_document(%L,%L,'{}'::jsonb)$$,:'j4','00000000-0000-0000-0000-0000000037a4'),'22023',null,'chunks que não é array');
select is(public.complete_index_document(:'j4','00000000-0000-0000-0000-0000000037a4',
  jsonb_build_array(
    jsonb_build_object('index',0,'content','chunk A','tokenCount',3,'embedding',pg_temp.vj(1)),
    jsonb_build_object('index',1,'content','chunk B','tokenCount',4,'embedding',pg_temp.vj(1,2)))),'done','complete devolve done');
select is((select status::text||':'||chunk_count||':'||coalesce(error,'-') from public.knowledge_documents where id=:'d1'),'ready:2:-','documento ready com chunk_count');
select is((select count(*)::int from public.knowledge_chunks where document_id=:'d1'),2,'chunks gravados');
select is((select state from public.ai_jobs where id=:'j4'),'done','tarefa done');
select throws_ok(format($$select public.complete_index_document(%L,%L,'[]'::jsonb)$$,:'j4','00000000-0000-0000-0000-0000000037a4'),'42501',null,'complete duas vezes é negado');

-- embedding com tamanho errado: sem escrita parcial
select tests.authenticate_as(:'ua');
select public.save_knowledge_document(:'oa', null, 'Doc ruim', 'texto') as d2 \gset
select tests.clear_authentication();
select (id)::uuid as j5 from public.ai_jobs where document_id=:'d2' \gset
update public.ai_jobs set state='running', attempts=1, claim_token='00000000-0000-0000-0000-0000000037a5', claimed_until=now()+interval '3 minutes' where id=:'j5';
select throws_ok(format($$select public.complete_index_document(%L,'00000000-0000-0000-0000-0000000037a5',
  jsonb_build_array(
    jsonb_build_object('index',0,'content','ok','tokenCount',1,'embedding',pg_temp.vj(1)),
    jsonb_build_object('index',1,'content','curto','tokenCount',1,'embedding','[0.1,0.2,0.3]'::jsonb)))$$,:'j5'),'22023',null,'embedding com tamanho errado');
select is((select count(*)::int from public.knowledge_chunks where document_id=:'d2'),0,'sem escrita parcial');
select is((select status::text from public.knowledge_documents where id=:'d2'),'processing','documento segue em processing');
select is((select state from public.ai_jobs where id=:'j5'),'running','tarefa segue running');
-- lista vazia é válida
select is(public.complete_index_document(:'j5','00000000-0000-0000-0000-0000000037a5','[]'::jsonb),'done','lista vazia é válida');
select is((select status::text||':'||chunk_count from public.knowledge_documents where id=:'d2'),'ready:0','ready com 0 chunks');

-- reprocess
select tests.authenticate_as(:'ua');
select tests.authenticate_as(:'ua'); select public.reprocess_knowledge_document(:'d1'); select tests.clear_authentication();
select tests.clear_authentication();
select is((select count(*)::int from public.knowledge_chunks where document_id=:'d1'),0,'reprocess apaga os chunks');
select is((select status::text||':'||generation||':'||chunk_count||':'||title||':'||content from public.knowledge_documents where id=:'d1'),'processing:5:0:Título 4:Conteúdo 4','reprocess volta a processing sem mudar título e conteúdo');
select is((select count(*)::int from public.ai_jobs where document_id=:'d1' and state='pending' and document_generation=5),1,'reprocess cria nova tarefa');

-- desistência
select (id)::uuid as j6 from public.ai_jobs where document_id=:'d1' and state='pending' \gset
update public.ai_jobs set state='running', attempts=3, claim_token='00000000-0000-0000-0000-0000000037a6', claimed_until=now()+interval '3 minutes' where id=:'j6';
select public.fail_ai_job(:'j6','00000000-0000-0000-0000-0000000037a6','not_configured',false);
select is((select status::text||':'||error from public.knowledge_documents where id=:'d1'),'error:IA não configurada na plataforma','not_configured vira mensagem específica');
select tests.authenticate_as(:'ua'); select public.reprocess_knowledge_document(:'d1'); select tests.clear_authentication();
select (id)::uuid as j7 from public.ai_jobs where document_id=:'d1' and state='pending' \gset
update public.ai_jobs set state='running', attempts=3, claim_token='00000000-0000-0000-0000-0000000037a7', claimed_until=now()+interval '3 minutes' where id=:'j7';
select public.fail_ai_job(:'j7','00000000-0000-0000-0000-0000000037a7','openai_http_500',true);
select is((select status::text||':'||error from public.knowledge_documents where id=:'d1'),'error:Não foi possível processar o documento. Tente reprocessar.','outra falha vira mensagem genérica');
-- desistência de geração antiga não altera o documento
select tests.authenticate_as(:'ua'); select public.reprocess_knowledge_document(:'d1'); select tests.clear_authentication();
update public.ai_jobs set state='running', attempts=3, claim_token='00000000-0000-0000-0000-0000000037a8', claimed_until=now()+interval '3 minutes' where id=:'j7';
select public.fail_ai_job(:'j7','00000000-0000-0000-0000-0000000037a8','openai_http_500',false);
select is((select status::text from public.knowledge_documents where id=:'d1'),'processing','desistência de geração antiga não marca erro');

-- busca vetorial
delete from public.knowledge_documents;
insert into public.knowledge_documents(id,organization_id,title,content,status,chunk_count) values
  ('00000000-0000-0000-0000-000000003701',:'oa','Pronto A','x','ready',3),
  ('00000000-0000-0000-0000-000000003702',:'oa','Processando A','x','processing',1),
  ('00000000-0000-0000-0000-000000003703',:'ob','Pronto B','x','ready',1);
insert into public.knowledge_chunks(id,organization_id,document_id,chunk_index,content,token_count,embedding) values
  ('00000000-0000-0000-0000-000000003711',:'oa','00000000-0000-0000-0000-000000003701',0,'exato',1,(pg_temp.vj(1))::text::extensions.vector),
  ('00000000-0000-0000-0000-000000003712',:'oa','00000000-0000-0000-0000-000000003701',1,'parecido',1,(pg_temp.vj(1,2))::text::extensions.vector),
  ('00000000-0000-0000-0000-000000003713',:'oa','00000000-0000-0000-0000-000000003701',2,'distante',1,(pg_temp.vj(3))::text::extensions.vector),
  ('00000000-0000-0000-0000-000000003714',:'oa','00000000-0000-0000-0000-000000003702',0,'em processamento',1,(pg_temp.vj(1))::text::extensions.vector),
  ('00000000-0000-0000-0000-000000003715',:'ob','00000000-0000-0000-0000-000000003703',0,'da org B',1,(pg_temp.vj(1))::text::extensions.vector);
select is((select array_agg(content order by similarity desc) from public.match_knowledge_chunks(:'oa',(pg_temp.vj(1))::text::extensions.vector)),
  array['exato','parecido'],'busca da org A: ordenada, com limiar, sem org B nem documento em processing');
select is((select round(similarity::numeric,3) from public.match_knowledge_chunks(:'oa',(pg_temp.vj(1))::text::extensions.vector) order by similarity desc limit 1),1.000,'similaridade 1 para vetor igual');
select is((select count(*)::int from public.match_knowledge_chunks(:'oa',(pg_temp.vj(1))::text::extensions.vector,1)),1,'respeita k');
select is((select array_agg(content) from public.match_knowledge_chunks(:'oa',(pg_temp.vj(1))::text::extensions.vector,5,0.8)),array['exato'],'respeita o limiar');
select is((select count(*)::int from public.match_knowledge_chunks(:'oa',(pg_temp.vj(1))::text::extensions.vector,5,0.0)),3,'limiar zero traz também o distante');
select is((select array_agg(content) from public.match_knowledge_chunks(:'ob',(pg_temp.vj(1))::text::extensions.vector)),array['da org B'],'busca da org B só vê a própria');
select is((select document_title from public.match_knowledge_chunks(:'ob',(pg_temp.vj(1))::text::extensions.vector)),'Pronto B','devolve o título do documento');
select throws_ok(format($$select * from public.match_knowledge_chunks(%L,'[1,2]'::extensions.vector)$$,:'oa'),'22023',null,'embedding de dimensão errada');

-- privilégios
select ok(not has_function_privilege('authenticated','public.match_knowledge_chunks(uuid,extensions.vector,integer,double precision)','execute'),'authenticated não executa match_knowledge_chunks');
select ok(not has_function_privilege('anon','public.match_knowledge_chunks(uuid,extensions.vector,integer,double precision)','execute'),'anon não executa match_knowledge_chunks');
select ok(has_function_privilege('service_role','public.match_knowledge_chunks(uuid,extensions.vector,integer,double precision)','execute'),'service_role executa match_knowledge_chunks');
select ok(not has_function_privilege('authenticated','public.complete_index_document(uuid,uuid,jsonb)','execute'),'authenticated não executa complete_index_document');
select ok(not has_function_privilege('authenticated','public.prepare_index_document(uuid,uuid)','execute'),'authenticated não executa prepare_index_document');
select ok(has_function_privilege('authenticated','public.save_knowledge_document(uuid,uuid,text,text)','execute'),'authenticated executa save_knowledge_document');
select ok(not has_function_privilege('anon','public.save_knowledge_document(uuid,uuid,text,text)','execute'),'anon não executa save_knowledge_document');
select ok(not has_function_privilege('anon','public.reprocess_knowledge_document(uuid)','execute'),'anon não executa reprocess_knowledge_document');
select ok(not has_function_privilege('authenticated','private.ai_job_gave_up(public.ai_jobs)','execute'),'authenticated não executa ai_job_gave_up');

-- delete por admin remove chunks e tarefas
insert into public.ai_jobs(organization_id,kind,document_id,document_generation) values (:'oa','index_document','00000000-0000-0000-0000-000000003701',1);
select tests.authenticate_as(:'ua');
select lives_ok($$delete from public.knowledge_documents where id='00000000-0000-0000-0000-000000003701'$$,'admin apaga documento');
select tests.clear_authentication();
select is((select count(*)::int from public.knowledge_chunks where document_id='00000000-0000-0000-0000-000000003701'),0,'apagar documento remove chunks');
select is((select count(*)::int from public.ai_jobs where document_id='00000000-0000-0000-0000-000000003701'),0,'apagar documento remove tarefas');
select tests.authenticate_as(:'uagent');
delete from public.knowledge_documents where id='00000000-0000-0000-0000-000000003702';
select tests.clear_authentication();
select is((select count(*)::int from public.knowledge_documents where id='00000000-0000-0000-0000-000000003702'),1,'agent não apaga documento');

select * from finish();
rollback;
