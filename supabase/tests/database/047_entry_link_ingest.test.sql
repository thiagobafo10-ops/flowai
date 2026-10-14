begin;
create extension if not exists pgtap with schema extensions;
select plan(62);
select tests.create_user('owner47@t.test','Owner47') as ua \gset
select tests.create_user('agent47@t.test','Agent47') as uag \gset
select tests.create_user('viewer47@t.test','Viewer47') as uv \gset
select tests.create_user('owner47b@t.test','Owner47B') as ub \gset
select tests.create_org(:'ua','Org47A') as oa \gset
select tests.create_org(:'ub','Org47B') as ob \gset
select tests.add_member(:'oa',:'uag','agent');
select tests.add_member(:'oa',:'uv','viewer');

-- fixtures (postgres)
select public.save_instagram_connection(:'ua',:'oa','{"appId":"147","appSecret":"app","accessToken":"access","accountId":"78947","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn, (:'saved'::jsonb->>'channelId') as ig \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
insert into public.channels(id,organization_id,type,name,status) values
  ('00000000-0000-0000-0000-000000004701',:'oa','simulator','Sim47','active'),
  ('00000000-0000-0000-0000-000000004703',:'ob','simulator','Sim47B','active');
insert into public.tags(id,organization_id,name) values ('00000000-0000-0000-0000-000000004711',:'oa','Promo');
insert into public.entry_links(id,organization_id,name,channel_id,code,tag_id,status) values
  ('00000000-0000-0000-0000-000000004721',:'oa','Promo Sim','00000000-0000-0000-0000-000000004701','promo-sim','00000000-0000-0000-0000-000000004711','active'),
  ('00000000-0000-0000-0000-000000004722',:'oa','Velho','00000000-0000-0000-0000-000000004701','velho',null,'archived'),
  ('00000000-0000-0000-0000-000000004723',:'oa','Bio IG',:'ig','igcode',null,'active'),
  ('00000000-0000-0000-0000-000000004724',:'oa','Sem Auto',:'ig','semauto',null,'active'),
  ('00000000-0000-0000-0000-000000004725',:'ob','Link B','00000000-0000-0000-0000-000000004703','bcode',null,'active');

create function pg_temp.nid(p_auto uuid, p_k text) returns uuid language sql as $$ select md5(p_auto::text || p_k)::uuid $$;
-- automação ativa (versão 1): trigger -> message (nó de espera)
create function pg_temp.mk(p_id uuid, p_org uuid, p_type text, p_cfg jsonb, p_at timestamptz) returns uuid
language plpgsql as $$
declare g jsonb := jsonb_build_object(
  'nodes', jsonb_build_array(
    jsonb_build_object('id', pg_temp.nid(p_id,'t'), 'type','trigger','config','{}'::jsonb,'position','{"x":0,"y":0}'::jsonb),
    jsonb_build_object('id', pg_temp.nid(p_id,'w'), 'type','message','config','{"mode":"text","text":"Oi","quickReplies":[{"id":"sim","title":"Sim"}]}'::jsonb,'position','{"x":0,"y":0}'::jsonb)),
  'edges', jsonb_build_array(jsonb_build_object('id', pg_temp.nid(p_id,'e'), 'source', pg_temp.nid(p_id,'t'),
    'target', pg_temp.nid(p_id,'w'), 'sourceHandle','default')));
begin
  insert into public.automations (id, organization_id, name, trigger_type, trigger_config, status, activated_at, current_version)
    values (p_id, p_org, 'Auto ' || p_type, p_type::public.automation_trigger_type, p_cfg, 'active', p_at, 1);
  insert into public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph)
    values (p_org, p_id, 1, p_type::public.automation_trigger_type, p_cfg, g);
  return p_id;
end $$;
create function pg_temp.runs(p_conv uuid, p_auto uuid default null) returns int language sql as $$
  select count(*)::int from public.automation_runs where conversation_id = p_conv and (p_auto is null or automation_id = p_auto) $$;
create function pg_temp.notes(p_conv uuid) returns int language sql as $$
  select count(*)::int from public.messages where conversation_id = p_conv and sender_type = 'system'
    and direction = 'outbound' and content like 'Entrou pelo link %' $$;
create function pg_temp.hits(p_link uuid) returns int language sql as $$
  select count(*)::int from public.entry_link_hits where link_id = p_link $$;
create function pg_temp.ig(p_ext text, p_sender text, p_text text, p_ctx jsonb default '{}') returns jsonb language sql as $$
  select public.ingest_instagram_event((select meta_connection_id from public.channels
      where external_account_id = '78947' and type = 'instagram'),
    jsonb_build_object('kind','message','accountId','78947','externalId',p_ext,'senderExternalId',p_sender,
      'senderName',null,'text',p_text,'context',p_ctx,'occurredAt',now())) $$;
create function pg_temp.conv_of_sender(p_sender text) returns uuid language sql as $$
  select c.id from public.conversations c join public.contacts ct on ct.id = c.contact_id
    where ct.instagram_id = p_sender order by c.created_at desc limit 1 $$;

select pg_temp.mk('00000000-0000-0000-0000-000000004731',:'oa','entry_link','{"linkIds":["00000000-0000-0000-0000-000000004721"]}',now()-interval '2 hours');
select pg_temp.mk('00000000-0000-0000-0000-000000004732',:'oa','entry_link','{"linkIds":["00000000-0000-0000-0000-000000004721"]}',now()-interval '1 hour');
select pg_temp.mk('00000000-0000-0000-0000-000000004733',:'oa','entry_link','{"linkIds":["00000000-0000-0000-0000-000000004723"]}',now()-interval '1 hour');
select pg_temp.mk('00000000-0000-0000-0000-000000004734',:'oa','message_received','{}',now()-interval '3 hours');
select pg_temp.mk('00000000-0000-0000-0000-000000004735',:'oa','tag_added','{"tagId":"00000000-0000-0000-0000-000000004711"}',now()-interval '3 hours');

-- =============================================================== segurança
select ok(not has_function_privilege('authenticated','private.entry_link_open(uuid,text,text,text,uuid)','execute'),'authenticated não executa entry_link_open');
select ok(not has_function_privilege('anon','public.simulate_entry_link(uuid,text,text)','execute'),'anon não executa simulate_entry_link');
select ok(has_function_privilege('authenticated','public.simulate_entry_link(uuid,text,text)','execute'),'authenticated executa simulate_entry_link');

-- =============================================================== Simulador
select tests.authenticate_as(:'uv');
select throws_ok($$select public.simulate_entry_link('00000000-0000-0000-0000-000000004721','+5511990004701','Ana')$$,'42501',null,'viewer não simula');
select tests.authenticate_as(:'ub');
select throws_ok($$select public.simulate_entry_link('00000000-0000-0000-0000-000000004721','+5511990004701','Ana')$$,'42501',null,'outra organização não simula');
select tests.authenticate_as(:'uag');
select throws_ok($$select public.simulate_entry_link('00000000-0000-0000-0000-000000004723','+5511990004701','Ana')$$,'22023',null,'link de canal que não é Simulador: 22023');
select throws_ok($$select public.simulate_entry_link('00000000-0000-0000-0000-000000004722','+5511990004701','Ana')$$,'22023',null,'link arquivado não simula');
select throws_ok($$select public.simulate_entry_link('00000000-0000-0000-0000-000000004721','  ','Ana')$$,'22023',null,'telefone vazio: 22023');
select public.simulate_entry_link('00000000-0000-0000-0000-000000004721','+5511990004701','Ana Sim') as sconv \gset
select tests.clear_authentication();
select is((select ct.name from public.conversations c join public.contacts ct on ct.id = c.contact_id where c.id = :'sconv'),'Ana Sim','simulação cria contato com o nome');
select is((select ct.phone from public.conversations c join public.contacts ct on ct.id = c.contact_id where c.id = :'sconv'),'+5511990004701','contato do Simulador pelo telefone');
select is((select channel_id from public.conversations where id = :'sconv'),'00000000-0000-0000-0000-000000004701'::uuid,'conversa no canal Simulador');
select is(pg_temp.notes(:'sconv'),1,'nota de sistema escrita');
select is((select content from public.messages where conversation_id = :'sconv' and sender_type = 'system'),'Entrou pelo link Promo Sim','texto da nota');
select is((select count(*)::int from public.entry_link_hits where conversation_id = :'sconv' and link_id = '00000000-0000-0000-0000-000000004721'
  and external_id like 'sim:%'),1,'uso registrado com external_id sim:');
select ok(exists(select 1 from public.contact_tags t join public.conversations c on c.contact_id = t.contact_id
  where c.id = :'sconv' and t.tag_id = '00000000-0000-0000-0000-000000004711'),'tag do link aplicada');
select is((select count(*)::int from public.events e join public.conversations c on c.contact_id = e.contact_id
  where c.id = :'sconv' and e.type = 'tag_added'),1,'tag_added emitido normalmente');
select is(pg_temp.runs(:'sconv'),1,'uma execução iniciada');
select is(pg_temp.runs(:'sconv','00000000-0000-0000-0000-000000004731'),1,'automação entry_link mais antiga escolhida');
select is((select automation_run_id from public.conversations where id = :'sconv'),
  (select id from public.automation_runs where conversation_id = :'sconv'),'execução vinculada à conversa');
select is((select count(*)::int from public.automation_runs where automation_id = '00000000-0000-0000-0000-000000004735'),0,
  'automação de tag não inicia (conversa já ocupada pelo link)');
select is((select count(*)::int from public.messages where conversation_id = :'sconv' and direction = 'inbound'),0,'simulação não cria mensagem do cliente');

-- conversa ocupada: conta o uso (e escreve a nota) sem iniciar execução
select tests.authenticate_as(:'uag');
select is(public.simulate_entry_link('00000000-0000-0000-0000-000000004721','+5511990004701','Outro'),:'sconv'::uuid,'mesma conversa reaproveitada');
select tests.clear_authentication();
select is((select count(*)::int from public.entry_link_hits where conversation_id = :'sconv'),2,'ocupada: uso contado');
select is(pg_temp.runs(:'sconv'),1,'ocupada: nenhuma execução nova');
select is(pg_temp.notes(:'sconv'),2,'ocupada: nota por uso');
select is((select ct.name from public.conversations c join public.contacts ct on ct.id = c.contact_id where c.id = :'sconv'),'Ana Sim','nome existente preservado');

-- aguardando humano: conta o uso, nenhuma execução
insert into public.contacts(id,organization_id,name,phone) values ('00000000-0000-0000-0000-000000004741',:'oa','Hu','+5511990004702');
insert into public.conversations(id,organization_id,contact_id,channel_id,status,handled_by)
  values ('00000000-0000-0000-0000-000000004742',:'oa','00000000-0000-0000-0000-000000004741','00000000-0000-0000-0000-000000004701','pending_human','human');
select private.entry_link_open('00000000-0000-0000-0000-000000004701','+5511990004702','promo-sim','ext-human') as human \gset
select is((:'human'::jsonb->>'conversationId')::uuid,'00000000-0000-0000-0000-000000004742'::uuid,'pending_human: conversa existente');
select is(pg_temp.runs('00000000-0000-0000-0000-000000004742'),0,'pending_human: nenhuma execução');
select is((select count(*)::int from public.entry_link_hits where external_id = 'ext-human'),1,'pending_human: uso contado');

-- RF1: o mesmo external_id duas vezes
select private.entry_link_open('00000000-0000-0000-0000-000000004701','+5511990004703','promo-sim','ext-dup') as d1 \gset
select private.entry_link_open('00000000-0000-0000-0000-000000004701','+5511990004703','promo-sim','ext-dup') as d2 \gset
select is((select count(*)::int from public.entry_link_hits where external_id = 'ext-dup'),1,'RF1: um uso');
select is(pg_temp.runs((:'d1'::jsonb->>'conversationId')::uuid),1,'RF1: uma execução');
select is(pg_temp.notes((:'d1'::jsonb->>'conversationId')::uuid),1,'RF1: uma nota');
select is(:'d2'::jsonb->>'duplicate','true','RF1: segunda abertura marcada como duplicada');
select is((select count(*)::int from public.contacts where phone = '+5511990004703'),1,'RF1: um contato');

-- link arquivado / código desconhecido / outra organização
select is(private.entry_link_open('00000000-0000-0000-0000-000000004701','+5511990004704','velho','ext-old')->>'ignored','true','link arquivado ignorado');
select is(pg_temp.hits('00000000-0000-0000-0000-000000004722'),0,'arquivado: nenhum uso');
select is((select count(*)::int from public.contacts where phone = '+5511990004704'),0,'arquivado: nenhum contato criado');
select is(private.entry_link_open('00000000-0000-0000-0000-000000004701','+5511990004704','bcode','ext-b')->>'ignored','true','código de outra organização não resolve');
select is(pg_temp.hits('00000000-0000-0000-0000-000000004725'),0,'outra organização: nenhum uso');

-- =============================================================== Instagram
-- código desconhecido: ignorado, a mensagem entra e segue o disparo normal
select pg_temp.ig('mid-unknown','9471','oi','{"referral":{"ref":"nope"}}');
select is((select count(*)::int from public.messages where external_id = 'mid-unknown'),1,'desconhecido: mensagem entra');
select is((select count(*)::int from public.entry_link_hits h join public.entry_links l on l.id = h.link_id where l.organization_id = :'oa'
  and h.external_id = 'mid-unknown'),0,'desconhecido: nenhum uso');
select is(pg_temp.runs(pg_temp.conv_of_sender('9471'),'00000000-0000-0000-0000-000000004734'),1,'desconhecido: gatilho de mensagem normal');
select is(pg_temp.notes(pg_temp.conv_of_sender('9471')),0,'desconhecido: nenhuma nota');

-- outra organização pelo webhook
select pg_temp.ig('mid-b','9475','oi','{"referral":{"ref":"bcode"}}');
select is(pg_temp.hits('00000000-0000-0000-0000-000000004725'),0,'webhook: código de outra organização não resolve');

-- referral junto da mensagem: só a automação do link
select pg_temp.ig('mid-ref','9472','quero','{"referral":{"ref":"igcode"}}') as mref \gset
select is(:'mref'::jsonb->>'state','done','mensagem com referral processada');
select is((select count(*)::int from public.messages where external_id = 'mid-ref' and direction = 'inbound'),1,'mensagem com referral entra');
select is(pg_temp.hits('00000000-0000-0000-0000-000000004723'),1,'referral: uso registrado');
select is((select external_id from public.entry_link_hits where link_id = '00000000-0000-0000-0000-000000004723'),'mid-ref','referral: external_id é o mid');
select is(pg_temp.notes(pg_temp.conv_of_sender('9472')),1,'referral: nota escrita');
select is(pg_temp.runs(pg_temp.conv_of_sender('9472')),1,'referral: uma execução');
select is(pg_temp.runs(pg_temp.conv_of_sender('9472'),'00000000-0000-0000-0000-000000004733'),1,'referral: execução da automação do link');

-- referral válido sem automação de link: a mensagem não inicia gatilho de mensagem
select pg_temp.ig('mid-semauto','9474','oi','{"referral":{"ref":"semauto"}}');
select is(pg_temp.hits('00000000-0000-0000-0000-000000004724'),1,'sem automação: uso registrado');
select is(pg_temp.runs(pg_temp.conv_of_sender('9474')),0,'referral válido nunca inicia gatilho de mensagem');

-- evento de referral sozinho
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','referral','accountId','78947','externalId','referral:1:9473',
  'senderExternalId','9473','ref','igcode','source','ADS','occurredAt',now())) as rev \gset
select is(:'rev'::jsonb->>'state','done','evento de referral processado');
select is((select kind from public.instagram_events where id = (:'rev'::jsonb->>'eventId')::uuid),'referral','evento gravado como referral');
select is((select count(*)::int from public.contacts where organization_id = :'oa' and instagram_id = '9473'),1,'referral cria o contato');
select is(pg_temp.runs(pg_temp.conv_of_sender('9473'),'00000000-0000-0000-0000-000000004733'),1,'referral sozinho inicia a automação do link');
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','referral','accountId','78947','externalId','referral:1:9473',
  'senderExternalId','9473','ref','igcode','source','ADS','occurredAt',now())),:'rev'::jsonb,'replay do referral devolve o mesmo evento');
select is(pg_temp.hits('00000000-0000-0000-0000-000000004723'),2,'replay não conta outro uso');
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','referral','accountId','78947','externalId','referral:2:9476',
  'senderExternalId','9476','ref','nope','source','ADS','occurredAt',now()))->>'state','ignored','referral desconhecido ignorado');
select is((select count(*)::int from public.contacts where organization_id = :'oa' and instagram_id = '9476'),0,'referral desconhecido não cria contato');

-- exclusão do contato apaga o payload do referral
delete from public.contacts where organization_id = :'oa' and instagram_id = '9473';
select is((select payload from public.instagram_events where id = (:'rev'::jsonb->>'eventId')::uuid),'{"purged":true}'::jsonb,'payload do referral purgado com o contato');

select * from finish();
rollback;
