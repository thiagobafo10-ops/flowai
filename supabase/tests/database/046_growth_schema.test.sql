begin;
create extension if not exists pgtap with schema extensions;
select plan(115);
select tests.create_user('owner46@t.test','Owner46') as ua \gset
select tests.create_user('admin46@t.test','Admin46') as uadm \gset
select tests.create_user('agent46@t.test','Agent46') as uag \gset
select tests.create_user('viewer46@t.test','Viewer46') as uv \gset
select tests.create_user('owner46b@t.test','Owner46B') as ub \gset
select tests.create_org(:'ua','Org46A') as oa \gset
select tests.create_org(:'ub','Org46B') as ob \gset
select tests.add_member(:'oa',:'uadm','admin');
select tests.add_member(:'oa',:'uag','agent');
select tests.add_member(:'oa',:'uv','viewer');

-- fixtures (postgres)
insert into public.channels(id,organization_id,type,name,status) values
  ('00000000-0000-0000-0000-000000004601',:'oa','instagram','IG46','active'),
  ('00000000-0000-0000-0000-000000004602',:'oa','simulator','Sim46','active'),
  ('00000000-0000-0000-0000-000000004603',:'ob','instagram','IG46B','active');
insert into public.tags(id,organization_id,name) values
  ('00000000-0000-0000-0000-000000004611',:'oa','VIP'),
  ('00000000-0000-0000-0000-000000004612',:'ob','VIP B');
insert into public.contacts(id,organization_id,name) values
  ('00000000-0000-0000-0000-000000004621',:'oa','Ana'),
  ('00000000-0000-0000-0000-000000004622',:'oa','Bia'),
  ('00000000-0000-0000-0000-000000004623',:'ob','Caio');

create function pg_temp.msg(p_buttons int default 0) returns jsonb language sql as $$
  select jsonb_build_object('text','Oi {primeiro_nome}','buttons',
    coalesce((select jsonb_agg(jsonb_build_object('id','b'||i,'title','Ver','kind','url','url','https://x.test/'||i))
      from generate_series(1,p_buttons) i), '[]'::jsonb)) $$;
create function pg_temp.step(p_delay int, p_id text default null, p_window jsonb default 'null') returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('id',p_id)) ||
    jsonb_build_object('delayMinutes',p_delay,'window',p_window,'message',pg_temp.msg()) $$;
create function pg_temp.settings(p_channel text default '00000000-0000-0000-0000-000000004601') returns jsonb language sql as $$
  select jsonb_build_object('channelIds',jsonb_build_array(p_channel),'exitOnReply',false,'exitWords',jsonb_build_array('sair','parar')) $$;
create function pg_temp.audience(p_channels jsonb default '["00000000-0000-0000-0000-000000004601"]') returns jsonb language sql as $$
  select jsonb_build_object('channelIds',p_channels,'tagsAll','[]'::jsonb,'tagsAny','[]'::jsonb,'tagsNone','[]'::jsonb,
    'stageIds','[]'::jsonb,'minLeadScore',null,'lastInteractionDays',7,'entryLinkIds','[]'::jsonb) $$;

-- esquema
select ok('entry_link' = any (enum_range(null::public.automation_trigger_type)::text[]), 'gatilho entry_link');
select ok('sequence_enroll' = any (enum_range(null::public.automation_node_type)::text[]), 'bloco sequence_enroll');
select ok('sequence_remove' = any (enum_range(null::public.automation_node_type)::text[]), 'bloco sequence_remove');
select has_table('public','entry_links','entry_links existe');
select has_table('public','entry_link_hits','entry_link_hits existe');
select has_table('public','sequences','sequences existe');
select has_table('public','sequence_steps','sequence_steps existe');
select has_table('public','sequence_enrollments','sequence_enrollments existe');
select has_table('public','campaigns','campaigns existe');
select has_table('public','outreach_deliveries','outreach_deliveries existe');
select has_table('private','outreach_settings','outreach_settings existe');
select has_column('public','channels','instagram_username','channels.instagram_username');
select has_column('public','sequence_steps','removed_at','sequence_steps.removed_at');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
  and c.relname in ('entry_links','entry_link_hits','sequences','sequence_steps','sequence_enrollments','campaigns','outreach_deliveries')
  and c.relrowsecurity),7,'RLS habilitado nas 7 tabelas');
select is((select count(*)::int from pg_policies where schemaname='public'
  and tablename in ('entry_links','entry_link_hits','sequences','sequence_steps','sequence_enrollments','campaigns','outreach_deliveries')
  and cmd='SELECT' and roles='{authenticated}'),7,'uma policy de leitura para membros em cada tabela');
select is((select count(*)::int from pg_policies where schemaname='public'
  and tablename in ('entry_links','entry_link_hits','sequences','sequence_steps','sequence_enrollments','campaigns','outreach_deliveries')
  and cmd<>'SELECT'),0,'nenhuma policy de escrita');
select is((select count(*)::int from unnest(array['entry_links','entry_link_hits','sequences','sequence_steps',
  'sequence_enrollments','campaigns','outreach_deliveries']) t
  where has_table_privilege('anon','public.'||t,'select') or has_table_privilege('authenticated','public.'||t,'insert')
    or has_table_privilege('authenticated','public.'||t,'update') or has_table_privilege('authenticated','public.'||t,'delete')
    or has_table_privilege('authenticated','public.'||t,'truncate')),0,'anon não lê; authenticated não escreve');
select is((select campaign_rate_per_minute from private.outreach_settings),30,'ritmo padrão 30/min');
select ok(not has_table_privilege('authenticated','private.outreach_settings','select'),'authenticated não lê outreach_settings');
select ok(has_column_privilege('authenticated','public.channels','instagram_username','select'),'membro lê instagram_username');
select ok(not has_column_privilege('authenticated','public.channels','instagram_username','update'),'membro não grava instagram_username');
select ok(not has_function_privilege('anon','public.save_entry_link(uuid,uuid,jsonb)','execute'),'anon não executa save_entry_link');
select ok(not has_function_privilege('authenticated','public.record_instagram_username(uuid,text)','execute'),'authenticated não executa record_instagram_username');
select ok(has_function_privilege('service_role','public.record_instagram_username(uuid,text)','execute'),'service_role executa record_instagram_username');

-- permissões de papel (agent e viewer: 42501)
select tests.authenticate_as(:'uag');
select throws_ok(format($$select public.save_entry_link(%L,null,'{"name":"X","channelId":"00000000-0000-0000-0000-000000004601","tagId":null}')$$, :'oa'),'42501',null,'agent não salva link');
select throws_ok(format($$select public.save_sequence(%L,null,'S',%L,'[]')$$, :'oa', pg_temp.settings()),'42501',null,'agent não salva sequência');
select throws_ok(format($$select public.save_campaign(%L,null,'C',%L,%L)$$, :'oa', pg_temp.audience(), pg_temp.msg()),'42501',null,'agent não salva campanha');
select throws_ok($$select public.set_instagram_username('00000000-0000-0000-0000-000000004601','loja')$$,'42501',null,'agent não define usuário do Instagram');
select tests.authenticate_as(:'uv');
select throws_ok(format($$select public.save_entry_link(%L,null,'{"name":"X","channelId":"00000000-0000-0000-0000-000000004601","tagId":null}')$$, :'oa'),'42501',null,'viewer não salva link');
select throws_ok(format($$select public.save_sequence(%L,null,'S',%L,'[]')$$, :'oa', pg_temp.settings()),'42501',null,'viewer não salva sequência');
select throws_ok(format($$select public.save_campaign(%L,null,'C',%L,%L)$$, :'oa', pg_temp.audience(), pg_temp.msg()),'42501',null,'viewer não salva campanha');
select tests.authenticate_as(:'uadm');
select throws_ok(format($$select public.save_entry_link(%L,null,'{"name":"X","channelId":"00000000-0000-0000-0000-000000004603","tagId":null}')$$, :'ob'),'42501',null,'admin de A não salva link em B');

-- links de entrada
select public.save_entry_link(:'oa', null, '{"name":"Bio","channelId":"00000000-0000-0000-0000-000000004601","tagId":null}') as l1 \gset
select ok((select code ~ '^[a-z0-9]{8}$' from public.entry_links where id=:'l1'),'código gerado tem 8 caracteres [a-z0-9]');
select is((select status from public.entry_links where id=:'l1'),'active','link nasce ativo');
select public.save_entry_link(:'oa', null, '{"name":"Promo","channelId":"00000000-0000-0000-0000-000000004601","code":"promo10","tagId":"00000000-0000-0000-0000-000000004611"}') as l2 \gset
select is((select (code, tag_id)::text from public.entry_links where id=:'l2'),'(promo10,00000000-0000-0000-0000-000000004611)','código e tag do admin');
select throws_ok(format($$select public.save_entry_link(%L,null,'{"name":"Dup","channelId":"00000000-0000-0000-0000-000000004601","code":"promo10","tagId":null}')$$, :'oa'),'22023','code_taken','código duplicado no canal: code_taken');
select lives_ok(format($$select public.save_entry_link(%L,null,'{"name":"Sim","channelId":"00000000-0000-0000-0000-000000004602","code":"promo10","tagId":null}')$$, :'oa'),'mesmo código em outro canal');
select throws_ok(format($$select public.save_entry_link(%L,null,'{"name":"X","channelId":"00000000-0000-0000-0000-000000004601","code":"AB","tagId":null}')$$, :'oa'),'22023',null,'código inválido');
select throws_ok(format($$select public.save_entry_link(%L,null,'{"name":"  ","channelId":"00000000-0000-0000-0000-000000004601","tagId":null}')$$, :'oa'),'22023',null,'nome vazio');
select throws_ok(format($$select public.save_entry_link(%L,null,%L)$$, :'oa', jsonb_build_object('name',repeat('x',101),'channelId','00000000-0000-0000-0000-000000004601','tagId',null)),'22023',null,'nome > 100');
select throws_ok(format($$select public.save_entry_link(%L,null,'{"name":"X","channelId":"00000000-0000-0000-0000-000000004603","tagId":null}')$$, :'oa'),'22023',null,'canal de outra organização');
select throws_ok(format($$select public.save_entry_link(%L,null,'{"name":"X","channelId":"00000000-0000-0000-0000-000000004601","tagId":"00000000-0000-0000-0000-000000004612"}')$$, :'oa'),'22023',null,'tag de outra organização');
select lives_ok(format($$select public.save_entry_link(%L,%L,'{"name":"Bio 2","channelId":"00000000-0000-0000-0000-000000004601","tagId":null}')$$, :'oa', :'l1'),'editar sem código');
select is((select name from public.entry_links where id=:'l1'),'Bio 2','nome atualizado');
select ok((select code ~ '^[a-z0-9]{8}$' from public.entry_links where id=:'l1'),'código mantido ao editar sem código');
select throws_ok(format($$select public.save_entry_link(%L,%L,'{"name":"Bio","channelId":"00000000-0000-0000-0000-000000004601","code":"promo10","tagId":null}')$$, :'oa', :'l1'),'22023','code_taken','editar para código em uso: code_taken');
select throws_ok(format($$select public.save_entry_link(%L,%L,'{"name":"Bio","channelId":"00000000-0000-0000-0000-000000004602","tagId":null}')$$, :'oa', :'l1'),'22023',null,'canal do link é imutável');
select tests.authenticate_as(:'uag');
select throws_ok(format($$select public.archive_entry_link(%L)$$, :'l2'),'42501',null,'agent não arquiva');
select tests.authenticate_as(:'uadm');
select lives_ok(format($$select public.archive_entry_link(%L)$$, :'l2'),'admin arquiva');
select is((select status from public.entry_links where id=:'l2'),'archived','link arquivado');
select tests.clear_authentication();
insert into public.entry_links(id,organization_id,name,channel_id,code) values
  ('00000000-0000-0000-0000-000000004631',:'ob','LB','00000000-0000-0000-0000-000000004603','bbb');
select tests.authenticate_as(:'uadm');
select throws_ok($$select public.archive_entry_link('00000000-0000-0000-0000-000000004631')$$,'P0002',null,'arquivar link de outra org: P0002');
select throws_ok(format($$select public.save_entry_link(%L,'00000000-0000-0000-0000-000000004631','{"name":"X","channelId":"00000000-0000-0000-0000-000000004601","tagId":null}')$$, :'oa'),'P0002',null,'editar link de outra org: P0002');

-- sequências
select public.save_sequence(:'oa', null, 'Boas-vindas', pg_temp.settings(), jsonb_build_array(
  pg_temp.step(60), pg_temp.step(1440, null, '{"days":[1,2,3,4,5],"start":"09:00","end":"18:00"}'))) as s1 \gset
select is((select (name, status)::text from public.sequences where id=:'s1'),'(Boas-vindas,draft)','sequência criada em rascunho');
select is((select array_agg(delay_minutes order by position)::text from public.sequence_steps where sequence_id=:'s1'),'{60,1440}','passos nas posições 1..n');
select is((select "window"->>'start' from public.sequence_steps where sequence_id=:'s1' and position=2),'09:00','janela salva');
select id as st1 from public.sequence_steps where sequence_id=:'s1' and position=1 \gset
select id as st2 from public.sequence_steps where sequence_id=:'s1' and position=2 \gset
select throws_ok(format($$select public.save_sequence(%L,null,'S',%L,%L)$$, :'oa', pg_temp.settings(), jsonb_build_array(pg_temp.step(0))),'22023',null,'espera 0 rejeitada');
select throws_ok(format($$select public.save_sequence(%L,null,'S',%L,%L)$$, :'oa', pg_temp.settings(), jsonb_build_array(pg_temp.step(43201))),'22023',null,'espera > 30 dias rejeitada');
select throws_ok(format($$select public.save_sequence(%L,null,'S',%L,%L)$$, :'oa', pg_temp.settings(),
  jsonb_build_array(pg_temp.step(5, null, '{"days":[1],"start":"18:00","end":"09:00"}'))),'22023',null,'janela com início >= fim rejeitada');
select throws_ok(format($$select public.save_sequence(%L,null,'S',%L,%L)$$, :'oa', pg_temp.settings(),
  jsonb_build_array(jsonb_set(pg_temp.step(5), '{message}', pg_temp.msg(4)))),'22023',null,'4 botões rejeitados');
select throws_ok(format($$select public.save_sequence(%L,null,'S',%L,'[]')$$, :'oa', '{"channelIds":[]}'),'22023',null,'sem canais rejeitado');
select throws_ok(format($$select public.save_sequence(%L,null,'S',%L,'[]')$$, :'oa', pg_temp.settings('00000000-0000-0000-0000-000000004603')),'22023',null,'canal de outra org rejeitado');
select throws_ok(format($$select public.save_sequence(%L,null,'',%L,'[]')$$, :'oa', pg_temp.settings()),'22023',null,'nome vazio rejeitado');
-- reordenar: st2 vira 1º, novo passo 2º; st1 (sem entregas) é apagado
select lives_ok(format($$select public.save_sequence(%L,%L,'Boas-vindas',%L,%L)$$, :'oa', :'s1', pg_temp.settings(),
  jsonb_build_array(pg_temp.step(30, :'st2'), pg_temp.step(90))),'reordenar passos');
select is((select position from public.sequence_steps where id=:'st2'),1,'id mantido e reposicionado');
select is((select count(*)::int from public.sequence_steps where id=:'st1'),0,'passo sem entregas é apagado');
select is((select delay_minutes from public.sequence_steps where sequence_id=:'s1' and position=2),90,'novo passo na posição 2');
-- passo com entrega enviada é marcado como removido
select tests.clear_authentication();
insert into public.sequence_enrollments(id,organization_id,sequence_id,contact_id,channel_id,current_position) values
  ('00000000-0000-0000-0000-000000004641',:'oa',:'s1','00000000-0000-0000-0000-000000004621','00000000-0000-0000-0000-000000004601',2);
insert into public.outreach_deliveries(organization_id,source,enrollment_id,step_id,contact_id,channel_id,status) values
  (:'oa','sequence','00000000-0000-0000-0000-000000004641',:'st2','00000000-0000-0000-0000-000000004621','00000000-0000-0000-0000-000000004601','sent');
select throws_ok(format($$insert into public.outreach_deliveries(organization_id,source,enrollment_id,step_id,contact_id,channel_id) values (%L,'sequence','00000000-0000-0000-0000-000000004641',%L,'00000000-0000-0000-0000-000000004621','00000000-0000-0000-0000-000000004601')$$, :'oa', :'st2'),'23505',null,'uma entrega por (inscrição, passo)');
select tests.authenticate_as(:'uadm');
select lives_ok(format($$select public.save_sequence(%L,%L,'Boas-vindas',%L,%L)$$, :'oa', :'s1', pg_temp.settings(),
  jsonb_build_array(pg_temp.step(15))),'remover passo enviado');
select tests.clear_authentication();
select is((select (position is null, removed_at is not null)::text from public.sequence_steps where id=:'st2'),'(t,t)','passo enviado fica como removido');
select is((select array_agg(delay_minutes order by position)::text from public.sequence_steps where sequence_id=:'s1' and removed_at is null),'{15}','passos ativos 1..n');
select lives_ok($$set constraints all immediate$$,'posições únicas por sequência');
set constraints all deferred;
select tests.authenticate_as(:'uadm');
select throws_ok(format($$select public.save_sequence(%L,%L,'Boas-vindas',%L,%L)$$, :'oa', :'s1', pg_temp.settings(),
  jsonb_build_array(pg_temp.step(15, :'st2'))),'22023',null,'passo removido não volta pelo id');
select public.save_sequence(:'oa', null, 'Outra', pg_temp.settings(), jsonb_build_array(pg_temp.step(5))) as s2 \gset
select throws_ok(format($$select public.save_sequence(%L,%L,'Outra',%L,%L)$$, :'oa', :'s2', pg_temp.settings(),
  jsonb_build_array(pg_temp.step(5, (select id::text from public.sequence_steps where sequence_id=:'s1' and removed_at is null)))),'22023',null,'id de passo de outra sequência rejeitado');
-- status
select tests.authenticate_as(:'uag');
select throws_ok(format($$select public.set_sequence_status(%L,'active')$$, :'s1'),'42501',null,'agent não ativa sequência');
select tests.authenticate_as(:'uadm');
select lives_ok(format($$select public.set_sequence_status(%L,'active')$$, :'s1'),'admin ativa sequência');
select is((select status from public.sequences where id=:'s1'),'active','sequência ativa');
select throws_ok(format($$select public.set_sequence_status(%L,'draft')$$, :'s1'),'22023',null,'status inválido');
select public.save_sequence(:'oa', null, 'Vazia', pg_temp.settings(), '[]') as s3 \gset
select throws_ok(format($$select public.set_sequence_status(%L,'active')$$, :'s3'),'22023',null,'sequência sem passos não ativa');
-- um ativo por (sequência, contato)
select tests.clear_authentication();
select throws_ok(format($$insert into public.sequence_enrollments(organization_id,sequence_id,contact_id,channel_id) values (%L,%L,'00000000-0000-0000-0000-000000004621','00000000-0000-0000-0000-000000004601')$$, :'oa', :'s1'),'23505',null,'segunda inscrição ativa rejeitada');
update public.sequence_enrollments set status='completed' where id='00000000-0000-0000-0000-000000004641';
select lives_ok(format($$insert into public.sequence_enrollments(id,organization_id,sequence_id,contact_id,channel_id) values ('00000000-0000-0000-0000-000000004642',%L,%L,'00000000-0000-0000-0000-000000004621','00000000-0000-0000-0000-000000004601')$$, :'oa', :'s1'),'nova inscrição ativa após concluir');
-- excluir cancela entregas pendentes
insert into public.outreach_deliveries(id,organization_id,source,enrollment_id,step_id,contact_id,channel_id,status) values
  ('00000000-0000-0000-0000-000000004651',:'oa','sequence','00000000-0000-0000-0000-000000004642',
   (select id from public.sequence_steps where sequence_id=:'s1' and removed_at is null),
   '00000000-0000-0000-0000-000000004621','00000000-0000-0000-0000-000000004601','pending');
select tests.authenticate_as(:'uag');
select throws_ok(format($$select public.delete_sequence(%L)$$, :'s1'),'42501',null,'agent não exclui sequência');
select tests.authenticate_as(:'uadm');
select lives_ok(format($$select public.delete_sequence(%L)$$, :'s1'),'admin exclui sequência');
select tests.clear_authentication();
select is((select count(*)::int from public.sequences where id=:'s1'),0,'sequência excluída');
select is((select (status, reason)::text from public.outreach_deliveries where id='00000000-0000-0000-0000-000000004651'),'(cancelled,sequence_deleted)','entrega pendente cancelada');

-- campanhas
select tests.authenticate_as(:'uadm');
select public.save_campaign(:'oa', null, 'Black Friday', pg_temp.audience(), pg_temp.msg(2)) as c1 \gset
select is((select (name, status)::text from public.campaigns where id=:'c1'),'("Black Friday",draft)','campanha em rascunho');
select throws_ok(format($$select public.save_campaign(%L,null,'C',%L,%L)$$, :'oa', pg_temp.audience('[]'), pg_temp.msg()),'22023',null,'público sem canais rejeitado');
select throws_ok(format($$select public.save_campaign(%L,null,'C',%L,%L)$$, :'oa', pg_temp.audience(), '{"text":""}'),'22023',null,'mensagem vazia rejeitada');
select throws_ok(format($$select public.save_campaign(%L,null,'C',%L,%L)$$, :'oa', pg_temp.audience(),
  '{"text":"x","buttons":[{"id":"a","title":"A","kind":"url","url":"http://x.test"}]}'),'22023',null,'botão sem https rejeitado');
select lives_ok(format($$select public.save_campaign(%L,%L,'Black Friday 2',%L,%L)$$, :'oa', :'c1', pg_temp.audience(), pg_temp.msg()),'editar rascunho');
select is((select name from public.campaigns where id=:'c1'),'Black Friday 2','rascunho editado');
select tests.clear_authentication();
update public.campaigns set status='scheduled', scheduled_at=now() + interval '1 hour' where id=:'c1';
select tests.authenticate_as(:'uadm');
select throws_ok(format($$select public.save_campaign(%L,%L,'X',%L,%L)$$, :'oa', :'c1', pg_temp.audience(), pg_temp.msg()),'22023',null,'save_campaign fora de draft: 22023');
select throws_ok(format($$select public.delete_campaign(%L)$$, :'c1'),'22023',null,'delete_campaign fora de draft: 22023');
select public.save_campaign(:'oa', null, 'Rascunho', pg_temp.audience(), pg_temp.msg()) as c2 \gset
select tests.authenticate_as(:'uv');
select throws_ok(format($$select public.delete_campaign(%L)$$, :'c2'),'42501',null,'viewer não exclui campanha');
select tests.authenticate_as(:'uadm');
select lives_ok(format($$select public.delete_campaign(%L)$$, :'c2'),'admin exclui rascunho');
select tests.clear_authentication();
select is((select count(*)::int from public.campaigns where id=:'c2'),0,'rascunho excluído');
insert into public.campaigns(id,organization_id,name,audience,message) values
  ('00000000-0000-0000-0000-000000004661',:'ob','CB','{}','{}');
insert into public.outreach_deliveries(organization_id,source,campaign_id,contact_id,channel_id) values
  (:'oa','campaign',:'c1','00000000-0000-0000-0000-000000004622','00000000-0000-0000-0000-000000004601');
select throws_ok(format($$insert into public.outreach_deliveries(organization_id,source,campaign_id,contact_id,channel_id) values (%L,'campaign',%L,'00000000-0000-0000-0000-000000004622','00000000-0000-0000-0000-000000004601')$$, :'oa', :'c1'),'23505',null,'uma entrega por contato por campanha');
select tests.authenticate_as(:'uadm');
select throws_ok(format($$select public.save_campaign(%L,'00000000-0000-0000-0000-000000004661','X',%L,%L)$$, :'oa', pg_temp.audience(), pg_temp.msg()),'P0002',null,'campanha de outra org: P0002');
select throws_ok($$select public.delete_campaign('00000000-0000-0000-0000-000000004661')$$,'P0002',null,'excluir campanha de outra org: P0002');

-- leitura por membros e escrita direta negada
select tests.authenticate_as(:'uv');
select is((select count(*)::int from public.entry_links),3,'viewer lê só os links da própria org');
select is((select count(*)::int from public.campaigns),1,'viewer lê só as campanhas da própria org');
select is((select count(*)::int from public.outreach_deliveries),3,'viewer lê entregas da própria org');
select tests.authenticate_as(:'ub');
select is((select count(*)::int from public.entry_links),1,'membro de B não vê links de A');
select is((select count(*)::int from public.sequences),0,'membro de B não vê sequências de A');
select tests.authenticate_as(:'uadm');
select throws_ok(format($$insert into public.entry_links(organization_id,name,channel_id,code) values (%L,'X','00000000-0000-0000-0000-000000004601','direto')$$, :'oa'),'42501',null,'admin não insere link direto');
select throws_ok($$update public.sequences set name='Hack'$$,'42501',null,'admin não atualiza sequência direto');
select throws_ok($$delete from public.campaigns$$,'42501',null,'admin não apaga campanha direto');
select throws_ok(format($$insert into public.outreach_deliveries(organization_id,source,campaign_id,contact_id,channel_id) values (%L,'campaign',%L,'00000000-0000-0000-0000-000000004621','00000000-0000-0000-0000-000000004601')$$, :'oa', :'c1'),'42501',null,'admin não insere entrega direto');
select throws_ok($$update public.channels set instagram_username='hack' where id='00000000-0000-0000-0000-000000004601'$$,'42501',null,'admin não grava instagram_username direto');

-- usuário do Instagram
select lives_ok($$select public.set_instagram_username('00000000-0000-0000-0000-000000004601','@Loja.X')$$,'admin define usuário');
select tests.clear_authentication();
select is((select instagram_username from public.channels where id='00000000-0000-0000-0000-000000004601'),'loja.x','usuário normalizado');
select tests.authenticate_as(:'uadm');
select throws_ok($$select public.set_instagram_username('00000000-0000-0000-0000-000000004601','loja x')$$,'22023',null,'usuário inválido');
select throws_ok($$select public.set_instagram_username('00000000-0000-0000-0000-000000004602','loja')$$,'22023',null,'canal que não é Instagram');
select throws_ok($$select public.set_instagram_username('00000000-0000-0000-0000-000000004603','loja')$$,'P0002',null,'canal de outra org: P0002');
select tests.clear_authentication();
set local role service_role;
select lives_ok($$select public.record_instagram_username('00000000-0000-0000-0000-000000004603','empresa_b')$$,'serviço grava o usuário verificado');
reset role;
select is((select instagram_username from public.channels where id='00000000-0000-0000-0000-000000004603'),'empresa_b','usuário verificado gravado');
select * from finish();
rollback;
