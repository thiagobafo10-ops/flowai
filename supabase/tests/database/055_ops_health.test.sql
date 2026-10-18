begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
select tests.create_user('owner55@t.test','Owner') as ua \gset
select tests.create_user('agent55@t.test','Agent') as uag \gset
select tests.create_user('other55@t.test','Other') as ub \gset
select tests.create_org(:'ua','Org55A') as oa \gset
select tests.create_org(:'ub','Org55B') as ob \gset
select tests.add_member(:'oa',:'uag','agent');
-- Fixture inserida como postgres (RLS de escrita liberada apenas para serviço).
insert into public.channels(id, organization_id, type, name, status, external_account_id)
  values (gen_random_uuid(), :'oa', 'instagram', 'Insta 55', 'active', '78955') returning id as chan \gset
insert into public.channels(id, organization_id, type, name, status, external_account_id)
  values (gen_random_uuid(), :'ob', 'instagram', 'Outro 55', 'active', '78956') returning id as chanb \gset
insert into public.instagram_events(organization_id, channel_id, kind, external_id, payload, occurred_at, state) values
  (:'oa', :'chan', 'comment', 'ev55a', '{"mediaId":"p55"}', now()-interval '10 minutes', 'pending'),
  (:'oa', :'chan', 'comment', 'ev55b', '{"mediaId":"p55"}', now(), 'pending'),
  (:'ob', :'chanb', 'comment', 'ev55c', '{"mediaId":"p55"}', now(), 'pending');
insert into public.instagram_send_intents(organization_id, channel_id, kind, text, state, error_code)
  values (:'oa', :'chan', 'private_reply', 'Oi', 'failed', 'rate_limited');
-- Um agente não pode ler a saúde operacional.
select tests.authenticate_as(:'uag');
select throws_ok(format('select public.ops_health(%L)', :'oa'), '42501', 'forbidden',
  'agente não lê a saúde da operação');
-- O proprietário vê apenas a própria organização.
select tests.authenticate_as(:'ua');
select is((public.ops_health(:'oa')->'instagram_events'->>'pending')::int, 2,
  'conta apenas os eventos pendentes da própria organização');
select is((public.ops_health(:'oa')->'send_intents'->>'failed')::int, 1, 'conta os envios falhados');
select is(jsonb_array_length(public.ops_health(:'oa')->'channels'), 1, 'lista apenas o canal da organização');
select is((public.ops_health(:'oa')->'automation_runs'->>'stalled')::int, 0,
  'execuções travadas ficam zeradas sem dados');
select is((
  select count(*)::int from jsonb_array_elements(public.ops_health(:'oa')->'channels') c
  where c->>'name' = 'Outro 55'
), 0, 'não vaza canal de outra organização');
select * from finish();
rollback;
