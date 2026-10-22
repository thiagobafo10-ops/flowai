-- Resposta pública ao comentário que disparou uma automação instagram_comment.
-- Operação própria (uma por evento), independente da resposta privada (instagram_send_intents):
-- o texto é sorteado na enfileiração a partir da versão congelada da automação e nunca muda;
-- 429 volta para pendente; resultado incerto nunca é reenviado; VIP e automação não respondem
-- publicamente duas vezes ao mesmo comentário.

-- ---------------------------------------------------------------- validação (espelha o Zod)
-- Espaço em branco = o mesmo conjunto que String.prototype.trim do JS (inclui NBSP, espaços
-- Unicode Zs, separadores de linha/parágrafo e BOM), para SQL e Zod concordarem.
create function private.public_reply_trim(p_text text) returns text
language sql immutable set search_path='' as $$
  select regexp_replace(p_text,
    '^[[:space:]\xa0\x1680\x2000-\x200a\x2028\x2029\x202f\x205f\x3000\xfeff]+|[[:space:]\xa0\x1680\x2000-\x200a\x2028\x2029\x202f\x205f\x3000\xfeff]+$','','g')
$$;

create function private.instagram_comment_public_replies_valid(p_config jsonb) returns boolean
language sql immutable set search_path='' as $$
  select case
    when not (p_config ? 'publicReplies') then true
    when jsonb_typeof(p_config->'publicReplies') is distinct from 'array' then false
    when jsonb_array_length(p_config->'publicReplies')>10 then false
    else not exists(select 1 from jsonb_array_elements(p_config->'publicReplies') e
      where jsonb_typeof(e)<>'string' or char_length(private.public_reply_trim(e#>>'{}')) not between 1 and 300)
  end
$$;

-- Variações utilizáveis (aparadas, não vazias, até 300 caracteres) de um trigger_config.
create function private.instagram_comment_public_reply_texts(p_config jsonb) returns text[]
language sql immutable set search_path='' as $$
  select coalesce(array_agg(t.v order by t.o),'{}'::text[]) from (
    select private.public_reply_trim(e#>>'{}') v, o
    from jsonb_array_elements(case when jsonb_typeof(p_config->'publicReplies')='array' then p_config->'publicReplies' else '[]'::jsonb end)
      with ordinality x(e,o)
    where jsonb_typeof(e)='string'
    limit 10
  ) t where char_length(t.v) between 1 and 300
$$;

-- ---------------------------------------------------------------- tabela
create table public.instagram_comment_public_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid not null,
  event_id uuid not null unique references public.instagram_events(id) on delete cascade,
  automation_id uuid not null,
  automation_version integer not null,
  comment_id text not null check(char_length(comment_id) between 1 and 1024),
  text text not null check(char_length(text) between 1 and 300
    and text ~ '[^[:space:]\xa0\x1680\x2000-\x200a\x2028\x2029\x202f\x205f\x3000\xfeff]'),
  state text not null default 'pending' check(state in ('pending','sending','sent','failed','uncertain','skipped','cancelled')),
  claim_token uuid, claimed_at timestamptz, claimed_connection_id uuid, claimed_generation integer,
  external_id text,
  error_code text check(error_code ~ '^[a-z_]{1,60}$'),
  created_at timestamptz not null default now(),
  foreign key(organization_id,channel_id) references public.channels(organization_id,id) on delete cascade
);
create index instagram_comment_public_replies_comment_idx on public.instagram_comment_public_replies(channel_id,comment_id);
create index instagram_comment_public_replies_org_idx on public.instagram_comment_public_replies(organization_id,created_at);
alter table public.instagram_comment_public_replies enable row level security;
revoke all on public.instagram_comment_public_replies from public,anon,authenticated;

-- ---------------------------------------------------------------- enfileiramento / re-vínculo
-- Vincula a resposta pública à regra que selecionou o comentário, lendo a versão congelada referida
-- pelo evento, e sorteia o texto. Chamado na inserção do evento (trigger) e quando o Direct troca
-- de regra (reselect_instagram_comment_rule). Uma linha só é re-vinculada antes de qualquer reserva
-- (pending ou cancelled); sem variações na nova regra, é cancelada. Cada mensagem da fila carrega a
-- regra, para o reconhecimento de uma mensagem antiga não cancelar a resposta da nova regra.
create function private.bind_instagram_comment_public_reply(p_event public.instagram_events) returns void
language plpgsql security definer set search_path='' as $$
declare cfg jsonb; texts text[]; ch public.channels; r public.instagram_comment_public_replies; inserted integer;
begin
  select v.trigger_config into cfg from public.automation_versions v
    where v.automation_id=p_event.automation_id and v.version=p_event.automation_version
      and v.organization_id=p_event.organization_id and v.trigger_type='instagram_comment';
  texts:=private.instagram_comment_public_reply_texts(cfg);
  select * into r from public.instagram_comment_public_replies where event_id=p_event.id for update;
  if found then
    if r.state not in ('pending','cancelled')
      or (r.automation_id=p_event.automation_id and r.automation_version=p_event.automation_version) then return; end if;
    if cardinality(texts)=0 then
      update public.instagram_comment_public_replies set automation_id=p_event.automation_id,automation_version=p_event.automation_version,
        state='cancelled',error_code='rule_changed',claim_token=null,claimed_at=null where id=r.id;
      return;
    end if;
    update public.instagram_comment_public_replies set automation_id=p_event.automation_id,automation_version=p_event.automation_version,
      text=texts[1+floor(random()*cardinality(texts))::integer],state='pending',error_code=null,
      claim_token=null,claimed_at=null,claimed_connection_id=null,claimed_generation=null where id=r.id;
    perform pgmq.send('instagram_work',jsonb_build_object('eventId',p_event.id,'task','public_reply','automationId',p_event.automation_id));
    return;
  end if;
  if cardinality(texts)=0 or coalesce(p_event.payload->>'commentId','')='' then return; end if;
  select * into ch from public.channels where id=p_event.channel_id and organization_id=p_event.organization_id;
  if ch.status is distinct from 'active' or coalesce(p_event.payload->>'senderExternalId','')=''
    or p_event.payload->>'senderExternalId'=ch.external_account_id then return; end if;
  insert into public.instagram_comment_public_replies(organization_id,channel_id,event_id,automation_id,automation_version,comment_id,text)
    values(p_event.organization_id,ch.id,p_event.id,p_event.automation_id,p_event.automation_version,p_event.payload->>'commentId',
      texts[1+floor(random()*cardinality(texts))::integer])
    on conflict(event_id) do nothing;
  get diagnostics inserted=row_count;
  if inserted>0 then
    perform pgmq.send('instagram_work',jsonb_build_object('eventId',p_event.id,'task','public_reply','automationId',p_event.automation_id));
  end if;
end $$;

-- Só quando a automação de fato selecionou o comentário (state pending + automation_id).
-- Reentrega não insere evento novo.
create function private.enqueue_instagram_comment_public_reply() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.bind_instagram_comment_public_reply(new);
  return new;
end $$;
create trigger instagram_comment_public_reply_enqueue after insert on public.instagram_events for each row
  when (new.kind='comment' and new.state='pending' and new.automation_id is not null)
  execute function private.enqueue_instagram_comment_public_reply();

-- ---------------------------------------------------------------- regra de fallback do Direct
-- Igual a 20261017000001, mais: a resposta pública acompanha a troca de regra.
create or replace function public.reselect_instagram_comment_rule(p_event_id uuid,p_comment_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ev public.instagram_events; a public.automations; item public.instagram_send_intents; body jsonb;
begin
  if p_comment_at is null then return 'null'::jsonb; end if;
  select * into ev from public.instagram_events where id=p_event_id and kind='comment' for update;
  if not found or ev.state not in ('pending','uncertain') then return 'null'::jsonb; end if;
  select * into item from public.instagram_send_intents where event_id=ev.id for update;
  if found and (item.state<>'pending' or item.automation_run_id is not null) then return 'null'::jsonb; end if;
  select x.* into a from public.automations x join public.automation_versions v on v.automation_id=x.id and v.version=x.current_version
    where x.organization_id=ev.organization_id and x.status='active' and x.activated_at<=p_comment_at
      and v.trigger_type='instagram_comment' and v.trigger_config->>'channelId'=ev.channel_id::text
      and (v.trigger_config->>'mediaId' is null
           or v.trigger_config->>'mediaId' in (ev.payload->>'mediaId',ev.payload->>'originalMediaId'))
      and private.automation_keyword_matches(ev.payload->>'text',v.trigger_config)
      and private.instagram_comment_first_node(v.graph) is not null
      and (
        coalesce((v.trigger_config->>'oncePerUser')::boolean, true) = false
        or not exists (
          select 1 from public.instagram_events prev
          where prev.channel_id = ev.channel_id
            and prev.kind = 'comment'
            and prev.id <> ev.id
            and prev.automation_id = x.id
            and prev.payload->>'senderExternalId' = ev.payload->>'senderExternalId'
            and (v.trigger_config->>'mediaId' is null
                 or v.trigger_config->>'mediaId' in (prev.payload->>'mediaId',prev.payload->>'originalMediaId'))
            and prev.state in ('pending', 'done', 'uncertain')
        )
      )
    order by x.activated_at,x.id limit 1;
  if a.id is null then return 'null'::jsonb; end if;
  update public.instagram_events set automation_id=a.id,automation_version=a.current_version,automation_activated_at=a.activated_at
    where id=ev.id returning * into ev;
  perform private.bind_instagram_comment_public_reply(ev);
  body:=private.instagram_comment_body(ev.automation_run_id,private.instagram_comment_node(ev));
  update public.instagram_send_intents set text=coalesce(body->>'text',body#>>'{attachment,payload,text}'),message_payload=body
    where event_id=ev.id and state='pending';
  return public.prepare_instagram_comment_send(ev.id);
end $$;

-- ---------------------------------------------------------------- preparar
create function public.prepare_instagram_comment_public_reply(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.instagram_comment_public_replies; ev public.instagram_events; ch public.channels;
begin
  select * into r from public.instagram_comment_public_replies where event_id=p_event_id for update;
  if not found then return 'null'::jsonb; end if;
  select * into ev from public.instagram_events where id=r.event_id and kind='comment';
  if not found or ev.payload->>'purged'='true' or ev.automation_id is distinct from r.automation_id then return 'null'::jsonb; end if;
  if not private.instagram_comment_automation_active(ev) then return 'null'::jsonb; end if;
  select * into ch from public.channels where id=r.channel_id and organization_id=r.organization_id;
  if ch.status is distinct from 'active' or ev.payload->>'senderExternalId'=ch.external_account_id then return 'null'::jsonb; end if;
  if r.state='sending' and r.claimed_at<now()-interval '1 minute' then
    update public.instagram_comment_public_replies set state='uncertain',error_code='expired_send_lease' where id=r.id returning * into r;
  end if;
  return jsonb_build_object('replyId',r.id,'eventId',ev.id,'organizationId',r.organization_id,'channelId',ch.id,
    'connectionId',ch.meta_connection_id,'commentId',r.comment_id,'mediaId',ev.payload->>'mediaId',
    'originalMediaId',ev.payload->>'originalMediaId','senderExternalId',ev.payload->>'senderExternalId',
    'ruleEffectiveAt',ev.automation_activated_at,'state',r.state);
end $$;

-- ---------------------------------------------------------------- reservar
-- Revalida tudo no momento da reserva (automação, canal, credencial, horário real do comentário)
-- e serializa com a operação pública do VIP pelo mesmo advisory lock.
create function public.claim_instagram_comment_public_reply(p_reply_id uuid,p_comment_at timestamptz,
  p_expected_connection_id uuid,p_expected_generation integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.instagram_comment_public_replies; ev public.instagram_events; ch public.channels; mc public.meta_connections;
begin
  select * into r from public.instagram_comment_public_replies where id=p_reply_id;
  if not found then return 'null'::jsonb; end if;
  perform pg_advisory_xact_lock(hashtextextended('instagram-public:'||r.channel_id||':'||r.comment_id,0));
  select * into ch from public.channels where id=r.channel_id and organization_id=r.organization_id for share;
  select * into mc from public.meta_connections where id=ch.meta_connection_id;
  select * into r from public.instagram_comment_public_replies where id=p_reply_id for update;
  if r.state='sending' and r.claimed_at<now()-interval '1 minute' then
    update public.instagram_comment_public_replies set state='uncertain',error_code='expired_send_lease' where id=r.id;
    return 'null'::jsonb;
  end if;
  if r.state<>'pending' then return 'null'::jsonb; end if;
  select * into ev from public.instagram_events where id=r.event_id and kind='comment';
  if ev.id is null or ev.payload->>'purged'='true' or ev.automation_id is distinct from r.automation_id
    or not private.instagram_comment_automation_active(ev) then return 'null'::jsonb; end if;
  if ch.status is distinct from 'active' or mc.id is null or mc.disconnected_at is not null
    or p_expected_connection_id is null or p_expected_generation is null
    or ch.meta_connection_id is distinct from p_expected_connection_id or mc.credential_generation is distinct from p_expected_generation
    or ev.payload->>'senderExternalId'=ch.external_account_id
    or p_comment_at is null or p_comment_at<ev.automation_activated_at or p_comment_at>now() then return 'null'::jsonb; end if;
  if exists(select 1 from public.instagram_vip_intents i where i.channel_id=r.channel_id and i.comment_id=r.comment_id and i.kind='public') then
    update public.instagram_comment_public_replies set state='skipped',error_code='vip_replied' where id=r.id;
    return 'null'::jsonb;
  end if;
  update public.instagram_comment_public_replies set state='sending',claim_token=gen_random_uuid(),claimed_at=now(),
    claimed_connection_id=p_expected_connection_id,claimed_generation=p_expected_generation where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'claimToken',r.claim_token,'text',r.text);
end $$;

-- ---------------------------------------------------------------- concluir
create function public.complete_instagram_comment_public_reply(p_reply_id uuid,p_claim_token uuid,p_state text,
  p_external_id text,p_error_code text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_state is null or p_state not in ('sent','failed','uncertain','pending')
    or (p_error_code is not null and p_error_code !~ '^[a-z_]{1,60}$') then raise exception 'invalid result' using errcode='22023'; end if;
  if p_state='pending' and p_error_code is distinct from 'rate_limited' then raise exception 'unsafe retry' using errcode='22023'; end if;
  if p_state='sent' and coalesce(p_external_id,'')='' then raise exception 'missing external id' using errcode='22023'; end if;
  update public.instagram_comment_public_replies set state=p_state,
    external_id=case when p_state='sent' then left(p_external_id,1024) end,error_code=p_error_code,
    claim_token=case when p_state='pending' then null else claim_token end,
    claimed_at=case when p_state='pending' then null else claimed_at end
  where id=p_reply_id and state='sending' and claim_token=p_claim_token;
end $$;

-- ---------------------------------------------------------------- fila
-- Reconhece só a tarefa public_reply: nunca altera o evento nem a resposta privada.
create function public.finish_instagram_comment_public_reply_work(p_queue_id bigint,p_state text,p_error_code text) returns void
language plpgsql security definer set search_path='' as $$
declare q record; ev uuid;
begin
  if p_state is null or p_state not in ('done','ignored','retry','failed','uncertain') then raise exception 'invalid work state' using errcode='22023'; end if;
  if p_error_code is not null and p_error_code !~ '^[a-z_]{1,60}$' then raise exception 'unsafe error code' using errcode='22023'; end if;
  select * into q from pgmq.q_instagram_work where msg_id=p_queue_id and message->>'task'='public_reply' for update;
  if not found then return; end if;
  ev:=(q.message->>'eventId')::uuid;
  if p_state='retry' and q.read_ct<5 then perform pgmq.set_vt('instagram_work',p_queue_id,60*greatest(q.read_ct,1)); return; end if;
  update public.instagram_comment_public_replies
    set state=case when p_state in ('retry','failed') then 'failed' else 'cancelled' end,
      error_code=coalesce(p_error_code,'comment_not_eligible'),claim_token=null,claimed_at=null
    where event_id=ev and state='pending'
      and (q.message->>'automationId' is null or automation_id=(q.message->>'automationId')::uuid);
  perform pgmq.archive('instagram_work',p_queue_id);
end $$;

-- Concessões expiradas viram incertas (nunca reenviadas), mesmo sem nova leitura do evento.
create function public.sweep_instagram_comment_public_reply_leases() returns integer
language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  update public.instagram_comment_public_replies set state='uncertain',error_code='expired_send_lease'
    where id in (select id from public.instagram_comment_public_replies
      where state='sending' and claimed_at<now()-interval '1 minute' order by claimed_at limit 100 for update skip locked);
  get diagnostics affected=row_count;
  return affected;
end $$;

-- Igual a 20261016000004, mais a varredura das respostas públicas.
create or replace function public.read_instagram_work(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare work jsonb;
begin
 perform public.sweep_instagram_vip_leases();
 perform public.sweep_instagram_comment_public_reply_leases();
 select coalesce(jsonb_agg(jsonb_build_object('queueId',msg_id,'eventId',message->>'eventId',
   'task',coalesce(message->>'task','comment')) order by msg_id),'[]'::jsonb) into work
 from pgmq.read('instagram_work',300,least(greatest(p_limit,1),10));
 return work;
end $$;

-- ---------------------------------------------------------------- VIP simétrico
-- Igual a 20261016000004, mais: a operação pública do VIP é cancelada quando a automação
-- já reservou/enviou a resposta pública do mesmo comentário (mesmo advisory lock).
create or replace function public.claim_instagram_vip_send(p_intent_id uuid,p_comment_at timestamptz,p_comment_text text,p_expected_connection_id uuid,p_expected_generation integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.instagram_vip_intents; s public.instagram_vip_settings; ch public.channels; mc public.meta_connections;
begin
 select * into i from public.instagram_vip_intents where id=p_intent_id;
 if not found then return 'null'; end if;
 -- Shared with legacy private sends, preserving whichever operation reserves first.
 perform pg_advisory_xact_lock(hashtextextended('instagram-private:'||i.channel_id||':'||i.comment_id,0));
 if i.kind='public' then perform pg_advisory_xact_lock(hashtextextended('instagram-public:'||i.channel_id||':'||i.comment_id,0)); end if;
 select * into ch from public.channels where id=i.channel_id and organization_id=i.organization_id for update;
 select * into s from public.instagram_vip_settings where channel_id=ch.id and organization_id=i.organization_id for update;
 select * into mc from public.meta_connections where id=ch.meta_connection_id;
 select * into i from public.instagram_vip_intents where id=p_intent_id for update;
 if i.state<>'pending' then return 'null'; end if;
 if i.kind='public' and exists(select 1 from public.instagram_comment_public_replies r where r.channel_id=i.channel_id and r.comment_id=i.comment_id and r.state in ('sending','sent','uncertain')) then
   update public.instagram_vip_intents set state='cancelled',error_code='automation_replied' where id=i.id; return 'null'; end if;
 if not coalesce(s.enabled,false) or ch.status<>'active' or mc.id is null or mc.disconnected_at is not null
   or p_expected_connection_id is null or p_expected_generation is null
   or ch.meta_connection_id is distinct from p_expected_connection_id or mc.credential_generation is distinct from p_expected_generation
   or s.comments_verified_at is null or s.comments_generation is distinct from mc.credential_generation or s.comments_error is not null
   or p_comment_at is null or p_comment_at<s.activated_at or p_comment_at>now() then return 'null'; end if;
 if i.kind='private' and (p_comment_at<=now()-interval '7 days' or coalesce(p_comment_text,'') !~* '(^|[^[:alnum:]_])VIP([^[:alnum:]_]|$)') then return 'null'; end if;
 if i.kind='private' and exists(select 1 from public.instagram_send_intents old where old.channel_id=i.channel_id and old.comment_id=i.comment_id and old.kind='private_reply' and old.state in ('sending','sent','uncertain')) then
   update public.instagram_vip_intents set state='cancelled',error_code='private_reply_reserved' where id=i.id; return 'null'; end if;
 update public.instagram_vip_intents set state='sending',claim_token=gen_random_uuid(),claimed_at=now(),
   claimed_connection_id=p_expected_connection_id,claimed_generation=p_expected_generation where id=i.id returning * into i;
 return jsonb_build_object('id',i.id,'claimToken',i.claim_token,'kind',i.kind,'text',case when i.kind='public' then s.public_reply_text else 'Aqui está o convite para o nosso grupo VIP do WhatsApp: '||s.group_url end);
end $$;

-- ---------------------------------------------------------------- salvar automação
-- Igual a 20261013000002, mais a validação de publicReplies para instagram_comment.
create or replace function public.save_automation(
  p_org uuid, p_id uuid, p_name text, p_trigger_type public.automation_trigger_type,
  p_trigger_config jsonb, p_graph jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_name text := btrim(coalesce(p_name, ''));
  v_status public.automation_status;
  n jsonb; e jsonb; v_ids uuid[] := '{}'; v_eids uuid[] := '{}'; v_rows int; v_nid uuid; v_src uuid; v_dst uuid;
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if not public.has_role(p_org, 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_trigger_type is null or jsonb_typeof(p_trigger_config) is distinct from 'object'
     or jsonb_typeof(p_graph) is distinct from 'object'
     or jsonb_typeof(p_graph -> 'nodes') is distinct from 'array'
     or jsonb_typeof(p_graph -> 'edges') is distinct from 'array' then
    raise exception 'invalid_graph' using errcode = '22023';
  end if;
  if p_trigger_type = 'instagram_comment' and not private.instagram_comment_public_replies_valid(p_trigger_config) then
    raise exception 'invalid_trigger_config' using errcode = '22023';
  end if;

  if v_id is not null then
    select status into v_status from public.automations where id = v_id and organization_id = p_org for update;
    if not found then raise exception 'automation_not_found' using errcode = 'P0002'; end if;
  end if;

  -- validação estrutural mínima (a validade semântica é do server action)
  for n in select * from jsonb_array_elements(p_graph -> 'nodes') loop
    if jsonb_typeof(n) <> 'object' or jsonb_typeof(n -> 'id') is distinct from 'string'
       or (n ->> 'id') !~ v_uuid_re then
      raise exception 'invalid_node_id' using errcode = '22023';
    end if;
    v_nid := (n ->> 'id')::uuid;
    if v_nid = any (v_ids) then raise exception 'duplicate_node_id' using errcode = '22023'; end if;
    v_ids := v_ids || v_nid;
    if jsonb_typeof(n -> 'type') is distinct from 'string' or not exists (
      select 1 from unnest(enum_range(null::public.automation_node_type)) t where t::text = n ->> 'type') then
      raise exception 'invalid_node_type' using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(n -> 'config', '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(n -> 'position', '{"x":0,"y":0}'::jsonb)) <> 'object' then
      raise exception 'invalid_node' using errcode = '22023';
    end if;
    if exists (select 1 from public.automation_nodes x where x.id = v_nid
        and (x.organization_id <> p_org or x.automation_id is distinct from v_id)) then
      raise exception 'node_id_in_use' using errcode = '22023';
    end if;
  end loop;
  for e in select * from jsonb_array_elements(p_graph -> 'edges') loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'id') is distinct from 'string'
       or (e ->> 'id') !~ v_uuid_re then
      raise exception 'invalid_edge_id' using errcode = '22023';
    end if;
    if jsonb_typeof(e -> 'source') is distinct from 'string' or jsonb_typeof(e -> 'target') is distinct from 'string'
       or (e ->> 'source') !~ v_uuid_re or (e ->> 'target') !~ v_uuid_re then
      raise exception 'invalid_edge' using errcode = '22023';
    end if;
    if (e ->> 'id')::uuid = any (v_eids) then raise exception 'duplicate_edge_id' using errcode = '22023'; end if;
    v_eids := v_eids || (e ->> 'id')::uuid;
    v_src := (e ->> 'source')::uuid; v_dst := (e ->> 'target')::uuid;
    if not (v_src = any (v_ids)) or not (v_dst = any (v_ids)) then
      raise exception 'edge_unknown_node' using errcode = '22023';
    end if;
    if exists (select 1 from public.automation_edges x where x.id = (e ->> 'id')::uuid
        and (x.organization_id <> p_org or x.automation_id is distinct from v_id)) then
      raise exception 'edge_id_in_use' using errcode = '22023';
    end if;
  end loop;

  if v_id is null then
    insert into public.automations (organization_id, name, trigger_type, trigger_config, created_by)
      values (p_org, v_name, p_trigger_type, p_trigger_config, (select auth.uid()))
      returning id into v_id;
  else
    update public.automations set name = v_name, trigger_type = p_trigger_type, trigger_config = p_trigger_config
      where id = v_id;
  end if;

  -- nodes: mantém ids (runs e steps referenciam nodes); remove os ausentes
  delete from public.automation_edges where organization_id = p_org and automation_id = v_id;
  delete from public.automation_nodes where organization_id = p_org and automation_id = v_id
    and not (id = any (v_ids));
  for n in select * from jsonb_array_elements(p_graph -> 'nodes') loop
    insert into public.automation_nodes (id, organization_id, automation_id, type, config, position)
      values ((n ->> 'id')::uuid, p_org, v_id, (n ->> 'type')::public.automation_node_type,
        coalesce(n -> 'config', '{}'::jsonb), coalesce(n -> 'position', '{"x":0,"y":0}'::jsonb))
    on conflict (id) do update set type = excluded.type, config = excluded.config, position = excluded.position
      where public.automation_nodes.automation_id = v_id and public.automation_nodes.organization_id = p_org;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'node_id_in_use' using errcode = '22023'; end if;
  end loop;
  for e in select * from jsonb_array_elements(p_graph -> 'edges') loop
    insert into public.automation_edges (id, organization_id, automation_id, source_node_id, target_node_id, source_handle)
      values ((e ->> 'id')::uuid, p_org, v_id, (e ->> 'source')::uuid, (e ->> 'target')::uuid,
        coalesce(e ->> 'sourceHandle', 'default'));
  end loop;

  if v_status = 'active' then perform private.snapshot_automation(p_org, v_id); end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- Saúde/Ops
-- Igual a 20261017000002, mais: as respostas públicas entram nos contadores de envio e na lista
-- de principais erros de envio (mesmo bloco já exibido), mantendo os dois coerentes.
create or replace function public.ops_health(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_tz text;
  v_events jsonb;
  v_event_errors jsonb;
  v_intents jsonb;
  v_intent_errors jsonb;
  v_runs jsonb;
  v_jobs jsonb;
  v_vip jsonb;
  v_channels jsonb;
begin
  if not public.has_role(p_org,'admin') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  select o.timezone into v_tz from public.organizations o where o.id=p_org;
  if v_tz is null then raise exception 'forbidden' using errcode='42501'; end if;

  -- Eventos do worker (comentários, DMs de automação, recibos de leitura).
  select jsonb_build_object(
    'pending', count(*) filter (where state='pending'),
    'uncertain', count(*) filter (where state='uncertain'),
    'failed', count(*) filter (where state='failed'),
    'ignored_24h', count(*) filter (where state='ignored' and created_at >= now()-interval '24 hours'),
    'pending_24h', count(*) filter (where created_at >= now()-interval '24 hours'),
    'oldest_pending_at', min(occurred_at) filter (where state='pending')
  ) into v_events
  from public.instagram_events where organization_id=p_org;

  select coalesce(jsonb_agg(jsonb_build_object('code',t.code,'count',t.total) order by t.total desc),'[]'::jsonb)
  into v_event_errors
  from (
    select coalesce(last_error,'unknown') code, count(*) total
    from public.instagram_events
    where organization_id=p_org and last_error is not null and created_at >= now()-interval '7 days'
    group by 1 order by count(*) desc limit 5
  ) t;

  -- Envios (Direct, respostas privadas e respostas públicas a comentários): os contadores
  -- cobrem as mesmas fontes que a lista de principais erros abaixo.
  select jsonb_build_object(
    'pending', count(*) filter (where state='pending'),
    'sending', count(*) filter (where state='sending'),
    'failed', count(*) filter (where state='failed'),
    'uncertain', count(*) filter (where state='uncertain'),
    'sent_24h', count(*) filter (where state='sent' and created_at >= now()-interval '24 hours')
  ) into v_intents
  from (
    select state, created_at from public.instagram_send_intents where organization_id=p_org
    union all
    select state, created_at from public.instagram_comment_public_replies where organization_id=p_org
  ) s;

  -- Principais erros de envio: Direct/respostas privadas e respostas públicas a comentários.
  select coalesce(jsonb_agg(jsonb_build_object('code',t.code,'count',t.total) order by t.total desc),'[]'::jsonb)
  into v_intent_errors
  from (
    select coalesce(x.error_code,'unknown') code, count(*) total
    from (
      select error_code from public.instagram_send_intents
      where organization_id=p_org and state in ('failed','uncertain') and error_code is not null
        and created_at >= now()-interval '7 days'
      union all
      select error_code from public.instagram_comment_public_replies
      where organization_id=p_org and state in ('failed','uncertain') and error_code is not null
        and created_at >= now()-interval '7 days'
    ) x
    group by 1 order by count(*) desc limit 5
  ) t;

  -- Execuções de automação (inclui as que ficaram presas além do esperado).
  select jsonb_build_object(
    'pending', count(*) filter (where status='pending'),
    'running', count(*) filter (where status='running'),
    'waiting', count(*) filter (where status='waiting'),
    'failed_24h', count(*) filter (where status='failed' and updated_at >= now()-interval '24 hours'),
    'stalled', count(*) filter (
      where (status in ('pending','running') and updated_at < now()-interval '15 minutes')
         or (status='waiting' and resume_at < now()-interval '5 minutes'))
  ) into v_runs
  from public.automation_runs where organization_id=p_org;

  -- Tarefas de IA (respostas e indexação de conhecimento).
  select jsonb_build_object(
    'pending', count(*) filter (where state='pending'),
    'running', count(*) filter (where state='running'),
    'failed_24h', count(*) filter (where state='failed' and updated_at >= now()-interval '24 hours'),
    'stuck', count(*) filter (where state='running' and claimed_until is not null and claimed_until < now())
  ) into v_jobs
  from public.ai_jobs where organization_id=p_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'channel_id', s.channel_id, 'enabled', s.enabled, 'last_error', s.last_error,
    'comments_error', s.comments_error, 'comments_verified_at', s.comments_verified_at
  ) order by s.channel_id),'[]'::jsonb)
  into v_vip
  from public.instagram_vip_settings s where s.organization_id=p_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'type', c.type, 'status', c.status,
    'last_error', c.last_error, 'updated_at', c.updated_at,
    'connection', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'app_id', m.app_id, 'api_version', m.api_version,
      'credential_generation', m.credential_generation,
      'token_verified_at', m.token_verified_at, 'webhook_verified_at', m.webhook_verified_at,
      'disconnected_at', m.disconnected_at, 'last_error', m.last_error
    ) end
  ) order by c.created_at),'[]'::jsonb)
  into v_channels
  from public.channels c left join public.meta_connections m on m.id=c.meta_connection_id
  where c.organization_id=p_org;

  return jsonb_build_object(
    'generated_at', now(),
    'timezone', v_tz,
    'channels', v_channels,
    'instagram_events', v_events || jsonb_build_object('top_errors', v_event_errors),
    'send_intents', v_intents || jsonb_build_object('top_errors', v_intent_errors),
    'automation_runs', v_runs,
    'ai_jobs', v_jobs,
    'vip', v_vip
  );
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function private.public_reply_trim(text),
  private.instagram_comment_public_replies_valid(jsonb),
  private.instagram_comment_public_reply_texts(jsonb),
  private.bind_instagram_comment_public_reply(public.instagram_events),
  private.enqueue_instagram_comment_public_reply(),
  public.sweep_instagram_comment_public_reply_leases(),
  public.prepare_instagram_comment_public_reply(uuid),
  public.claim_instagram_comment_public_reply(uuid,timestamptz,uuid,integer),
  public.complete_instagram_comment_public_reply(uuid,uuid,text,text,text),
  public.finish_instagram_comment_public_reply_work(bigint,text,text) from public,anon,authenticated;
grant execute on function public.sweep_instagram_comment_public_reply_leases(),
  public.prepare_instagram_comment_public_reply(uuid),
  public.claim_instagram_comment_public_reply(uuid,timestamptz,uuid,integer),
  public.complete_instagram_comment_public_reply(uuid,uuid,text,text,text),
  public.finish_instagram_comment_public_reply_work(bigint,text,text) to service_role;
