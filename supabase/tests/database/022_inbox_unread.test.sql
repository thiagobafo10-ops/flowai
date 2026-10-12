begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);
select tests.create_user('unread_owner@t.test') as owner_id \gset
select tests.create_user('unread_other@t.test') as other_id \gset
select tests.create_org(:'owner_id', 'Unread test') as org_id \gset
select tests.authenticate_as(:'owner_id');
select is(public.inbox_unread_count(:'org_id'), 0::bigint, 'new org has no unread');
select tests.clear_authentication();
insert into public.channels(organization_id,type,name,status) values (:'org_id','simulator','Simulador','active') returning id as channel_id \gset
select public.ingest_inbound_message(:'channel_id','unread1','+5511988887777','Ana','Oi',now()) as message_id \gset
select conversation_id as conversation_id from public.messages where id=:'message_id' \gset
select tests.authenticate_as(:'owner_id');
select is(public.inbox_unread_count(:'org_id'), 1::bigint, 'unassigned inbound is unread');
select public.mark_conversation_read(:'conversation_id');
select is(public.inbox_unread_count(:'org_id'), 0::bigint, 'read marker clears count');
update public.conversations set last_read_at=null, assigned_to=:'owner_id' where id=:'conversation_id';
select is(public.inbox_unread_count(:'org_id'), 1::bigint, 'mine counts once');
select tests.clear_authentication();
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,is_internal_note,created_at)
values (:'org_id',:'conversation_id',:'channel_id','outbound','human','Internal note',true,now()+interval '1 second');
select tests.authenticate_as(:'owner_id');
select is(public.inbox_unread_count(:'org_id'), 1::bigint, 'notes do not clear unread');
select tests.clear_authentication();
select tests.add_member(:'org_id', :'other_id', 'agent');
select tests.authenticate_as(:'other_id');
select is(public.inbox_unread_count(:'org_id'), 0::bigint, 'another member assigned conversation excluded');
select tests.clear_authentication();
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,created_at)
values (:'org_id',:'conversation_id',:'channel_id','outbound','human','Reply',now()+interval '2 seconds');
select tests.authenticate_as(:'owner_id');
select is(public.inbox_unread_count(:'org_id'), 0::bigint, 'latest outbound clears unread');
update public.conversations set status='closed' where id=:'conversation_id';
select is(public.inbox_unread_count(:'org_id'), 0::bigint, 'closed conversations excluded');
select tests.clear_authentication();
select tests.create_user('unread_stranger@t.test') as stranger_id \gset
select tests.authenticate_as(:'stranger_id');
select throws_ok(format('select public.inbox_unread_count(%L)', :'org_id'), '42501', null, 'foreign org forbidden');
select * from finish();
rollback;
